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
import type { Label } from "./label.ts";
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
	"ogg",
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
 * How a record came to look the way it does.
 *
 * Not the pipeline's audit log — that is the server's hash-chained account of
 * how an entity was detected. This is the generator's own note of what it did,
 * kept so a surprising record can be explained without rerunning it.
 */
export interface Provenance {
	/**
	 * Which renderer produced the artifact.
	 *
	 * Conventionally `ts:txt` or `python:pdf`, naming the side of the render
	 * contract that ran.
	 */
	renderer: string;

	/**
	 * The record's own seed, forked from the corpus seed.
	 *
	 * Recorded so one record can be regenerated on its own, without replaying
	 * the corpus up to it.
	 */
	seed: number;

	/**
	 * Lossy transformations applied after planting, in order.
	 *
	 * OCR noise, audio transcription, image compression. Values recorded in the
	 * answer key are what survives these, so knowing which ran explains why a
	 * planted value and its rendered form differ.
	 */
	transforms?: string[];
}

/**
 * One record's entry in the corpus index.
 *
 * Deliberately small: the index is read in full to plan a run, while the answer
 * key beside each artifact is read only when that record is scored. Keeping
 * every entity in one file would mean parsing the whole corpus to grade a
 * single document.
 */
export interface RecordEntry {
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

	/** Directory holding the artifact and its truth file, relative to the corpus root. */
	path: string;

	/** SHA-256 of the rendered artifact, hex-encoded. */
	digest: string;
}

/**
 * The corpus index.
 *
 * Names what the corpus contains and what produced it, without carrying the
 * ground truth itself.
 */
export interface Manifest {
	/**
	 * Schema version.
	 *
	 * A reader refuses a version it does not understand rather than guessing. A
	 * silently misread answer key produces confident, wrong numbers, which is
	 * worse than no numbers at all.
	 */
	version: 1;

	/** The seed the corpus was generated from. */
	seed: number;

	/** Harness version that generated it, for tracing a change in results. */
	generator: string;

	/**
	 * Every label the corpus plants, in taxonomy order.
	 *
	 * Recorded here because the labels themselves live in each record's answer
	 * key, and a consumer that needs only the set — the runner scoping a policy,
	 * a report naming what was in scope — should not have to read the whole
	 * corpus to learn it.
	 */
	labels: Label[];

	/** When generation finished, as an ISO 8601 timestamp. */
	createdAt: string;

	/** Every record in the corpus, in generation order. */
	records: RecordEntry[];
}

/**
 * One record's complete answer key.
 *
 * Written beside the artifact it describes and read only when that record is
 * scored, so grading one document costs one small file rather than the corpus.
 *
 * Named `CorpusRecord` rather than `Record` so it never shadows TypeScript's
 * builtin utility type in a file that imports it.
 */
export interface CorpusRecord {
	/**
	 * Schema version, independent of the manifest's.
	 *
	 * A truth file is read on its own, so it has to say what it is without the
	 * index beside it.
	 */
	version: 1;

	/** Stable identifier, matching this record's {@link RecordEntry.id}. */
	id: string;

	/** The container format this record is rendered into. */
	format: DocumentFormat;

	/** The specification this was generated from. */
	specId: string;

	/** Filename of the rendered artifact, relative to this record's directory. */
	artifact: string;

	/** SHA-256 of the rendered artifact, hex-encoded. */
	digest: string;

	/** How this record was produced. */
	provenance: Provenance;

	/** The independently scored components of this record. */
	modalities: Modality[];

	/** Every fabricated value this record carries. */
	entities: Entity[];

	/** Every appearance of those values, at known positions. */
	occurrences: Occurrence[];
}
