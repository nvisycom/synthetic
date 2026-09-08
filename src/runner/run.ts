/**
 * @fileoverview Running a corpus through a live pipeline.
 *
 * The whole benchmark in one command: provision a workspace, submit every
 * record, record what came back, tear the workspace down, and score the result.
 *
 * It provisions and deletes its own workspace, policy, and pipeline rather than
 * using existing ones, so a run measures detection rather than whatever policy
 * a shared workspace happens to carry — and so a run leaves nothing behind.
 * Scoring is a separate module called at the end, which is what lets an
 * existing run be re-graded without resubmitting it.
 *
 * @module runner/run
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Nvisy } from "@nvisy/sdk";
import { version } from "#/config.ts";
import { HarnessError } from "#/error.ts";
import { logger } from "#/logger.ts";
import { MANIFEST_FILE } from "#/manifest/layout.ts";
import { readManifest, readRecord } from "#/manifest/read.ts";
import { outcomePath, RECORDS_DIR, RUN_FILE } from "./layout.ts";
import type { Run } from "./outcome.ts";
import { provision, teardown } from "./provision.ts";
import { submitRecord } from "./submit.ts";

/**
 * Options accepted by {@link executeRun}.
 */
export interface RunOptions {
	/** Corpus directory to submit. */
	corpus: string;
	/** Directory to write the run into. */
	out: string;
	/** Base URL of the API. */
	baseUrl: string;
	/** API token; when absent, the runner creates a throwaway account. */
	token?: string;
	/** Give up on a detection after this long, in milliseconds. */
	timeoutMs?: number;

	/** How many records to have in flight at once. */
	concurrency?: number;

	/**
	 * Abandon the run when this many of the last {@link failureWindow} records
	 * failed.
	 *
	 * Isolating a failure is right for a transient one and wrong for a server
	 * that has gone away: without a limit a run writes a failure per remaining
	 * record and finishes "successfully", leaving a file that looks like a
	 * benchmark result and is not.
	 *
	 * A rate over a trailing window rather than a run of consecutive failures,
	 * because with records in flight together there is no meaningful "in a row"
	 * — the order results arrive in is not the order they were submitted.
	 */
	failureThreshold?: number;

	/**
	 * Whether to score the run once it is written.
	 *
	 * On by default: submitting a corpus and not grading it leaves the question
	 * the benchmark exists to answer unanswered. Turned off when the run is
	 * wanted for its own sake — to score later, or against a different corpus
	 * copy.
	 */
	score?: boolean;

	/** Directory to write the report into, when scoring. */
	report?: string;

	/** How many recent records the threshold is measured over. */
	failureWindow?: number;
}

/**
 * Records in flight at once, unless asked otherwise.
 *
 * Four rather than more because the win flattens quickly: measured against a
 * local server, twenty records took 59s serially, 44s at four, and 42s at
 * eight, while per-record latency rose from 2.7s to 15.1s — the pipeline
 * processes largely in series, so extra concurrency mostly queues. Sixteen
 * exhausted the server's database connections outright.
 */
const DEFAULT_CONCURRENCY = 4;

/** Most of a small window failing means the pipeline is gone, not unlucky. */
const DEFAULT_FAILURE_THRESHOLD = 8;
const DEFAULT_FAILURE_WINDOW = 10;

/**
 * Raised when a run cannot start or cannot be completed.
 */
export class ExecutionError extends HarnessError {
	override readonly name = "ExecutionError";
}

/**
 * The token length the SDK's client requires before it will construct.
 *
 * Signing up needs a client, and a client needs a token, so the bootstrap call
 * is made with a placeholder the server never sees as credentials.
 */
const BOOTSTRAP_TOKEN = "bootstrap-signup";

/**
 * Returns an authenticated client.
 *
 * With `NVISY_API_TOKEN` set, the run uses that account. Without it, the runner
 * signs up for a throwaway one — a benchmark provisions and deletes its own
 * workspace anyway, so it needs an account rather than *your* account, and
 * asking for credentials on the command line would put a password in a shell
 * history and a process listing for no benefit.
 */
