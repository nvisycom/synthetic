/**
 * @fileoverview The property every renderer must hold, in one place.
 *
 Each renderer's own tests cover what is particular to its format; this is the
 * claim they all make, which is what the whole answer key rests on: a range
 * points at the bytes the value actually occupies. It is checked against the
 * rendered file directly, with no decoding step, because a check that decoded
 * first could only confirm that two of the harness' own routines agree.
 *
 * A tabular cell range is the exception, since a cell offset is by definition
 * an offset into a parsed cell. That one is checked by parsing the document
 * back — with the CSV reader, not the writer, so the two are not the same code
 * agreeing with itself.
 *
 * @module generator/render/verifiable
 */

import { expect } from "vitest";
import { sliceByteRange } from "#/util/offset.ts";
import { parseCsv } from "./csv.parse.ts";
import type { Rendered } from "./index.ts";

/**
 * Asserts every occurrence slices back out of the document it came from.
 *
 * @param rendered - What a renderer returned
 * @param parse - How to read the format back, for the formats that have a
 * parser; asserts the document is still well-formed after substitution
 */
export function expectVerifiable(
	rendered: Rendered,
	parse?: (text: string) => unknown,
): void {
	expect(rendered.occurrences.length).toBeGreaterThan(0);

	for (const occurrence of rendered.occurrences) {
		const { location } = occurrence;
		if (location.kind !== "text" && location.kind !== "tabular") {
			throw new Error(`Unexpected location kind ${location.kind}`);
		}

		// Every planted value has a file range: the generator wrote the file, so
		// it always knows. Only a detection may lack one.
		const { ranges } = location;
		if (ranges === undefined) {
			throw new Error(`${occurrence.id} recorded no file range`);
		}

		const found = ranges
			.map((range) => sliceByteRange(rendered.text, range))
			.join("");

		// What the range covers is what the renderer says it wrote.
		expect(found).toBe(occurrence.written);

		// And a value the format did not escape is on disk verbatim, so the two
		// agreeing is not vacuous: it would catch a `written` recorded from the
		// wrong value entirely.
		if (!/[&<>"\\]/.test(occurrence.text)) {
			expect(found).toBe(occurrence.text);
		}

		// A tabular location carries a second coordinate, in the cell's own value
		// rather than the file. It is checked by slicing the parsed cell, not by
		// its width alone: a range of the right size at the wrong offset is
		// exactly the mistake worth catching, and a width check passes it.
		if (location.kind === "tabular") {
			// A planted value always states where it sits in its cell; only a
			// detection may leave it to mean "the whole cell".
			const { cell } = location;
			if (cell === undefined) {
				throw new Error(`${occurrence.id} recorded no cell range`);
			}

			const rows = parseCsv(rendered.text);
			const parsed = rows[location.row]?.[location.column];
			expect(
				parsed,
				`no cell at row ${location.row}, column ${location.column}`,
			).toBeDefined();

			expect(sliceByteRange(parsed ?? "", cell)).toBe(occurrence.text);
		}
	}

	if (parse !== undefined) {
		expect(() => parse(rendered.text)).not.toThrow();
	}
}
