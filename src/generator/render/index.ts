/**
 * @fileoverview Choosing a renderer for a format.
 *
 * A renderer turns a spec's template into the bytes of a document, planting
 * entities as it goes and recording where each one landed.
 *
 * Positions are recorded against the file's own bytes, whatever the format
 * escapes or wraps them in. A renderer knows where a value landed while it is
 * writing it, so it records that directly rather than leaving the offsets to be
 * searched for afterwards — and the harness never has to decode a document to
 * say where something is.
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

	/** Every planted value, positioned in those bytes. */
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
