import { describe, expect, it } from "vitest";
import type { Occurrence } from "#/datatypes/record.ts";
import type { Detected } from "#/runner/outcome.ts";
import { matchRecord, overlapOf } from "./match.ts";

function planted(
	id: string,
	start: number,
	end: number,
	label = "person_name",
): Occurrence & { label: string } {
	return {
		id,
		entityId: `ent_${id}`,
		modalityId: "mod_1",
		surface: "canonical",
		text: "x",
		written: "x",
		location: { kind: "text", ranges: [{ start, end }] },
		label,
	};
}

function found(
	id: string,
	start: number,
	end: number,
	label = "person_name",
): Detected {
	return { id, label, location: { kind: "text", ranges: [{ start, end }] } };
}

/** Reads the label a fixture carries, standing in for the entity lookup. */
const labelOf = (occurrence: Occurrence) =>
	(occurrence as Occurrence & { label: string }).label;

describe("overlapOf", () => {
	it("measures shared bytes of two text ranges", () => {
		expect(
			overlapOf(
				{ kind: "text", ranges: [{ start: 0, end: 10 }] },
				{ kind: "text", ranges: [{ start: 4, end: 20 }] },
			),
		).toBe(6);
	});

	it("reports nothing for ranges that only touch", () => {
		// Half-open ranges, so [0,10) and [10,20) are adjacent, not overlapping —
		// which is exactly how two values written back to back sit.
		expect(
			overlapOf(
				{ kind: "text", ranges: [{ start: 0, end: 10 }] },
				{ kind: "text", ranges: [{ start: 10, end: 20 }] },
			),
		).toBe(0);
	});

	it("sums the pieces of a split value without counting the gap", () => {
		expect(
			overlapOf(
				{
					kind: "text",
					ranges: [
						{ start: 0, end: 5 },
						{ start: 10, end: 15 },
					],
				},
				{ kind: "text", ranges: [{ start: 0, end: 20 }] },
			),
		).toBe(10);
	});

	it("refuses to compare different coordinate systems", () => {
		// A byte offset and a cell address are not the same number, and treating
		// one as the other is how a boundary figure becomes fiction.
		expect(
			overlapOf(
				{ kind: "text", ranges: [{ start: 0, end: 10 }] },
				{ kind: "tabular", row: 0, column: 0, cell: { start: 0, end: 10 } },
			),
		).toBe(0);
	});

	it("requires a tabular match to name the same cell", () => {
		const left = {
			kind: "tabular",
			row: 1,
			column: 2,
			cell: { start: 0, end: 5 },
		} as const;
		expect(overlapOf(left, { ...left, row: 9 })).toBe(0);
		expect(overlapOf(left, { ...left, column: 9 })).toBe(0);
		expect(overlapOf(left, left)).toBe(5);
	});

	it("treats an unstated cell range as the whole cell", () => {
		// A detection over an entire cell states no offsets, so it meets whatever
		// was planted there rather than missing it on a technicality.
		expect(
			overlapOf(
				{ kind: "tabular", row: 0, column: 0, cell: { start: 0, end: 12 } },
				{ kind: "tabular", row: 0, column: 0 },
			),
		).toBeGreaterThan(0);
	});
});

describe("matchRecord", () => {
	it("pairs a detection with the value it covers", () => {
		const { pairings, unpaired } = matchRecord(
			[planted("occ_1", 0, 10)],
			[found("det_1", 0, 10)],
			labelOf,
		);

		expect(pairings[0]?.detection?.id).toBe("det_1");
		expect(pairings[0]?.overlap).toBe(10);
		expect(unpaired).toEqual([]);
	});

	it("credits a detection covering only part of a value", () => {
		// `579676.82` inside a planted `USD 579676.82`: the detector found it, and
		// requiring exact spans would report a real hit as a leak.
		const { pairings } = matchRecord(
			[planted("occ_1", 0, 13)],
			[found("det_1", 4, 13)],
			labelOf,
		);

		expect(pairings[0]?.detection?.id).toBe("det_1");
		expect(pairings[0]?.overlap).toBe(9);
	});

	it("gives one detection to one value, leaving the rest missed", () => {
		// The case from the live run: an email and a phone written with nothing
		// between them came back as a single `email_address` span covering both.
		// The email was found; nothing identified the phone, so it is a miss —
		// crediting both would report a leak as a catch.
		const { pairings } = matchRecord(
			[
				planted("occ_1", 641, 667, "email_address"),
				planted("occ_2", 667, 679, "phone_number"),
			],
			[found("det_1", 641, 679, "email_address")],
			labelOf,
		);

		expect(pairings[0]?.detection?.id).toBe("det_1");
		expect(pairings[1]?.detection).toBeUndefined();
	});

	it("prefers the value whose label agrees over the larger overlap", () => {
		// A detection sitting mostly over one value but labelled as another is
		// evidence about the one it names.
		const { pairings } = matchRecord(
			[
				planted("occ_1", 0, 30, "person_name"),
				planted("occ_2", 28, 40, "email_address"),
			],
			[found("det_1", 10, 40, "email_address")],
			labelOf,
		);

		expect(pairings[0]?.detection).toBeUndefined();
		expect(pairings[1]?.detection?.id).toBe("det_1");
	});

	it("reports a detection that overlaps nothing planted", () => {
		const { pairings, unpaired } = matchRecord(
			[planted("occ_1", 0, 10)],
			[found("det_1", 50, 60)],
			labelOf,
		);

		expect(pairings[0]?.detection).toBeUndefined();
		expect(unpaired.map((d) => d.id)).toEqual(["det_1"]);
	});

	it("pairs each of two detections over one value with only one of them", () => {
		// A pipeline reporting the same value twice has found it once; the spare
		// is reported rather than counted again.
		const { pairings, unpaired } = matchRecord(
			[planted("occ_1", 0, 10)],
			[found("det_1", 0, 10), found("det_2", 2, 8)],
			labelOf,
		);

		expect(pairings[0]?.detection?.id).toBe("det_1");
		expect(unpaired.map((d) => d.id)).toEqual(["det_2"]);
	});

	it("does not depend on the order candidates are considered", () => {
		// Two equally good pairs must settle the same way every run, or a score
		// changes without the pipeline changing.
		const occurrences = [planted("occ_1", 0, 10), planted("occ_2", 20, 30)];
		const forwards = matchRecord(
			occurrences,
			[found("det_1", 0, 10), found("det_2", 20, 30)],
			labelOf,
		);
		const backwards = matchRecord(
			occurrences,
			[found("det_2", 20, 30), found("det_1", 0, 10)],
			labelOf,
		);

		expect(forwards.pairings.map((p) => p.detection?.id)).toEqual([
			"det_1",
			"det_2",
		]);
		expect(backwards.pairings.map((p) => p.detection?.id)).toEqual([
			"det_1",
			"det_2",
		]);
	});
});
