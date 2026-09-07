/**
 * @fileoverview Validation for run files.
 *
 * A run is written by the runner and read back by the scorer, often much later
 * and against a corpus generated separately. The same reasoning as the manifest
 * applies: types vanish at that boundary, and a run the scorer half-understands
 * produces confident numbers that are wrong.
 *
 * One field is deliberately permissive. A detection's label is validated as a
 * non-empty string rather than against the taxonomy, because a pipeline may
 * legitimately report a label this harness does not know — a newer catalog, a
 * custom recognizer. Refusing the file would discard a whole run over a label
 * scoring can simply report as unrecognized.
 *
 * @module runner/schema
 */

import { z } from "zod";
import { LocationSchema } from "#/manifest/schema.ts";

/** A non-negative integer. */
const count = z.number().int().nonnegative();

/** An identifier: non-empty and trimmed. */
const identifier = z
	.string()
	.min(1)
	.refine((value) => value === value.trim(), {
		message: "Identifier must not have leading or trailing whitespace",
	});

export const DetectedSchema = z.strictObject({
	id: identifier,
	// Not checked against the taxonomy: see the module note.
	label: z.string().min(1),
	location: LocationSchema,
	text: z.string().optional(),
	confidence: z.number().min(0).max(1).optional(),
	recognizer: z.string().min(1).optional(),
});

export const RecordOutcomeSchema = z.discriminatedUnion("status", [
	z.strictObject({
		status: z.literal("detected"),
		recordId: identifier,
		detectionId: identifier,
		detected: z.array(DetectedSchema),
		durationMs: count,
	}),
	z.strictObject({
		status: z.literal("failed"),
		recordId: identifier,
		stage: z.enum(["upload", "detect", "await", "read"]),
		message: z.string().min(1),
		detectionId: identifier.optional(),
	}),
]);

export const RunSchema = z
	.strictObject({
		version: z.literal(1),
		id: identifier,
		corpusSeed: z.number().int(),
		corpusDigest: z
			.string()
			.regex(/^[0-9a-f]{64}$/, "Digest must be a SHA-256 hex"),
		workspace: identifier,
		pipeline: identifier,
		runner: z.string().min(1),
		startedAt: z.iso.datetime(),
		finishedAt: z.iso.datetime(),
		records: z.array(
			z.strictObject({
				recordId: identifier,
				path: z.string().min(1),
				status: z.enum(["detected", "failed"]),
			}),
		),
	})
	.superRefine((run, ctx) => {
		const seen = new Set<string>();
		for (const [index, entry] of run.records.entries()) {
			if (seen.has(entry.recordId)) {
				ctx.addIssue({
					code: "custom",
					path: ["records", index, "recordId"],
					message: `Duplicate record id ${JSON.stringify(entry.recordId)}`,
				});
			}
			seen.add(entry.recordId);
		}

		if (Date.parse(run.finishedAt) < Date.parse(run.startedAt)) {
			ctx.addIssue({
				code: "custom",
				path: ["finishedAt"],
				message: "A run cannot finish before it started",
			});
		}
	});

/**
 * Raised when a run file cannot be trusted.
 */
export class RunError extends Error {
	override readonly name = "RunError";

	/** Every problem found, one line each. */
	readonly issues: readonly string[];

	constructor(message: string, issues: readonly string[]) {
		super(message);
		this.issues = issues;
	}
}

/**
 * Validates against a schema, reporting every problem at once.
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

	throw new RunError(
		`${subject} is not valid (${issues.length} ${
			issues.length === 1 ? "problem" : "problems"
		})`,
		issues,
	);
}

/**
 * Parses and validates a run index.
 *
 * @throws {RunError} If it is malformed
 */
export function parseRun(value: unknown): z.infer<typeof RunSchema> {
	return parseWith(RunSchema, value, "Run");
}

/**
 * Parses and validates one record's outcome.
 *
 * @throws {RunError} If it is malformed
 */
export function parseOutcome(
	value: unknown,
): z.infer<typeof RecordOutcomeSchema> {
	return parseWith(RecordOutcomeSchema, value, "Outcome");
}
