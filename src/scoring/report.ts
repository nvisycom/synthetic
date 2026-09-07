/**
 * @fileoverview Turning matched pairs into a report.
 *
 * The report is broken down several ways because a single number hides the
 * failures worth catching. Recall on a corpus is a weighted average of very
 * different problems: a name in running prose, an account number in a table
 * cell, a value split across a line break. Breaking it down by label, format,
 * and surface form is what makes a regression legible — the aggregate can hold
 * still while one of them collapses.
 *
 * @module scoring/report
 */

import type { Entity } from "#/datatypes/entity.ts";
import type { CorpusRecord } from "#/datatypes/record.ts";
import type { Detected, RecordOutcome } from "#/runner/outcome.ts";
import { matchRecord } from "./match.ts";
import {
	type Boundary,
	coverage,
	decoyPrecision,
	emptyTally,
	labelledRecall,
	type PlantedOutcome,
	recall,
	type Tally,
} from "./outcome.ts";

/**
 * What happened to one planted value, with enough context to find it again.
 */
export interface OccurrenceReport {
	/** The occurrence, by its id in the record. */
	occurrenceId: string;

	/** What was planted there. */
	label: string;

	/** How it was written. */
	surface: string;

	/** The value itself, so a report reads without opening the corpus. */
	text: string;

	/** Whether it was planted to be found or to be left alone. */
	expect: "detected" | "ignored";

	/** Why it was chosen to be hard, when it was. */
	adversarial?: string;

	/** The verdict. */
	outcome: PlantedOutcome;
}

/**
 * One record's results.
 */
export interface RecordReport {
	recordId: string;
	format: string;
	specId: string;

	/** Present when the record never produced a detection. */
	failed?: { stage: string; message: string };

	/** Every planted value in it. */
	occurrences: OccurrenceReport[];

	/** Detections that landed on nothing planted. */
	unplanted: { id: string; label: string }[];
}

/**
 * Tallies sliced one way, keyed by whatever the slice is.
 */
export type Breakdown = Record<string, Tally>;

/**
 * A scored run, in summary.
 *
 * Everything here is bounded: the breakdowns are keyed by label, format, and
 * surface form, which are fixed vocabularies, so this stays a few kilobytes
 * whatever the corpus' size. Per-record detail is written beside it rather than
 * in it — see {@link ./layout.ts}.
 */
export interface Report {
	version: 1;

	/** The run this scored, and the corpus it was scored against. */
	runId: string;
	corpusSeed: number;
	corpusDigest: string;

	/** When the report was produced. */
	scoredAt: string;

	/** Records the pipeline never processed, which score nothing. */
	failedRecords: number;

	/** Everything, in one tally. */
	totals: Tally;

	/** The same, per label, format, and surface form. */
	byLabel: Breakdown;
	byFormat: Breakdown;
	bySurface: Breakdown;

	/** Adversarial values only, by why they were chosen to be hard. */
	byAdversarial: Breakdown;

	/** Detections that landed on nothing planted, across the run. */
	unplanted: number;

	/** How many records contributed, so a summary says what it covers. */
	scoredRecords: number;
}

/**
 * Adds one value's outcome into a tally.
 */
function accumulate(tally: Tally, report: OccurrenceReport): void {
	const { outcome } = report;

	if (report.expect === "ignored") {
		tally.decoys++;
		if (outcome.kind === "over-redacted") tally.overRedacted++;
		return;
	}

	tally.planted++;
	switch (outcome.kind) {
		case "found":
			tally.found++;
			addBoundary(tally, outcome.boundary);
			break;
		case "mislabelled":
			tally.mislabelled++;
			addBoundary(tally, outcome.boundary);
			break;
		default:
			tally.missed++;
	}
}

/**
 * Sums a value's boundary into a tally, or counts it as unmeasured.
 */
function addBoundary(tally: Tally, from: Boundary | undefined): void {
	if (from === undefined) {
		tally.unmeasured++;
		return;
	}
	tally.boundary.covered += from.covered;
	tally.boundary.missed += from.missed;
	tally.boundary.spilled += from.spilled;
}

/**
 * Adds a value's outcome into one slice of a breakdown.
 */
function into(
	breakdown: Breakdown,
	key: string,
	report: OccurrenceReport,
): void {
	const tally = breakdown[key] ?? emptyTally();
	breakdown[key] = tally;
	accumulate(tally, report);
}

/**
 * Measures how well a detection's span agreed with the value it found.
 *
 * Reported in the units the two were compared in.
 *
 * Returns `undefined` when either side did not state a width. A tabular
 * detection over a whole cell is the case: the pipeline named a cell and no
 * offsets within it, so how much of the value it covered is not something it
 * said. Measuring it as zero would be a lie in whichever direction the missing
 * side lay — a whole-cell detection over a four-byte value would report no
 * spill, scoring a wiped cell as a flawless boundary, which is over-redaction
 * recorded as perfection.
 */
function boundaryOf(
	plantedExtent: number | undefined,
	detectedExtent: number | undefined,
	overlap: number,
): Boundary | undefined {
	if (plantedExtent === undefined || detectedExtent === undefined) {
		return undefined;
	}

	return {
		covered: overlap,
		missed: Math.max(0, plantedExtent - overlap),
		spilled: Math.max(0, detectedExtent - overlap),
	};
}

