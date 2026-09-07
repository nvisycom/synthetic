import { describe, expect, it } from "vitest";
import {
	byteLength,
	byteRangeAt,
	sliceByteRange,
	toByteOffset,
	toStringIndex,
} from "./offset.ts";

/** ASCII, two-byte, three-byte, and four-byte characters respectively. */
const ASCII = "hello";
const ACCENTED = "café";
const CJK = "日本語";
const EMOJI = "a👍b";

describe("byteLength", () => {
	it.each([
		[ASCII, 5],
		[ACCENTED, 5], // 3 ASCII + 1 two-byte
		[CJK, 9], // 3 three-byte
		[EMOJI, 6], // 2 ASCII + 1 four-byte
		["", 0],
	])("measures %o as %i bytes", (text, expected) => {
		expect(byteLength(text)).toBe(expected);
	});

	it("differs from string length once past ASCII", () => {
		// The whole reason this module exists.
		expect(ACCENTED.length).toBe(4);
		expect(byteLength(ACCENTED)).toBe(5);
	});
});

describe("toByteOffset", () => {
	it("matches the string index for ASCII", () => {
		expect(toByteOffset(ASCII, 0)).toBe(0);
		expect(toByteOffset(ASCII, 3)).toBe(3);
		expect(toByteOffset(ASCII, 5)).toBe(5);
	});

	it("accounts for multi-byte characters", () => {
		// "café": c-a-f are one byte each, é is two.
		expect(toByteOffset(ACCENTED, 3)).toBe(3);
		expect(toByteOffset(ACCENTED, 4)).toBe(5);
	});

	it("handles a surrogate pair as one character", () => {
		// "a👍b": the emoji occupies two UTF-16 units and four bytes.
		expect(toByteOffset(EMOJI, 1)).toBe(1);
		expect(toByteOffset(EMOJI, 3)).toBe(5);
	});

	it("rejects an index between the halves of a surrogate pair", () => {
		// Index 2 sits inside "👍". Slicing there cuts the pair and yields a byte
		// offset pointing inside a character — a span that looks valid and covers
		// the wrong bytes.
		expect(() => toByteOffset(EMOJI, 2)).toThrow(/surrogate pair/);
	});

	it("rejects an out-of-range index", () => {
		expect(() => toByteOffset(ASCII, 6)).toThrow(RangeError);
		expect(() => toByteOffset(ASCII, -1)).toThrow(RangeError);
	});
});

describe("toStringIndex", () => {
	it.each([ASCII, ACCENTED, CJK, EMOJI])("round-trips through %o", (text) => {
		for (let index = 0; index <= text.length; index++) {
			// Skip the interior of a surrogate pair, which is not a character
			// boundary and has no byte offset of its own.
			const code = text.charCodeAt(index - 1);
			if (index > 0 && code >= 0xd800 && code <= 0xdbff) continue;

			expect(toStringIndex(text, toByteOffset(text, index))).toBe(index);
		}
	});

	it("refuses an offset interior to a character", () => {
		// Byte 4 is the middle of "é" in "café".
		expect(() => toStringIndex(ACCENTED, 4)).toThrow(RangeError);
		// Byte 1 is the middle of the first CJK character.
		expect(() => toStringIndex(CJK, 1)).toThrow(RangeError);
	});

	it("rejects an offset past the end", () => {
		expect(() => toStringIndex(ASCII, 6)).toThrow(RangeError);
	});

	it("rejects a negative offset", () => {
		expect(() => toStringIndex(ASCII, -1)).toThrow(RangeError);
	});
});

describe("byteRangeAt", () => {
	it("covers a value planted in ASCII text", () => {
		const text = "SSN: 555-01-0199 on file";
		const value = "555-01-0199";
		const range = byteRangeAt(text, text.indexOf(value), value);

		expect(sliceByteRange(text, range)).toBe(value);
	});

	it("covers a value planted after multi-byte text", () => {
		// The case that breaks a naive implementation: the offset of the value
		// is shifted by the accented characters preceding it.
		const text = "Renée Müller — SSN: 555-01-0199";
		const value = "555-01-0199";
		const range = byteRangeAt(text, text.indexOf(value), value);

		expect(sliceByteRange(text, range)).toBe(value);
		// Byte offset must exceed the string index, since text before it is
		// multi-byte.
		expect(range.start).toBeGreaterThan(text.indexOf(value));
	});

	it("covers a multi-byte value itself", () => {
		const text = "Patient: 田中太郎 (admitted)";
		const value = "田中太郎";
		const range = byteRangeAt(text, text.indexOf(value), value);

		expect(sliceByteRange(text, range)).toBe(value);
		expect(range.end - range.start).toBe(12);
	});

	it("covers a value containing an emoji", () => {
		const text = "handle: @dev👍user posted";
		const value = "@dev👍user";
		const range = byteRangeAt(text, text.indexOf(value), value);

		expect(sliceByteRange(text, range)).toBe(value);
	});
});

describe("sliceByteRange", () => {
	it("returns the empty string for an empty range", () => {
		expect(sliceByteRange(ASCII, { start: 2, end: 2 })).toBe("");
	});

	it("rejects an inverted range", () => {
		expect(() => sliceByteRange(ASCII, { start: 4, end: 2 })).toThrow(
			RangeError,
		);
	});

	it("rejects a range splitting a character", () => {
		expect(() => sliceByteRange(CJK, { start: 0, end: 2 })).toThrow(RangeError);
	});
});
