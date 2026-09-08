import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { TemplateError } from "../template.ts";
import { expectVerifiable } from "./verifiable.ts";
import { renderXml } from "./xml.ts";

function entity(id: string, value: string): Entity {
	return { id, label: "person_name", value };
}

function slots(...pairs: [string, Entity][]): Map<string, Entity> {
	return new Map(pairs);
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

	it("writes a value verbatim inside CDATA", () => {
		// CDATA escapes nothing, so a value planted there occupies exactly its own
		// bytes — the one context where the range and the value have equal width.
		const rendered = renderXml(
			{ tag: "d", cdata: "{{who}}" },
			slots(["who", entity("ent_1", "A & B <C>")]),
			"mod_1",
		);

		expectVerifiable(rendered);

		const occurrence = rendered.occurrences[0];
		if (occurrence?.location.kind !== "text") {
			throw new Error("expected text");
		}
		// Entities and all, unescaped.
		expect(occurrence.written).toBe("A & B <C>");
		expect(occurrence.written).toBe(occurrence.text);
		expect(rendered.text).toContain("<![CDATA[A & B <C>]]>");
	});
	it("covers the escaped bytes in element text", () => {
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

		const org = rendered.occurrences[0];
		if (org?.location.kind !== "text") throw new Error("expected text");
		expect(org.text).toBe("Wright & Sons <Holdings>");
		expect(org.written).toBe("Wright &amp; Sons &lt;Holdings&gt;");

		// The range is the escaped width, which is what a redactor overwrites.
		const [range] = org.location.ranges;
		expect(range.end - range.start).toBe(org.written.length);
		expect(range.end - range.start).toBeGreaterThan(org.text.length);

		// And the next value sits past those extra bytes.
		const who = rendered.occurrences[1];
		if (who?.location.kind !== "text") throw new Error("expected text");
		expect(who.location.ranges[0].start).toBeGreaterThan(range.end);
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

	it("plants nothing in a namespace declaration", () => {
		// A URI is markup rather than content: it holds nothing a document is
		// about, so no value is planted in one and no range covers it.
		const rendered = renderXml(
			{
				tag: "ns:d",
				attrs: { "xmlns:ns": "urn:example:directory", id: "{{who}}" },
				children: [{ tag: "c", text: "{{who}}" }],
			},
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);

		expect(rendered.text).toContain('xmlns:ns="urn:example:directory"');
		expectVerifiable(rendered);

		// One occurrence for the ordinary attribute, one for the element text --
		// and none for the namespace.
		expect(rendered.occurrences).toHaveLength(2);
		for (const occurrence of rendered.occurrences) {
			if (occurrence.location.kind !== "text") throw new Error("expected text");
			const [range] = occurrence.location.ranges;
			expect(rendered.text.slice(range.start, range.end)).toBe("Dana");
		}
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
