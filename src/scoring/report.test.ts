import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import type { CorpusRecord, Occurrence } from "#/datatypes/record.ts";
import type { Detected, RecordOutcome } from "#/runner/outcome.ts";
import { coverage, decoyPrecision, labelledRecall, recall } from "./outcome.ts";
import { buildReport, scoreRecord } from "./report.ts";

function record(
	entities: Entity[],
	occurrences: Occurrence[],
	format = "txt",
): CorpusRecord {
	return {
		version: 1,
		id: "rec_1",
		format: format as CorpusRecord["format"],
		specId: "spec_1",
		artifact: `document.${format}`,
		digest: "a".repeat(64),
		provenance: { renderer: `ts:${format}`, seed: 1 },
		modalities: [{ id: "mod_1", kind: "text", path: "body", text: "x" }],
		entities,
		occurrences,
	};
}

function occurrence(
	id: string,
	entityId: string,
	start: number,
	end: number,
	surface: Occurrence["surface"] = "canonical",
): Occurrence {
	return {
		id,
		entityId,
		modalityId: "mod_1",
		surface,
		text: "value",
		written: "value",
		location: { kind: "text", ranges: [{ start, end }] },
	};
}

function detected(
	id: string,
	label: string,
	start: number,
	end: number,
): Detected {
	return { id, label, location: { kind: "text", ranges: [{ start, end }] } };
}

function outcome(detections: Detected[]): RecordOutcome {
	return {
		status: "detected",
		recordId: "rec_1",
		detectionId: "det",
		detected: detections,
		durationMs: 1,
	};
}

describe("scoreRecord", () => {
	it("reports a value found under the right label", () => {
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "email_address", value: "a@b.c" }],
				[occurrence("occ_1", "e1", 0, 10)],
			),
			outcome([detected("d1", "email_address", 0, 10)]),
		);

		expect(report.occurrences[0]?.outcome).toEqual({
			kind: "found",
			detectionId: "d1",
			boundary: { covered: 10, missed: 0, spilled: 0 },
		});
	});

	it("reports a value found under the wrong label as mislabelled", () => {
		// A `case_number` shaped like an SSN comes back as `government_id`. The
		// value was located, so a redactor removes it and nothing leaks — calling
		// it a miss overstates the harm. But the taxonomy was wrong, so it is not
		// a hit either.
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "case_number", value: "471-88-2130" }],
				[occurrence("occ_1", "e1", 0, 11)],
			),
			outcome([detected("d1", "government_id", 0, 11)]),
		);

		expect(report.occurrences[0]?.outcome).toMatchObject({
			kind: "mislabelled",
			reported: "government_id",
		});
	});

	it("measures a detection that covered only part of a value", () => {
		// `579676.82` inside a planted `USD 579676.82`: found, with four bytes of
		// the value left uncovered.
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "monetary_amount", value: "USD 579676.82" }],
				[occurrence("occ_1", "e1", 0, 13)],
			),
			outcome([detected("d1", "monetary_amount", 4, 13)]),
		);

		expect(report.occurrences[0]?.outcome).toMatchObject({
			kind: "found",
			boundary: { covered: 9, missed: 4, spilled: 0 },
		});
	});

	it("measures a detection that spilled past a value", () => {
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "email_address", value: "a@b.c" }],
				[occurrence("occ_1", "e1", 0, 10)],
			),
			outcome([detected("d1", "email_address", 0, 22)]),
		);

		expect(report.occurrences[0]?.outcome).toMatchObject({
			boundary: { covered: 10, missed: 0, spilled: 12 },
		});
	});

	it("measures no boundary when a tabular detection names only a cell", () => {
		// The API's way of saying "the whole cell" is to send no offsets. How much
		// of the value that covered is not something the pipeline said, so it is
		// not measured — reporting it as zero spill would score a wiped cell as a
		// flawless boundary, which is over-redaction recorded as perfection.
		const report = scoreRecord(
			{
				...record([{ id: "e1", label: "bank_account", value: "0001" }], []),
				format: "csv",
				occurrences: [
					{
						id: "occ_1",
						entityId: "e1",
						modalityId: "mod_1",
						surface: "canonical",
						text: "0001",
						written: "0001",
						location: {
							kind: "tabular",
							row: 1,
							column: 0,
							ranges: [{ start: 5, end: 9 }],
							cell: { start: 20, end: 24 },
						},
					},
				],
			},
			{
				status: "detected",
				recordId: "rec_1",
				detectionId: "det",
				durationMs: 1,
				detected: [
					{
						id: "d1",
						label: "bank_account",
						location: { kind: "tabular", row: 1, column: 0 },
					},
				],
			},
		);

		const outcome = report.occurrences[0]?.outcome;
		expect(outcome?.kind).toBe("found");
		if (outcome?.kind !== "found") throw new Error("expected found");
		expect(outcome.boundary).toBeUndefined();
	});

	it("counts a decoy the pipeline left alone as correctly ignored", () => {
		// The precision half: without it a pipeline redacting everything scores
		// perfectly.
		const report = scoreRecord(
			record(
				[
					{
						id: "e1",
						label: "case_number",
						value: "CASE-1",
						expect: "ignored",
					},
				],
				[occurrence("occ_1", "e1", 0, 6)],
			),
			outcome([]),
		);

		expect(report.occurrences[0]?.outcome).toEqual({
			kind: "correctly-ignored",
		});
	});

	it("counts a redacted decoy as over-redaction", () => {
		const report = scoreRecord(
			record(
				[
					{
						id: "e1",
						label: "case_number",
						value: "CASE-1",
						expect: "ignored",
					},
				],
				[occurrence("occ_1", "e1", 0, 6)],
			),
			outcome([detected("d1", "case_number", 0, 6)]),
		);

		expect(report.occurrences[0]?.outcome).toMatchObject({
			kind: "over-redacted",
		});
	});

	it("scores nothing for a record the pipeline never processed", () => {
		// Blaming a transport failure on the pipeline's detection would hide the
		// real problem, and the two need different fixes.
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "email_address", value: "a@b.c" }],
				[occurrence("occ_1", "e1", 0, 10)],
			),
			{
				status: "failed",
				recordId: "rec_1",
				stage: "upload",
				message: "connection reset",
			},
		);

		expect(report.failed).toEqual({
			stage: "upload",
			message: "connection reset",
		});
		expect(report.occurrences).toEqual([]);
	});

	it("scores nothing for a record the run never mentions", () => {
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "email_address", value: "a@b.c" }],
				[occurrence("occ_1", "e1", 0, 10)],
			),
			undefined,
		);

		expect(report.failed?.stage).toBe("missing");
		expect(report.occurrences).toEqual([]);
	});

	it("reports a detection that landed on nothing planted", () => {
		const report = scoreRecord(
			record(
				[{ id: "e1", label: "email_address", value: "a@b.c" }],
				[occurrence("occ_1", "e1", 0, 10)],
			),
			outcome([detected("d1", "url", 90, 99)]),
		);

		expect(report.unplanted).toEqual([{ id: "d1", label: "url" }]);
	});
});

