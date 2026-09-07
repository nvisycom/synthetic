/**
 * @fileoverview Scoring redaction output against ground truth.
 *
 * @module scoring/score
 */

/**
 * Options accepted by {@link runScore}.
 */
export interface ScoreOptions {
	/** Corpus directory holding the ground-truth manifest. */
	corpus: string;
	/** Directory of redaction output to grade. */
	output: string;
	/** Where to write the report; undefined prints to stdout. */
	report?: string;
}

/**
 * Scores redaction output, reporting per entity type and modality.
 */
export async function runScore(options: ScoreOptions): Promise<void> {
	void options;
	throw new Error("not implemented");
}
