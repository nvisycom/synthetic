#!/usr/bin/env node
/**
 * @fileoverview CLI entrypoint for the synthetic benchmark harness.
 *
 * Three commands cover the benchmark's lifecycle. `generate` builds a corpus,
 * `run` submits one to a live pipeline and grades what came back, and `score`
 * grades a run that already exists.
 *
 * `run` is the usual entry point, and the other two are the halves it is made
 * of. They stay separable because they cost very different things: a corpus is
 * expensive to build and worth reusing across many runs, a run costs a network
 * round trip per record, and scoring costs nothing — so a change to how
 * matching works re-grades an existing run in milliseconds rather than
 * resubmitting it. A run is pinned to its corpus by digest, so the two can only
 * be paired back up with the corpus that produced them.
 *
 * @module main
 */

import { defineCommand, runMain } from "citty";
import { description, version } from "./config.ts";
import { HarnessError } from "./error.ts";
import { configureLogger } from "./logger.ts";

const generate = defineCommand({
	meta: {
		name: "generate",
		description: "Generate a synthetic corpus with recorded ground truth",
	},
	args: {
		data: {
			type: "string",
			description: "Directory of tracked corpus specifications to build from",
			default: "./data",
			alias: "d",
		},
		out: {
			type: "string",
			description: "Directory to render the corpus into",
			default: "./corpus",
			alias: "o",
		},
		seed: {
			type: "string",
			description:
				"Seed for the corpus generator. The same seed always yields the same corpus, which is what makes a score comparable across runs",
			required: true,
		},
		records: {
			type: "string",
			description: "Number of records to generate",
			default: "4000",
			alias: "n",
		},
	},
	async run({ args }) {
		const { runGenerate } = await import("./generator/generate.ts");
		await guard(() => runGenerate(args));
	},
});

const score = defineCommand({
	meta: {
		name: "score",
		description: "Score a benchmark run against a corpus' ground truth",
	},
	args: {
		corpus: {
			type: "string",
			description: "Corpus directory holding the ground-truth manifest",
			default: "./corpus",
			alias: "c",
		},
		run: {
			type: "string",
			description: "Run directory holding what the pipeline reported",
			required: true,
			alias: "r",
		},
		report: {
			type: "string",
			description:
				"Directory to write the report into; omit to print the summary only",
		},
	},
	async run({ args }) {
		const { runScore } = await import("./scoring/score.ts");
		await guard(async () => {
			await runScore(args);
		});
	},
});

const run = defineCommand({
	meta: {
		name: "run",
		description: "Submit a corpus to a pipeline and score what comes back",
	},
	args: {
		corpus: {
			type: "string",
			description: "Corpus directory to submit",
			default: "./corpus",
			alias: "c",
		},
		out: {
			type: "string",
			description: "Directory to write the run into",
			default: "./runs",
			alias: "o",
		},
		development: {
			type: "boolean",
			description: "Run against a local server on port 8080",
			alias: "d",
			default: false,
		},
		"base-url": {
			type: "string",
			description: "API base URL, overriding --development",
		},
		concurrency: {
			type: "string",
			description:
				"How many records to have in flight at once; the win flattens past 4",
			default: "4",
			alias: "j",
		},
		timeout: {
			type: "string",
			description: "Give up on a detection after this many seconds",
			default: "120",
		},
		score: {
			type: "boolean",
			description:
				"Score the run once it is written; --no-score submits without grading",
			default: true,
		},
		report: {
			type: "string",
			description: "Directory to write the report into, when scoring",
		},
	},
	async run({ args }) {
		const { executeRun } = await import("./runner/run.ts");
		await guard(() =>
			executeRun({
				corpus: args.corpus,
				out: args.out,
				// An explicit URL wins; otherwise --development picks the local
				// server, and the default stays production so a run against it is
				// never what happens by accident.
				baseUrl:
					args["base-url"] ||
					(args.development ? DEVELOPMENT_URL : PRODUCTION_URL),
				// Read from the environment rather than a flag, so a token never
				// lands in a shell history or a process listing. Without one the
				// runner creates a throwaway account of its own.
				...(process.env.NVISY_API_TOKEN
					? { token: process.env.NVISY_API_TOKEN }
					: {}),
				concurrency: positiveInteger(args.concurrency, "--concurrency"),
				timeoutMs: positiveInteger(args.timeout, "--timeout") * 1000,
				score: args.score,
				...(args.report !== undefined ? { report: args.report } : {}),
			}),
		);
	},
});

const main = defineCommand({
	meta: { name: "synthetic", version, description },
	args: {
		verbose: {
			type: "boolean",
			description: "Log debug detail",
			alias: "v",
			default: false,
		},
		quiet: {
			type: "boolean",
			description: "Log warnings and errors only",
			alias: "q",
			default: false,
		},
		json: {
			type: "boolean",
			description:
				"Log newline-delimited JSON; the default when output is not a terminal",
			default: false,
		},
	},
	// Runs before the matched subcommand, so every command shares one
	// configured logger rather than each wiring up its own.
	setup({ args }) {
		configureLogger({
			verbose: args.verbose,
			quiet: args.quiet,
			json: args.json,
		});
	},
	subCommands: { generate, run, score },
});

/**
 * Errors the harness raises deliberately, as opposed to ones that mean a bug.
 *
 * A missing token or an unusable spec is a message to act on, so it is printed
 * as one. A stack trace there buries the sentence that matters under frames the
 * caller cannot do anything about — while a genuine fault still prints in full,
 * because there the frames are the useful part.
 */
/**
 * Reads a flag that must be a positive whole number.
 *
 * `Number("abc")` is NaN, and NaN survives every comparison downstream — a
 * mistyped concurrency spawns no workers and writes an empty run as a success.
 */
function positiveInteger(value: string, flag: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		// Thrown rather than exited: the guard below prints it as a message and
		// sets the exit code, and `process.exit` can terminate before a pending
		// write to a pipe has flushed.
		const error = new Error(
			`${flag} must be a positive whole number, got ${JSON.stringify(value)}`,
		);
		error.name = "ExecutionError";
		throw error;
	}
	return parsed;
}

/** The hosted API, used unless told otherwise. */
const PRODUCTION_URL = "https://api.nvisy.com";

/** A locally running server, as `--development` selects. */
const DEVELOPMENT_URL = "http://127.0.0.1:8080";

/**
 * Runs a command, reporting a deliberate failure as a message.
 *
 * Wrapped per command rather than around `runMain`, because citty's runMain
 * catches everything, console.errors it, and exits — so an error thrown from a
 * command never reaches a handler outside it, and handling it outside would
 * also give up runMain's `--help` and `--version`.
 */
async function guard(work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (cause) {
		// Asked of the type rather than of a list of names, so an error added
		// later is reported correctly by virtue of extending the base — there is
		// nothing here to keep in step with it.
		if (!(cause instanceof HarnessError)) throw cause;

		// A message to act on, not a fault: print the sentence that matters and
		// leave out frames the caller can do nothing about.
		process.stderr.write(`${cause.message}\n`);
		for (const issue of cause.issues) {
			process.stderr.write(`  - ${issue}\n`);
		}
		process.exitCode = 1;
	}
}

await runMain(main);
