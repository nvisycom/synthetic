/**
 * @fileoverview Scoring a benchmark run against a corpus' ground truth.
 *
 * The point of the whole harness: a corpus knows where every sensitive value
 * is, a run records what a pipeline found, and this compares the two. Neither
 * side is adjusted to fit the other — the answer key is what the generator
 * wrote and verified against the bytes on disk, and a run is what the pipeline
 * said, recorded verbatim.
 *
 * The two are pinned together by the corpus digest. A report that silently
 * scored one corpus' run against another's truth would produce numbers that
 * look ordinary and mean nothing, so a mismatch is refused rather than warned
 * about.
 *
 * @module scoring/score
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HarnessError } from "#/error.ts";
import { logger } from "#/logger.ts";
import { MANIFEST_FILE } from "#/manifest/layout.ts";
import { readManifest, readRecord } from "#/manifest/read.ts";
import { outcomePath, RUN_FILE } from "#/runner/layout.ts";
import type { RecordOutcome } from "#/runner/outcome.ts";
import { parseOutcome, parseRun } from "#/runner/schema.ts";
import { detailPath, REPORT_FILE } from "./layout.ts";
import type { Tally } from "./outcome.ts";
import {
	buildReport,
	type RecordReport,
	type Report,
	scoreRecord,
	summarize,
} from "./report.ts";

/**
 * Raised when a run and a corpus cannot be scored against each other.
 */
export class ScoreError extends HarnessError {
	override readonly name = "ScoreError";
}

/**
 * Options accepted by {@link runScore}.
 */
export interface ScoreOptions {
	/** Corpus directory holding the ground-truth manifest. */
	corpus: string;

	/** Run directory holding what the pipeline reported. */
	run: string;

	/**
	 * Directory to write the report into; undefined writes none.
	 *
	 * A directory rather than a file, because the per-record detail is written
	 * beside the summary rather than inside it — see {@link ./layout.ts}.
	 */
	report?: string;
}

/**
 * Reads a run's index, refusing one that does not match the corpus.
 */
async function readRun(
	runDir: string,
	corpusDir: string,
): Promise<ReturnType<typeof parseRun>> {
	let raw: string;
	try {
		raw = await readFile(join(runDir, RUN_FILE), "utf8");
	} catch (cause) {
		throw new ScoreError(
			`Could not read a run at ${runDir}: ${(cause as Error).message}`,
		);
	}

	const run = parseRun(JSON.parse(raw) as unknown);

	const digest = createHash("sha256")
		.update(await readFile(join(corpusDir, MANIFEST_FILE)))
		.digest("hex");

	if (digest !== run.corpusDigest) {
		throw new ScoreError(
			`Run ${run.id} was produced against a different corpus.\n` +
				`  run expects manifest digest ${run.corpusDigest}\n` +
				`  ${corpusDir} has ${digest}\n` +
				`Regenerate the corpus with --seed ${run.corpusSeed}, or score against the corpus this run used.`,
		);
	}

	return run;
}

/**
 * Reads one record's outcome, if the run has one.
 *
 * A run may legitimately lack an outcome for a record — it was interrupted, or
 * the corpus grew since. That is reported as an unprocessed record rather than
 * as a pipeline that missed everything in it.
 */
async function readOutcome(
	runDir: string,
	recordId: string,
): Promise<RecordOutcome | undefined> {
	try {
		const raw = await readFile(join(runDir, outcomePath(recordId)), "utf8");
		return parseOutcome(JSON.parse(raw) as unknown) as RecordOutcome;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw cause;
	}
}

/**
 * Scores a run, reporting per label, format, and surface form.
 *
 * @throws {ScoreError} If the run and corpus do not belong together
 */
