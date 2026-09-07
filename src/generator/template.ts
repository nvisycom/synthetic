/**
 * @fileoverview Planting values into a text template.
 *
 * A template is plain text with `{{slot}}` placeholders, and `{{slot:surface}}`
 * to write a slot in a particular form. Everything else is literal, so an
 * author controls exactly where a value lands.
 *
 * Offsets are recorded as the text is built rather than searched for
 * afterwards. Searching would find the wrong occurrence whenever a value
 * appears twice, or when one planted value happens to contain another — a
 * street number inside an account number, a first name inside an email — and
 * the resulting answer key would point at the wrong bytes while looking
 * entirely correct.
 *
 * @module generator/template
 */

import type { Entity, SurfaceForm } from "#/datatypes/entity.ts";
import type { Location, Range } from "#/datatypes/location.ts";
import type { Occurrence } from "#/datatypes/record.ts";
import { HarnessError } from "#/error.ts";
import { byteLength } from "#/util/offset.ts";

/**
 * `{{slot}}` or `{{slot:surface}}`.
 *
 * Global, and therefore stateful: every caller must reset `lastIndex` before
 * using it. {@link hasPlaceholder} exists so a one-off test does not have to
 * remember that, since forgetting leaves the next scan starting mid-string.
 */
export const PLACEHOLDER =
	/\{\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*([a-zA-Z_]+)\s*)?\}\}/g;

/**
 * What a template produced.
 */
export interface Planted {
	/** The rendered text. */
	text: string;

	/** Every value planted in it, with its exact position. */
	occurrences: Occurrence[];
}

/**
 * What a placeholder resolved to.
 */
export interface Resolved {
	/** The entity the slot names. */
	entity: Entity;

	/** Which of its forms the placeholder asked for. */
	surface: SurfaceForm;

	/** That form's text. */
	value: string;
}

/**
 * How a format writes a value at one particular spot in a document.
 *
 * Per spot rather than per format, because one format can escape differently
 * from one place to the next: XML replaces `&` with `&amp;` in element text and
 * leaves it alone inside CDATA, and a value planted in the wrong one is either
 * corrupted or double-escaped.
 */
export type Escape = (value: string) => string;

/**
 * Writes a value unchanged, for the places a format escapes nothing.
 */
export const verbatim: Escape = (value) => value;

/**
 * A marker that has been located in the serialized document.
 *
 * What a renderer needs in order to say where the value ended up, and in
 * whatever coordinate system that format uses.
 */
export interface Placement<Context> {
	/** The entity, surface, and value the placeholder resolved to. */
	resolved: Resolved;

	/** Whatever the renderer attached when it placed the marker. */
	context: Context;

	/** The bytes the written value occupies in the finished document. */
	range: Range;
}

/**
 * Delimits a marker: U+007F, which nothing else in a document can be.
 *
 * It has to survive serialization byte for byte, or the position it marks is
 * not the position the value gets. `JSON.stringify` escapes only below U+0020,
 * XML and CSV escape neither, and no fabricated value or template contains it —
 * faker does not emit control characters, and {@link Markers.place} refuses a
 * value that does.
 */
const MARKER = "\u007f";

/**
 * Raised when a template and its slots disagree.
 */
export class TemplateError extends HarnessError {
	override readonly name = "TemplateError";
}

/**
 * Returns whether a string carries a placeholder.
 *
 * Resets the shared pattern first, so a caller cannot be caught out by where a
 * previous scan happened to stop.
 */
export function hasPlaceholder(text: string): boolean {
	PLACEHOLDER.lastIndex = 0;
	return PLACEHOLDER.test(text);
}

/**
 * Looks up the value a placeholder asks for.
 *
 * Shared by every renderer, so a template means the same thing whatever format
 * it is written into.
 *
 * @throws {TemplateError} If the slot is unknown, or lacks the requested form
 */
