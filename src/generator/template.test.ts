import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { sliceByteRange } from "#/util/offset.ts";
import { plant, slotsUsed, TemplateError } from "./template.ts";

function entity(
	id: string,
	value: string,
	variants?: Entity["variants"],
): Entity {
	return { id, label: "person_name", value, ...(variants ? { variants } : {}) };
}

function slots(...pairs: [string, Entity][]): Map<string, Entity> {
	return new Map(pairs);
}

/** Asserts every occurrence slices back out of the text it was planted in. */
function expectVerifiable(text: string, planted: ReturnType<typeof plant>) {
	for (const occurrence of planted.occurrences) {
		if (occurrence.location.kind !== "text") continue;
		const found = occurrence.location.ranges
			.map((range) => sliceByteRange(text, range))
			.join("");
		expect(found).toBe(occurrence.text);
	}
}

describe("plant", () => {
	it("substitutes a value and records where it landed", () => {
		const planted = plant(
			"Dear {{name}},",
			slots(["name", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);

		expect(planted.text).toBe("Dear Dana Reyes,");
		expect(planted.occurrences).toHaveLength(1);
		expectVerifiable(planted.text, planted);
	});

	it("records byte offsets, not string indices", () => {
		// The bug this guards: "café" is 4 characters and 5 bytes, so a value
		// after it sits at a different offset than its string index suggests.
		const planted = plant(
			"café {{name}}",
			slots(["name", entity("ent_1", "Dana")]),
			"mod_1",
		);

		const location = planted.occurrences[0]?.location;
		if (location?.kind !== "text") throw new Error("expected a text location");
		expect(location.ranges[0]?.start).toBe(6);
		expectVerifiable(planted.text, planted);
	});

	it("handles a multi-byte value", () => {
		const planted = plant(
			"Patient: {{name}} admitted",
			slots(["name", entity("ent_1", "田中太郎")]),
			"mod_1",
		);

		const location = planted.occurrences[0]?.location;
		if (location?.kind !== "text") throw new Error("expected a text location");
		expect(location.ranges[0]?.end).toBe((location.ranges[0]?.start ?? 0) + 12);
		expectVerifiable(planted.text, planted);
	});

	it("plants one entity several times, each occurrence its own", () => {
		const planted = plant(
			"{{name}} and {{name}} again",
			slots(["name", entity("ent_1", "Dana")]),
			"mod_1",
		);

		expect(planted.occurrences).toHaveLength(2);
		// Both trace back to one entity: the coreference case.
		expect(planted.occurrences.every((o) => o.entityId === "ent_1")).toBe(true);
		expect(planted.occurrences[0]?.id).not.toBe(planted.occurrences[1]?.id);
		expectVerifiable(planted.text, planted);
	});

	it("distinguishes two occurrences of an identical value", () => {
		// Searching for the value would find the first match twice; tracking the
		// offset as the text is built keeps them distinct.
		const planted = plant(
			"{{a}} {{b}}",
			slots(["a", entity("ent_1", "Dana")], ["b", entity("ent_2", "Dana")]),
			"mod_1",
		);

		const first = planted.occurrences[0]?.location;
		const second = planted.occurrences[1]?.location;
		if (first?.kind !== "text" || second?.kind !== "text") {
			throw new Error("expected text locations");
		}
		expect(first.ranges[0]?.start).not.toBe(second.ranges[0]?.start);
	});

	it("writes a requested surface form", () => {
		const planted = plant(
			"{{name}} signs as {{name:signature}}",
			slots(["name", entity("ent_1", "Dana Reyes", { signature: "D.R." })]),
			"mod_1",
		);

		expect(planted.text).toBe("Dana Reyes signs as D.R.");
		expect(planted.occurrences[1]?.surface).toBe("signature");
		expectVerifiable(planted.text, planted);
	});

	it("leaves text with no placeholders untouched", () => {
		const planted = plant("No values here.", slots(), "mod_1");
		expect(planted.text).toBe("No values here.");
		expect(planted.occurrences).toEqual([]);
	});

	it("rejects a placeholder naming an undeclared slot", () => {
		expect(() => plant("{{missing}}", slots(), "mod_1")).toThrow(TemplateError);
	});

	it("rejects a surface form the entity does not have", () => {
		expect(() =>
			plant(
				"{{name:signature}}",
				slots(["name", entity("ent_1", "Dana Reyes")]),
				"mod_1",
			),
		).toThrow(/no "signature" form/);
	});
});

describe("slotsUsed", () => {
	it("lists each slot once, in order of first use", () => {
		expect(slotsUsed("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
	});

	it("sees slots written with a surface form", () => {
		expect(slotsUsed("{{name:signature}}")).toEqual(["name"]);
	});

	it("returns nothing for text with no placeholders", () => {
		expect(slotsUsed("plain text")).toEqual([]);
	});
});
