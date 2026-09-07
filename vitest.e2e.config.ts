import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",

		// Separate from the unit suite: these spawn the CLI as a subprocess and
		// run against the repository's own specs, so they are slower and they
		// fail for different reasons — a broken spec rather than broken code.
		include: ["test/**/*.e2e.test.ts"],

		// Generating a corpus and comparing two full runs takes longer than a
		// unit test's default budget allows.
		testTimeout: 120_000,
		hookTimeout: 120_000,

		// One corpus at a time: the runs are IO-bound and interleaving them makes
		// a failure harder to place.
		fileParallelism: false,
	},

	// Types are imported from src/ so the corpus shape is declared once. Runtime
	// helpers are not: an assertion that used the harness's own reader could not
	// catch a bug the writer and reader share.
	resolve: {
		alias: {
			"#": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},

	oxc: {
		target: "es2022",
	},
});
