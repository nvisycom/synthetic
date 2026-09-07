/**
 * @fileoverview Ground-truth types.
 *
 * @module datatypes
 */

export type { AdversarialKind, Entity, SurfaceForm } from "./entity.ts";
export { ADVERSARIAL_KINDS, SURFACE_FORMS } from "./entity.ts";
export type { Label, LabelCategory, LabelDefinition } from "./label.ts";
export {
	isLabel,
	LABEL_CATEGORIES,
	LABEL_IDS,
	LABEL_LIST,
	LABELS,
	LABELS_BY_ID,
	labelName,
} from "./label.ts";
export type {
	AudioLocation,
	ImageLocation,
	Location,
	Range,
	TextLocation,
} from "./location.ts";
export { extentOf } from "./location.ts";
export {
	byteLength,
	byteRangeAt,
	sliceByteRange,
	toByteOffset,
	toStringIndex,
} from "./offset.ts";
export type {
	CorpusRecord,
	DocumentFormat,
	Manifest,
	Modality,
	ModalityKind,
	Occurrence,
} from "./record.ts";
export { DOCUMENT_FORMATS, MODALITY_KINDS } from "./record.ts";
