import { describe, expect, it } from "vitest";
import type { Entity } from "#/datatypes/entity.ts";
import { TemplateError } from "../template.ts";
import { renderJson } from "./json.ts";
import { expectVerifiable as expectVerifiableIn } from "./verifiable.ts";

/** Asserts the ranges, and that the document still parses as JSON. */
function expectVerifiable(rendered: ReturnType<typeof renderJson>): void {
	expectVerifiableIn(rendered, JSON.parse);
}

function entity(
	id: string,
	value: string,
	variants?: Entity["variants"],
): Entity {
	return { id, label: "person_name", value, ...(variants ? { variants } : {}) };
}

function slots(...pairs: [string, Entity][]): Map<string, Entity> {
	return new Map(pairs);
}

describe("renderJson", () => {
	it("produces valid JSON", () => {
		const rendered = renderJson(
			{ name: "{{who}}" },
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expect(() => JSON.parse(rendered.text)).not.toThrow();
		expect(JSON.parse(rendered.text)).toEqual({ name: "Dana Reyes" });
	});

	it("records both coordinate systems", () => {
		const rendered = renderJson(
			{ name: "{{who}}" },
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);
		expectVerifiable(rendered);
	});

	it("covers the escaped bytes, not the value's own width", () => {
		// The case that decides what a range means. `Say "Ace" Delgado` is 17
		// characters but reaches disk as 21 bytes, the two quotes having become
		// `\"`. A redactor overwriting 17 leaves a stray quote behind, so the range
		// has to be the wider one.
		const rendered = renderJson(
			{ alias: "{{alias}}", note: "About {{who}}." },
			slots(
				["alias", entity("ent_1", 'Say "Ace" Delgado')],
				["who", entity("ent_2", "Dana Reyes")],
			),
			"mod_1",
		);

		expectVerifiable(rendered);

		const alias = rendered.occurrences[0];
		if (alias?.location.kind !== "text") {
			throw new Error("expected a text location");
		}
		expect(alias.text).toBe('Say "Ace" Delgado');
		expect(alias.written).toBe('Say \\"Ace\\" Delgado');

		const [range] = alias.location.ranges;
		expect(range.end - range.start).toBe(alias.written.length);
		expect(range.end - range.start).toBe(alias.text.length + 2);

		// And the value after it is placed past those extra bytes, rather than
		// where an unescaped document would have put it.
		const who = rendered.occurrences[1];
		if (who?.location.kind !== "text") {
			throw new Error("expected a text location");
		}
		expect(who.location.ranges[0].start).toBeGreaterThan(range.end);
	});

	it("escapes a value containing quotes and backslashes", () => {
		const rendered = renderJson(
			{ raw: "{{v}}" },
			slots(["v", entity("ent_1", 'back\\slash and "quotes"')]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text).raw).toBe('back\\slash and "quotes"');
		expectVerifiable(rendered);
	});

	it("plants into nested objects and arrays", () => {
		const rendered = renderJson(
			{
				customer: { name: "{{who}}" },
				notes: ["First {{who}}.", "Second {{who}}."],
			},
			slots(["who", entity("ent_1", "Dana Reyes")]),
			"mod_1",
		);

		expect(rendered.occurrences).toHaveLength(3);
		expectVerifiable(rendered);
	});

	it("handles multi-byte values", () => {
		const rendered = renderJson(
			{ name: "{{who}}", note: "Seen: {{who}}" },
			slots(["who", entity("ent_1", "田中太郎")]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text).name).toBe("田中太郎");
		expectVerifiable(rendered);
	});

	it("writes a requested surface form", () => {
		const rendered = renderJson(
			{ full: "{{who}}", short: "{{who:signature}}" },
			slots(["who", entity("ent_1", "Dana Reyes", { signature: "D.R." })]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text)).toEqual({
			full: "Dana Reyes",
			short: "D.R.",
		});
		expectVerifiable(rendered);
	});

	it("leaves numbers, booleans, and null alone", () => {
		const rendered = renderJson(
			{ count: 3, open: false, closed: null, who: "{{who}}" },
			slots(["who", entity("ent_1", "Dana")]),
			"mod_1",
		);
		expect(JSON.parse(rendered.text)).toEqual({
			count: 3,
			open: false,
			closed: null,
			who: "Dana",
		});
	});

	it("rejects a placeholder in a key", () => {
		// It would be written verbatim and plant nothing, leaving a spec that
		// looks correct and a document that is not.
		expect(() =>
			renderJson(
				{ "{{who}}": "value" },
				slots(["who", entity("ent_1", "Dana")]),
				"mod_1",
			),
		).toThrow(/keys are not/);
	});

	it("rejects a template that is not a container", () => {
		expect(() => renderJson("just a string", slots(), "mod_1")).toThrow(
			TemplateError,
		);
	});

	it("rejects a placeholder naming an undeclared slot", () => {
		expect(() => renderJson({ a: "{{missing}}" }, slots(), "mod_1")).toThrow(
			TemplateError,
		);
	});
});
