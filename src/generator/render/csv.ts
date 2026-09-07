/**
 * @fileoverview Rendering a CSV document.
 *
 * A CSV spec's template is a JSON array of rows, each an array of cells, with
 * `{{slot}}` placeholders inside cell text. The first row is the header.
 *
 * Tabular content is addressed by row and column rather than by an offset into
 * the file, because that is how a pipeline reads it: a detection over a
 * spreadsheet comes back naming a cell. Recording ground truth the same way
 * means scoring compares like with like, with no translation step in the middle
 * where an off-by-one could hide.
 *
 * Quoting is why a value's byte range is not simply where it sits in its cell.
 * RFC 4180 wraps a cell containing a comma, quote, or newline in quotes and
 * doubles any quote inside it, so `Reyes, "Dana"` occupies more bytes in the
 * file than the value itself does. Both coordinates are recorded: the cell
 * address a detection names, and the bytes a redaction must cover.
 *
 * Unlike the other formats, quoting is decided by the whole cell rather than by
 * the value — a comma anywhere in the cell quotes it — so a value's written form
 * is not known until the cell is complete. The row is therefore assembled first
 * with markers in place, exactly as the other renderers do, and quoting is
 * applied to the finished cell.
 *
 * @module generator/render/csv
 */

import type { Entity } from "#/datatypes/entity.ts";
import type { Range } from "#/datatypes/location.ts";
import { byteLength } from "#/util/offset.ts";
import {
	Markers,
	PLACEHOLDER,
	resolveSlot,
	TemplateError,
	verbatim,
} from "../template.ts";
import type { Rendered } from "./index.ts";

/** Separates cells; the newline separates rows. */
const DELIMITER = ",";

/**
 * Whether RFC 4180 requires this cell to be quoted.
 */
function quoted(cell: string): boolean {
	return /[",\n\r]/.test(cell);
}

/**
 * How a quoted cell writes a value planted inside it.
 *
 * The only rewriting CSV does to a value, and it applies exactly when the cell
 * around it is quoted — which is why the decision is made per cell rather than
 * per value.
 */
function doubleQuotes(value: string): string {
	return value.replaceAll('"', '""');
}

/**
 * Replaces every placeholder in a cell with whatever `write` returns for it.
 *
 * `onValue` and `onLiteral` see each piece in order as it is written, which is
 * how the caller measures where a value lands without scanning the result.
 */
function fill(
	template: string,
	write: (name: string, requested?: string) => string,
	onValue?: (written: string) => void,
	onLiteral?: (literal: string) => void,
): string {
	PLACEHOLDER.lastIndex = 0;
	let last = 0;
	let out = "";

	for (const match of template.matchAll(PLACEHOLDER)) {
		const literal = template.slice(last, match.index);
		out += literal;
		onLiteral?.(literal);

		const [placeholder, name, requested] = match;
		const written = write(name as string, requested);
		out += written;
		onValue?.(written);

		last = match.index + placeholder.length;
	}

	const tail = template.slice(last);
	onLiteral?.(tail);
	return out + tail;
}

/**
 * Where a value sits in the table, carried through serialization so the
 * occurrence can name it.
 *
 * The cell address and the in-cell range are both fixed before the document is
 * assembled — they describe the parsed table, which quoting does not change —
 * while the file range is only known once everything around it is written.
 */
interface CellAddress {
	row: number;
	column: number;
	columnName?: string;
	/** The value's byte range within the cell's parsed value. */
	cell: Range;
}

/**
 * Renders a CSV template into a document.
 *
 * @param template - Rows of cells, the first row being the header
 * @param entities - Entities by slot name
 * @param modalityId - The modality occurrences are recorded against
 * @throws {TemplateError} If the template is not a table, or a placeholder names
 * an unknown slot
 */
export function renderCsv(
	template: unknown,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): Rendered {
	if (!Array.isArray(template) || template.length === 0) {
		throw new TemplateError("A CSV template must be a non-empty array of rows");
	}

	const header = template[0];
	if (!Array.isArray(header)) {
		throw new TemplateError("A CSV template's first row must be its header");
	}
	const columnNames = header.map((name) => String(name));

	const markers = new Markers<CellAddress>();
	const lines: string[] = [];

	for (const [rowIndex, row] of template.entries()) {
		if (!Array.isArray(row)) {
			throw new TemplateError(
				`Row ${rowIndex} of a CSV template must be an array of cells`,
			);
		}

		const cells = row.map((raw, columnIndex) => {
			const columnName = columnNames[columnIndex];

			// The cell is filled twice. First with the real values, which settles
			// two things that cannot be known any other way: whether the cell needs
			// quoting — a planted `Reyes, Dana` brings the comma that a template
			// cell of `{{who}}` does not have — and where each value sits in the
			// parsed cell, which is the coordinate a detection over a table comes
			// back in. Then again with markers, to be positioned in the file.
			// Filling twice is safe: `resolveSlot` returns the form the entity
			// already holds rather than drawing a new one.
			const cellRanges: Range[] = [];
			let cellBytes = 0;
			const filled = fill(
				String(raw),
				(name, requested) => resolveSlot(entities, name, requested).value,
				(written) => {
					cellRanges.push({
						start: cellBytes,
						end: cellBytes + byteLength(written),
					});
					cellBytes += byteLength(written);
				},
				(literal) => {
					cellBytes += byteLength(literal);
				},
			);

			const escapeWith = quoted(filled) ? doubleQuotes : verbatim;
			let planted = 0;
			const marked = fill(String(raw), (name, requested) => {
				const cell = cellRanges[planted++];
				if (cell === undefined) {
					throw new TemplateError("Cell filled inconsistently across passes");
				}
				return markers.place(entities, name, requested, escapeWith, {
					row: rowIndex,
					column: columnIndex,
					...(columnName !== undefined ? { columnName } : {}),
					cell,
				});
			});

			return quoted(filled) ? `"${marked.replaceAll('"', '""')}"` : marked;
		});

		lines.push(cells.join(DELIMITER));
	}

	return markers.resolve(
		`${lines.join("\n")}\n`,
		modalityId,
		({ context, range }) => ({
			kind: "tabular",
			row: context.row,
			column: context.column,
			...(context.columnName !== undefined
				? { columnName: context.columnName }
				: {}),
			ranges: [range],
			cell: context.cell,
		}),
	);
}
