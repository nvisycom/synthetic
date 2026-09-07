import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
	parseSpec,
	type RecordSpecSchema,
	type SlotSpecSchema,
	SpecError,
} from "./spec.schema.ts";
import type { RecordSpec, SlotSpec } from "./spec.ts";

/**
 * Mutual assignability, so the schema and the interface cannot drift: a field
 * added to one but not the other would either pass validation and be silently
 * absent, or be rejected at load for no visible reason.
 */
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const specMatches: Eq<z.infer<typeof RecordSpecSchema>, RecordSpec> = true;
const slotMatches: Eq<z.infer<typeof SlotSpecSchema>, SlotSpec> = true;

function valid(): unknown {
	return {
		version: 1,
		id: "claim-letter",
		description: "A well-behaved form.",
		format: "txt",
		slots: [
			{ name: "subject", label: "person_name", surfaces: ["canonical"] },
			{ name: "id", label: "government_id" },
		],
	};
}

/** Applies a change to a copy of the valid spec. */
function broken(mutate: (spec: never) => void): unknown {
	const spec = valid();
	mutate(spec as never);
	return spec;
}

/**
 * Asserts a spec is rejected for a particular reason.
 *
 * Matches the issue list rather than the message, since the message is only a
 * count while the detail is what a spec author actually needs.
 */
function expectRejected(spec: unknown, matching: RegExp): void {
	try {
		parseSpec(spec, "spec.json");
		expect.unreachable("should have thrown");
	} catch (error) {
		expect(error).toBeInstanceOf(SpecError);
		expect((error as SpecError).issues.join("\n")).toMatch(matching);
	}
}

describe("schema and interface agreement", () => {
	it("keeps the schema in step with the interface", () => {
		expect([specMatches, slotMatches]).toEqual([true, true]);
	});
});

describe("parseSpec", () => {
	it("accepts a well-formed spec", () => {
		const spec = parseSpec(valid(), "spec.json");
		expect(spec.id).toBe("claim-letter");
		expect(spec.slots).toHaveLength(2);
	});

	it("names the file in the error", () => {
		// The failure this fixes: a missing `format` used to surface as a manifest
		// error at write time, naming a field the spec does not have, three steps
		// from the file that was actually wrong.
		try {
			parseSpec({}, "data/specs/broken/spec.json");
			expect.unreachable("should have thrown");
		} catch (error) {
			expect((error as SpecError).message).toContain(
				"data/specs/broken/spec.json",
			);
		}
	});

	it("reports every problem at once", () => {
		try {
			parseSpec({ version: 1 }, "spec.json");
			expect.unreachable("should have thrown");
		} catch (error) {
			expect((error as SpecError).issues.length).toBeGreaterThan(1);
		}
	});

	it("catches a missing format", () => {
		expectRejected(
			broken((spec: never) => {
				delete (spec as { format?: unknown }).format;
			}),
			/format/,
		);
	});
});

describe("labels", () => {
	// The mistake here is always a plausible invention: `ssn` for
	// `government_id`, `medical_record_number` for `medical_id`. A planted label
	// no pipeline emits would read as a total recall miss rather than a typo.
	function withLabel(label: string): unknown {
		return broken((spec: never) => {
			const slot = (spec as { slots: { label: string }[] }).slots[0];
			if (slot) slot.label = label;
		});
	}

	it("rejects an invented label", () => {
		expectRejected(withLabel("ssn"), /Unknown label/);
	});

	it("suggests real labels, so the author is not left guessing", () => {
		expectRejected(withLabel("ssn"), /government_id/);
	});

	it("accepts a real label", () => {
		expect(() => parseSpec(withLabel("medical_id"), "spec.json")).not.toThrow();
	});
});

describe("slots", () => {
	it("rejects a duplicate slot name", () => {
		// A template can only reference one of them; the other would sit in the
		// answer key with no occurrence, scoring as a value the pipeline missed
		// but that was never there.
		expectRejected(
			broken((spec: never) => {
				const slots = (spec as { slots: unknown[] }).slots;
				slots.push({ ...(slots[0] as object) });
			}),
			/Duplicate slot name/,
		);
	});

	it("rejects a slot name a template could never reference", () => {
		expectRejected(
			broken((spec: never) => {
				const slot = (spec as { slots: { name: string }[] }).slots[0];
				if (slot) slot.name = "has spaces";
			}),
			/Slot names/,
		);
	});

	it("rejects a note with no adversarial kind to annotate", () => {
		expectRejected(
			broken((spec: never) => {
				const slot = (spec as { slots: { note?: string }[] }).slots[0];
				if (slot) slot.note = "explains nothing in particular";
			}),
			/adversarial kind/,
		);
	});

	it("accepts a note alongside an adversarial kind", () => {
		const spec = broken((draft: never) => {
			const slot = (
				draft as { slots: { note?: string; adversarial?: string }[] }
			).slots[0];
			if (slot) {
				slot.adversarial = "common_word";
				slot.note = "collides with an ordinary English word";
			}
		});
		expect(() => parseSpec(spec, "spec.json")).not.toThrow();
	});

	it("rejects a spec with no slots", () => {
		expectRejected(
			broken((spec: never) => {
				(spec as { slots: unknown[] }).slots = [];
			}),
			/./,
		);
	});
});

describe("strictness", () => {
	it("rejects an unrecognized field, which is usually a typo", () => {
		expectRejected(
			broken((spec: never) => {
				(spec as Record<string, unknown>).templates = "template.txt";
			}),
			/./,
		);
	});

	it("refuses an unknown version rather than guessing at the layout", () => {
		expectRejected(
			broken((spec: never) => {
				(spec as { version: unknown }).version = 2;
			}),
			/version/,
		);
	});

	it("requires an id usable as a directory name", () => {
		expectRejected(
			broken((spec: never) => {
				(spec as { id: string }).id = "Claim Letter";
			}),
			/lowercase/,
		);
	});
});
