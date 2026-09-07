import { describe, expect, it } from "vitest";
import { Random } from "./random.ts";

/**
 * Draws a fixed-length sequence, so two sources can be compared directly.
 */
function draw(random: Random, count = 10): number[] {
	return Array.from({ length: count }, () => random.integer(0, 1_000_000));
}

describe("Random", () => {
	describe("reproducibility", () => {
		it("gives the same sequence for the same seed", () => {
			expect(draw(Random.fromSeed(42))).toEqual(draw(Random.fromSeed(42)));
		});

		it("gives different sequences for different seeds", () => {
			expect(draw(Random.fromSeed(42))).not.toEqual(draw(Random.fromSeed(43)));
		});

		it("survives a round trip through the CLI's string seed", () => {
			const seed = Random.parseSeed("42");
			expect(draw(Random.fromSeed(seed))).toEqual(draw(Random.fromSeed(42)));
		});
	});

	describe("fork", () => {
		it("gives each fork an independent stream", () => {
			const parent = Random.fromSeed(42);
			expect(draw(parent.fork())).not.toEqual(draw(parent.fork()));
		});

		it("derives the same children from the same parent seed", () => {
			const a = Random.fromSeed(42);
			const b = Random.fromSeed(42);

			// Fork twice from each, so the second fork's jump distance is covered
			// as well as the first.
			a.fork();
			b.fork();
			expect(draw(a.fork())).toEqual(draw(b.fork()));
		});

		it("leaves a fork unaffected by how much its siblings draw", () => {
			// The regression that motivates forking at all: changing how many
			// values one record consumes must not shift any other record.
			const quiet = Random.fromSeed(42);
			quiet.fork();
			const quietSecond = quiet.fork();

			const busy = Random.fromSeed(42);
			const busyFirst = busy.fork();
			const busySecond = busy.fork();

			// The first sibling draws heavily; the second must not notice.
			draw(busyFirst, 5000);

			expect(draw(busySecond)).toEqual(draw(quietSecond));
		});

		it("does not consume the parent's own stream", () => {
			const withFork = Random.fromSeed(42);
			withFork.fork();

			// A fork clones and jumps a copy, so the parent's next draw is the same
			// as if it had never forked.
			expect(draw(withFork)).toEqual(draw(Random.fromSeed(42)));
		});
	});

	describe("parseSeed", () => {
		it("accepts integers, including negatives and zero", () => {
			expect(Random.parseSeed("0")).toBe(0);
			expect(Random.parseSeed("-7")).toBe(-7);
			expect(Random.parseSeed("42")).toBe(42);
			expect(Random.parseSeed(" 42 ")).toBe(42);
		});

		// `Number("")`, `Number(" ")` and `Number("\n")` are all 0, so a
		// coercion-first check would accept an empty seed as 0.
		it.each([
			"",
			" ",
			"\n",
			"abc",
			"1.5",
			"NaN",
			"Infinity",
			"1e999",
			"1e3",
			"0x10",
			"9007199254740993",
		])("rejects %o rather than coercing it", (value) => {
			expect(() => Random.parseSeed(value)).toThrow(TypeError);
		});
	});

	describe("integer", () => {
		it("stays within an inclusive range", () => {
			const random = Random.fromSeed(1);
			for (let i = 0; i < 1000; i++) {
				const value = random.integer(5, 10);
				expect(value).toBeGreaterThanOrEqual(5);
				expect(value).toBeLessThanOrEqual(10);
			}
		});

		it("reaches both bounds", () => {
			const random = Random.fromSeed(1);
			const seen = new Set(
				Array.from({ length: 500 }, () => random.integer(0, 3)),
			);
			expect(seen).toEqual(new Set([0, 1, 2, 3]));
		});

		it("handles a single-value range", () => {
			expect(Random.fromSeed(1).integer(7, 7)).toBe(7);
		});

		it("rejects an inverted range", () => {
			expect(() => Random.fromSeed(1).integer(10, 5)).toThrow(RangeError);
		});

		it("rejects non-integer bounds", () => {
			expect(() => Random.fromSeed(1).integer(0, 1.5)).toThrow(TypeError);
		});
	});

	describe("float", () => {
		it("stays in [0, 1)", () => {
			const random = Random.fromSeed(1);
			for (let i = 0; i < 1000; i++) {
				const value = random.float();
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThan(1);
			}
		});
	});

	describe("bool", () => {
		it("always returns the certain answer at 0 and 1", () => {
			const random = Random.fromSeed(1);
			for (let i = 0; i < 100; i++) {
				expect(random.bool(0)).toBe(false);
				expect(random.bool(1)).toBe(true);
			}
		});

		it("approximates the requested probability", () => {
			const random = Random.fromSeed(1);
			const trials = 10_000;
			let hits = 0;
			for (let i = 0; i < trials; i++) {
				if (random.bool(0.25)) hits++;
			}
			expect(hits / trials).toBeCloseTo(0.25, 1);
		});

		it("rejects a probability outside [0, 1]", () => {
			expect(() => Random.fromSeed(1).bool(-0.1)).toThrow(RangeError);
			expect(() => Random.fromSeed(1).bool(1.1)).toThrow(RangeError);
		});
	});

	describe("pick", () => {
		it("only returns members of the collection", () => {
			const random = Random.fromSeed(1);
			const items = ["a", "b", "c"] as const;
			for (let i = 0; i < 100; i++) {
				expect(items).toContain(random.pick(items));
			}
		});

		it("rejects an empty collection", () => {
			expect(() => Random.fromSeed(1).pick([])).toThrow(RangeError);
		});
	});

	describe("weighted", () => {
		it("never returns a zero-weighted item", () => {
			const random = Random.fromSeed(1);
			for (let i = 0; i < 500; i++) {
				expect(random.weighted(["never", "always"], [0, 1])).toBe("always");
			}
		});

		it("respects relative weights", () => {
			const random = Random.fromSeed(1);
			const trials = 10_000;
			let rare = 0;
			for (let i = 0; i < trials; i++) {
				if (random.weighted(["rare", "common"], [1, 9]) === "rare") rare++;
			}
			expect(rare / trials).toBeCloseTo(0.1, 1);
		});

		it("rejects mismatched lengths", () => {
			expect(() => Random.fromSeed(1).weighted(["a", "b"], [1])).toThrow(
				RangeError,
			);
		});

		it("rejects weights that overflow to Infinity when summed", () => {
			// Each weight is finite, but the total is not. `float() * Infinity` is
			// Infinity, so every comparison fails and the last item wins whatever
			// its weight.
			expect(() =>
				Random.fromSeed(1).weighted(
					["a", "b"],
					[Number.MAX_VALUE, Number.MAX_VALUE],
				),
			).toThrow(RangeError);
		});

		it("rejects weights summing to zero", () => {
			expect(() => Random.fromSeed(1).weighted(["a", "b"], [0, 0])).toThrow(
				RangeError,
			);
		});

		it("rejects negative and non-finite weights", () => {
			expect(() => Random.fromSeed(1).weighted(["a", "b"], [-1, 2])).toThrow(
				RangeError,
			);
			expect(() =>
				Random.fromSeed(1).weighted(["a", "b"], [Number.NaN, 2]),
			).toThrow(RangeError);
		});
	});

	describe("shuffle", () => {
		it("keeps every element exactly once", () => {
			const items = [1, 2, 3, 4, 5];
			const shuffled = Random.fromSeed(1).shuffle(items);
			expect([...shuffled].sort()).toEqual([...items].sort());
		});

		it("leaves the input untouched", () => {
			const items = [1, 2, 3, 4, 5];
			Random.fromSeed(1).shuffle(items);
			expect(items).toEqual([1, 2, 3, 4, 5]);
		});

		it("actually reorders", () => {
			const items = Array.from({ length: 50 }, (_, i) => i);
			expect(Random.fromSeed(1).shuffle(items)).not.toEqual(items);
		});

		it("handles empty and single-element collections", () => {
			expect(Random.fromSeed(1).shuffle([])).toEqual([]);
			expect(Random.fromSeed(1).shuffle([1])).toEqual([1]);
		});
	});

	describe("sample", () => {
		it("returns the requested number of distinct elements", () => {
			const items = [1, 2, 3, 4, 5];
			const sampled = Random.fromSeed(1).sample(items, 3);
			expect(sampled).toHaveLength(3);
			expect(new Set(sampled).size).toBe(3);
			for (const value of sampled) expect(items).toContain(value);
		});

		it("handles the degenerate counts", () => {
			expect(Random.fromSeed(1).sample([1, 2, 3], 0)).toEqual([]);
			expect(Random.fromSeed(1).sample([1, 2, 3], 3)).toHaveLength(3);
		});

		it("rejects over-sampling", () => {
			expect(() => Random.fromSeed(1).sample([1, 2], 3)).toThrow(RangeError);
		});

		it("rejects a negative count", () => {
			expect(() => Random.fromSeed(1).sample([1, 2], -1)).toThrow(RangeError);
		});
	});
});
