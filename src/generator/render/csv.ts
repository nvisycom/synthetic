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
 * Quoting still matters for the source ranges. RFC 4180 wraps a cell containing
 * a comma, quote, or newline in quotes and doubles any quote inside it — so a
 * name like `Reyes, Dana` occupies more bytes in the file than in the cell, and
 * a redactor overwriting the wrong span would clip it.
 *
 * @module generator/render/csv
 */

import type { Entity } from "#/datatypes/entity.ts";
import type { Range } from "#/datatypes/location.ts";
import type { Occurrence } from "#/datatypes/record.ts";
import { byteLength } from "#/util/offset.ts";
import { PLACEHOLDER, resolveSlot, TemplateError } from "../template.ts";
import type { Rendered } from "./index.ts";

/** Separates cells; the newline separates rows. */
const DELIMITER = ",";

/**
 * A cell's text with the values planted in it recorded.
 */
interface Cell {
	/** The cell's decoded text, as a parser would return it. */
	text: string;

	/** Values planted in it, positioned within the cell. */
	planted: {
		entity: Entity;
		surface: Occurrence["surface"];
		value: string;
		range: Range;
	}[];
}

/**
 * Fills a cell's placeholders, recording where each value sits within it.
 */
function fillCell(
	template: string,
	entities: ReadonlyMap<string, Entity>,
): Cell {
	const cell: Cell = { text: "", planted: [] };
	let bytes = 0;
	let last = 0;

	PLACEHOLDER.lastIndex = 0;
	let match = PLACEHOLDER.exec(template);

	while (match !== null) {
		const literal = template.slice(last, match.index);
		cell.text += literal;
		bytes += byteLength(literal);

		const [placeholder, name, requested] = match;
		const resolved = resolveSlot(entities, name, requested);

		const start = bytes;
		cell.text += resolved.value;
		bytes += byteLength(resolved.value);

		cell.planted.push({
			entity: resolved.entity,
			surface: resolved.surface,
			value: resolved.value,
			range: { start, end: bytes },
		});

		last = match.index + placeholder.length;
		match = PLACEHOLDER.exec(template);
	}

	cell.text += template.slice(last);
	return cell;
}

/**
 * Quotes a cell for the file, if RFC 4180 requires it.
 *
 * Returns the bytes to write and the offset at which the cell's own text
 * begins, which is 1 when quoted and 0 otherwise.
 */
function quote(text: string): { written: string; contentOffset: number } {
	if (!/[",\n\r]/.test(text)) {
		return { written: text, contentOffset: 0 };
	}
	// A quote inside a quoted cell is written twice.
	return { written: `"${text.replaceAll('"', '""')}"`, contentOffset: 1 };
}

/**
 * Maps an offset in a cell's text to its offset in the quoted form.
 *
 * Only doubled quotes shift it, and only those before the offset.
 */
function shiftForQuoting(text: string, offset: number): number {
	const before = text.slice(0, offset);
	const doubled = (before.match(/"/g) ?? []).length;
	return offset + doubled;
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

	const occurrences: Occurrence[] = [];
	let text = "";
	let bytes = 0;
	// The decoded modality is every cell's content in reading order, so a
	// detector over the extracted text sees what a person would. No byte counter
	// is needed alongside it: tabular occurrences are addressed by cell, so their
	// offsets are relative to the cell rather than to this string.
	let decoded = "";

	for (const [rowIndex, row] of template.entries()) {
		if (!Array.isArray(row)) {
			throw new TemplateError(
				`Row ${rowIndex} of a CSV template must be an array of cells`,
			);
		}

		for (const [columnIndex, raw] of row.entries()) {
			if (columnIndex > 0) {
				text += DELIMITER;
				bytes += 1;
			}

			const cell = fillCell(String(raw), entities);
			const { written, contentOffset } = quote(cell.text);

			// Where this cell's content starts in the file, past any opening quote.
			const cellStart = bytes + contentOffset;

			for (const planted of cell.planted) {
				occurrences.push({
					id: `occ_${String(occurrences.length).padStart(4, "0")}`,
					entityId: planted.entity.id,
					modalityId,
					surface: planted.surface,
					text: planted.value,
					location: {
						kind: "tabular",
						row: rowIndex,
						column: columnIndex,
						...(columnNames[columnIndex] !== undefined
							? { columnName: columnNames[columnIndex] }
							: {}),
						// Whole-cell values record no range, matching the SDK, where an
						// unset offset means the entity is the cell.
						...(planted.range.start === 0 &&
						planted.range.end === byteLength(cell.text)
							? {}
							: { range: planted.range }),
						source: [
							{
								start:
									cellStart + shiftForQuoting(cell.text, planted.range.start),
								end: cellStart + shiftForQuoting(cell.text, planted.range.end),
							},
						] as [Range, ...Range[]],
					},
				});
			}

			text += written;
			bytes += byteLength(written);
			decoded += cell.text;
		}

		text += "\n";
		bytes += 1;
		decoded += "\n";
	}

	return { text, decoded, occurrences };
}