export async function runScore(options: ScoreOptions): Promise<Report> {
	const manifest = await readManifest(options.corpus);
	const run = await readRun(options.run, options.corpus);

	const out = options.report;
	if (out !== undefined) {
		await mkdir(join(out, dirname(detailPath("x"))), { recursive: true });
	}

	// Records are scored one at a time and each one's detail written as it is
	// finished, so a corpus of any size costs one record's memory rather than
	// all of them. Only the tallies are kept, and those are bounded.
	const records: RecordReport[] = [];
	for (const entry of manifest.records) {
		const record = await readRecord(options.corpus, entry);
		const scored = scoreRecord(
			record,
			await readOutcome(options.run, entry.id),
		);

		if (out !== undefined) {
			await writeFile(
				join(out, detailPath(entry.id)),
				`${JSON.stringify(scored, null, 2)}\n`,
				"utf8",
			);
		}

		records.push(scored);
	}

	const report = buildReport(
		{
			runId: run.id,
			corpusSeed: run.corpusSeed,
			corpusDigest: run.corpusDigest,
		},
		records,
	);

	print(report);

	if (out !== undefined) {
		await writeFile(
			join(out, REPORT_FILE),
			`${JSON.stringify(report, null, 2)}\n`,
			"utf8",
		);
		logger.success("wrote report", { path: join(out, REPORT_FILE) });
	}

	return report;
}

/** Formats a ratio as a percentage, or a dash when there is nothing to report. */
function percent(value: number | undefined): string {
	return value === undefined
		? "    —"
		: `${(value * 100).toFixed(1)}%`.padStart(5);
}

/**
 * Prints a breakdown as a table, widest column first.
 */
function table(title: string, breakdown: Record<string, Tally>): void {
	const rows = Object.entries(breakdown).sort(([a], [b]) => a.localeCompare(b));
	if (rows.length === 0) return;

	const width = Math.max(title.length, ...rows.map(([key]) => key.length));

	process.stdout.write(
		`\n  ${title.padEnd(width)}  found  recall  strict  wrong  cover  decoys\n`,
	);

	for (const [key, tally] of rows) {
		const { recall, labelledRecall, precision, coverage } = summarize(tally);
		// `found` counts what recall counts — anything located, label right or
		// not — so the column and the percentage beside it cannot disagree. The
		// ones located under the wrong label are broken out in `wrong`.
		const located = tally.found + tally.mislabelled;

		process.stdout.write(
			`  ${key.padEnd(width)}  ${`${located}/${tally.planted}`.padStart(5)}  ` +
				`${percent(recall)}  ${percent(labelledRecall)}  ` +
				`${String(tally.mislabelled).padStart(5)}  ` +
				`${percent(coverage)}  ${percent(precision)}\n`,
		);
	}
}

/**
 * Prints the report.
 *
 * Several breakdowns rather than one number, because they fail for different
 * reasons: `recall` counts a value as found even under the wrong label, since a
 * redactor still removes it, while `strict` requires the label to agree.
 */
function print(report: Report): void {
	const {
		recall: overall,
		labelledRecall: strict,
		precision,
		coverage: cover,
	} = summarize(report.totals);

	process.stdout.write(
		`\n  run ${report.runId}  (corpus seed ${report.corpusSeed})\n`,
	);
	process.stdout.write(
		`  ${report.totals.found + report.totals.mislabelled}/${report.totals.planted} planted values found` +
			`   recall ${percent(overall)}   labelled ${percent(strict)}\n`,
	);
	process.stdout.write(
		`  boundary coverage ${percent(cover)}   decoys left alone ${percent(precision)}` +
			`   unplanted detections ${report.unplanted}\n`,
	);

	if (report.totals.unmeasured > 0) {
		// Said plainly rather than left to be inferred from a coverage figure
		// computed over fewer values than were found.
		process.stdout.write(
			`  ${report.totals.unmeasured} found value(s) had no boundary to measure` +
				` — the pipeline named a cell without offsets\n`,
		);
	}

	if (report.failedRecords > 0) {
		process.stdout.write(
			`  ${report.failedRecords} record(s) never processed, and score nothing\n`,
		);
	}

	table("label", report.byLabel);
	table("format", report.byFormat);
	table("surface", report.bySurface);
	table("adversarial", report.byAdversarial);
	process.stdout.write("\n");
}
