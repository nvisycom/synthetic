#!/usr/bin/env node
/**
 * @fileoverview CLI entrypoint for the synthetic benchmark harness.
 *
 * Three commands cover the benchmark's lifecycle: `generate` builds a corpus,
 * `score` grades redaction output against it, and `bench` runs both against a
 * live pipeline. They are separate rather than one flow because a corpus is
 * expensive to build and worth reusing across many scoring runs, and because
 * scoring must be repeatable against a fixed corpus for a regression to mean
 * anything.
 *
 * @module main
 */

import { defineCommand, runMain } from "citty";
import { description, version } from "./config.ts";
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
		description: "Score redaction output against a corpus' ground truth",
	},
	args: {
		corpus: {
			type: "string",
			description: "Corpus directory holding the ground-truth manifest",
			default: "./corpus",
			alias: "c",
		},
		output: {
			type: "string",
			description: "Directory of redaction output to grade",
			required: true,
		},
		report: {
			type: "string",
			description: "Where to write the report; omit to print to stdout",
		},
	},
	async run({ args }) {
		const { runScore } = await import("./scoring/score.ts");
		await guard(() => runScore(args));
	},
});

const bench = defineCommand({
	meta: {
		name: "bench",
		description: "Run a corpus through a pipeline and score the result",
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
	},
	async run({ args }) {
		const { runBench } = await import("./runner/bench.ts");
		await guard(() =>
			runBench({
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
				concurrency: Number(args.concurrency),
				timeoutMs: Number(args.timeout) * 1000,
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
	subCommands: { generate, score, bench },
});

/**
 * Errors the harness raises deliberately, as opposed to ones that mean a bug.
 *
 * A missing token or an unusable spec is a message to act on, so it is printed
 * as one. A stack trace there buries the sentence that matters under frames the
 * caller cannot do anything about — while a genuine fault still prints in full,
 * because there the frames are the useful part.
 */
/** The hosted API, used unless told otherwise. */
const PRODUCTION_URL = "https://api.nvisy.com";

/** A locally running server, as `--development` selects. */
const DEVELOPMENT_URL = "http://127.0.0.1:8080";

const EXPECTED = new Set([
	"BenchError",
	"GeneratorError",
	"ManifestError",
	"RunError",
	"SpecError",
	"TemplateError",
]);

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
		const error = cause as Error & { issues?: readonly string[] };
		if (!EXPECTED.has(error.name)) throw cause;

		// A message to act on, not a fault: print the sentence that matters and
		// leave out frames the caller can do nothing about.
		process.stderr.write(`${error.message}\n`);
		for (const issue of error.issues ?? []) {
			process.stderr.write(`  - ${issue}\n`);
		}
		process.exit(1);
	}
}

await runMain(main);
