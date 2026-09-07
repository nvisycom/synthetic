/**
 * @fileoverview Generating one record from a spec.
 *
 * The last step is the important one: every recorded offset is sliced back out
 * of the text that was actually produced and compared to the value it claims to
 * cover. Ground truth is never taken on the renderer's word, because an answer
 * key that is subtly wrong is worse than one that is obviously broken — it
 * scores, and the numbers look fine.
 *
 * @module generator/record
 */

import { createHash } from "node:crypto";
import type { Entity, SurfaceForm } from "#/datatypes/entity.ts";
import type { CorpusRecord, Occurrence } from "#/datatypes/record.ts";
import type { Random } from "#/random.ts";
import { sliceByteRange } from "#/util/offset.ts";
import { fabricate, isFabricable, seedFaker } from "./fabricate.ts";
import type { Rendered } from "./render/index.ts";
import { RENDERABLE_FORMATS, rendererFor } from "./render/index.ts";
import type { LoadedSpec } from "./spec.ts";
import { slotsUsed, TemplateError } from "./template.ts";

/** The modality a text record's body is recorded against. */
const BODY = "mod_body";

/**
 * Raised when a record could not be generated, or could not be trusted.
 */
export class GeneratorError extends Error {
	override readonly name = "GeneratorError";
}

/**
 * Checks a spec against its template.
 *
 * Run once per spec rather than per record, so a typo is reported once instead
 * of four thousand times.
 *
 * @throws {GeneratorError} If they disagree, or a slot asks for a label the
 * generator cannot fabricate
 */
export function validateSpec(loaded: LoadedSpec): void {
	const { spec, template } = loaded;
	const declared = new Set(spec.slots.map((slot) => slot.name));
	const problems: string[] = [];

	if (!RENDERABLE_FORMATS.includes(spec.format)) {
		// Accepting a format nothing renders would write plain text into a
		// `document.pdf` and record it as a valid PDF record — a corpus that looks
		// generated and is not.
		problems.push(
			`format ${JSON.stringify(spec.format)} has no renderer yet; supported: ${RENDERABLE_FORMATS.join(", ")}`,
		);
	}

	for (const slot of spec.slots) {
		if (slot.value === undefined && !isFabricable(slot.label)) {
			// Planting a placeholder no detector would recognize would score as a
			// miss and say nothing about the pipeline.
			problems.push(
				`slot ${JSON.stringify(slot.name)} wants label ${JSON.stringify(slot.label)}, which has no builder`,
			);
		}
	}

	const body =
		typeof template === "string" ? template : JSON.stringify(template);
	for (const name of slotsUsed(body)) {
		if (!declared.has(name)) {
			problems.push(
				`template references slot ${JSON.stringify(name)}, which is not declared`,
			);
		}
	}

	const used = new Set(slotsUsed(body));
	for (const slot of spec.slots) {
		if (!used.has(slot.name)) {
			// An unplanted slot would appear in the answer key with no occurrence,
			// scoring as a value the pipeline missed but that was never there.
			problems.push(`slot ${JSON.stringify(slot.name)} is never planted`);
		}
	}

	if (problems.length > 0) {
		throw new GeneratorError(
			`Spec ${JSON.stringify(spec.id)} is not usable:\n  ${problems.join("\n  ")}`,
		);
	}
}

/**
 * Asserts that every occurrence slices back to the value it claims.
 *
 * The check that makes ground truth trustworthy. A mistake in offset arithmetic
 * does not throw on its own; it shifts a span, and every boundary number
 * computed from it is quietly wrong.
 *
 * @throws {GeneratorError} On the first occurrence that does not match
 */
export function verifyOccurrences(
	text: string,
	occurrences: readonly Occurrence[],
): void {
	for (const occurrence of occurrences) {
		// Tabular values are addressed by cell rather than by an offset into the
		// document, so there is no decoded range to slice; verifySourceRanges
		// checks them against the file instead.
		if (occurrence.location.kind !== "text") continue;

		let found = "";
		for (const range of occurrence.location.ranges) {
			try {
				found += sliceByteRange(text, range);
			} catch (cause) {
				throw new GeneratorError(
					`Occurrence ${occurrence.id} has an unusable range [${range.start}, ${range.end}): ${(cause as Error).message}`,
				);
			}
		}

		if (found !== occurrence.text) {
			throw new GeneratorError(
				`Occurrence ${occurrence.id} claims ${JSON.stringify(occurrence.text)} but its range covers ${JSON.stringify(found)}`,
			);
		}
	}
}

/**
 * Resolves XML entities in a fragment.
 */
function unescapeXml(fragment: string): string {
	return (
		fragment
			.replaceAll("&lt;", "<")
			.replaceAll("&gt;", ">")
			.replaceAll("&quot;", '"')
			.replaceAll("&apos;", "'")
			// Ampersand last, so "&amp;lt;" does not become "<".
			.replaceAll("&amp;", "&")
	);
}

