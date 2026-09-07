/**
 * @fileoverview What comparing a detection to a planted value produces.
 *
 * The three questions the blog poses are kept apart on purpose, because they
 * fail for different reasons and a single number hides which one went wrong:
 *
 * - **Recall** — was the value found at all? Anything overlapping it counts,
 *   because a detector that finds `247944.08` inside a planted `USD 247944.08`
 *   has found it. Requiring exact spans would report half this corpus' real
 *   hits as leaks.
 * - **Precision** — was everything found actually sensitive? A detection over a
 *   value planted to be ignored is over-redaction, which damages a document as
 *   surely as a miss exposes one.
 * - **Boundary accuracy** — was the whole value covered, and no more? Measured
 *   only for values that were found, so a miss cannot masquerade as a boundary
 *   problem.
 *
 * A wrong label is its own outcome rather than being forced into one of those.
 * A detection reporting `government_id` over a planted `case_number` did locate
 * the value, so a redactor removes it and nothing leaks; calling it a miss
 * overstates the harm. But the taxonomy was wrong, and the adversarial specs
 * exist to expose exactly that, so it does not count as a hit either.
 *
 * @module scoring/outcome
 */

import type { Label } from "#/datatypes/label.ts";

/**
 * How well a detection's span agrees with the value it found.
 *
 * Both figures are in the units of the coordinate system being compared —
 * bytes for text, and the cell's own bytes for tabular content.
 */
export interface Boundary {
	/** Bytes of the planted value the detection covered. */
	covered: number;

	/** Bytes of the planted value the detection left uncovered. */
	missed: number;

	/** Bytes the detection covered that were not part of the value. */
	spilled: number;
}

/**
 * What happened to one planted value.
 */
export type PlantedOutcome =
	| {
			kind: "found";
			/** The detection that matched it. */
			detectionId: string;
			/**
			 * How well the spans agreed, when both sides stated a width.
			 *
			 * Absent when one did not — a tabular detection naming a cell and no
			 * offsets within it says which cell, not how much of the value it
			 * covered. Left out rather than measured as zero, which would score a
			 * wiped cell as an exact match.
			 */
			boundary?: Boundary;
	  }
	| {
			kind: "mislabelled";
			detectionId: string;
			/** What the pipeline called it. */
			reported: string;
			boundary?: Boundary;
	  }
	| {
			kind: "missed";
	  }
	| {
			/**
			 * The value was planted to be ignored, and the pipeline ignored it.
			 *
			 * The precision half of the benchmark: a corpus that only counted
			 * misses would score a pipeline that redacts everything perfectly.
			 */
			kind: "correctly-ignored";
	  }
	| {
			/** The value was planted to be ignored, and was redacted anyway. */
			kind: "over-redacted";
			detectionId: string;
			reported: string;
	  };

/**
 * What happened to one detection.
 *
 * The mirror of {@link PlantedOutcome}: every detection either lands on
 * something planted or does not.
 */
export type DetectionOutcome =
	| { kind: "matched"; occurrenceId: string }
	| { kind: "mislabelled"; occurrenceId: string; expected: Label }
	| {
			/**
			 * The detection overlapped nothing planted.
			 *
			 * Not necessarily wrong. A corpus plants the values a spec declares,
			 * and a document's incidental text may contain something a pipeline is
			 * right to flag — a URL in a template's prose, say. Reported as its own
			 * category rather than folded into precision, since the corpus cannot
			 * say whether it was a mistake.
			 */
			kind: "unplanted";
	  };

/**
 * Counts for one slice of a report — a label, a format, a surface form.
 */
export interface Tally {
	/** Values planted and expected to be detected. */
	planted: number;

	/** Of those, how many were found with the right label. */
	found: number;

	/** Found, but reported under a different label. */
	mislabelled: number;

	/** Not found at all. */
	missed: number;

	/** Values planted to be ignored. */
	decoys: number;

	/** Of those, how many were redacted anyway. */
	overRedacted: number;

	/**
	 * Summed boundary figures across everything found that stated a width.
	 *
	 * A found value whose boundary could not be measured contributes nothing
	 * here, so {@link coverage} describes the values it actually covers rather
	 * than being diluted by ones nobody measured.
	 */
	boundary: Boundary;

	/** Values found whose boundary neither side stated a width for. */
	unmeasured: number;
}

/**
 * Returns an empty tally, so counts can be accumulated into it.
 */
export function emptyTally(): Tally {
	return {
		planted: 0,
		found: 0,
		mislabelled: 0,
		missed: 0,
		decoys: 0,
		overRedacted: 0,
		boundary: { covered: 0, missed: 0, spilled: 0 },
		unmeasured: 0,
	};
}

/**
 * Recall: the share of planted values a pipeline located.
 *
 * A mislabelled value counts as located, since a redactor removes it and
 * nothing leaks. Per-label recall is reported separately, where it does not.
 *
 * Returns `undefined` rather than zero when nothing was planted: a label absent
 * from a corpus has no recall, and reporting 0% would read as a failure.
 */
export function recall(tally: Tally): number | undefined {
	if (tally.planted === 0) return undefined;
	return (tally.found + tally.mislabelled) / tally.planted;
}

/**
 * Strict recall: the share found *and* labelled correctly.
 */
export function labelledRecall(tally: Tally): number | undefined {
	if (tally.planted === 0) return undefined;
	return tally.found / tally.planted;
}

/**
 * Precision against the corpus' decoys.
 *
 * The share of values planted to be ignored that the pipeline did leave alone.
 * This is not precision over every detection — the corpus cannot judge a
 * detection it never planted — but over the values it deliberately planted as
 * things that must survive.
 */
export function decoyPrecision(tally: Tally): number | undefined {
	if (tally.decoys === 0) return undefined;
	return (tally.decoys - tally.overRedacted) / tally.decoys;
}

/**
 * The share of a found value's bytes that were actually covered.
 */
export function coverage(boundary: Boundary): number | undefined {
	const total = boundary.covered + boundary.missed;
	if (total === 0) return undefined;
	return boundary.covered / total;
}