export function resolveSlot(
	entities: ReadonlyMap<string, Entity>,
	name: string | undefined,
	requested: string | undefined,
): Resolved {
	if (name === undefined) {
		throw new TemplateError("Malformed placeholder");
	}

	const entity = entities.get(name);
	if (entity === undefined) {
		throw new TemplateError(
			`Template references slot ${JSON.stringify(name)}, which the spec does not define`,
		);
	}

	const surface = (requested ?? "canonical") as SurfaceForm;
	const value =
		surface === "canonical" ? entity.value : entity.variants?.[surface];
	if (value === undefined) {
		throw new TemplateError(
			`Slot ${JSON.stringify(name)} has no ${JSON.stringify(surface)} form; declare it in the spec's surfaces`,
		);
	}

	return { entity, surface, value };
}

/**
 * Renders a template, planting entities and recording where each landed.
 *
 * @param body - The template text
 * @param entities - Entities by slot name
 * @param modalityId - The modality occurrences are recorded against
 * @throws {TemplateError} If a placeholder names an unknown slot, or asks for a
 * surface form the entity does not have
 */
export function plant(
	body: string,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): Planted {
	const occurrences: Occurrence[] = [];
	let text = "";
	// Tracked alongside the string so a value's offset never has to be searched
	// for. Bytes, not characters: the answer key records UTF-8 offsets.
	let bytes = 0;
	let last = 0;
	let index = 0;

	PLACEHOLDER.lastIndex = 0;
	let match = PLACEHOLDER.exec(body);
	while (match !== null) {
		const [placeholder, name, requested] = match;

		const literal = body.slice(last, match.index);
		text += literal;
		bytes += byteLength(literal);

		const { entity, surface, value } = resolveSlot(entities, name, requested);

		const start = bytes;
		text += value;
		bytes += byteLength(value);

		occurrences.push({
			id: `occ_${String(index).padStart(4, "0")}`,
			entityId: entity.id,
			modalityId,
			surface,
			text: value,
			// Plain text escapes nothing, so the file carries the value as-is.
			written: value,
			location: { kind: "text", ranges: [{ start, end: bytes }] },
		});
		index++;

		last = match.index + placeholder.length;
		match = PLACEHOLDER.exec(body);
	}

	text += body.slice(last);

	return { text, occurrences };
}

/**
 * Returns every slot name a template references, in order of first use.
 *
 * Used to check a spec against its template before generating, so a typo in
 * either is caught once rather than at every record.
 */
export function slotsUsed(body: string): string[] {
	const names: string[] = [];
	PLACEHOLDER.lastIndex = 0;

	let match = PLACEHOLDER.exec(body);
	while (match !== null) {
		const name = match[1];
		if (name !== undefined && !names.includes(name)) names.push(name);
		match = PLACEHOLDER.exec(body);
	}

	return names;
}

/**
 * Substitutes a template's placeholders for unique markers, to be resolved
 * after the document has been serialized.
 *
 * The problem this solves: a structured format decides how a value is written —
 * a quote becomes `\"` in JSON, an ampersand `&amp;` in XML, a comma forces
 * quotes around a CSV cell — and none of that is known until the document is
 * built. Building it by hand to watch each escape go by is one answer, and the
 * one this used to take; the cost was a serializer per format, written and
 * maintained here, doing what the format's own serializer already does.
 *
 * Instead the document is serialized normally with a marker where each value
 * belongs, and the markers are replaced afterwards. A marker survives
 * serialization unchanged — it holds nothing any format escapes — so where it
 * lands is where the value lands.
 *
 * A marker rather than the value itself, because afterwards the value would have
 * to be found, and searching finds the wrong copy. A document that mentions
 * `Dana Reyes` in a subject line and plants it in a field has two matches and no
 * way to tell them apart; the corpus makes this common on purpose, planting
 * repeated references for coreference and names that collide with ordinary words.
 * A marker carries its occurrence's own id, so there is nothing to disambiguate.
 */
