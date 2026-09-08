/**
 * @fileoverview Rendering a structured JSON document.
 *
 * A JSON spec's template is itself JSON, with `{{slot}}` placeholders inside
 * string values, so a record has the shape a real JSON document has — nested
 * objects, several fields, values where they belong — rather than prose in a
 * wrapper.
 *
 * `JSON.stringify` writes the document. It already knows how JSON escapes a
 * value, and reimplementing that here would only add a second opinion about it
 * to disagree with. What it does not report is where each value landed, which
 * is what {@link Markers} supplies: the template is serialized with a marker
 * standing in for each planted value, and the markers are replaced afterwards.
 *
 * @module generator/render/json
 */

import type { Entity } from "#/datatypes/entity.ts";
import {
	hasPlaceholder,
	Markers,
	PLACEHOLDER,
	TemplateError,
} from "../template.ts";
import type { Rendered } from "./index.ts";

/** Two spaces per level, matching the written document. */
const INDENT = 2;

/**
 * How JSON writes a value inside a string.
 *
 * Taken from `JSON.stringify` rather than written out, so it cannot drift from
 * what actually serialized the document: quoting the value alone and dropping
 * the surrounding quotes leaves exactly the bytes it contributes.
 */
function escapeWith(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

/**
 * Replaces a template's placeholders with markers, recursing into the tree.
 */
function mark(
	value: unknown,
	entities: ReadonlyMap<string, Entity>,
	markers: Markers,
): unknown {
	if (typeof value === "string") {
		PLACEHOLDER.lastIndex = 0;
		return value.replaceAll(
			PLACEHOLDER,
			(_, name: string, requested?: string) =>
				markers.place(entities, name, requested, escapeWith, undefined),
		);
	}

	if (Array.isArray(value)) {
		return value.map((item) => mark(item, entities, markers));
	}

	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => {
				// A placeholder in a key would be serialized as a marker and never
				// resolved, leaving a spec that looks correct and a document that is
				// not. Caught here rather than at resolve time, where the message
				// could only say that some marker went missing.
				if (hasPlaceholder(key)) {
					throw new TemplateError(
						`Key ${JSON.stringify(key)} carries a placeholder; values are planted, keys are not`,
					);
				}
				return [key, mark(item, entities, markers)];
			}),
		);
	}

	// Numbers, booleans, and null carry no planted values.
	return value;
}

/**
 * Renders a JSON template into a document.
 *
 * @param template - The template's parsed JSON, with `{{slot}}` in string values
 * @param entities - Entities by slot name
 * @param modalityId - The modality occurrences are recorded against
 * @throws {TemplateError} If the root is not a container, a placeholder names an
 * unknown slot, or asks for a surface form the entity does not have
 */
export function renderJson(
	template: unknown,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): Rendered {
	if (template === null || typeof template !== "object") {
		throw new TemplateError(
			"A JSON template must be an object or an array at its root",
		);
	}

	const markers = new Markers();
	const marked = mark(template, entities, markers);

	return markers.resolve(
		`${JSON.stringify(marked, null, INDENT)}\n`,
		modalityId,
	);
}
