/**
 * @fileoverview Where a corpus keeps its files.
 *
 * ```
 * corpus/
 *   manifest.json          the index
 *   records/
 *     rec_0001/
 *       document.pdf       the artifact
 *       truth.json         its answer key
 * ```
 *
 * The index is read in full to plan a run; an answer key is read only when its
 * record is scored. Splitting them is what keeps grading one document from
 * costing a parse of the whole corpus.
 *
 * @module manifest/layout
 */

/** Filename of the corpus index, at the corpus root. */
export const MANIFEST_FILE = "manifest.json";

/** Filename of a record's answer key, in the record's own directory. */
export const TRUTH_FILE = "truth.json";

/** Directory holding every record, relative to the corpus root. */
export const RECORDS_DIR = "records";

/**
 * Returns a record's directory, relative to the corpus root.
 */
export function recordPath(id: string): string {
	return `${RECORDS_DIR}/${id}`;
}
