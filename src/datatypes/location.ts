/**
 * @fileoverview Coordinates for planted values.
 *
 * These deliberately mirror the conventions `@nvisy/sdk` uses, so that ground
 * truth and a detection can be compared without a translation step in between.
 * A conversion in the middle of scoring is a place for an off-by-one to hide,
 * and an off-by-one here silently changes every boundary-accuracy number.
 *
 * Two conventions are worth stating plainly, because both differ from the
 * obvious guess:
 *
 * - Text offsets are **byte** offsets into UTF-8, not character or UTF-16 code
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
 * A byte range in a document's decoded text.
 *
 * Offsets index the UTF-8 encoding of {@link Modality.text}, matching the
 * SDK's `Range_of_uint`. Deriving them with `Buffer.byteLength` rather than
 * `String.prototype.length` is the difference between a correct span and one
 * that drifts on the first non-ASCII character.
 */
export interface TextLocation {
	kind: "text";

	/**
	 * The byte range covering the value.
	 *
	 * A value broken across a layout boundary carries more than one range, in
	 * reading order. Kept distinct rather than merged, because the gap between
	 * them is exactly what a pipeline matching within a single line will miss,
	 * and merging would hide the failure the case exists to expose.
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
 * Where a value sits within a modality.
 *
 * The three coordinate systems stay separate rather than collapsing into one
 * generic shape: overlap between byte ranges, between rectangles, and between
 * time intervals are different computations, and conflating them is how
 * boundary scoring quietly goes wrong.
 */
export type Location = TextLocation | ImageLocation | AudioLocation;

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
		case "image":
			return (
				(location.max.x - location.min.x) * (location.max.y - location.min.y)
			);
		case "audio":
			return location.span.end - location.span.start;
	}
}