describe("buildReport", () => {
	const base = { runId: "r1", corpusSeed: 5, corpusDigest: "d" };

	it("totals every slice back to the same planted count", () => {
		const scored = scoreRecord(
			record(
				[
					{ id: "e1", label: "email_address", value: "a@b.c" },
					{ id: "e2", label: "person_name", value: "Dana" },
					{ id: "e3", label: "case_number", value: "C1", expect: "ignored" },
				],
				[
					occurrence("occ_1", "e1", 0, 10),
					occurrence("occ_2", "e2", 20, 24, "misspelled"),
					occurrence("occ_3", "e3", 40, 42),
				],
			),
			outcome([detected("d1", "email_address", 0, 10)]),
		);

		const report = buildReport(base, [scored]);

		expect(report.totals.planted).toBe(2);
		expect(report.totals.found).toBe(1);
		expect(report.totals.missed).toBe(1);
		expect(report.totals.decoys).toBe(1);
		expect(report.totals.overRedacted).toBe(0);

		// A decoy is counted in the decoy column, never as a planted value to
		// find, or recall would be diluted by values nobody should detect.
		for (const breakdown of [
			report.byLabel,
			report.byFormat,
			report.bySurface,
		]) {
			const planted = Object.values(breakdown).reduce(
				(total, tally) => total + tally.planted,
				0,
			);
			expect(planted).toBe(report.totals.planted);
		}

		expect(recall(report.totals)).toBe(0.5);
		expect(decoyPrecision(report.totals)).toBe(1);
	});

	it("counts a mislabelled value in recall but not in strict recall", () => {
		const scored = scoreRecord(
			record(
				[{ id: "e1", label: "case_number", value: "471-88-2130" }],
				[occurrence("occ_1", "e1", 0, 11)],
			),
			outcome([detected("d1", "government_id", 0, 11)]),
		);

		const report = buildReport(base, [scored]);

		expect(recall(report.totals)).toBe(1);
		expect(labelledRecall(report.totals)).toBe(0);
	});

	it("keeps an unmeasured boundary out of the coverage figure", () => {
		// Counted rather than folded in at zero, so coverage describes the values
		// it actually measured and a reader can see how many it could not.
		const scored = scoreRecord(
			{
				...record([{ id: "e1", label: "bank_account", value: "0001" }], []),
				format: "csv",
				occurrences: [
					{
						id: "occ_1",
						entityId: "e1",
						modalityId: "mod_1",
						surface: "canonical",
						text: "0001",
						written: "0001",
						location: {
							kind: "tabular",
							row: 0,
							column: 0,
							ranges: [{ start: 0, end: 4 }],
							cell: { start: 0, end: 4 },
						},
					},
				],
			},
			{
				status: "detected",
				recordId: "rec_1",
				detectionId: "det",
				durationMs: 1,
				detected: [
					{
						id: "d1",
						label: "bank_account",
						location: { kind: "tabular", row: 0, column: 0 },
					},
				],
			},
		);

		const report = buildReport(base, [scored]);
		expect(report.totals.found).toBe(1);
		expect(report.totals.unmeasured).toBe(1);
		// Nothing measured, so there is no coverage to report — rather than a
		// perfect one conjured from a value nobody sized.
		expect(coverage(report.totals.boundary)).toBeUndefined();
	});

	it("reports no recall for a label nothing was planted under", () => {
		// Absent is not the same as failed, and 0% would read as a regression.
		const report = buildReport(base, []);
		expect(recall(report.totals)).toBeUndefined();
		expect(decoyPrecision(report.totals)).toBeUndefined();
	});

	it("counts records the pipeline never processed", () => {
		const scored = scoreRecord(record([], []), {
			status: "failed",
			recordId: "rec_1",
			stage: "detect",
			message: "boom",
		});

		expect(buildReport(base, [scored]).failedRecords).toBe(1);
	});
});
