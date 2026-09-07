/**
 * @fileoverview Fabricated values and how they appear.
 *
 * The benchmark reports per label rather than in aggregate, because detection
 * behaviour varies enormously between them: a name in running prose is a
 * different problem from an account number in a table cell. An aggregate score
 * hides exactly the regressions worth catching.
 *
 * The labels themselves live in {@link ./label.ts}, mirroring elide's built-in
 * taxonomy so a planted value and a detection can be compared directly.
 *
 * @module datatypes/entity
 */

import type { Label } from "./label.ts";

/**
 * How a planted value is written at one occurrence.
 *
 * One person is typically referenced several ways in a single document, and a
 * pipeline that catches the canonical spelling but misses the initials or the
 * signature block has still leaked. Recording the surface form per occurrence
 * lets a report break recall down by how the value was written, which is where
 * that class of miss becomes visible.
 */
export type SurfaceForm = (typeof SURFACE_FORMS)[number];

/**
 * Every surface form, in a stable order.
 */
export const SURFACE_FORMS = [
	/** The value exactly as its entity defines it. */
	"canonical",
	/** Shortened: initials, a first name alone, an abbreviation. */
	"abbreviated",
	/** A deliberate misspelling or transposition, as a human would typo it. */
	"misspelled",
	/** Repunctuated or respaced: `555-01-0199` against `555 01 0199`. */
	"reformatted",
	/** Embedded in a larger token, such as a name inside an email address. */
	"embedded",
	/** A signature, initials block, or other stylised rendering. */
	"signature",
	/** Produced by a lossy channel: OCR output or a speech transcript. */
	"transcribed",
] as const;

/**
 * Why an entity was chosen to be hard.
 *
 * Adversarial entities are the ones that expose real failures, and they are
 * reported separately so a headline score is not quietly propped up by easy
 * values, and so a regression confined to hard cases stays visible.
 */
export type AdversarialKind = (typeof ADVERSARIAL_KINDS)[number];

/**
 * Every adversarial kind, in a stable order.
 */
export const ADVERSARIAL_KINDS = [
	/** Collides with a common word: a person named April, Case, or Mark. */
	"common_word",
	/** Shaped like a different identifier: an order number resembling an SSN. */
	"format_collision",
	/** Written several ways in one document, all referring to one subject. */
	"coreference",
	/** Broken across a line, page, cell, or paragraph boundary. */
	"split_value",
	/** Damaged by OCR or speech transcription. */
	"lossy_channel",
	/** Sits in an unusual place: metadata, a footnote, a chart label. */
	"unusual_context",
] as const;

/**
 * A fabricated sensitive value, with every way it may appear.
 *
 * Entities are generated once per record and referenced by occurrences, so that
 * all six ways one person is written trace back to a single entity. Scoring
 * uses that link to tell "missed this person entirely" from "caught the person
 * but missed one spelling".
 */
export interface Entity {
	/** Stable identifier, unique within a record. */
	id: string;

	/** What kind of sensitive value this is. */
	label: Label;

	/**
	 * The canonical rendering.
	 *
	 * Always fabricated. Values are drawn to be structurally plausible — a
	 * generated SSN matches the shape of a real one, and a generated IBAN passes
	 * its checksum — but never correspond to a real person, account, or record.
	 */
	value: string;

	/**
	 * Alternative renderings, keyed by surface form.
	 *
	 * Populated only for the forms an entity actually uses: an API key has no
	 * meaningful abbreviation, while a person name usually has several.
	 */
	variants?: Partial<Record<SurfaceForm, string>>;

	/**
	 * Whether a pipeline is expected to detect this value.
	 *
	 * `ignored` marks a value planted to test precision: it looks sensitive but
	 * is not, so finding it is a false positive rather than a hit. Absent means
	 * detected, which is the common case.
	 */
	expect?: "detected" | "ignored";

	/**
	 * Why this entity is hard, when it was chosen to be.
	 *
	 * Absent for ordinary entities. Present entries are reported as their own
	 * cohort alongside the headline numbers.
	 */
	adversarial?: AdversarialKind;

	/**
	 * A note on what makes this case hard, for report annotation.
	 */
	note?: string;
}
