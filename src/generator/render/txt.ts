/**
 * @fileoverview Rendering a plain text document.
 *
 * The degenerate case, and worth stating explicitly: in a plain text file the
 * bytes on disk *are* the string a detector reads, so the two coordinate
 * systems coincide and no source ranges are recorded. Every other format is a
 * departure from this, and keeping it a renderer rather than a special case in
 * the caller leaves that comparison visible.
 *
 * @module generator/render/txt
 */

import type { Entity } from "#/datatypes/entity.ts";
import { plant, TemplateError } from "../template.ts";
import type { Rendered } from "./index.ts";

/**
 * Renders a plain text template.
 *
 * @param template - The template body, as read from `template.txt`
 * @throws {TemplateError} If the template is not a string
 */
export function renderTxt(
	template: unknown,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): Rendered {
	if (typeof template !== "string") {
		throw new TemplateError("A text template must be a string");
	}

	const planted = plant(template, entities, modalityId);
	return {
		text: planted.text,
		decoded: planted.text,
		occurrences: planted.occurrences,
	};
}