/**
 * Resolves JSON escapes in a fragment, leaving it alone if it is not escaped.
 */
function unescapeJson(fragment: string): string {
	try {
		return JSON.parse(`"${fragment}"`) as string;
	} catch {
		return fragment;
	}
}

/**
 * Asserts that every source range covers its value in the rendered file.
 *
 * The decoded ranges are checked against the planted text; these check the
 * other coordinate system, against the bytes actually written. A source range
 * points at what a redactor would overwrite, so one that is off by the width of
 * an escape would silently score a correct redaction as a boundary miss.
 *
 * The slice is compared to the value *as escaped*, since that is what is
 * physically there.
 *
 * @throws {GeneratorError} On the first range that does not match
 */
export function verifySourceRanges(
	rendered: string,
	occurrences: readonly Occurrence[],
): void {
	for (const occurrence of occurrences) {
		const { location } = occurrence;
		if (location.kind !== "text" && location.kind !== "tabular") continue;
		const { source } = location;
		if (source === undefined) continue;

		let found = "";
		for (const range of source) {
			try {
				found += sliceByteRange(rendered, range);
			} catch (cause) {
				throw new GeneratorError(
					`Occurrence ${occurrence.id} has an unusable source range [${range.start}, ${range.end}): ${(cause as Error).message}`,
				);
			}
		}

		// The rendered bytes carry the value's escaped form, so unescape before
		// comparing rather than requiring the two to be byte-identical. JSON uses
		// backslashes; CSV doubles a quote inside a quoted cell.
		// The escaping a fragment carries depends on the format that wrote it, so
		// accept any resolution that recovers the value rather than threading the
		// format through. A fragment that matches under none of them is a genuine
		// mismatch.
		const candidates = [
			found,
			found.replaceAll('""', '"'),
			unescapeJson(found),
			unescapeXml(found),
		];

		if (!candidates.includes(occurrence.text)) {
			throw new GeneratorError(
				`Occurrence ${occurrence.id} claims ${JSON.stringify(occurrence.text)} but its source range covers ${JSON.stringify(found)}`,
			);
		}
	}
}

/**
 * What generating a record produced.
 */
export interface Generated {
	/** The answer key. */
	record: CorpusRecord;
	/** The artifact's bytes, for the caller to write. */
	artifact: string;
}

/**
 * Generates one record.
 *
 * @param spec - The kind of document to generate
 * @param id - The record's stable identifier
 * @param random - The record's own stream, forked from the corpus seed
 */
export function generateRecord(
	loaded: LoadedSpec,
	id: string,
	random: Random,
	seed: number,
): Generated {
	const { spec, template } = loaded;
	seedFaker(random);

	const entities: Entity[] = [];
	const bySlot = new Map<string, Entity>();

	for (const [index, slot] of spec.slots.entries()) {
		const surfaces: SurfaceForm[] = slot.surfaces ?? ["canonical"];
		const entity = fabricate(
			`ent_${String(index).padStart(4, "0")}`,
			slot.label,
			surfaces,
			random,
			slot.value,
		);

		if (slot.expect !== undefined) entity.expect = slot.expect;
		if (slot.adversarial !== undefined) entity.adversarial = slot.adversarial;
		if (slot.note !== undefined) entity.note = slot.note;

		entities.push(entity);
		bySlot.set(slot.name, entity);
	}

	const render = rendererFor(spec.format);
	if (render === undefined) {
		throw new GeneratorError(
			`Record ${id}: format ${JSON.stringify(spec.format)} has no renderer`,
		);
	}

	let rendered: Rendered;
	try {
		rendered = render(template, bySlot, BODY);
	} catch (cause) {
		if (cause instanceof TemplateError) {
			throw new GeneratorError(
				`Record ${id} from spec ${JSON.stringify(spec.id)}: ${cause.message}`,
			);
		}
		throw cause;
	}

	// Ground truth is verified against the artifact, not assumed from it: the
	// decoded ranges against the text a detector reads, and the source ranges
	// against the bytes on disk.
	verifyOccurrences(rendered.decoded, rendered.occurrences);
	verifySourceRanges(rendered.text, rendered.occurrences);

	const artifact = rendered.text;
	const digest = createHash("sha256").update(artifact, "utf8").digest("hex");

	return {
		artifact,
		record: {
			version: 1,
			id,
			format: spec.format,
			specId: spec.id,
			artifact: `document.${spec.format}`,
			digest,
			provenance: { renderer: `ts:${spec.format}`, seed },
			modalities: [
				{ id: BODY, kind: "text", path: "body", text: rendered.decoded },
			],
			entities,
			occurrences: rendered.occurrences,
		},
	};
}
