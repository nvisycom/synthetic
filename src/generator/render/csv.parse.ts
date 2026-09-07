/**
 * @fileoverview Parsing a CSV template.
 *
 * A CSV spec's template is itself a CSV file, so a table reads as a table and a
 * diff shows a changed row rather than a changed JSON line.
 *
 * This parses the template only. The values it yields are cell text — possibly
 * containing `{{slot}}` placeholders — and the renderer quotes them again
 * independently when it writes the document, since a planted value may itself
 * introduce a comma the template never had.
 *
 * @module generator/render/csv.parse
 */

/**
 * Parses RFC 4180 CSV into rows of cells.
 *
 * Handles quoted cells, doubled quotes inside them, and newlines within a
 * quoted cell. A trailing newline does not produce an empty final row.
 *
 * @throws {SyntaxError} If a quoted cell is never closed
 */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	let index = 0;

	// Normalize line endings so a template authored on Windows parses the same.
	const source = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

	while (index < source.length) {
		const character = source[index];

		if (quoted) {
			if (character === '"') {
				if (source[index + 1] === '"') {
					// A doubled quote is one literal quote.
					cell += '"';
					index += 2;
					continue;
				}
				quoted = false;
				index++;
				continue;
			}
			cell += character;
			index++;
			continue;
		}

		if (character === '"' && cell === "") {
			quoted = true;
			index++;
			continue;
		}

		if (character === ",") {
			row.push(cell);
			cell = "";
			index++;
			continue;
		}

		if (character === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			index++;
			continue;
		}

		cell += character;
		index++;
	}

	if (quoted) {
		throw new SyntaxError("Unterminated quoted cell");
	}

	// A trailing newline closes the last row rather than opening an empty one.
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}

	return rows;
}
