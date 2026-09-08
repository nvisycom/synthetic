/**
 * @fileoverview Coordinates for planted values.
 *
 * These deliberately mirror the conventions `@nvisy/sdk` uses, so that ground
 * truth and a detection can be compared without a translation step in between.
 * A conversion in the middle of scoring is a place for an off-by-one to hide,
 * and an off-by-one here silently changes every boundary-accuracy number.
 *
 * Three conventions are worth stating plainly, because each differs from the
 * obvious guess:
 *
 * - Text offsets index the **raw file**, not text extracted from it. The bytes
 *   on disk are the only coordinate system a detector, a redactor, and this
 *   harness can all agree on without agreeing on a codec first.
 * - Those offsets are **byte** offsets into UTF-8, not character or UTF-16 code
 *   unit offsets. A `é` advances an offset by two, an emoji by four.
 * - Audio times are **microseconds**, matching the SDK's `TimeSpan`.
 *
 * @module datatypes/location
 */

/**
 * A half-open range, `start` inclusive and `end` exclusive.
 *
 * The unit depends on the coordinate system that carries it: bytes for text,
 * pixels for rasters, microseconds for audio.
 */
export interface Range {
	/** Inclusive start. */
	start: number;
	/** Exclusive end. */
	end: number;
}

/**
 * A byte range in a document's raw bytes.
 *
 * Offsets index the file on disk, matching the SDK's `DecodedSpan.source`.
 * Deriving them with `Buffer.byteLength` rather than `String.prototype.length`
 * is the difference between a correct span and one that drifts on the first
 * non-ASCII character.
 *
 * The file is the one coordinate system every reader agrees on. A detector's
 * own decoded offsets depend on how it extracted text — which escapes it
 * resolved, whether it kept markup, where it inserted separators — so comparing
 * against them means agreeing with a particular extractor, and the harness would
 * be scoring its own codec as much as the pipeline. The bytes admit no such
 * disagreement: a planted value either sits at those bytes or it does not.
 */
export interface TextLocation {
	kind: "text";

	/**
	 * The byte ranges covering the value in the file.
	 *
	 * More than one when the value is not contiguous on disk: an escape falling
	 * inside it splits it, as does a layout boundary. Kept distinct rather than
	 * merged, because the gap between them is exactly what a pipeline matching
	 * within a single line will miss, and merging would hide the failure the case
	 * exists to expose.
	 */
	ranges: [Range, ...Range[]];

	/** Zero-based page index, for paged formats. */
	page?: number;
}

/**
 * A pixel rectangle in a raster modality.
 *
 * Named for the modality rather than the unit, matching the SDK's
 * `ImageLocation`.
 *
 * Expressed as opposing corners to match the SDK's `BoundingBox`, whose `min`
 * and `max` are `Point`s. The origin is the image's top-left, x increasing
 * rightwards and y downwards.
 */
export interface ImageLocation {
	kind: "image";

	/** Top-left corner, inclusive. */
	min: { x: number; y: number };

	/** Bottom-right corner, exclusive. */
	max: { x: number; y: number };

	/** Zero-based page index, for paged formats. */
	page?: number;
}

/**
 * A time interval in an audio modality.
 *
 * Named for the modality rather than the unit, matching the SDK's
 * `AudioLocation`.
 *
 * Microseconds, matching the SDK's `TimeSpan`. Milliseconds would be the
 * intuitive unit and the wrong one: a thousandfold error in a boundary
 * comparison reads as a total miss rather than as a bug.
 */
export interface AudioLocation {
	kind: "audio";

	/** The interval covering the spoken value. */
	span: Range;

	/**
	 * Which speaker uttered it, when the audio has more than one.
	 *
	 * Mirrors the SDK's `AudioLocation.speaker_id`.
	 */
	speaker?: string;
}

/**
 * A cell in a tabular document, and where the value sits inside it.
 *
 * Tabular content gets its own coordinate system rather than an offset into a
 * flattened document, because that is how a pipeline reads it: a CSV or
 * spreadsheet is addressed by row and column, and a detection comes back naming
 * a cell. Flattening here would mean translating on every comparison, and a
 * translation in the middle of scoring is where an off-by-one hides.
 *
 * Mirrors the SDK's `TabularLocation`.
 */
export interface TabularLocation {
	kind: "tabular";

	/** Zero-based row index of the cell. */
	row: number;

	/** Zero-based column index of the cell. */
	column: number;

	/** Header label of the column, when the document has one. */
	columnName?: string;

	/** Sheet name, for a multi-sheet workbook. */
	sheetName?: string;

	/**
	 * The byte ranges covering the value in the file, when the format has any.
	 *
	 * Ground truth records these because the generator wrote the file and knows
	 * exactly where the value landed, quoting included: the range starts past an
	 * opening quote and counts any doubled quote before the value, so it covers
	 * the bytes a redactor must overwrite rather than what the cell would parse
	 * to.
	 *
	 * A detection carries none. A pipeline reading a table answers in cells, and
	 * for a workbook there are no file offsets to answer in — which is why
	 * {@link cell} rather than this is what the two are compared on.
	 */
	ranges?: [Range, ...Range[]];

	/**
	 * Where the value sits within its own cell.
	 *
	 * Tabular content is the one place a pipeline does not answer in file
	 * offsets: a detection over a spreadsheet comes back naming a row, a column,
	 * and an offset into that cell's value. Recording the same thing means
	 * scoring compares like with like, rather than translating a cell offset into
	 * a file offset on every comparison — which is where an off-by-one would
	 * hide, and which is impossible for a format like `xlsx` that has no file
	 * offsets to translate to.
	 *
	 * Counted in the cell's parsed value, so an opening quote and any doubling
	 * are excluded: a value filling a quoted cell starts at 0, not 1.
	 *
	 * Absent when the value is the whole cell and its width is not stated — how
	 * the API reports a detection over an entire cell. Left absent rather than
	 * filled with a zero-width range at 0, which a scorer could not tell from a
	 * genuine empty match at the cell's start; the cell address says which text
	 * is meant, and the scorer widens it to that.
	 */
	cell?: Range;
}

/**
 * Where a value sits within a modality.
 *
 * The three coordinate systems stay separate rather than collapsing into one
 * generic shape: overlap between byte ranges, between rectangles, and between
 * time intervals are different computations, and conflating them is how
 * boundary scoring quietly goes wrong.
 */
export type Location =
	| TextLocation
	| ImageLocation
	| AudioLocation
	| TabularLocation;

/**
 * Returns the total extent a location covers, in its own units.
 *
 * Used by boundary scoring to compare how much of a value a redaction covered
 * against how much it should have. A multi-range text location sums its pieces,
 * so a value split across a page break is measured by the text it actually
 * occupies rather than by the gap it spans.
 */
export function extentOf(location: Location): number {
	switch (location.kind) {
		case "text":
			return location.ranges.reduce(
				(total, range) => total + (range.end - range.start),
				0,
			);
		case "tabular":
			// The cell range, not the file one: it is the coordinate a tabular
			// detection reports, so it is the one boundary accuracy compares. A
			// whole-cell location states no range, and its extent is the cell —
			// which the caller knows and this function does not.
			return location.cell === undefined
				? 0
				: location.cell.end - location.cell.start;
		case "image":
			return (
				(location.max.x - location.min.x) * (location.max.y - location.min.y)
			);
		case "audio":
			return location.span.end - location.span.start;
	}
}
