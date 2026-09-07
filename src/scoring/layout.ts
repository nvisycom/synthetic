/**
 * @fileoverview Where a report keeps its files.
 *
 * ```
 * report/
 *   report.json          the summary
 *   records/
 *     rec_0001.json      what became of each value in it
 * ```
 *
 * The same split a corpus and a run already make, for the same reason. The
 * summary is bounded — its breakdowns are keyed by label, format, and surface
 * form, all fixed vocabularies — so it stays a few kilobytes whether twelve
 * records were scored or a hundred thousand. The per-record detail is a row per
 * planted value, and holding it in the same file would put a corpus-sized
 * document between a reader and a single number.
 *
 * @module scoring/layout
 */

/** Filename of the report summary, at the report's root. */
export const REPORT_FILE = "report.json";

/** Directory holding per-record detail, relative to the report root. */
export const RECORDS_DIR = "records";

/**
 * Returns a record's detail path, relative to the report root.
 */
export function detailPath(recordId: string): string {
	return `${RECORDS_DIR}/${recordId}.json`;
}
