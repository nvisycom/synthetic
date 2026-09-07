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
		await runGenerate(args);
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
		await runScore(args);
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
		report: {
			type: "string",
			description: "Where to write the report; omit to print to stdout",
		},
	},
	async run({ args }) {
		const { runBench } = await import("./runner/bench.ts");
		await runBench(args);
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

await runMain(main);
