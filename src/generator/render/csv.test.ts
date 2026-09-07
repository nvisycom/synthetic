import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { TemplateError } from "../template.ts";
import { parseCsv } from "./csv.parse.ts";
import { renderCsv } from "./csv.ts";
import { expectVerifiable } from "./verifiable.ts";

function entity(id: string, value: string): Entity {
	return { id, label: "person_name", value };
}

function slots(...pairs: [string, Entity][]): Map<string, Entity> {
	return new Map(pairs);
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

	it("locates a value occupying its whole cell", () => {
		const rendered = renderCsv(
			[["name"], ["{{who}}"]],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);

		expectVerifiable(rendered);

		const occurrence = rendered.occurrences[0];
		if (occurrence?.location.kind !== "tabular") {
			throw new Error("expected tabular");
		}
		// Past the `name\n` header, and covering the cell exactly.
		expect(occurrence.location.ranges?.[0]).toEqual({ start: 5, end: 15 });
		expect(rendered.text).toBe("name\nDana Reyes\n");
	});

	it("addresses a value in its cell as well as in the file", () => {
		// A detection over a table comes back naming a row, a column, and an
		// offset into that cell — never a file offset — so ground truth records
		// the same thing beside the bytes.
		const rendered = renderCsv(
			[["note"], ['Ref "A" for {{who}}, urgent']],
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);

		expectVerifiable(rendered);

		const occurrence = rendered.occurrences[0];
		if (occurrence?.location.kind !== "tabular") {
			throw new Error("expected tabular");
		}
		// The comma and quotes force the cell to be quoted, which moves the file
		// range but leaves the cell range alone: `Ref "A" for ` is 12 bytes of the
		// cell's own value however the file writes it.
		expect(occurrence.location.cell).toEqual({ start: 12, end: 16 });
		expect(occurrence.location.ranges?.[0]?.start).toBeGreaterThan(16);

		const [range] = occurrence.location.ranges ?? [];
		if (range === undefined) throw new Error("expected a file range");
		expect(rendered.text.slice(range.start, range.end)).toBe("Dana");

		// And the cell range indexes the parsed cell, as a detector would report.
		const rows = parseCsv(rendered.text);
		const cell = rows[occurrence.location.row]?.[occurrence.location.column];
		expect(
			cell?.slice(
				occurrence.location.cell?.start,
				occurrence.location.cell?.end,
			),
		).toBe("Dana");
	});

	it("locates a value sitting inside a longer cell", () => {
		const rendered = renderCsv(
			[["note"], ["Filed by {{who}} today"]],
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);

		expectVerifiable(rendered);

		const occurrence = rendered.occurrences[0];
		if (occurrence?.location.kind !== "tabular") {
			throw new Error("expected tabular");
		}
		// The cell holds no comma or quote, so it is unquoted and the value sits
		// at "note\n" plus "Filed by ".
		expect(occurrence.location.ranges?.[0]).toEqual({ start: 14, end: 24 });
		expect(occurrence.location.row).toBe(1);
		expect(occurrence.location.column).toBe(0);
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

	it("counts the doubled quotes a quoted cell adds before the value", () => {
		const rendered = renderCsv(
			[["note"], ['Alias "X" for {{who}}']],
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);

		expectVerifiable(rendered);

		// The cell holds quotes, so it is wrapped and every quote inside doubled:
		// `note\n"Alias ""X"" for Dana"\n`.
		expect(rendered.text).toBe('note\n"Alias ""X"" for Dana"\n');

		const occurrence = rendered.occurrences[0];
		if (occurrence?.location.kind !== "tabular") {
			throw new Error("expected tabular");
		}
		// 5 for the header, 1 for the opening quote, 14 for `Alias "X" for ` with
		// its two quotes doubled to four characters.
		const [range] = occurrence.location.ranges ?? [];
		if (range === undefined) throw new Error("expected a file range");
		expect(range).toEqual({ start: 22, end: 26 });
		expect(rendered.text.slice(range.start, range.end)).toBe("Dana");
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
