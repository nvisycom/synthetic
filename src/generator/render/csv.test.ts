import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { sliceByteRange } from "#/util/offset.ts";
import { TemplateError } from "../template.ts";
import { parseCsv } from "./csv.parse.ts";
import { renderCsv } from "./csv.ts";

function entity(id: string, value: string): Entity {
	return { id, label: "person_name", value };
}

function slots(...pairs: [string, Entity][]): Map<string, Entity> {
	return new Map(pairs);
}

/** Asserts every source range covers its value in the rendered file. */
function expectVerifiable(rendered: ReturnType<typeof renderCsv>): void {
	for (const occurrence of rendered.occurrences) {
		if (occurrence.location.kind !== "tabular") continue;
		const raw = (occurrence.location.source ?? [])
			.map((range) => sliceByteRange(rendered.text, range))
			.join("");
		// A quoted cell doubles any quote inside it.
		expect(raw.replaceAll('""', '"')).toBe(occurrence.text);
	}
}

describe("renderCsv", () => {
	it("addresses values by row and column", () => {
		const rendered = renderCsv(
			[
				["id", "name"],
				["1", "{{who}}"],
			],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);

		const location = rendered.occurrences[0]?.location;
		if (location?.kind !== "tabular") throw new Error("expected tabular");
		expect(location.row).toBe(1);
		expect(location.column).toBe(1);
		expect(location.columnName).toBe("name");
	});

	it("records no range when the value is the whole cell", () => {
		// Matching the SDK, where an unset offset means the entity is the cell.
		const rendered = renderCsv(
			[["name"], ["{{who}}"]],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		const location = rendered.occurrences[0]?.location;
		if (location?.kind !== "tabular") throw new Error("expected tabular");
		expect(location.range).toBeUndefined();
	});

	it("records a range when the value sits inside a longer cell", () => {
		const rendered = renderCsv(
			[["note"], ["Filed by {{who}} today"]],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		const location = rendered.occurrences[0]?.location;
		if (location?.kind !== "tabular") throw new Error("expected tabular");
		expect(location.range).toEqual({ start: 9, end: 19 });
	});

	it("quotes a cell whose value contains a comma", () => {
		// The case that forces RFC 4180 quoting and shifts the source offsets.
		const rendered = renderCsv(
			[["name"], ["{{who}}"]],
			slots(["who", entity("ent_1", "Reyes, Dana")]),
			"mod_1",
		);
		expect(rendered.text).toContain('"Reyes, Dana"');
		expectVerifiable(rendered);
	});

	it("doubles a quote inside a quoted cell", () => {
		const rendered = renderCsv(
			[["alias"], ["{{who}}"]],
			slots(["who", entity("ent_1", 'Say "Ace" Delgado')]),
			"mod_1",
		);
		expect(rendered.text).toContain('"Say ""Ace"" Delgado"');
		expectVerifiable(rendered);
	});

	it("shifts source offsets past the doubled quotes", () => {
		const rendered = renderCsv(
			[["note"], ['Alias "X" for {{who}}']],
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);
		const location = rendered.occurrences[0]?.location;
		if (location?.kind !== "tabular") throw new Error("expected tabular");
		// Two doubled quotes before the value, plus the opening quote.
		expect(location.source?.[0]?.start).toBeGreaterThan(
			location.range?.start ?? 0,
		);
		expectVerifiable(rendered);
	});

	it("leaves an unquoted cell's offsets alone", () => {
		const rendered = renderCsv(
			[["name"], ["{{who}}"]],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expectVerifiable(rendered);
	});

	it("handles multi-byte values", () => {
		const rendered = renderCsv(
			[["name"], ["Patient {{who}} admitted"]],
			slots(["who", entity("ent_1", "田中太郎")]),
			"mod_1",
		);
		expectVerifiable(rendered);
	});

	it("plants one entity across several cells", () => {
		const rendered = renderCsv(
			[
				["name", "note"],
				["{{who}}", "About {{who}}."],
			],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expect(rendered.occurrences).toHaveLength(2);
		expect(rendered.occurrences.every((o) => o.entityId === "ent_1")).toBe(
			true,
		);
		expectVerifiable(rendered);
	});

	it("keeps every row at the header's width", () => {
		// A quoted cell must not swallow a delimiter and collapse a column. Read
		// back with the project's own parser, which the parser tests cover
		// independently.
		const rendered = renderCsv(
			[
				["id", "name", "note"],
				["1", "{{who}}", "About {{who}}, at length."],
				["2", "{{who}}", "plain"],
			],
			slots(["who", entity("ent_1", "Reyes, Dana")]),
			"mod_1",
		);

		const rows = parseCsv(rendered.text);
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(row).toHaveLength(3);
		// The quoted name survives as one cell rather than splitting on its comma.
		expect(rows[1]?.[1]).toBe("Reyes, Dana");
	});

	it("keeps source offsets correct past a multi-byte character", () => {
		// The bug this guards: the shift was counted by slicing the cell at a
		// *byte* offset, which overshoots in UTF-16 and counted quotes sitting
		// after the value rather than before it.
		const rendered = renderCsv(
			[["note"], ['日本語 {{who}} "q" tail']],
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);
		expectVerifiable(rendered);
	});

	it("rejects a template that is not a table", () => {
		expect(() => renderCsv({ not: "a table" }, slots(), "mod_1")).toThrow(
			TemplateError,
		);
		expect(() => renderCsv([], slots(), "mod_1")).toThrow(TemplateError);
	});

	it("rejects a row that is not an array", () => {
		expect(() => renderCsv([["h"], "nope"], slots(), "mod_1")).toThrow(
			TemplateError,
		);
	});
});
