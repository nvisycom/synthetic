/**
 * @fileoverview Rendering a plain text document.
 *
 * The degenerate case, and worth stating explicitly: a plain text file escapes
 * nothing and wraps nothing, so a value's offsets are simply where it was
 * written. Every other format writes a value differently from how it reads, and
 * keeping this a renderer rather than a special case in the caller leaves that
 * comparison visible.
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

	return plant(template, entities, modalityId);
}
