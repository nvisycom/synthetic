/**
 * @fileoverview Rendering an XML document.
 *
 * An XML spec's template is JSON describing the tree, so the structure is
 * explicit rather than parsed back out of angle brackets:
 *
 * ```json
 * { "tag": "person", "attrs": { "email": "{{email}}" },
 *   "children": [{ "tag": "name", "text": "{{who}}" }] }
 * ```
 *
 * XML gives a value more places to hide than JSON does, and they escape
 * differently. Element text and attribute values replace `&`, `<`, and `>` with
 * entities; a comment escapes nothing but may not contain `--`; and CDATA
 * escapes nothing at all, so inside it the decoded and source offsets coincide
 * while they diverge everywhere else. A pipeline that reads element text but
 * skips attributes, comments, or CDATA leaks exactly the values planted there.
 *
 * As with the other structured renderers, the document is written by hand
 * rather than serialized, because the mapping between decoded and source
 * offsets is only knowable while each entity is being written.
 *
 * @module generator/render/xml
 */

import type { Entity } from "#/datatypes/entity.ts";
import type { Occurrence } from "#/datatypes/record.ts";
import { byteLength } from "#/util/offset.ts";
import { PLACEHOLDER, resolveSlot, TemplateError } from "../template.ts";
import type { Rendered } from "./index.ts";

/** Two spaces per level, as the written document uses. */
const INDENT = "  ";

/**
 * One node of an XML template.
 */
interface Node {
	/** Element name. */
	tag: string;
	/** Attribute values, which may carry placeholders. */
	attrs?: Record<string, string>;
	/** Text content, which may carry placeholders. */
	text?: string;
	/** Text written as CDATA, where nothing is escaped. */
	cdata?: string;
	/** A comment written before this element. */
	comment?: string;
	/** Child elements. */
	children?: Node[];
}

/**
 * Where in a document a value sits, which decides how it is escaped.
 */
type Context = "text" | "attribute" | "comment" | "cdata";

/**
 * Accumulates the document while tracking both coordinate systems.
 */
class Writer {
	text = "";
	bytes = 0;

	/**
	 * The document's readable content: element text, attribute values, comments,
	 * and CDATA, in document order. This is the modality a detector reads, and
	 * what occurrence `ranges` index. Markup itself is left out.
	 */
	decoded = "";
	decodedBytes = 0;

	readonly occurrences: Occurrence[] = [];

	/** Writes markup, which no occurrence indexes. */
	raw(fragment: string): void {
		this.text += fragment;
		this.bytes += byteLength(fragment);
	}

	/**
	 * Writes one character of content, escaped for its context.
	 */
	character(character: string, context: Context): void {
		if (context === "text" || context === "attribute") {
			switch (character) {
				case "&":
					this.raw("&amp;");
					break;
				case "<":
					this.raw("&lt;");
					break;
				case ">":
					this.raw("&gt;");
					break;
				case '"':
					// Only inside an attribute, which this renderer double-quotes.
					this.raw(context === "attribute" ? "&quot;" : '"');
					break;
				default:
					this.raw(character);
			}
		} else {
			// Comments and CDATA carry their content verbatim.
			this.raw(character);
		}

		this.decoded += character;
		this.decodedBytes += byteLength(character);
	}
}

/**
 * Writes a run of content, planting any placeholders it carries.
 */
function writeContent(
	writer: Writer,
	template: string,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
	context: Context,
): void {
	let last = 0;
	PLACEHOLDER.lastIndex = 0;
	let match = PLACEHOLDER.exec(template);

	while (match !== null) {
		for (const character of template.slice(last, match.index)) {
			writer.character(character, context);
		}

		const [placeholder, name, requested] = match;
		const resolved = resolveSlot(entities, name, requested);

		const decodedStart = writer.decodedBytes;
		const sourceStart = writer.bytes;
		for (const character of resolved.value) {
			writer.character(character, context);
		}

		writer.occurrences.push({
			id: `occ_${String(writer.occurrences.length).padStart(4, "0")}`,
			entityId: resolved.entity.id,
			modalityId,
			surface: resolved.surface,
			text: resolved.value,
			location: {
				kind: "text",
				ranges: [{ start: decodedStart, end: writer.decodedBytes }],
				source: [{ start: sourceStart, end: writer.bytes }],
			},
		});

		last = match.index + placeholder.length;
		match = PLACEHOLDER.exec(template);
	}

	for (const character of template.slice(last)) {
		writer.character(character, context);
	}
}

/**
 * Writes one element and its subtree.
 */
function writeNode(
	writer: Writer,
	node: Node,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
	depth: number,
): void {
	if (typeof node?.tag !== "string" || node.tag.length === 0) {
		throw new TemplateError("Every XML template node needs a `tag`");
	}

	const pad = INDENT.repeat(depth);

	if (node.comment !== undefined) {
		if (node.comment.includes("--")) {
			throw new TemplateError("An XML comment may not contain '--'");
		}
		writer.raw(`${pad}<!-- `);
		writeContent(writer, node.comment, entities, modalityId, "comment");
		writer.raw(" -->\n");
	}

	writer.raw(`${pad}<${node.tag}`);

	for (const [name, value] of Object.entries(node.attrs ?? {})) {
		writer.raw(` ${name}="`);
		writeContent(writer, value, entities, modalityId, "attribute");
		writer.raw('"');
	}

	const children = node.children ?? [];
	const hasText = node.text !== undefined || node.cdata !== undefined;

	if (!hasText && children.length === 0) {
		writer.raw(" />\n");
		return;
	}

	writer.raw(">");

	if (node.text !== undefined) {
		writeContent(writer, node.text, entities, modalityId, "text");
	}

	if (node.cdata !== undefined) {
		// Nothing inside CDATA is escaped, so a value planted here has identical
		// decoded and source offsets — the one place in an XML document where the
		// two coincide.
		writer.raw("<![CDATA[");
		writeContent(writer, node.cdata, entities, modalityId, "cdata");
		writer.raw("]]>");
	}

	if (children.length > 0) {
		writer.raw("\n");
		for (const child of children) {
			writeNode(writer, child, entities, modalityId, depth + 1);
		}
		writer.raw(pad);
	}

	writer.raw(`</${node.tag}>\n`);
}

/**
 * Renders an XML template into a document.
 *
 * @param template - The root node, as parsed from `template.json`
 * @param entities - Entities by slot name
 * @param modalityId - The modality occurrences are recorded against
 * @throws {TemplateError} If the template is not a node tree, or a placeholder
 * names an unknown slot
 */
export function renderXml(
	template: unknown,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): Rendered {
	if (template === null || typeof template !== "object") {
		throw new TemplateError("An XML template must be an object");
	}

	const writer = new Writer();
	writer.raw('<?xml version="1.0" encoding="UTF-8"?>\n');
	writeNode(writer, template as Node, entities, modalityId, 0);

	return {
		text: writer.text,
		decoded: writer.decoded,
		occurrences: writer.occurrences,
	};
}
