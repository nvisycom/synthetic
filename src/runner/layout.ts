/**
 * @fileoverview Where a run keeps its files.
 *
 * ```
 * runs/
 *   <run id>/
 *     run.json           the index: corpus, pipeline, timings
 *     records/
 *       rec_0001.json    what the pipeline reported, or why it failed
 * ```
 *
 * Mirrors a corpus: an index read in full to plan or report, and one file per
 * record read only when that record is scored.
 *
 * @module runner/layout
 */

/** Filename of the run index, at the run's root. */
export const RUN_FILE = "run.json";

/** Directory holding per-record outcomes, relative to the run root. */
export const RECORDS_DIR = "records";

/**
 * Returns a record's outcome path, relative to the run root.
 */
export function outcomePath(recordId: string): string {
	return `${RECORDS_DIR}/${recordId}.json`;
}
