/**
 * @fileoverview Record specifications.
 *
 * A spec is the tracked input a record is generated from: which labels it
 * carries, how they are written, and the template they are planted into. Specs
 * live in `data/` and are versioned, because changing one changes what every
 * score computed from it means.
 *
 * A spec describes a *kind* of document, not one document. Generating from it
 * with different seeds yields different records that exercise the same case.
 *
 * @module generator/spec
 */

import type { AdversarialKind, SurfaceForm } from "#/datatypes/entity.ts";
import type { Label } from "#/datatypes/label.ts";
import type { DocumentFormat } from "#/datatypes/record.ts";

/**
 * One value to plant, and how it should appear.
 */
export interface SlotSpec {
	/**
	 * Name used to reference this slot from a template.
	 *
	 * A template writes `{{claimant}}`; the slot named `claimant` fills it.
	 */
	name: string;

	/** What kind of value to fabricate. */
	label: Label;

	/**
	 * How this value is written where it appears.
	 *
	 * A slot referenced several times in a template may be written differently
	 * at each site — the canonical name in the header, initials in a signature.
	 * Listing the forms here is what lets one entity be planted six ways and
	 * still be scored as one subject.
	 *
	 * @default ["canonical"]
	 */
	surfaces?: SurfaceForm[];

	/**
	 * Whether the pipeline is expected to find this value.
	 *
	 * `ignored` plants a value that must survive un-redacted: a catalog number
	 * shaped like an account, a bare figure with no keyword to vouch for it.
	 * These are the precision half of the benchmark — a detection here is a false
	 * positive, and over-redaction is what ruins a document's utility.
	 *
	 * Ignored slots are excluded from recall, so a corpus without them can only
	 * measure how much a pipeline finds, never how much it wrongly takes.
	 *
	 * @default "detected"
	 */
	expect?: "detected" | "ignored";

	/**
	 * Marks this slot as deliberately hard, and says why.
	 *
	 * Reported as its own cohort, so a headline score is not propped up by easy
	 * values and a regression confined to hard cases stays visible.
	 */
	adversarial?: AdversarialKind;

	/** A note on what makes this case hard, carried into the answer key. */
	note?: string;

	/**
	 * A fixed value, instead of a fabricated one.
	 *
	 * For curated adversarial cases where the exact string is the point: a
	 * person named "April", an order number shaped like an SSN. Still fabricated
	 * data, just chosen by hand rather than drawn.
	 */
	value?: string;
}

/**
 * A kind of document to generate.
 */
export interface RecordSpec {
	/**
	 * Schema version.
	 *
	 * A spec is read by a generator that may be newer than the file, so it says
	 * what it is rather than being guessed at.
	 */
	version: 1;

	/** Stable identifier, unique across `data/`, carried into every record. */
	id: string;

	/** What this case exercises, for a human reading the corpus. */
	description: string;

	/** The format records generated from this spec are rendered into. */
	format: DocumentFormat;

	/** The values to plant. */
	slots: SlotSpec[];

	/**
	 * The template file, relative to the spec's own directory.
	 *
	 * @default "template.txt"
	 */
	template?: string;
}

/**
 * A spec together with the template it names.
 *
 * The two are read separately and carried together, so nothing downstream has
 * to know a spec is a directory rather than a file.
 */
export interface LoadedSpec {
	/** The spec as declared. */
	spec: RecordSpec;

	/**
	 * The loaded template, in whatever shape its format's loader produced.
	 *
	 * A string for `txt`; parsed JSON for `json`. Placeholders are written
	 * `{{slot}}`, or `{{slot:surface}}` to write a slot in a particular form.
	 * Everything outside a placeholder is literal, so an author controls exactly
	 * where values land — including whether one straddles a line break.
	 */
	template: unknown;
}
