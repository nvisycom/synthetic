/**
 * @fileoverview Validation for record specifications.
 *
 * Specs are hand-written and tracked in `data/`, which makes them the one input
 * here a person edits directly — and so the one most likely to carry a typo. A
 * bare cast let a malformed spec through to fail much later: omitting `format`
 * surfaced as a manifest schema error at *write* time, naming a field the spec
 * does not even have, three steps from the file that was actually wrong.
 *
 * Checked once at load, a spec fails with its own path and every problem at
 * once.
 *
 * @module generator/spec.schema
 */

import { z } from "zod";
import { ADVERSARIAL_KINDS, SURFACE_FORMS } from "#/datatypes/entity.ts";
import type { Label } from "#/datatypes/label.ts";
import { isLabel, LABEL_IDS } from "#/datatypes/label.ts";
import { DOCUMENT_FORMATS } from "#/datatypes/record.ts";
import { HarnessError } from "#/error.ts";

/**
 * A label id, checked against the taxonomy.
 *
 * The error names some real labels, because the usual mistake is a plausible
 * invention — `ssn` for `government_id`, `medical_record_number` for
 * `medical_id` — and a bare rejection leaves the author guessing.
 */
const label: z.ZodType<Label> = z.custom<Label>(
	(value) => typeof value === "string" && isLabel(value),
	{
		message: `Unknown label. Valid labels include: ${LABEL_IDS.slice(0, 6).join(", ")}, and ${LABEL_IDS.length - 6} more`,
	},
);

/**
 * A slot name, as a template references it.
 *
 * Restricted to the characters the placeholder pattern matches, so a name that
 * could never be referenced is rejected at load rather than silently going
 * unplanted.
 */
const slotName = z
	.string()
	.min(1)
	.regex(
		/^[a-zA-Z0-9_-]+$/,
		"Slot names may only contain letters, digits, underscores, and hyphens",
	);

export const SlotSpecSchema = z.strictObject({
	name: slotName,
	label,
	surfaces: z.array(z.enum(SURFACE_FORMS)).nonempty().optional(),
	expect: z.enum(["detected", "ignored"]).optional(),
	adversarial: z.enum(ADVERSARIAL_KINDS).optional(),
	note: z.string().min(1).optional(),
	value: z.string().min(1).optional(),
});

export const RecordSpecSchema = z
	.strictObject({
		version: z.literal(1),
		id: z
			.string()
			.min(1)
			.regex(
				/^[a-z0-9-]+$/,
				"Spec ids are lowercase, digits, and hyphens; the id is also the directory name",
			),
		description: z.string().min(1),
		format: z.enum(DOCUMENT_FORMATS),
		slots: z.array(SlotSpecSchema).nonempty(),
		// A bare filename, resolved inside the spec's own directory. A path is
		// rejected outright rather than resolved and checked, since a spec has no
		// reason to reach outside its folder and the narrow rule is the one that
		// cannot be worked around.
		template: z
			.string()
			.min(1)
			.regex(
				/^[a-zA-Z0-9._-]+$/,
				"Template must be a filename in the spec's own directory, not a path",
			)
			.refine((name) => name !== "." && name !== "..", {
				message: "Template must name a file",
			})
			.optional(),
	})
	.superRefine((spec, ctx) => {
		const seen = new Set<string>();
		for (const [index, slot] of spec.slots.entries()) {
			if (seen.has(slot.name)) {
				// A template referencing a duplicated name would plant one of them
				// and leave the other with no occurrence, scoring as a value the
				// pipeline missed but that was never there.
				ctx.addIssue({
					code: "custom",
					path: ["slots", index, "name"],
					message: `Duplicate slot name ${JSON.stringify(slot.name)}`,
				});
			}
			seen.add(slot.name);

			// `note` explains what makes a case hard, so it only means something
			// alongside the flag that says it is hard.
			if (slot.note !== undefined && slot.adversarial === undefined) {
				ctx.addIssue({
					code: "custom",
					path: ["slots", index, "note"],
					message: "A note needs an adversarial kind to annotate",
				});
			}
		}
	});

/**
 * Raised when a spec cannot be used.
 */
export class SpecError extends HarnessError {
	override readonly name = "SpecError";
}

/**
 * Parses and validates a spec.
 *
 * @param value - Parsed JSON, not a raw string
 * @param path - Where it came from, so the error names the file to fix
 * @throws {SpecError} Listing every problem rather than only the first
 */
export function parseSpec(
	value: unknown,
	path: string,
): z.infer<typeof RecordSpecSchema> {
	const result = RecordSpecSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}

	const issues = result.error.issues.map((issue) => {
		const where = issue.path.length > 0 ? issue.path.join(".") : "(root)";
		return `${where}: ${issue.message}`;
	});

	throw new SpecError(
		`Spec at ${path} is not valid (${issues.length} ${
			issues.length === 1 ? "problem" : "problems"
		})`,
		issues,
	);
}
