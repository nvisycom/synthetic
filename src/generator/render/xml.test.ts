import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { sliceByteRange } from "#/util/offset.ts";
import { TemplateError } from "../template.ts";
import { renderXml } from "./xml.ts";

function entity(id: string, value: string): Entity {
	return { id, label: "person_name", value };
}

function slots(...pairs: [string, Entity][]): Map<string, Entity> {
	return new Map(pairs);
}

/** Resolves the entities an XML document escapes with. */
function resolveEntities(fragment: string): string {
	return fragment
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&amp;", "&");
}

/** Asserts both coordinate systems against the rendered document. */
function expectVerifiable(rendered: ReturnType<typeof renderXml>): void {
	for (const occurrence of rendered.occurrences) {
		if (occurrence.location.kind !== "text") continue;

		const decoded = occurrence.location.ranges
			.map((range) => sliceByteRange(rendered.decoded, range))
			.join("");
		expect(decoded).toBe(occurrence.text);

		const raw = (occurrence.location.source ?? [])
			.map((range) => sliceByteRange(rendered.text, range))
			.join("");
		expect(resolveEntities(raw)).toBe(occurrence.text);
	}
}

describe("renderXml", () => {
	it("writes a declaration and a well-formed element", () => {
		const rendered = renderXml(
			{ tag: "person", text: "{{who}}" },
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expect(rendered.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(rendered.text).toContain("<person>Dana Reyes</person>");
		expectVerifiable(rendered);
	});

	it("plants into an attribute", () => {
		// A reader that walks only text nodes never sees this value.
		const rendered = renderXml(
			{ tag: "person", attrs: { email: "{{who}}" } },
			slots(["who", entity("ent_1", "dana@example.com")]),
			"mod_1",
		);
		expect(rendered.text).toContain('email="dana@example.com"');
		expect(rendered.occurrences).toHaveLength(1);
		expectVerifiable(rendered);
	});

	it("plants into a comment", () => {
		// Invisible to a renderer, present in the bytes: a leak here survives
		// every visual review.
		const rendered = renderXml(
			{ tag: "note", comment: "Escalate to {{who}}.", text: "body" },
			slots(["who", entity("ent_1", "dana@example.com")]),
			"mod_1",
		);
		expect(rendered.text).toContain("<!-- Escalate to dana@example.com. -->");
		expectVerifiable(rendered);
	});

	it("plants into CDATA, where nothing is escaped", () => {
		const rendered = renderXml(
			{ tag: "details", cdata: "Card {{who}} on file" },
			slots(["who", entity("ent_1", "4111 1111 1111 1111")]),
			"mod_1",
		);
		expect(rendered.text).toContain(
			"<![CDATA[Card 4111 1111 1111 1111 on file]]>",
		);
		expectVerifiable(rendered);
	});

	it("leaves decoded and source offsets equal inside CDATA", () => {
		// The one place in an XML document where the two coincide, because CDATA
		// escapes nothing.
		const rendered = renderXml(
			{ tag: "d", cdata: "{{who}}" },
			slots(["who", entity("ent_1", "A & B <C>")]),
			"mod_1",
		);
		const location = rendered.occurrences[0]?.location;
		if (location?.kind !== "text") throw new Error("expected text");
		const raw = (location.source ?? [])
			.map((range) => sliceByteRange(rendered.text, range))
			.join("");
		// Written verbatim, entities and all.
		expect(raw).toBe("A & B <C>");
	});

	it("escapes entities in element text and shifts the source offsets", () => {
		const rendered = renderXml(
			{
				tag: "root",
				children: [
					{ tag: "employer", text: "{{org}}" },
					{ tag: "contact", text: "{{who}}" },
				],
			},
			slots(
				["org", entity("ent_1", "Wright & Sons <Holdings>")],
				["who", entity("ent_2", "Dana Reyes")],
			),
			"mod_1",
		);

		expect(rendered.text).toContain("Wright &amp; Sons &lt;Holdings&gt;");
		expectVerifiable(rendered);

		// The entities cost extra bytes, so the value after them sits further into
		// the file than into the decoded text.
		const after = rendered.occurrences[1]?.location;
		if (after?.kind !== "text") throw new Error("expected text");
		expect(after.source?.[0]?.start).toBeGreaterThan(
			after.ranges[0]?.start ?? 0,
		);
	});

	it("escapes a quote inside an attribute", () => {
		const rendered = renderXml(
			{ tag: "p", attrs: { alias: "{{who}}" } },
			slots(["who", entity("ent_1", 'Say "Ace"')]),
			"mod_1",
		);
		expect(rendered.text).toContain("&quot;Ace&quot;");
		expectVerifiable(rendered);
	});

	it("writes a self-closing element when it has no content", () => {
		const rendered = renderXml(
			{ tag: "host", attrs: { address: "{{ip}}" } },
			slots(["ip", entity("ent_1", "192.0.2.1")]),
			"mod_1",
		);
		expect(rendered.text).toContain("/>");
	});

	it("carries a namespace prefix in the element name", () => {
		// A prefixed name is a different string, so a pipeline keying on the plain
		// element name for context loses the boost and the value falls back to its
		// own shape.
		const rendered = renderXml(
			{
				tag: "ns:directory",
				attrs: { "xmlns:c": "urn:example:contact" },
				children: [{ tag: "c:email", text: "{{who}}" }],
			},
			slots(["who", entity("ent_1", "dana@example.com")]),
			"mod_1",
		);

		expect(rendered.text).toContain("<ns:directory");
		expect(rendered.text).toContain("<c:email>dana@example.com</c:email>");
		expectVerifiable(rendered);
	});

	it("recurses into children", () => {
		const rendered = renderXml(
			{
				tag: "a",
				children: [{ tag: "b", children: [{ tag: "c", text: "{{who}}" }] }],
			},
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);
		expect(rendered.occurrences).toHaveLength(1);
		expectVerifiable(rendered);
	});

	it("handles multi-byte values", () => {
		const rendered = renderXml(
			{ tag: "n", text: "Patient {{who}} admitted" },
			slots(["who", entity("ent_1", "田中太郎")]),
			"mod_1",
		);
		expectVerifiable(rendered);
	});

	it("rejects a placeholder in a tag or an attribute name", () => {
		const who = slots(["who", entity("ent_1", "Dana")]);
		expect(() => renderXml({ tag: "{{who}}" }, who, "mod_1")).toThrow(
			/markup is not/,
		);
		expect(() =>
			renderXml({ tag: "a", attrs: { "{{who}}": "v" } }, who, "mod_1"),
		).toThrow(/names are not/);
	});

	it("rejects a node with no tag", () => {
		expect(() => renderXml({ text: "orphan" }, slots(), "mod_1")).toThrow(
			TemplateError,
		);
	});

	it("rejects a comment containing a double hyphen", () => {
		// Not legal XML, and would produce a document no parser accepts.
		expect(() =>
			renderXml({ tag: "a", comment: "bad -- comment" }, slots(), "mod_1"),
		).toThrow(TemplateError);
	});

	it("rejects a template that is not an object", () => {
		expect(() => renderXml("nope", slots(), "mod_1")).toThrow(TemplateError);
	});
});