async function authenticate(options: RunOptions): Promise<Nvisy> {
	if (options.token !== undefined && options.token.length > 0) {
		return new Nvisy({ apiToken: options.token, baseUrl: options.baseUrl });
	}

	// Signing up needs a client, and a client needs a token, so the bootstrap
	// call carries a placeholder the server never reads as credentials.
	const bootstrap = new Nvisy({
		apiToken: BOOTSTRAP_TOKEN,
		baseUrl: options.baseUrl,
	});

	// Unique per run, so concurrent benchmarks cannot collide on a username, and
	// random rather than sequential so an account is never guessable.
	const suffix = `${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

	try {
		const auth = await bootstrap.auth.signupAccount({
			username: `synthetic${suffix}`,
			emailAddress: `synthetic-${suffix}@benchmark.invalid`,
			// Throwaway and never reused: the account exists for one run, and the
			// token it returns is the only thing that touches it.
			password: `S-${randomBytes(24).toString("base64url")}`,
			displayName: "Synthetic Benchmark",
		});
		return new Nvisy({ apiToken: auth.apiToken, baseUrl: options.baseUrl });
	} catch (cause) {
		const reason = (cause as Error).message;

		// `fetch failed` means nothing answered, which is a different problem
		// from a rejected signup and has a different fix. Saying "could not
		// create an account" there sends the reader after the wrong thing.
		if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(reason)) {
			throw new ExecutionError(
				[
					`No API server at ${options.baseUrl}`,
					"",
					"  Point at a running server:",
					"    synthetic run --base-url http://127.0.0.1:8080",
				].join("\n"),
			);
		}

		throw new ExecutionError(
			[
				`Could not create a benchmark account: ${reason}`,
				"",
				"  Set a token to use an existing account instead:",
				"    export NVISY_API_TOKEN=...",
			].join("\n"),
		);
	}
}

/**
 * Submits a corpus to a pipeline and records what came back.
 *
 * Provisions its own workspace, policy, and pipeline, and deletes them
 * afterwards — including when the run fails, so a failed benchmark does not
 * leave configuration behind that a later run could inherit.
 */
export async function executeRun(options: RunOptions): Promise<void> {
	// The options come first, because they cost nothing to check and depend on
	// nothing. Anything after this either reaches the network or provisions a
	// workspace, and a bad flag surfacing behind an unreachable server sends the
	// reader after the wrong problem — or worse, throws after provisioning and
	// strands a workspace that only the `finally` below deletes.
	//
	// Validated rather than clamped: `Math.max(1, NaN)` is NaN, which spawns no
	// workers at all, so a mistyped flag would write an empty run and call it a
	// success.
	const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
	if (!Number.isInteger(concurrency) || concurrency < 1) {
		throw new ExecutionError(
			`Concurrency must be a positive integer, got ${JSON.stringify(options.concurrency)}`,
		);
	}
	const threshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
	const window = options.failureWindow ?? DEFAULT_FAILURE_WINDOW;

	// Checked before the corpus is read: a missing token is the cheapest failure
	// to report, and waiting behind a manifest read would surface whichever
	// problem happens to come first rather than the one the caller can fix.
	const client = await authenticate(options);

	const manifest = await readManifest(options.corpus);

	// Pins the run to the exact corpus it scored. Two runs are only comparable
	// if this matches, and a report that silently compares across corpora is
	// comparing nothing.
	const corpusDigest = createHash("sha256")
		.update(await readFile(join(options.corpus, MANIFEST_FILE)))
		.digest("hex");

	const runId = `${manifest.seed}-${Date.now().toString(36)}`;
	const startedAt = new Date().toISOString();

	logger.info("provisioning", {
		run: runId,
		labels: manifest.labels.length,
		records: manifest.records.length,
	});
	const target = await provision(client, runId, manifest.labels);

	// Indexed by position, so the run's record order matches the corpus' even
	// though results arrive out of order.
	const outcomes: (Run["records"][number] | undefined)[] = new Array(
		manifest.records.length,
	);

	// A trailing window of completions, oldest first, holding whether each
	// failed. Order-independent, so it means the same thing at any concurrency.
	const recent: boolean[] = [];
	let completed = 0;
	let aborted: ExecutionError | undefined;

	try {
		await mkdir(join(options.out, runId, RECORDS_DIR), { recursive: true });

		let next = 0;
		const worker = async (): Promise<void> => {
			while (aborted === undefined) {
				const index = next++;
				const entry = manifest.records[index];
				if (entry === undefined) return;

				const record = await readRecord(options.corpus, entry);
				const bytes = await readFile(
					join(options.corpus, entry.path, record.artifact),
				);

				const outcome = await submitRecord(
					client,
					target.workspace,
					target.pipeline,
					{
						id: record.id,
						format: record.format,
						artifact: record.artifact,
						bytes,
					},
					options.timeoutMs === undefined
						? {}
						: { timeoutMs: options.timeoutMs },
				);

				const path = outcomePath(record.id);
				await writeFile(
					join(options.out, runId, path),
					`${JSON.stringify(outcome, null, 2)}\n`,
					"utf8",
				);

				outcomes[index] = {
					recordId: record.id,
					path,
					status: outcome.status,
				};

				completed++;
				recent.push(outcome.status === "failed");
				if (recent.length > window) recent.shift();

				logger.info("submitted", {
					record: `${completed}/${manifest.records.length}`,
					id: record.id,
					...(outcome.status === "detected"
						? { found: outcome.detected.length, ms: outcome.durationMs }
						: { failed: outcome.stage }),
				});

				if (outcome.status === "failed") {
					logger.warn("record failed", {
						id: record.id,
						stage: outcome.stage,
						message: outcome.message,
					});

					const failures = recent.filter(Boolean).length;
					if (recent.length >= window && failures >= threshold) {
						// Set rather than thrown, so the other workers finish what they
						// already started instead of leaving detections half-written.
						aborted = new ExecutionError(
							[
								`Aborted after ${completed} of ${manifest.records.length}: ${failures} of the last ${recent.length} failed.`,
								"",
								`  Last failure (${outcome.stage}): ${outcome.message}`,
								"",
								"  The pipeline is not answering. Nothing is scored from a",
								"  partial run, so no index was written.",
							].join("\n"),
						);
					}
				}
			}
		};

		await Promise.all(
			Array.from(
				{ length: Math.min(concurrency, manifest.records.length) },
				() => worker(),
			),
		);

		if (aborted !== undefined) throw aborted;

		const entries = outcomes.filter(
			(outcome): outcome is Run["records"][number] => outcome !== undefined,
		);

		const run: Run = {
			version: 1,
			id: runId,
			corpusSeed: manifest.seed,
			corpusDigest,
			workspace: target.workspace,
			pipeline: target.pipeline,
			runner: version,
			startedAt,
			finishedAt: new Date().toISOString(),
			records: entries,
		};

		await writeFile(
			join(options.out, runId, RUN_FILE),
			`${JSON.stringify(run, null, 2)}\n`,
			"utf8",
		);
	} finally {
		const problem = await teardown(client, target.workspace);
		if (problem !== undefined) {
			// Reported rather than thrown: a stranded workspace must not mask the
			// failure that stranded it.
			logger.warn("could not delete the run's workspace", {
				workspace: target.workspace,
				message: problem,
			});
		}
	}

	const written = outcomes.filter(
		(outcome): outcome is Run["records"][number] => outcome !== undefined,
	);
	const failed = written.filter((entry) => entry.status === "failed").length;
	const detected = written.length - failed;

	if (failed > 0) {
		// Stated plainly rather than buried in a success line: a score computed
		// over a run with failures covers fewer records than the corpus holds,
		// and a report that does not say so overstates its own coverage.
		logger.warn("some records were not scored", {
			failed,
			of: written.length,
		});
	}

	logger.success("benchmark complete", {
		run: runId,
		detected,
		failed,
		out: join(options.out, runId),
	});

	if (options.score === false) return;

	// Imported here rather than at the top so a submit-only run does not pay to
	// load the scorer, and so the two halves stay separable.
	const { runScore } = await import("#/scoring/score.ts");
	await runScore({
		corpus: options.corpus,
		run: join(options.out, runId),
		...(options.report !== undefined ? { report: options.report } : {}),
	});
}
