/**
 * @fileoverview Records, modalities, and the ground-truth manifest.
 *
 * A document is not scored as one blob. A single PDF may carry a text layer, an
 * embedded image, and a scanned page, and those are three detection problems
 * that fail for different reasons. Splitting a file into modalities is what
 * turns "the PDF scored 0.91" into "the text layer is fine, the scanned page is
 * losing account numbers".
 *
 * @module datatypes/record
 */

import type { Entity, SurfaceForm } from "./entity.ts";
import type { Location } from "./location.ts";

/**
 * A component of a document that is detected and scored on its own.
 */
export type ModalityKind = (typeof MODALITY_KINDS)[number];

/**
 * Every modality kind, in a stable order.
 */
export const MODALITY_KINDS = [
	/** Extractable characters: a PDF text layer, a DOCX body, a CSV cell. */
	"text",
	/** Raster content needing OCR: a scanned page or a photographed form. */
	"scan",
	/** An embedded raster: a logo, a screenshot, a pasted table. */
	"image",
	/** Spoken audio needing transcription. */
	"audio",
	/** Document metadata: EXIF, PDF info, DOCX core properties. */
	"metadata",
] as const;

/**
 * A container format a record can be rendered into.
 */
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/**
 * Every document format, in a stable order.
 */
export const DOCUMENT_FORMATS = [
	// Composite formats, carrying several modalities in one file.
	"pdf",
	"docx",
	"pptx",
	"rtf",
	// Structured and plain text.
	"csv",
	"xlsx",
	"json",
	"xml",
	"html",
	"txt",
	// Images.
	"png",
	"jpeg",
	"tiff",
	// Audio.
	"wav",
	"mp3",
] as const;

/**
 * One appearance of an entity inside one modality, at a known position.
 *
 * This is the unit of ground truth: a record's occurrences are the complete
 * answer key, listing every sensitive value present in the rendered artifact
 * exactly once. That completeness is precisely what a real customer document
 * cannot offer, and the reason the corpus is synthetic at all.
 */
export interface Occurrence {
	/** Stable identifier, unique within a record. */
	id: string;

	/** The entity rendered here; joins to {@link Entity.id}. */
	entityId: string;

	/** The modality this sits in; joins to {@link Modality.id}. */
	modalityId: string;

	/** How the value is written at this position. */
	surface: SurfaceForm;

	/**
	 * The literal text as it appears here.
	 *
	 * For a text modality this equals the modality's text sliced by the
	 * location's ranges — a property the generator asserts after rendering,
	 * rather than assuming.
	 */
	text: string;

	/**
	 * What a lossy channel actually produced, when it differs from
	 * {@link text}.
	 *
	 * OCR turns `Rodriguez` into `Rodnguez`; a transcript renders an account
	 * number as words. A pipeline is scored against what is genuinely present in
	 * the artifact, so this is the string scoring matches when it is set.
	 */
	transcribed?: string;

	/** Where the value sits. */
	location: Location;

	/**
	 * The boundary this value is broken across, when it is broken.
	 *
	 * A value split by a line wrap, page break, or table cell is among the most
	 * common real-world misses, because many pipelines match within a line.
	 * Flagging it lets a report separate that failure from ordinary recall. The
	 * pieces themselves live in the location's ranges.
	 */
	splitAcross?: "line" | "page" | "cell" | "paragraph" | "column";
}

/**
 * One independently scored component of a rendered artifact.
 */
export interface Modality {
	/** Stable identifier, unique within a record. */
	id: string;

	/** What kind of component this is. */
	kind: ModalityKind;

	/**
	 * Where this sits inside its container, for reporting.
	 *
	 * Free-form but conventional: `page:3`, `sheet:Claims!B12`, `image:0`,
	 * `metadata:pdf.Author`. Used to point a human at the failure.
	 */
	path: string;

	/**
	 * The full text of this modality, for text-bearing kinds.
	 *
	 * Occurrence byte ranges index into the UTF-8 encoding of this string.
	 * Absent for modalities whose content is not characters, such as a scan
	 * scored purely in pixel space.
	 */
	text?: string;

	/** Pixel dimensions, for raster modalities. */
	dimensions?: { width: number; height: number; pages?: number };

	/** Duration in microseconds, for audio modalities. */
	durationUs?: number;
}

/**
 * One synthetic document, with its complete answer key.
 *
 * Named `CorpusRecord` rather than `Record` so it never shadows TypeScript's
 * builtin utility type in a file that imports it.
 */
export interface CorpusRecord {
	/** Stable identifier, unique within a corpus. */
	id: string;

	/** The container format this record is rendered into. */
	format: DocumentFormat;

	/**
	 * The specification this was generated from.
	 *
	 * Joins a record back to the tracked file in `data/` that described it, so a
	 * regression can be traced to the case that produced it.
	 */
	specId: string;

	/** Path to the rendered artifact, relative to the corpus root. */
	path: string;

	/** SHA-256 of the rendered artifact, hex-encoded. */
	digest: string;

	/** The independently scored components of this record. */
	modalities: Modality[];

	/** Every fabricated value this record carries. */
	entities: Entity[];

	/** Every appearance of those values, at known positions. */
	occurrences: Occurrence[];
}

/**
 * A generated corpus and everything needed to reproduce it.
 */
export interface Manifest {
	/**
	 * Manifest schema version.
	 *
	 * Scoring refuses a manifest it does not understand rather than guessing.
	 * A silently misread answer key produces confident, wrong numbers, which is
	 * worse than no numbers at all.
	 */
	version: 1;

	/** The seed the corpus was generated from. */
	seed: number;

	/** Harness version that generated it, for tracing a change in results. */
	generator: string;

	/** When generation finished, as an ISO 8601 timestamp. */
	createdAt: string;

	/** The records making up the corpus. */
	records: CorpusRecord[];
}
