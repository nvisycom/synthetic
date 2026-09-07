/**
 * @fileoverview Seeded randomness.
 *
 * Reproducibility is the property the whole benchmark rests on: a score is only
 * comparable across runs if the corpus that produced it can be rebuilt exactly.
 * So nothing here ever touches `Math.random`, and every draw traces back to the
 * seed the run was started with.
 *
 * The important idea is {@link Random.fork}. If four thousand records drew from
 * one shared stream, adding a single entity to record twelve would shift every
 * value in every record after it, and the same seed would stop meaning the same
 * corpus. Forking gives each record its own independent stream, so a change to
 * one record leaves the others byte-for-byte identical.
 *
 * @module random
 */

import { uniformInt } from "pure-rand/distribution/uniformInt";
import { xoroshiro128plus } from "pure-rand/generator/xoroshiro128plus";
import type { JumpableRandomGenerator } from "pure-rand/types/JumpableRandomGenerator";

/**
 * A seeded source of randomness.
 *
 * Instances are stateful: each draw advances the stream. Two instances created
 * from the same seed, drawn from in the same order, always produce the same
 * values.
 */
export class Random {
	readonly #generator: JumpableRandomGenerator;

	/**
	 * Number of streams forked so far, used to give each fork a distinct jump
	 * distance.
	 */
	#forks = 0;

	private constructor(generator: JumpableRandomGenerator) {
		this.#generator = generator;
	}

	/**
	 * Creates a source from a seed.
	 *
	 * @param seed - Any integer; the same seed always yields the same sequence
	 */
	static fromSeed(seed: number): Random {
		return new Random(xoroshiro128plus(seed));
	}

	/**
	 * Parses a seed from CLI input.
	 *
	 * Rejects anything that is not a finite integer rather than coercing it,
	 * since a silently mangled seed produces a corpus nobody can reproduce.
	 *
	 * @throws If the value is not a finite integer
	 */
	static parseSeed(value: string): number {
		// Validate the text before converting. `Number("")`, `Number(" ")`, and
		// `Number("\n")` are all 0, so coercing first would silently accept an
		// empty seed and produce a corpus nobody could trace back to it.
		if (!/^-?\d+$/.test(value.trim())) {
			throw new TypeError(
				`Seed must be an integer, received ${JSON.stringify(value)}`,
			);
		}

		const seed = Number(value.trim());
		if (!Number.isSafeInteger(seed)) {
			throw new TypeError(
				`Seed must be a safe integer, received ${JSON.stringify(value)}`,
			);
		}
		return seed;
	}

	/**
	 * Derives an independent stream.
	 *
	 * Each fork is separated from its siblings by a jump of 2^64 values, far
	 * beyond what any single record consumes, so streams never overlap. Forking
	 * the same parent in the same order always yields the same children, which
	 * is what keeps per-record generation stable as unrelated records change.
	 */
	fork(): Random {
		const child = this.#generator.clone();
		for (let i = 0; i <= this.#forks; i++) {
			// `jump` mutates in place and returns nothing.
			child.jump();
		}
		this.#forks += 1;
		return new Random(child);
	}

	/**
	 * Returns an integer in `[min, max]`, both inclusive.
	 *
	 * @throws If the range is empty or its bounds are not integers
	 */
	integer(min: number, max: number): number {
		if (!Number.isInteger(min) || !Number.isInteger(max)) {
			throw new TypeError(`Range bounds must be integers: [${min}, ${max}]`);
		}
		if (min > max) {
			throw new RangeError(`Empty range: [${min}, ${max}]`);
		}
		return uniformInt(this.#generator, min, max);
	}

	/**
	 * Returns a float in `[0, 1)`.
	 *
	 * Built from a 53-bit integer draw so the result carries the full precision
	 * of a double, rather than the 32 bits a single word would give.
	 */
	float(): number {
		return (
			this.integer(0, Number.MAX_SAFE_INTEGER) / (Number.MAX_SAFE_INTEGER + 1)
		);
	}

	/**
	 * Returns `true` with the given probability.
	 *
	 * @param probability - Chance of `true`, from 0 to 1 inclusive
	 * @throws If the probability is outside `[0, 1]`
	 */
	bool(probability = 0.5): boolean {
		if (!(probability >= 0 && probability <= 1)) {
			throw new RangeError(`Probability must be in [0, 1], got ${probability}`);
		}
		return this.float() < probability;
	}

	/**
	 * Picks one element uniformly.
	 *
	 * @throws If the collection is empty
	 */
	pick<T>(items: readonly T[]): T {
		if (items.length === 0) {
			throw new RangeError("Cannot pick from an empty collection");
		}
		// Length is non-zero, so the index is always in range.
		return items[this.integer(0, items.length - 1)] as T;
	}

	/**
	 * Picks one element according to relative weights.
	 *
	 * Used where a corpus should mirror a realistic distribution rather than a
	 * uniform one: most documents carry a handful of entities and a few carry
	 * many, and scoring only exercises the hard cases if the corpus contains
	 * them in proportion.
	 *
	 * @throws If the collections differ in length, are empty, or the weights are
	 * not finite, non-negative, and non-zero in total
	 */
	weighted<T>(items: readonly T[], weights: readonly number[]): T {
		if (items.length !== weights.length) {
			throw new RangeError(
				`Mismatched lengths: ${items.length} items, ${weights.length} weights`,
			);
		}
		if (items.length === 0) {
			throw new RangeError("Cannot pick from an empty collection");
		}

		let total = 0;
		for (const weight of weights) {
			if (!Number.isFinite(weight) || weight < 0) {
				throw new RangeError(
					`Weights must be finite and non-negative: ${weight}`,
				);
			}
			total += weight;
		}
		if (total === 0) {
			throw new RangeError("Weights must not sum to zero");
		}

		let remaining = this.float() * total;
		for (let i = 0; i < items.length; i++) {
			remaining -= weights[i] as number;
			if (remaining < 0) {
				return items[i] as T;
			}
		}
		// Only reachable through floating-point drift at the very top of the
		// range, where the last item is the right answer anyway.
		return items[items.length - 1] as T;
	}

	/**
	 * Returns a shuffled copy, leaving the input untouched.
	 *
	 * A Fisher-Yates shuffle, which is uniform over permutations. Used to vary
	 * where planted values land within a document, so that a pipeline cannot
	 * score well by learning a fixed layout.
	 */
	shuffle<T>(items: readonly T[]): T[] {
		const result = [...items];
		for (let i = result.length - 1; i > 0; i--) {
			const j = this.integer(0, i);
			[result[i], result[j]] = [result[j] as T, result[i] as T];
		}
		return result;
	}

	/**
	 * Returns `count` distinct elements, in random order.
	 *
	 * @throws If `count` is negative or exceeds the collection size
	 */
	sample<T>(items: readonly T[], count: number): T[] {
		if (!Number.isInteger(count) || count < 0) {
			throw new RangeError(
				`Count must be a non-negative integer, got ${count}`,
			);
		}
		if (count > items.length) {
			throw new RangeError(
				`Cannot sample ${count} from a collection of ${items.length}`,
			);
		}
		return this.shuffle(items).slice(0, count);
	}
}
