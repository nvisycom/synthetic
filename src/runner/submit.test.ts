import type { Audit } from "@nvisy/sdk/datatypes";
import { describe, expect, it } from "vitest";
import { readAnalysis } from "./submit.ts";

/** A minimal analysis report, shaped as the API returns one. */
function analysis(entities: unknown[]): Audit {
	return {
		report: { parts: [{ modality: "text", id: ["document.txt"], entities }] },
		context: {},
		codec: {},
		usage: {},
	} as unknown as Audit;
}

function entity(over: Record<string, unknown> = {}): unknown {
	return {
		id: "ent-1",
		label: "person_name",
		confidence: 0.8,
		location: { coord: { kind: "decoded", range: { start: 4, end: 14 } } },
		audit: [{ source: "pattern" }],
		...over,
	};
}

describe("readAnalysis", () => {
	it("reads a text entity's decoded range", () => {
		const [found] = readAnalysis(analysis([entity()]));
		expect(found?.label).toBe("person_name");
		expect(found?.location).toEqual({
			kind: "text",
			ranges: [{ start: 4, end: 14 }],
		});
		expect(found?.confidence).toBe(0.8);
		expect(found?.recognizer).toBe("pattern");
	});

	it("keeps a label the harness does not know", () => {
		// A newer catalog or a custom recognizer is a fact worth reporting, not
		// one to drop at read time.
		const [found] = readAnalysis(analysis([entity({ label: "custom_thing" })]));
		expect(found?.label).toBe("custom_thing");
	});

	it("skips a source-only coordinate", () => {
		// No decoded range means nothing to compare against ground truth, so it
		// is left for the scorer to report rather than guessed at here.
		const found = readAnalysis(
			analysis([
				entity({ location: { coord: { kind: "source", source: [] } } }),
			]),
		);
		expect(found).toEqual([]);
	});

	it("skips a part that is not text", () => {
		const report = {
			report: { parts: [{ modality: "image", id: ["x.png"], entities: [{}] }] },
		} as unknown as Audit;
		expect(readAnalysis(report)).toEqual([]);
	});

	it("reads every entity in a part", () => {
		const found = readAnalysis(
			analysis([entity(), entity({ id: "ent-2", label: "email_address" })]),
		);
		expect(found).toHaveLength(2);
	});

	it("omits the recognizer when the audit trail is empty", () => {
		const [found] = readAnalysis(analysis([entity({ audit: [] })]));
		expect(found?.recognizer).toBeUndefined();
	});
});
