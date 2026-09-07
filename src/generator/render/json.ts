/**
 * @fileoverview Rendering a structured JSON document.
 *
 * A JSON spec's template is itself JSON, with `{{slot}}` placeholders inside
 * string values, so a record has the shape a real JSON document has — nested
 * objects, several fields, values where they belong — rather than prose in a
 * wrapper.
 *
 * Two coordinate systems come apart here, and both are recorded. In
 * `{"alias": "Say \"Ace\" Delgado"}` the planted name sits at one offset in the
 * string a parser returns and another in the file's bytes, because the escapes
 * shift everything after them. A detector reads decoded text; a redactor
 * overwrites bytes.
 *
 * The document is serialized by hand rather than through `JSON.stringify`,
 * because the mapping between those offsets is only knowable while each escape
 * is being written. Serializing first would leave the source offsets to be
 * searched for afterwards — the guessing this harness avoids everywhere else.
 *
 * @module generator/render/json
 */

import type { Entity, SurfaceForm } from "#/datatypes/entity.ts";
import type { Occurrence } from "#/datatypes/record.ts";
import { byteLength } from "#/util/offset.ts";
import {
	hasPlaceholder,
	PLACEHOLDER,
	resolveSlot,
	TemplateError,
} from "../template.ts";
import type { Rendered } from "./index.ts";

/** Two spaces per level, as the written document uses. */
const INDENT = "  ";

/**
 * Accumulates the document while tracking where every planted value landed.
 *
 * Both offsets are recorded as the text is built. The decoded offset counts a
 * value as a parser would return it; the source offset counts the bytes
 * actually written, escapes included.
 */
class Writer {
	/** The file's bytes so far. */
	text = "";

	/** Byte length of {@link text}, kept alongside so it is never recomputed. */
	bytes = 0;

	/**
	 * The concatenated string content of the document, escapes resolved.
	 *
	 * This is the modality a detector reads, and what occurrence `ranges` index.
	 * Structural punctuation is left out, since no detector sees a brace.
	 */
	decoded = "";

	/** Byte length of {@link decoded}. */
	decodedBytes = 0;

	/** Every value planted, with both coordinate systems recorded. */
	readonly occurrences: Occurrence[] = [];

	/** Writes structural text, which no occurrence indexes. */
	raw(fragment: string): void {
		this.text += fragment;
		this.bytes += byteLength(fragment);
	}

	/**
	 * Writes one character of a string value, escaping it for JSON.
	 *
	 * The two counters advance independently: the file may gain two bytes where
	 * the decoded text gains one.
	 */
	character(character: string): void {
		switch (character) {
			case '"':
				this.raw('\\"');
				break;
			case "\\":
				this.raw("\\\\");
				break;
			case "\n":
				this.raw("\\n");
				break;
			case "\r":
				this.raw("\\r");
				break;
			case "\t":
				this.raw("\\t");
				break;
			default:
				// Control characters must be escaped; everything else, non-ASCII
				// included, is written literally so the file stays readable.
				this.raw(
					character < " "
						? `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
						: character,
				);
		}

		this.decoded += character;
		this.decodedBytes += byteLength(character);
	}

	/** Records where a value landed, in both coordinate systems. */
	record(
		entity: Entity,
		surface: SurfaceForm,
		value: string,
		decodedStart: number,
		sourceStart: number,
		modalityId: string,
	): void {
		this.occurrences.push({
			id: `occ_${String(this.occurrences.length).padStart(4, "0")}`,
			entityId: entity.id,
			modalityId,
			surface,
			text: value,
			location: {
				kind: "text",
				ranges: [{ start: decodedStart, end: this.decodedBytes }],
				source: [{ start: sourceStart, end: this.bytes }],
			},
		});
	}
}

/**
 * Writes a string value, planting any placeholders it contains.
 */
function writeString(
	writer: Writer,
	value: string,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): void {
	writer.raw('"');

	let last = 0;
	PLACEHOLDER.lastIndex = 0;
	let match = PLACEHOLDER.exec(value);

	while (match !== null) {
		for (const character of value.slice(last, match.index)) {
			writer.character(character);
		}

		const [placeholder, name, requested] = match;
		const resolved = resolveSlot(entities, name, requested);

		const decodedStart = writer.decodedBytes;
		const sourceStart = writer.bytes;
		for (const character of resolved.value) {
			writer.character(character);
		}
		writer.record(
			resolved.entity,
			resolved.surface,
			resolved.value,
			decodedStart,
			sourceStart,
			modalityId,
		);

		last = match.index + placeholder.length;
		match = PLACEHOLDER.exec(value);
	}

	for (const character of value.slice(last)) {
		writer.character(character);
	}

	writer.raw('"');
}

/**
 * Writes any JSON value, recursing into objects and arrays.
 */
function writeValue(
	writer: Writer,
	value: unknown,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
	depth: number,
): void {
	const pad = INDENT.repeat(depth);
	const inner = INDENT.repeat(depth + 1);

	if (typeof value === "string") {
		writeString(writer, value, entities, modalityId);
		return;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			writer.raw("[]");
			return;
		}
		writer.raw("[\n");
		for (const [index, item] of value.entries()) {
			writer.raw(inner);
			writeValue(writer, item, entities, modalityId, depth + 1);
			writer.raw(index === value.length - 1 ? "\n" : ",\n");
		}
		writer.raw(`${pad}]`);
		return;
	}

	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			writer.raw("{}");
			return;
		}
		writer.raw("{\n");
		for (const [index, [key, item]] of entries.entries()) {
			// A placeholder in a key would be written verbatim and plant nothing,
			// leaving a spec that looks correct and a document that is not.
			if (hasPlaceholder(key)) {
				throw new TemplateError(
					`Key ${JSON.stringify(key)} carries a placeholder; values are planted, keys are not`,
				);
			}
			writer.raw(`${inner}${JSON.stringify(key)}: `);
			writeValue(writer, item, entities, modalityId, depth + 1);
			writer.raw(index === entries.length - 1 ? "\n" : ",\n");
		}
		writer.raw(`${pad}}`);
		return;
	}

	// Numbers, booleans, and null carry no planted values.
	writer.raw(JSON.stringify(value));
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

	const writer = new Writer();
	writeValue(writer, template, entities, modalityId, 0);
	writer.raw("\n");

	return {
		text: writer.text,
		decoded: writer.decoded,
		occurrences: writer.occurrences,
	};
}
