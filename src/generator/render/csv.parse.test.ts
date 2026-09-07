import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.parse.ts";

describe("parseCsv", () => {
	it("parses plain rows", () => {
		expect(parseCsv("a,b\n1,2\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("does not invent a row from a trailing newline", () => {
		expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
	});

	it("parses a file with no trailing newline", () => {
		expect(parseCsv("a,b")).toEqual([["a", "b"]]);
	});

	it("keeps a comma inside a quoted cell", () => {
		expect(parseCsv('name\n"Reyes, Dana"\n')).toEqual([
			["name"],
			["Reyes, Dana"],
		]);
	});

	it("resolves a doubled quote to one quote", () => {
		expect(parseCsv('alias\n"Say ""Ace"" Delgado"\n')).toEqual([
			["alias"],
			['Say "Ace" Delgado'],
		]);
	});

	it("keeps a newline inside a quoted cell", () => {
		expect(parseCsv('note\n"line one\nline two"\n')).toEqual([
			["note"],
			["line one\nline two"],
		]);
	});

	it("preserves empty cells", () => {
		expect(parseCsv("a,,c\n")).toEqual([["a", "", "c"]]);
	});

	it("preserves placeholders untouched", () => {
		expect(parseCsv("name\n{{who}}\n")).toEqual([["name"], ["{{who}}"]]);
	});

	it("normalizes CRLF line endings", () => {
		// A template authored on Windows must parse the same as one on Unix, or a
		// corpus would differ by the machine it was generated on.
		expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
			["a", "b"],
			["1", "2"],
		]);
	});

	it("keeps a row that is only a quoted empty cell", () => {
		// Content alone cannot distinguish a quoted empty cell from no cell, so
		// the row was dropped entirely.
		expect(parseCsv('""')).toEqual([[""]]);
	});

	it("rejects an unterminated quoted cell", () => {
		expect(() => parseCsv('name\n"never closed\n')).toThrow(SyntaxError);
	});
});
