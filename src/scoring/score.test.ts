import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGenerate } from "#/generator/generate.ts";
import { readManifest } from "#/manifest/read.ts";
import { runScore, ScoreError } from "./score.ts";

let work: string;

/** A corpus generated from the real specs, so the answer key is genuine. */
async function corpus(records = 3): Promise<string> {
	const out = join(work, "corpus");
	await runGenerate({
		seed: "5",
		records: String(records),
		data: "./data",
		out,
	});
	return out;
}

/**
 * Writes a run beside a corpus, with whatever outcomes a test needs.
 *
 * The digest is read from the corpus rather than invented, since scoring
 * refuses a run that does not match.
 */
async function run(
	corpusDir: string,
	outcomes: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
): Promise<string> {
	const { createHash } = await import("node:crypto");
	const { readFile } = await import("node:fs/promises");
	const manifest = await readManifest(corpusDir);
	const digest = createHash("sha256")
		.update(await readFile(join(corpusDir, "manifest.json")))
		.digest("hex");

	const dir = join(work, "run");
	await mkdir(join(dir, "records"), { recursive: true });

	await writeFile(
		join(dir, "run.json"),
		JSON.stringify({
			version: 1,
			id: "run-1",
			corpusSeed: manifest.seed,
			corpusDigest: digest,
			workspace: "ws",
			pipeline: "p",
			runner: "0.1.0",
			startedAt: "2026-01-01T00:00:00.000Z",
			finishedAt: "2026-01-01T00:00:01.000Z",
			records: Object.keys(outcomes).map((id) => ({
				recordId: id,
				path: `records/${id}.json`,
				status: "detected",
			})),
			...overrides,
		}),
		"utf8",
	);

	for (const [id, outcome] of Object.entries(outcomes)) {
		await writeFile(
			join(dir, "records", `${id}.json`),
			JSON.stringify(outcome),
			"utf8",
		);
	}

	return dir;
}

beforeEach(async () => {
	work = await mkdtemp(join(tmpdir(), "synthetic-score-"));
	vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(work, { recursive: true, force: true });
});

describe("runScore", () => {
	it("scores a run whose detections match what was planted", async () => {
		// The detections are built from the answer key itself, so a pipeline that
		// found everything perfectly must score as having found everything —
		// otherwise every number below it is suspect.
		const corpusDir = await corpus();
		const manifest = await readManifest(corpusDir);
		const { readRecord } = await import("#/manifest/read.ts");

		const outcomes: Record<string, unknown> = {};
		for (const entry of manifest.records) {
			const record = await readRecord(corpusDir, entry);
			const labels = new Map(record.entities.map((e) => [e.id, e]));

			outcomes[entry.id] = {
				status: "detected",
				recordId: entry.id,
				detectionId: "det",
				durationMs: 1,
				detected: record.occurrences
					// A decoy is planted to be left alone, so a perfect pipeline does
					// not report it.
					.filter((o) => labels.get(o.entityId)?.expect !== "ignored")
					.map((o, index) => ({
						id: `d${index}`,
						label: labels.get(o.entityId)?.label,
						location: o.location,
					})),
			};
		}

		const report = await runScore({
			corpus: corpusDir,
			run: await run(corpusDir, outcomes),
		});

		expect(report.totals.planted).toBeGreaterThan(0);
		expect(report.totals.found).toBe(report.totals.planted);
		expect(report.totals.missed).toBe(0);
		expect(report.totals.overRedacted).toBe(0);
		expect(report.unplanted).toBe(0);
		expect(report.failedRecords).toBe(0);
	});

	it("scores a run that found nothing as a total miss", async () => {
		const corpusDir = await corpus(1);
		const manifest = await readManifest(corpusDir);
		const id = manifest.records[0]?.id ?? "";

		const report = await runScore({
			corpus: corpusDir,
			run: await run(corpusDir, {
				[id]: {
					status: "detected",
					recordId: id,
					detectionId: "det",
					durationMs: 1,
					detected: [],
				},
			}),
		});

		expect(report.totals.found).toBe(0);
		expect(report.totals.missed).toBe(report.totals.planted);
	});

	it("refuses a run produced against a different corpus", async () => {
		// Numbers from a mismatched pair look entirely ordinary and mean nothing,
		// so this is refused rather than warned about.
		const corpusDir = await corpus(1);
		const manifest = await readManifest(corpusDir);
		const id = manifest.records[0]?.id ?? "";

		const runDir = await run(
			corpusDir,
			{
				[id]: {
					status: "detected",
					recordId: id,
					detectionId: "d",
					durationMs: 1,
					detected: [],
				},
			},
			{ corpusDigest: "b".repeat(64) },
		);

		await expect(runScore({ corpus: corpusDir, run: runDir })).rejects.toThrow(
			ScoreError,
		);
	});

	it("reports a record the run never processed rather than blaming detection", async () => {
		const corpusDir = await corpus(1);
		const manifest = await readManifest(corpusDir);
		const id = manifest.records[0]?.id ?? "";
		const out = join(work, "report");

		const report = await runScore({
			corpus: corpusDir,
			run: await run(corpusDir, {}),
			report: out,
		});

		expect(report.failedRecords).toBe(1);
		// Its values are absent from the tallies rather than counted as missed:
		// they were never looked at, and blaming detection for a transport
		// failure sends the reader after the wrong thing.
		expect(report.totals.planted).toBe(0);

		const { readFile } = await import("node:fs/promises");
		const detail = JSON.parse(
			await readFile(join(out, "records", `${id}.json`), "utf8"),
		) as { failed?: { stage: string } };
		expect(detail.failed?.stage).toBe("missing");
	});

	it("writes the summary and each record's detail beside it", async () => {
		// Split so the summary stays a few kilobytes whatever the corpus' size:
		// its breakdowns are keyed by fixed vocabularies, while the detail is a
		// row per planted value and grows without bound.
		const corpusDir = await corpus(1);
		const manifest = await readManifest(corpusDir);
		const id = manifest.records[0]?.id ?? "";
		const out = join(work, "report");

		await runScore({
			corpus: corpusDir,
			run: await run(corpusDir, {
				[id]: {
					status: "detected",
					recordId: id,
					detectionId: "d",
					durationMs: 1,
					detected: [],
				},
			}),
			report: out,
		});

		const { readFile } = await import("node:fs/promises");
		const summary = JSON.parse(
			await readFile(join(out, "report.json"), "utf8"),
		) as { version: number; scoredRecords: number; records?: unknown };
		expect(summary.version).toBe(1);
		expect(summary.scoredRecords).toBe(1);
		// The per-record rows are not in it, which is the point of the split.
		expect(summary.records).toBeUndefined();

		const detail = JSON.parse(
			await readFile(join(out, "records", `${id}.json`), "utf8"),
		) as { recordId: string; occurrences: unknown[] };
		expect(detail.recordId).toBe(id);
		expect(detail.occurrences.length).toBeGreaterThan(0);
	});

	it("reports a missing run rather than a stack trace", async () => {
		const corpusDir = await corpus(1);
		await expect(
			runScore({ corpus: corpusDir, run: join(work, "nowhere") }),
		).rejects.toThrow(ScoreError);
	});
});