export class Markers<Context = undefined> {
	/** What each marker stands for, by marker text. */
	private readonly planted = new Map<
		string,
		{ resolved: Resolved; escapeWith: Escape; context: Context }
	>();

	/**
	 * Returns a marker standing in for a placeholder's value.
	 *
	 * @param escapeWith - How this spot in the document writes a value
	 * @param context - Whatever the renderer needs back when locating the value,
	 * such as which cell of a table it was written into
	 * @throws {TemplateError} If the slot is unknown, or lacks the requested form
	 */
	place(
		entities: ReadonlyMap<string, Entity>,
		name: string | undefined,
		requested: string | undefined,
		escapeWith: Escape,
		context: Context,
	): string {
		const resolved = resolveSlot(entities, name, requested);
		if (resolved.value.includes(MARKER)) {
			// Only reachable from a spec with a literal U+007F in it. Refused rather
			// than planted, since it would be indistinguishable from a marker and
			// would corrupt every position after it.
			throw new TemplateError(
				`Slot ${JSON.stringify(name)} contains U+007F, which the renderer reserves`,
			);
		}

		const marker = `${MARKER}${this.planted.size}${MARKER}`;
		this.planted.set(marker, { resolved, escapeWith, context });
		return marker;
	}

	/**
	 * Replaces every marker in a serialized document with its escaped value.
	 *
	 * Markers are resolved in the order they appear in the document rather than
	 * the order they were placed, so the occurrences a record reports read in
	 * document order — the order a person checking the answer key expects, and
	 * the order a detector returns its findings in.
	 *
	 * @param document - The serialized document, markers still in place
	 * @param modalityId - The modality occurrences are recorded against
	 * @param locate - Turns a located value into this format's own coordinates;
	 * defaults to a byte range into the file, which is what every format but a
	 * tabular one uses
	 * @throws {TemplateError} If a marker was placed but never serialized
	 */
	resolve(
		document: string,
		modalityId: string,
		locate: (placement: Placement<Context>) => Location = ({ range }) => ({
			kind: "text",
			ranges: [range],
		}),
	): Planted {
		let text = document;
		let searchFrom = 0;
		const occurrences: Occurrence[] = [];

		for (;;) {
			const at = text.indexOf(MARKER, searchFrom);
			if (at === -1) break;

			const close = text.indexOf(MARKER, at + MARKER.length);
			if (close === -1) {
				throw new TemplateError(
					`Unterminated marker in the serialized document at ${at}`,
				);
			}
			const marker = text.slice(at, close + MARKER.length);

			const placed = this.planted.get(marker);
			if (placed === undefined) {
				throw new TemplateError(
					`Serialized document carries an unknown marker ${JSON.stringify(marker)}`,
				);
			}
			this.planted.delete(marker);

			// The value as the file will carry it, which is what the range covers:
			// a redactor overwrites those bytes, not the value's logical form.
			const { resolved, context } = placed;
			const written = placed.escapeWith(resolved.value);
			const start = byteLength(text.slice(0, at));
			const range = { start, end: start + byteLength(written) };

			text = text.slice(0, at) + written + text.slice(at + marker.length);
			searchFrom = at + written.length;

			occurrences.push({
				id: `occ_${String(occurrences.length).padStart(4, "0")}`,
				entityId: resolved.entity.id,
				modalityId,
				surface: resolved.surface,
				text: resolved.value,
				written,
				location: locate({ resolved, context, range }),
			});
		}

		if (this.planted.size > 0) {
			// A template that put a placeholder somewhere the serializer dropped —
			// a duplicate object key, say. The document would be missing a value the
			// answer key claims is in it, so it is refused rather than scored.
			throw new TemplateError(
				`${this.planted.size} placeholder(s) did not survive serialization: ${[...this.planted.values()].map((p) => JSON.stringify(p.resolved.value)).join(", ")}`,
			);
		}

		return { text, occurrences };
	}
}
