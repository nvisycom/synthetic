/**
 * @fileoverview Choosing a renderer for a format.
 *
 * A renderer turns a spec's template into the bytes of a document, planting
 * entities as it goes and recording where each one landed.
 *
 * Two coordinate systems matter, and a renderer reports both. `decoded` is the
 * string content a detector reads, which occurrence `ranges` index; the
 * document's bytes are what a redactor overwrites, which `source` ranges index.
 * In a plain text file the two coincide and no source ranges are recorded; a
 * structured format pulls them apart.
 *
 * @module generator/render
 */

import type { Entity } from "#/datatypes/entity.ts";
import type { DocumentFormat, Occurrence } from "#/datatypes/record.ts";
import { renderCsv } from "./csv.ts";
import { renderJson } from "./json.ts";
import { renderTxt } from "./txt.ts";
import { renderXml } from "./xml.ts";

/**
 * A rendered document and the ground truth for the values inside it.
 */
export interface Rendered {
	/** The document's bytes, as written to disk. */
	text: string;

	/**
	 * The string content a detector reads, escapes resolved.
	 *
	 * Recorded as the record's text modality, and what occurrence `ranges`
	 * index. Equals {@link text} for a plain text document.
	 */
	decoded: string;

	/** Every planted value, with its position in both coordinate systems. */
	occurrences: Occurrence[];
}

/**
 * Turns a template into a document.
 *
 * The template is whatever that format's loader produced: a string for `txt`,
 * parsed JSON for `json`.
 */
export type Renderer = (
	template: unknown,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
) => Rendered;

/**
 * Renderers by format.
 *
 * A format absent from here is refused at spec load rather than written as
 * plain text under a misleading extension.
 */
const RENDERERS: Partial<Record<DocumentFormat, Renderer>> = {
	txt: renderTxt,
	json: renderJson,
	csv: renderCsv,
	xml: renderXml,
};

/**
 * Every format a renderer exists for, in a stable order.
 */
export const RENDERABLE_FORMATS: readonly DocumentFormat[] = Object.keys(
	RENDERERS,
) as DocumentFormat[];

/**
 * Returns the renderer for a format, or `undefined` when none exists.
 */
export function rendererFor(format: DocumentFormat): Renderer | undefined {
	return RENDERERS[format];
}