/**
 * Scores one record.
 *
 * @param record - The answer key
 * @param outcome - What the run recorded for it
 */
export function scoreRecord(
	record: CorpusRecord,
	outcome: RecordOutcome | undefined,
): RecordReport {
	const entities = new Map<string, Entity>(
		record.entities.map((entity) => [entity.id, entity]),
	);
	const labelOf = (occurrenceEntityId: string) =>
		entities.get(occurrenceEntityId)?.label ?? "";

	if (outcome === undefined || outcome.status === "failed") {
		// A record the pipeline never processed scores nothing. Counting its
		// values as missed would blame the pipeline's detection for what was a
		// transport failure, and the two need different fixes.
		return {
			recordId: record.id,
			format: record.format,
			specId: record.specId,
			...(outcome?.status === "failed"
				? { failed: { stage: outcome.stage, message: outcome.message } }
				: {
						failed: {
							stage: "missing",
							message: "The run recorded no outcome for this record",
						},
					}),
			occurrences: [],
			unplanted: [],
		};
	}

	const { pairings, unpaired } = matchRecord(
		record.occurrences,
		outcome.detected,
		(occurrence) => labelOf(occurrence.entityId),
	);

	const occurrences = pairings.map(({ occurrence, detection, overlap }) => {
		const entity = entities.get(occurrence.entityId);
		const label = entity?.label ?? "";
		const expect = entity?.expect ?? "detected";

		return {
			occurrenceId: occurrence.id,
			label,
			surface: occurrence.surface,
			text: occurrence.text,
			expect,
			...(entity?.adversarial !== undefined
				? { adversarial: entity.adversarial }
				: {}),
			outcome: verdict(occurrence, detection, overlap, label, expect),
		} satisfies OccurrenceReport;
	});

	return {
		recordId: record.id,
		format: record.format,
		specId: record.specId,
		occurrences,
		unplanted: unpaired.map((detection) => ({
			id: detection.id,
			label: detection.label,
		})),
	};
}

/**
 * Decides what happened to one planted value.
 */
function verdict(
	occurrence: CorpusRecord["occurrences"][number],
	detection: Detected | undefined,
	overlap: number,
	label: string,
	expect: "detected" | "ignored",
): PlantedOutcome {
	if (detection === undefined) {
		return expect === "ignored"
			? { kind: "correctly-ignored" }
			: { kind: "missed" };
	}

	if (expect === "ignored") {
		return {
			kind: "over-redacted",
			detectionId: detection.id,
			reported: detection.label,
		};
	}

	const boundary = boundaryOf(
		extentFor(occurrence.location),
		extentFor(detection.location),
		overlap,
	);

	return detection.label === label
		? { kind: "found", detectionId: detection.id, boundary }
		: {
				kind: "mislabelled",
				detectionId: detection.id,
				reported: detection.label,
				boundary,
			};
}

/**
 * The extent a location covers, in the units it is compared in.
 *
 * A tabular location is measured by its cell range rather than its file bytes,
 * because that is the coordinate a detection over a table reports — the file
 * range exists in ground truth alone, and comparing against it would measure a
 * boundary the pipeline never spoke about.
 *
 * `undefined` when the location states no width, which a whole-cell tabular
 * location does. Distinct from zero: an empty span is a width, and treating
 * "did not say" as "said nothing was covered" is how a wiped cell comes to
 * score as an exact match.
 */
function extentFor(
	location: CorpusRecord["occurrences"][number]["location"],
): number | undefined {
	switch (location.kind) {
		case "text":
			return location.ranges.reduce(
				(total, range) => total + (range.end - range.start),
				0,
			);
		case "tabular":
			return location.cell === undefined
				? undefined
				: location.cell.end - location.cell.start;
		case "audio":
			return location.span.end - location.span.start;
		case "image":
			return (
				(location.max.x - location.min.x) * (location.max.y - location.min.y)
			);
	}
}

/**
 * Builds a report from every record's results.
 */
export function buildReport(
	base: Pick<Report, "runId" | "corpusSeed" | "corpusDigest">,
	records: readonly RecordReport[],
): Report {
	const report: Report = {
		version: 1,
		...base,
		scoredAt: new Date().toISOString(),
		failedRecords: records.filter((r) => r.failed !== undefined).length,
		totals: emptyTally(),
		byLabel: {},
		byFormat: {},
		bySurface: {},
		byAdversarial: {},
		unplanted: 0,
		scoredRecords: records.length,
	};

	for (const record of records) {
		report.unplanted += record.unplanted.length;

		for (const occurrence of record.occurrences) {
			accumulate(report.totals, occurrence);
			into(report.byLabel, occurrence.label, occurrence);
			into(report.byFormat, record.format, occurrence);
			into(report.bySurface, occurrence.surface, occurrence);
			if (occurrence.adversarial !== undefined) {
				into(report.byAdversarial, occurrence.adversarial, occurrence);
			}
		}
	}

	return report;
}

/**
 * The headline figures, for printing.
 */
export function summarize(tally: Tally): {
	recall?: number;
	labelledRecall?: number;
	precision?: number;
	coverage?: number;
} {
	return {
		recall: recall(tally),
		labelledRecall: labelledRecall(tally),
		precision: decoyPrecision(tally),
		coverage: coverage(tally.boundary),
	};
}
