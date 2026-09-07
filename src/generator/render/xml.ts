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
 * differently. Element text and attribute values replace `&`, `<`, `>`, and `"`
 * with entities; a comment escapes nothing but may not contain `--`; and CDATA
 * escapes nothing at all. A pipeline that reads element text but skips
 * attributes, comments, or CDATA leaks exactly the values planted there.
 *
 * The tree is written out here rather than through an XML library because the
 * escaping is one line and the rest — where a comment sits, what goes in CDATA,
 * which attributes are namespace declarations — is this template format's own
 * shape, which a library would not know. Positions come from {@link Markers},
 * as they do for every format.
 *
 * @module generator/render/xml
 */

import type { Entity } from "#/datatypes/entity.ts";
import {
	type Escape,
	hasPlaceholder,
	Markers,
	PLACEHOLDER,
	TemplateError,
	verbatim,
} from "../template.ts";
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
 * How XML writes a value in element text or an attribute.
 *
 * `"` is escaped in both, rather than only in attributes where it must be.
 * Escaping it in element text is permitted, changes nothing a parser reads, and
 * means one function describes both contexts.
 *
 * Comments and CDATA escape nothing and use {@link verbatim} instead.
 */
function escapeWith(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/**
 * Replaces a run of template content with markers.
 */
function mark(
	template: string,
	entities: ReadonlyMap<string, Entity>,
	markers: Markers,
	escapeAt: Escape,
): string {
	PLACEHOLDER.lastIndex = 0;
	return template.replaceAll(
		PLACEHOLDER,
		(_, name: string, requested?: string) =>
			markers.place(entities, name, requested, escapeAt, undefined),
	);
}

/**
 * Writes one element and its subtree.
 */
function writeNode(
	out: string[],
	node: Node,
	entities: ReadonlyMap<string, Entity>,
	markers: Markers,
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
		// A comment escapes nothing; the `--` check above is what keeps it legal.
		out.push(
			`${pad}<!-- ${mark(node.comment, entities, markers, verbatim)} -->\n`,
		);
	}

	if (hasPlaceholder(node.tag)) {
		throw new TemplateError(
			`Tag ${JSON.stringify(node.tag)} carries a placeholder; content is planted, markup is not`,
		);
	}

	out.push(`${pad}<${node.tag}`);

	for (const [name, value] of Object.entries(node.attrs ?? {})) {
		if (hasPlaceholder(name)) {
			throw new TemplateError(
				`Attribute name ${JSON.stringify(name)} carries a placeholder; values are planted, names are not`,
			);
		}
		// A namespace declaration is markup, not content: it holds a URI rather
		// than anything a document is about, so nothing is planted in it.
		out.push(
			name === "xmlns" || name.startsWith("xmlns:")
				? ` ${name}="${value}"`
				: ` ${name}="${mark(value, entities, markers, escapeWith)}"`,
		);
	}

	const children = node.children ?? [];
	const hasText = node.text !== undefined || node.cdata !== undefined;

	if (!hasText && children.length === 0) {
		out.push(" />\n");
		return;
	}

	out.push(">");

	if (node.text !== undefined) {
		out.push(mark(node.text, entities, markers, escapeWith));
	}

	if (node.cdata !== undefined) {
		// Nothing inside CDATA is escaped, so a value planted here occupies
		// exactly its own bytes — the one place in an XML document where what a
		// parser returns and what the file holds cannot differ.
		out.push(`<![CDATA[${mark(node.cdata, entities, markers, verbatim)}]]>`);
	}

	if (children.length > 0) {
		out.push("\n");
		for (const child of children) {
			writeNode(out, child, entities, markers, depth + 1);
		}
		out.push(pad);
	}

	out.push(`</${node.tag}>\n`);
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

	const markers = new Markers();
	const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
	writeNode(out, template as Node, entities, markers, 0);

	return markers.resolve(out.join(""), modalityId);
}
