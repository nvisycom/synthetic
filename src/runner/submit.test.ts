import type { Audit } from "@nvisy/sdk/datatypes";
import { describe, expect, it } from "vitest";
import { readAnalysis } from "./submit.ts";

/** A minimal analysis report, shaped as the API returns one. */
function analysis(entities: unknown[], modality = "text"): Audit {
	return {
		report: { parts: [{ modality, id: ["document.txt"], entities }] },
		context: {},
		codec: {},
		usage: {},
	} as unknown as Audit;
}

function entity(over: Record<string, unknown> = {}): unknown {
	return {
		id: "ent-1",
		label: "person_name",
		confidence: 0.8,
		location: { coord: { kind: "decoded", range: { start: 4, end: 14 } } },
		audit: [{ source: "pattern" }],
		...over,
	};
}

describe("readAnalysis", () => {
	it("reads a decoded range as the file range when the two coincide", () => {
		// The API leaves `source` empty exactly when the raw bytes are the decoded
		// text, which is every plain text document — so the decoded range is the
		// file range, and dropping it would lose every txt detection.
		const [found] = readAnalysis(analysis([entity()]));
		expect(found?.label).toBe("person_name");
		expect(found?.location).toEqual({
			kind: "text",
			ranges: [{ start: 4, end: 14 }],
		});
		expect(found?.confidence).toBe(0.8);
		expect(found?.recognizer).toBe("pattern");
	});

	it("prefers the source ranges over the decoded one", () => {
		// Where a format escapes, the two differ, and ground truth is recorded in
		// the file's own bytes — so those are what a detection is compared on.
		const [found] = readAnalysis(
			analysis([
				entity({
					location: {
						coord: {
							kind: "decoded",
							range: { start: 4, end: 14 },
							source: [{ range: { start: 9, end: 21 } }],
						},
					},
				}),
			]),
		);
		expect(found?.location).toEqual({
			kind: "text",
			ranges: [{ start: 9, end: 21 }],
		});
	});

	it("keeps every source range of a value split across an escape", () => {
		const [found] = readAnalysis(
			analysis([
				entity({
					location: {
						coord: {
							kind: "decoded",
							range: { start: 0, end: 8 },
							source: [
								{ range: { start: 0, end: 3 } },
								{ range: { start: 5, end: 10 } },
							],
						},
					},
				}),
			]),
		);
		expect(found?.location).toEqual({
			kind: "text",
			ranges: [
				{ start: 0, end: 3 },
				{ start: 5, end: 10 },
			],
		});
	});

	it("reads a tabular entity by cell", () => {
		// A detection over a table answers in row, column, and an offset into the
		// cell — never a file offset, which a workbook would not have.
		const [found] = readAnalysis(
			analysis(
				[
					{
						id: "ent-9",
						label: "bank_account",
						confidence: 0.9,
						location: {
							row_index: 2,
							column_index: 1,
							column_name: "account",
							start_offset: 0,
							end_offset: 12,
						},
						audit: [{ source: "pattern" }],
					},
				],
				"tabular",
			),
		);
		expect(found?.location).toEqual({
			kind: "tabular",
			row: 2,
			column: 1,
			columnName: "account",
			cell: { start: 0, end: 12 },
		});
		expect(found?.label).toBe("bank_account");
	});

	it("reads a tabular entity covering its whole cell", () => {
		// Unset offsets mean the whole cell. Recorded as an empty range rather
		// than a made-up width, which would score as a boundary miss.
		const [found] = readAnalysis(
			analysis(
				[
					{
						id: "ent-9",
						label: "bank_account",
						confidence: 0.9,
						location: { row_index: 0, column_index: 0 },
						audit: [],
					},
				],
				"tabular",
			),
		);
		// No cell range at all, rather than a zero-width one: an empty range at 0
		// would be indistinguishable from a genuine empty match at the cell's
		// start, and the scorer widens an absent one to the whole cell.
		expect(found?.location).toEqual({ kind: "tabular", row: 0, column: 0 });
	});

	it("keeps a label the harness does not know", () => {
		// A newer catalog or a custom recognizer is a fact worth reporting, not
		// one to drop at read time.
		const [found] = readAnalysis(analysis([entity({ label: "custom_thing" })]));
		expect(found?.label).toBe("custom_thing");
	});

	it("skips a coordinate that places nothing", () => {
		// No range at all means nothing to compare against ground truth, so it is
		// left for the scorer to report rather than guessed at here.
		const found = readAnalysis(
			analysis([
				entity({ location: { coord: { kind: "source", source: [] } } }),
			]),
		);
		expect(found).toEqual([]);
	});

	it("skips a part whose modality has no coordinates here", () => {
		const report = {
			report: { parts: [{ modality: "image", id: ["x.png"], entities: [{}] }] },
		} as unknown as Audit;
		expect(readAnalysis(report)).toEqual([]);
	});

	it("reads every entity in a part", () => {
		const found = readAnalysis(
			analysis([entity(), entity({ id: "ent-2", label: "email_address" })]),
		);
		expect(found).toHaveLength(2);
	});

	it("omits the recognizer when the audit trail is empty", () => {
		const [found] = readAnalysis(analysis([entity({ audit: [] })]));
		expect(found?.recognizer).toBeUndefined();
	});
});
