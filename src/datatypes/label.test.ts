import { describe, expect, it } from "vitest";
import {
	isLabel,
	LABEL_CATEGORIES,
	LABEL_IDS,
	LABEL_LIST,
	LABELS,
	LABELS_BY_ID,
	labelName,
} from "./label.ts";

describe("LABELS", () => {
	it("has no duplicate ids", () => {
		expect(new Set(LABEL_IDS).size).toBe(LABEL_IDS.length);
	});

	it("covers every category", () => {
		for (const category of LABEL_CATEGORIES) {
			expect(LABELS[category].length).toBeGreaterThan(0);
		}
	});

	it("keeps ids in the lowercase form elide uses", () => {
		for (const id of LABEL_IDS) {
			expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	it("gives every label a non-empty display name", () => {
		for (const label of LABEL_LIST) {
			expect(label.name.length).toBeGreaterThan(0);
		}
	});

	it("tags every label with the category it was listed under", () => {
		for (const category of LABEL_CATEGORIES) {
			for (const label of LABELS[category]) {
				expect(LABELS_BY_ID.get(label.id)?.category).toBe(category);
			}
		}
	});

	it("partitions labels across categories without overlap", () => {
		const counted = LABEL_CATEGORIES.reduce(
			(total, category) => total + LABELS[category].length,
			0,
		);
		expect(counted).toBe(LABEL_LIST.length);
	});
});

describe("isLabel", () => {
	it("accepts known ids", () => {
		expect(isLabel("person_name")).toBe(true);
		expect(isLabel("unresolved")).toBe(true);
	});

	it("rejects unknown ids", () => {
		expect(isLabel("not_a_label")).toBe(false);
		expect(isLabel("")).toBe(false);
	});
});

describe("labelName", () => {
	it("returns the display name for a known label", () => {
		expect(labelName("person_name")).toBe("person name");
	});

	it("falls back to the id, so a report never shows undefined", () => {
		expect(labelName("not_a_label")).toBe("not_a_label");
	});
});
