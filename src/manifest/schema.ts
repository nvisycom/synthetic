/**
 * @fileoverview Runtime validation for the ground-truth manifest.
 *
 * The manifest is written by the generator and read back by the scorer, often
 * on a different machine and long afterwards. Types vanish at that boundary, so
 * without a check here a malformed or stale manifest parses into a shape the
 * scorer half-understands and grades against — producing confident numbers that
 * are wrong, which is worse than no numbers at all.
 *
 * The schemas therefore reject rather than repair. Every object is strict, so
 * an unrecognized field is an error instead of silently ignored data: a field
 * the scorer does not know about is a version mismatch, and guessing past it is
 * how a benchmark starts lying.
 *
 * @module datatypes/schema
 */

import { z } from "zod";
import { ADVERSARIAL_KINDS, SURFACE_FORMS } from "#/datatypes/entity.ts";
import type { Label } from "#/datatypes/label.ts";
import { isLabel } from "#/datatypes/label.ts";
import type { Range } from "#/datatypes/location.ts";
import { DOCUMENT_FORMATS, MODALITY_KINDS } from "#/datatypes/record.ts";

/** A non-negative integer, as every offset and dimension here must be. */
const offset = z.number().int().nonnegative();

/** SHA-256, hex-encoded and lowercase. */
const digestSchema = z
	.string()
	.regex(/^[0-9a-f]{64}$/, "Digest must be a SHA-256 hex");

/** An identifier: non-empty, and trimmed so two ids cannot differ by spacing. */
const identifier = z
	.string()
	.min(1)
	.refine((value) => value === value.trim(), {
		message: "Identifier must not have leading or trailing whitespace",
	});

/**
 * A half-open range.
 *
 * `end` may equal `start` — an empty range is meaningful for a zero-width
 * position — but may never precede it.
 */
export const RangeSchema = z
	.strictObject({ start: offset, end: offset })
	.refine((range) => range.end >= range.start, {
		message: "Range end must not precede its start",
	});

export const TextLocationSchema = z.strictObject({
	kind: z.literal("text"),
	// At least one range, since a location with none places nothing. Typed as
	// a non-empty tuple so the inferred type matches `TextLocation` exactly;
	// `.nonempty()` alone checks at runtime but still infers a plain array.
	ranges: z.array(RangeSchema).nonempty() as unknown as z.ZodType<
		[Range, ...Range[]]
	>,
	page: offset.optional(),
});

export const ImageLocationSchema = z
	.strictObject({
		kind: z.literal("image"),
		min: z.strictObject({ x: offset, y: offset }),
		max: z.strictObject({ x: offset, y: offset }),
		page: offset.optional(),
	})
	.refine((box) => box.max.x >= box.min.x && box.max.y >= box.min.y, {
		message: "Bounding box corners must not be inverted",
	});

export const AudioLocationSchema = z.strictObject({
	kind: z.literal("audio"),
	span: RangeSchema,
	speaker: z.string().min(1).optional(),
});

export const LocationSchema = z.discriminatedUnion("kind", [
	TextLocationSchema,
	ImageLocationSchema,
	AudioLocationSchema,
]);

/**
 * A label id.
 *
 * Validated against the taxonomy rather than accepted as a free string: a label
 * outside it can never match a detection, so catching it when the manifest is
 * read points at the real problem instead of surfacing later as a phantom
 * recall failure.
 */
export const LabelSchema: z.ZodType<Label> = z.custom<Label>(
	(value) => typeof value === "string" && isLabel(value),
	{ message: "Unknown label id" },
);

export const EntitySchema = z.strictObject({
	id: identifier,
	label: LabelSchema,
	value: z.string().min(1),
	variants: z.partialRecord(z.enum(SURFACE_FORMS), z.string()).optional(),
	adversarial: z.enum(ADVERSARIAL_KINDS).optional(),
	note: z.string().optional(),
});

export const OccurrenceSchema = z.strictObject({
	id: identifier,
	entityId: identifier,
	modalityId: identifier,
	surface: z.enum(SURFACE_FORMS),
	text: z.string().min(1),
	transcribed: z.string().optional(),
	location: LocationSchema,
	splitAcross: z
		.enum(["line", "page", "cell", "paragraph", "column"])
		.optional(),
});

export const ModalitySchema = z.strictObject({
	id: identifier,
	kind: z.enum(MODALITY_KINDS),
	path: z.string().min(1),
	text: z.string().optional(),
	dimensions: z
		.strictObject({
			width: z.number().int().positive(),
			height: z.number().int().positive(),
			pages: z.number().int().positive().optional(),
		})
		.optional(),
	durationUs: offset.optional(),
});

/**
 * How a record was produced.
 */
export const ProvenanceSchema = z.strictObject({
	renderer: z.string().min(1),
	seed: z.number().int().safe(),
	transforms: z.array(z.string().min(1)).optional(),
});

/**
 * One record's entry in the corpus index.
 */
export const RecordEntrySchema = z.strictObject({
	id: identifier,
	format: z.enum(DOCUMENT_FORMATS),
	specId: identifier,
	path: z.string().min(1),
	digest: digestSchema,
});

