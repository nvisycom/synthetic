/**
 * @fileoverview Converting between JavaScript string indices and byte offsets.
 *
 * Ground truth records byte offsets into UTF-8, because that is what the SDK's
 * spans use. JavaScript strings are UTF-16, so `"café".length` is 4 while its
 * UTF-8 encoding is 5 bytes. Every planted value has to cross that gap, and a
 * mistake in the crossing does not throw — it silently shifts a span, and every
 * boundary-accuracy number computed from it is quietly wrong.
 *
 * These helpers exist so the conversion happens in exactly one place, with
 * tests, rather than inline at each call site.
 *
 * @module datatypes/offset
 */

import type { Range } from "./location.ts";

const encoder = new TextEncoder();

/**
 * Returns the UTF-8 byte length of a string.
 */
export function byteLength(text: string): number {
	return encoder.encode(text).length;
}

/**
 * Converts a JavaScript string index to a UTF-8 byte offset.
 *
 * @param text - The string the index refers to
 * @param index - A UTF-16 code unit index, as `indexOf` returns
 * @throws If the index falls outside the string
 */
export function toByteOffset(text: string, index: number): number {
	if (!Number.isInteger(index) || index < 0 || index > text.length) {
		throw new RangeError(
			`Index ${index} is outside a string of length ${text.length}`,
		);
	}
	return byteLength(text.slice(0, index));
}

/**
 * Converts a UTF-8 byte offset back to a JavaScript string index.
 *
 * @param text - The string the offset refers to
 * @param offset - A UTF-8 byte offset
 * @throws If the offset falls outside the string, or lands inside a character
 * rather than on its boundary
 */
export function toStringIndex(text: string, offset: number): number {
	if (!Number.isInteger(offset) || offset < 0) {
		throw new RangeError(
			`Byte offset must be a non-negative integer: ${offset}`,
		);
	}

	let bytes = 0;
	for (let index = 0; index <= text.length; index++) {
		if (bytes === offset) {
			return index;
		}
		if (bytes > offset) {
			// Stepped past without landing on it, so the offset was interior to a
			// character. Silently rounding here would hand back a span that does
			// not cover the value, so refuse instead.
			throw new RangeError(
				`Byte offset ${offset} falls inside a character, not on a boundary`,
			);
		}
		if (index < text.length) {
			// Advance by whole code points, so a surrogate pair counts once.
			const codePoint = text.codePointAt(index);
			const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
			bytes += byteLength(text.slice(index, index + width));
			if (width === 2) index++;
		}
	}

	throw new RangeError(
		`Byte offset ${offset} is beyond the string's ${byteLength(text)} bytes`,
	);
}

/**
 * Returns the byte range covering a substring found at a string index.
 *
 * The common case when planting: a value is written into a document, its index
 * located with `indexOf`, and its span recorded.
 *
 * @throws If the index falls outside the string
 */
export function byteRangeAt(text: string, index: number, value: string): Range {
	const start = toByteOffset(text, index);
	return { start, end: start + byteLength(value) };
}

/**
 * Slices a string by a byte range.
 *
 * Used to verify a planted value against the artifact that was actually
 * produced: the generator asserts that slicing a modality's text by a recorded
 * range returns the value it claims to have planted. Ground truth is never
 * taken on a renderer's word.
 *
 * @throws If the range falls outside the string or splits a character
 */
export function sliceByteRange(text: string, range: Range): string {
	if (range.end < range.start) {
		throw new RangeError(`Inverted range: [${range.start}, ${range.end})`);
	}
	return text.slice(
		toStringIndex(text, range.start),
		toStringIndex(text, range.end),
	);
}
