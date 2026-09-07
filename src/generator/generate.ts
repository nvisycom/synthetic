/**
 * @fileoverview Corpus generation.
 *
 * @module generator/generate
 */

/**
 * Options accepted by {@link runGenerate}.
 */
export interface GenerateOptions {
	/** Directory of tracked corpus specifications to build from. */
	data: string;
	/** Directory to render the corpus into. */
	out: string;
	/** Seed making the corpus reproducible. */
	seed: string;
	/** Number of records to generate. */
	records: string;
}

/**
 * Generates a synthetic corpus and its ground-truth manifest.
 */
export async function runGenerate(options: GenerateOptions): Promise<void> {
	void options;
	throw new Error("not implemented");
}