/**
 * The corpus index.
 *
 * Small by construction: it names what the corpus holds without carrying the
 * ground truth, so planning a run does not mean parsing every entity in it.
 */
export const ManifestSchema = z
	.strictObject({
		// A single supported version, refused rather than migrated. Guessing at
		// an unknown layout is exactly the failure this file exists to prevent.
		version: z.literal(1),
		seed: z.number().int().safe(),
		generator: z.string().min(1),
		createdAt: z.iso.datetime(),
		records: z.array(RecordEntrySchema),
	})
	.superRefine((manifest, ctx) => {
		const seen = new Set<string>();
		for (const [index, record] of manifest.records.entries()) {
			if (seen.has(record.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["records", index, "id"],
					message: `Duplicate record id ${JSON.stringify(record.id)}`,
				});
			}
			seen.add(record.id);
		}
	});

/**
 * One record's answer key, with the cross-references between its parts checked.
 *
 * The referential checks matter as much as the field types. An occurrence
 * pointing at an entity that does not exist is not a scoring input, it is a
 * generator bug, and this file is the last place it can be caught before it
 * quietly becomes a miss in someone's report.
 */
export const CorpusRecordSchema = z
	.strictObject({
		version: z.literal(1),
		id: identifier,
		format: z.enum(DOCUMENT_FORMATS),
		specId: identifier,
		artifact: z.string().min(1),
		digest: digestSchema,
		provenance: ProvenanceSchema,
		modalities: z.array(ModalitySchema),
		entities: z.array(EntitySchema),
		occurrences: z.array(OccurrenceSchema),
	})
	.superRefine((record, ctx) => {
		const entityIds = new Set<string>();
		for (const entity of record.entities) {
			if (entityIds.has(entity.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["entities"],
					message: `Duplicate entity id ${JSON.stringify(entity.id)}`,
				});
			}
			entityIds.add(entity.id);
		}

		const modalityIds = new Set<string>();
		for (const modality of record.modalities) {
			if (modalityIds.has(modality.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["modalities"],
					message: `Duplicate modality id ${JSON.stringify(modality.id)}`,
				});
			}
			modalityIds.add(modality.id);
		}

		const occurrenceIds = new Set<string>();
		for (const [index, occurrence] of record.occurrences.entries()) {
			if (occurrenceIds.has(occurrence.id)) {
				ctx.addIssue({
					code: "custom",
					path: ["occurrences", index, "id"],
					message: `Duplicate occurrence id ${JSON.stringify(occurrence.id)}`,
				});
			}
			occurrenceIds.add(occurrence.id);

			if (!entityIds.has(occurrence.entityId)) {
				ctx.addIssue({
					code: "custom",
					path: ["occurrences", index, "entityId"],
					message: `No entity ${JSON.stringify(occurrence.entityId)} in this record`,
				});
			}
			if (!modalityIds.has(occurrence.modalityId)) {
				ctx.addIssue({
					code: "custom",
					path: ["occurrences", index, "modalityId"],
					message: `No modality ${JSON.stringify(occurrence.modalityId)} in this record`,
				});
			}
		}
	});

/**
 * Raised when a corpus file cannot be trusted.
 */
export class ManifestError extends Error {
	override readonly name = "ManifestError";

	/**
	 * Every problem found, one line each, for logging.
	 *
	 * Assigned in the body rather than declared as a parameter property, which
	 * Node's type stripping does not support — the CLI runs from source, so a
	 * parameter property here would crash it while still passing tests.
	 */
	readonly issues: readonly string[];

	constructor(message: string, issues: readonly string[]) {
		super(message);
		this.issues = issues;
	}
}

/**
 * Parses and validates a manifest.
 *
 * @param value - Parsed JSON, not a raw string
 * @returns The manifest, typed and checked
 * @throws {ManifestError} If it is malformed, listing every problem rather than
 * only the first, so one read reports everything wrong with the file
 */
export function parseManifest(value: unknown): z.infer<typeof ManifestSchema> {
	return parseWith(ManifestSchema, value, "Manifest");
}

/**
 * Validates against a schema, reporting every problem rather than only the
 * first, so one read tells you everything wrong with a file.
 */
function parseWith<T extends z.ZodType>(
	schema: T,
	value: unknown,
	subject: string,
): z.infer<T> {
	const result = schema.safeParse(value);
	if (result.success) {
		return result.data;
	}

	const issues = result.error.issues.map((issue) => {
		const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		return `${path}: ${issue.message}`;
	});

	throw new ManifestError(
		`${subject} is not valid (${issues.length} ${
			issues.length === 1 ? "problem" : "problems"
		})`,
		issues,
	);
}
/**
 * Parses and validates one record's answer key.
 *
 * @param value - Parsed JSON, not a raw string
 * @throws {ManifestError} If it is malformed, listing every problem at once
 */
export function parseRecord(
	value: unknown,
): z.infer<typeof CorpusRecordSchema> {
	return parseWith(CorpusRecordSchema, value, "Record");
}
