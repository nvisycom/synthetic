/**
 * @fileoverview Deciding which detection found which planted value.
 *
 * Everything a report says rests on this pairing, and the awkward cases are the
 * ones that matter. Values in a real document sit next to each other, and a
 * detector's span does not always respect the boundary: in this corpus an
 * `email_address` and a `phone_number` written with no separator between them
 * came back as one detection covering both.
 *
 * That is scored as finding the email and missing the phone, which is what
 * happened — a redactor acting on that span removes the email, and the phone
 * survives because nothing identified it. Crediting both would report a leak as
 * a catch. So the pairing is one-to-one: a detection satisfies at most one
 * planted value, and a planted value is satisfied by at most one detection.
 *
 * Pairs are chosen by preferring a matching label and then the largest overlap,
 * greedily. A greedy pass rather than an optimal assignment because the cases
 * are small and local — a document has a handful of candidates in any one spot,
 * not a bipartite graph worth solving — and because a rule someone can follow by
 * eye is worth more here than the last fraction of a percent: a benchmark whose
 * pairing cannot be checked by hand cannot be trusted when it disagrees.
 *
 * @module scoring/match
 */

import type { Location } from "#/datatypes/location.ts";
import type { Occurrence } from "#/datatypes/record.ts";
import type { Detected } from "#/runner/outcome.ts";

/**
 * How much two locations have in common, in their own units.
 *
 * Zero when they do not overlap, and zero when they are not comparable at all —
 * a text range and a table cell describe different documents' worth of
 * coordinates, and treating one as the other is how a boundary number quietly
 * becomes fiction.
 */
export function overlapOf(left: Location, right: Location): number {
	if (left.kind !== right.kind) return 0;

	if (left.kind === "text" && right.kind === "text") {
		return rangesOverlap(left.ranges, right.ranges);
	}

	if (left.kind === "tabular" && right.kind === "tabular") {
		// A tabular detection names a cell; anything outside it is a different
		// value however close the offsets happen to be.
		if (left.row !== right.row || left.column !== right.column) return 0;
		if (left.sheetName !== right.sheetName) return 0;

		// An absent cell range means the whole cell, so it overlaps whatever the
		// other one covers there.
		if (left.cell === undefined || right.cell === undefined) {
			return extentOfCell(left.cell ?? right.cell);
		}
		return rangesOverlap([left.cell], [right.cell]);
	}

	if (left.kind === "audio" && right.kind === "audio") {
		return rangesOverlap([left.span], [right.span]);
	}

	if (left.kind === "image" && right.kind === "image") {
		const width =
			Math.min(left.max.x, right.max.x) - Math.max(left.min.x, right.min.x);
		const height =
			Math.min(left.max.y, right.max.y) - Math.max(left.min.y, right.min.y);
		return width > 0 && height > 0 ? width * height : 0;
	}

	return 0;
}

/**
 * Summed overlap between two sets of ranges.
 *
 * Both sides may carry several — a value split across an escape or a line
 * break — and the pieces are compared pairwise rather than end to end, so the
 * gap between them counts for neither.
 */
function rangesOverlap(
	left: readonly { start: number; end: number }[],
	right: readonly { start: number; end: number }[],
): number {
	let total = 0;
	for (const a of left) {
		for (const b of right) {
			const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start);
			if (shared > 0) total += shared;
		}
	}
	return total;
}

/** The width a whole-cell location covers, which it does not state. */
function extentOfCell(
	cell: { start: number; end: number } | undefined,
): number {
	// A whole-cell match has no width of its own to report. One byte stands for
	// "they meet", enough to pair them without inventing a boundary figure —
	// boundary accuracy skips these, since neither side stated a width.
	return cell === undefined ? 1 : Math.max(1, cell.end - cell.start);
}

/**
 * One planted value paired with the detection that found it, if any.
 */
export interface Pairing {
	/** The planted value. */
	occurrence: Occurrence;

	/** What found it, or `undefined` when nothing did. */
	detection?: Detected;

	/** How much of the two coincide, in the location's own units. */
	overlap: number;
}

/**
 * The result of pairing one record's detections against its planted values.
 */
export interface Matched {
	/** Every planted value, paired or not, in the order the record lists them. */
	pairings: Pairing[];

	/**
	 * Detections that were not paired with anything planted.
	 *
	 * Not necessarily wrong: a document's incidental text may contain something
	 * a pipeline is right to flag, and the corpus cannot say otherwise. Reported
	 * as its own category rather than folded into precision.
	 */
	unpaired: Detected[];
}

/**
 * A candidate pair, before any of them are committed to.
 */
interface Candidate {
	occurrenceIndex: number;
	detectionIndex: number;
	overlap: number;
	/** Whether the pipeline's label agrees with what was planted. */
	sameLabel: boolean;
}

/**
 * Pairs a record's detections with the values planted in it.
 *
 * @param occurrences - What the generator planted
 * @param detections - What the pipeline reported
 * @param labelOf - The label planted for an occurrence, by entity id
 */
export function matchRecord(
	occurrences: readonly Occurrence[],
	detections: readonly Detected[],
	labelOf: (occurrence: Occurrence) => string,
): Matched {
	const candidates: Candidate[] = [];

	for (const [occurrenceIndex, occurrence] of occurrences.entries()) {
		for (const [detectionIndex, detection] of detections.entries()) {
			const overlap = overlapOf(occurrence.location, detection.location);
			if (overlap <= 0) continue;

			candidates.push({
				occurrenceIndex,
				detectionIndex,
				overlap,
				sameLabel: detection.label === labelOf(occurrence),
			});
		}
	}

	// Best first: a label that agrees settles it, then the larger overlap. Ties
	// break on position so the pairing does not depend on iteration order, which
	// would make a score irreproducible for no reason anyone could see.
	candidates.sort(
		(a, b) =>
			Number(b.sameLabel) - Number(a.sameLabel) ||
			b.overlap - a.overlap ||
			a.occurrenceIndex - b.occurrenceIndex ||
			a.detectionIndex - b.detectionIndex,
	);

	const takenOccurrences = new Set<number>();
	const takenDetections = new Set<number>();
	const pairings: Pairing[] = occurrences.map((occurrence) => ({
		occurrence,
		overlap: 0,
	}));

	for (const candidate of candidates) {
		if (takenOccurrences.has(candidate.occurrenceIndex)) continue;
		if (takenDetections.has(candidate.detectionIndex)) continue;

		takenOccurrences.add(candidate.occurrenceIndex);
		takenDetections.add(candidate.detectionIndex);

		const pairing = pairings[candidate.occurrenceIndex];
		if (pairing === undefined) continue;
		pairing.detection = detections[candidate.detectionIndex];
		pairing.overlap = candidate.overlap;
	}

	return {
		pairings,
		unpaired: detections.filter((_, index) => !takenDetections.has(index)),
	};
}
