import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { sliceByteRange } from "#/util/offset.ts";
import { TemplateError } from "../template.ts";
import { renderJson } from "./json.ts";

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

/**
 * Asserts both coordinate systems: decoded ranges against the string a detector
 * reads, source ranges against the bytes on disk.
 */
function expectVerifiable(rendered: ReturnType<typeof renderJson>): void {
	for (const occurrence of rendered.occurrences) {
		if (occurrence.location.kind !== "text") continue;

		const decoded = occurrence.location.ranges
			.map((range) => sliceByteRange(rendered.decoded, range))
			.join("");
		expect(decoded).toBe(occurrence.text);

		const { source } = occurrence.location;
		expect(source).toBeDefined();
		const raw = (source ?? [])
			.map((range) => sliceByteRange(rendered.text, range))
			.join("");
		// The file holds the escaped form, so unescape before comparing.
		expect(JSON.parse(`"${raw}"`)).toBe(occurrence.text);
	}
}

describe("renderJson", () => {
	it("produces valid JSON", () => {
		const rendered = renderJson(
			{ name: "{{who}}" },
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expect(() => JSON.parse(rendered.text)).not.toThrow();
		expect(JSON.parse(rendered.text)).toEqual({ name: "Dana Reyes" });
	});

	it("records both coordinate systems", () => {
		const rendered = renderJson(
			{ name: "{{who}}" },
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expectVerifiable(rendered);
	});

	it("shifts source offsets past an escape, leaving decoded ones alone", () => {
		// The case the whole dual-coordinate model exists for: the escaped quotes
		// push later values further into the file without moving them in the
		// decoded string.
		const rendered = renderJson(
			{ alias: "{{alias}}", note: "About {{who}}." },
			slots(
				["alias", entity("ent_1", 'Say "Ace" Delgado')],
				["who", entity("ent_2", "Dana Reyes")],
			),
			"mod_1",
		);

		expectVerifiable(rendered);
		const who = rendered.occurrences[1]?.location;
		if (who?.kind !== "text") throw new Error("expected a text location");
		// Two escaped quotes cost two extra bytes each in the file.
		expect(who.source?.[0]?.start).toBeGreaterThan(who.ranges[0]?.start ?? 0);
	});

	it("escapes a value containing quotes and backslashes", () => {
		const rendered = renderJson(
			{ raw: "{{v}}" },
			slots(["v", entity("ent_1", 'back\\slash and "quotes"')]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text).raw).toBe('back\\slash and "quotes"');
		expectVerifiable(rendered);
	});

	it("plants into nested objects and arrays", () => {
		const rendered = renderJson(
			{
				customer: { name: "{{who}}" },
				notes: ["First {{who}}.", "Second {{who}}."],
			},
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);

		expect(rendered.occurrences).toHaveLength(3);
		expectVerifiable(rendered);
	});

	it("handles multi-byte values", () => {
		const rendered = renderJson(
			{ name: "{{who}}", note: "Seen: {{who}}" },
			slots(["who", entity("ent_1", "田中太郎")]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text).name).toBe("田中太郎");
		expectVerifiable(rendered);
	});

	it("writes a requested surface form", () => {
		const rendered = renderJson(
			{ full: "{{who}}", short: "{{who:signature}}" },
			slots(["who", entity("ent_1", "Dana Reyes", { signature: "D.R." })]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text)).toEqual({
			full: "Dana Reyes",
			short: "D.R.",
		});
		expectVerifiable(rendered);
	});

	it("leaves numbers, booleans, and null alone", () => {
		const rendered = renderJson(
			{ count: 3, open: false, closed: null, who: "{{who}}" },
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text)).toEqual({
			count: 3,
			open: false,
			closed: null,
			who: "Dana",
		});
	});

	it("rejects a placeholder in a key", () => {
		// It would be written verbatim and plant nothing, leaving a spec that
		// looks correct and a document that is not.
		expect(() =>
			renderJson(
				{ "{{who}}": "value" },
				slots(["who", entity("ent_1", "Dana")]),
				"mod_1",
			),
		).toThrow(/keys are not/);
	});

	it("rejects a template that is not a container", () => {
		expect(() => renderJson("just a string", slots(), "mod_1")).toThrow(
			TemplateError,
		);
	});

	it("rejects a placeholder naming an undeclared slot", () => {
		expect(() => renderJson({ a: "{{missing}}" }, slots(), "mod_1")).toThrow(
			TemplateError,
		);
	});
});
