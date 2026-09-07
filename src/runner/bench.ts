/**
 * @fileoverview End-to-end benchmark run against a live pipeline.
 *
 * @module runner/bench
 */

/**
 * Options accepted by {@link runBench}.
 */
export interface BenchOptions {
	/** Corpus directory to submit. */
	corpus: string;
	/** Where to write the report; undefined prints to stdout. */
	report?: string;
}

/**
 * Submits a corpus to a pipeline and scores what comes back.
 */
export async function runBench(options: BenchOptions): Promise<void> {
	void options;
	throw new Error("not implemented");
}
