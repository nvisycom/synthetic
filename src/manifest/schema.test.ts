import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { Entity } from "#/datatypes/entity.ts";
import type {
	CorpusRecord,
	Manifest,
	Modality,
	Occurrence,
} from "#/datatypes/record.ts";
import {
	type CorpusRecordSchema,
	type EntitySchema,
	ManifestError,
	type ManifestSchema,
	type ModalitySchema,
	type OccurrenceSchema,
	parseManifest,
	parseRecord,
} from "./schema.ts";

/**
 * Mutual assignability. Two independent declarations of one shape are exactly
 * the drift this asserts against: a field added to an interface but not its
 * schema would pass validation and then be silently absent, and the reverse
 * would be rejected at read time for no visible reason.
 *
 * These are compile-time assertions; if they hold, `npm run typecheck` passes
 * and the runtime body of the test is a formality.
 */
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const manifestMatches: Eq<z.infer<typeof ManifestSchema>, Manifest> = true;
const recordMatches: Eq<
	z.infer<typeof CorpusRecordSchema>,
	CorpusRecord
> = true;
const entityMatches: Eq<z.infer<typeof EntitySchema>, Entity> = true;
const occurrenceMatches: Eq<
	z.infer<typeof OccurrenceSchema>,
	Occurrence
> = true;
const modalityMatches: Eq<z.infer<typeof ModalitySchema>, Modality> = true;

/**
 * A minimal valid manifest, for tests to break in one specific way each.
 */
function validManifest(): unknown {
	return {
		version: 1,
		seed: 42,
		generator: "0.1.0",
		createdAt: "2026-01-01T00:00:00.000Z",
		records: [
			{
				id: "rec_1",
				format: "txt",
				specId: "spec_1",
				path: "records/rec_1",
				digest: "a".repeat(64),
			},
		],
	};
}

/**
 * A minimal valid answer key, for tests to break one way each.
 */
function validRecord(): unknown {
	return {
		version: 1,
		id: "rec_1",
		format: "txt",
		specId: "spec_1",
		artifact: "document.txt",
		digest: "a".repeat(64),
		provenance: { renderer: "ts:txt", seed: 1234 },
		modalities: [{ id: "mod_1", kind: "text", path: "body", text: "hi" }],
		entities: [{ id: "ent_1", label: "person_name", value: "Dana Reyes" }],
		occurrences: [
			{
				id: "occ_1",
				entityId: "ent_1",
				modalityId: "mod_1",
				surface: "canonical",
				text: "Dana Reyes",
				location: { kind: "text", ranges: [{ start: 0, end: 10 }] },
			},
		],
	};
}

/**
 * Applies a change to a copy of the valid manifest.
 */
function withManifest(mutate: (manifest: never) => void): unknown {
	const manifest = validManifest();
	mutate(manifest as never);
	return manifest;
}

/**
 * Applies a change to a copy of the valid answer key.
 */
function withRecord(mutate: (record: never) => void): unknown {
	const record = validRecord();
	mutate(record as never);
	return record;
}

describe("schema and interface agreement", () => {
	it("keeps every schema in step with its interface", () => {
		expect([
			manifestMatches,
			recordMatches,
			entityMatches,
			occurrenceMatches,
			modalityMatches,
		]).toEqual([true, true, true, true, true]);
	});
});

describe("under Node's type stripping", () => {
	it("loads from source, as the CLI runs it", () => {
		// Vitest transpiles, so a construct Node cannot strip (a parameter
		// property, an enum) passes here while crashing the real CLI. Import the
		// module the way `npm start` does, to catch that.
		const source = `
			import { ManifestError, parseManifest } from "./src/manifest/schema.ts";
			try {
				parseManifest({});
			} catch (error) {
				if (!(error instanceof ManifestError)) throw error;
				console.log("ok", error.issues.length > 0);
			}
		`;
		const output = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--input-type=module", "--eval", source],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
		expect(output.trim()).toBe("ok true");
	});
});

describe("parseManifest", () => {
	it("accepts a well-formed manifest", () => {
		const manifest = parseManifest(validManifest());
		expect(manifest.records).toHaveLength(1);
		expect(manifest.records[0]?.id).toBe("rec_1");
	});

	it("indexes records without carrying their ground truth", () => {
		// The point of the split: the index stays small enough to read in full,
		// so planning a run never means parsing every entity in the corpus.
		const entry = parseManifest(validManifest()).records[0];
		expect(entry).not.toHaveProperty("entities");
		expect(entry).not.toHaveProperty("occurrences");
	});

	it("throws ManifestError rather than a raw zod error", () => {
		expect(() => parseManifest({})).toThrow(ManifestError);
	});

	it("reports every problem at once, not just the first", () => {
		try {
			parseManifest({ version: 1, seed: "nope", generator: "", records: [] });
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(ManifestError);
			expect((error as ManifestError).issues.length).toBeGreaterThan(1);
		}
	});

	it("names the failing path in each issue", () => {
		try {
			parseManifest(
				withManifest((m: never) => {
					(m as { seed: unknown }).seed = "not a number";
				}),
			);
			expect.unreachable("should have thrown");
		} catch (error) {
			expect((error as ManifestError).issues.join("\n")).toContain("seed");
		}
	});
});

describe("version", () => {
	it("refuses an unknown version rather than guessing at the layout", () => {
		expect(() =>
			parseManifest(
				withManifest((m: never) => {
					(m as { version: unknown }).version = 2;
				}),
			),
		).toThrow(ManifestError);
	});
});

describe("strictness", () => {
	it("rejects an unrecognized top-level field", () => {
		expect(() =>
			parseManifest(
				withManifest((m: never) => {
					(m as Record<string, unknown>).extra = true;
				}),
			),
		).toThrow(ManifestError);
	});

	it("rejects an unrecognized field on a record", () => {
		expect(() =>
			parseManifest(
				withManifest((m: never) => {
					const record = (m as { records: Record<string, unknown>[] })
						.records[0] as Record<string, unknown>;
					record.extra = true;
				}),
			),
		).toThrow(ManifestError);
	});
});

describe("parseRecord", () => {
	it("accepts a well-formed answer key", () => {
		const record = parseRecord(validRecord());
		expect(record.entities[0]?.label).toBe("person_name");
		expect(record.provenance.renderer).toBe("ts:txt");
	});

	it("reads on its own, carrying its own version", () => {
		// A truth file is opened without the index beside it, so it has to say
		// what it is.
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					(r as { version: unknown }).version = 2;
				}),
			),
		).toThrow(ManifestError);
	});

	it("records how it was produced", () => {
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					delete (r as { provenance?: unknown }).provenance;
				}),
			),
		).toThrow(ManifestError);
	});
});

describe("labels", () => {
	it("rejects a label outside the taxonomy", () => {
		// The failure this catches: a planted label no pipeline can emit would
		// otherwise read as a total recall miss rather than a bad answer key.
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					const entity = (r as { entities: { label: string }[] }).entities[0];
					if (entity) entity.label = "ssn";
				}),
			),
		).toThrow(ManifestError);
	});
});

describe("referential integrity", () => {
	it("rejects an occurrence pointing at a missing entity", () => {
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					const occurrence = (r as { occurrences: { entityId: string }[] })
						.occurrences[0];
					if (occurrence) occurrence.entityId = "ent_missing";
				}),
			),
		).toThrow(ManifestError);
	});

	it("rejects an occurrence pointing at a missing modality", () => {
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					const occurrence = (r as { occurrences: { modalityId: string }[] })
						.occurrences[0];
					if (occurrence) occurrence.modalityId = "mod_missing";
				}),
			),
		).toThrow(ManifestError);
	});

	it("rejects duplicate entity ids within a record", () => {
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					const record = r as { entities: unknown[] };
					record.entities.push({ ...(record.entities[0] as object) });
				}),
			),
		).toThrow(ManifestError);
	});

	it("rejects duplicate occurrence ids within a record", () => {
		expect(() =>
			parseRecord(
				withRecord((r: never) => {
					const record = r as { occurrences: unknown[] };
					record.occurrences.push({ ...(record.occurrences[0] as object) });
				}),
			),
		).toThrow(ManifestError);
	});

	it("rejects duplicate record ids in the index", () => {
		expect(() =>
			parseManifest(
				withManifest((m: never) => {
					const manifest = m as { records: unknown[] };
					manifest.records.push({ ...(manifest.records[0] as object) });
				}),
			),
		).toThrow(ManifestError);
	});
});

describe("ranges", () => {
	/** Replaces the first occurrence's ranges. */
	function withRanges(ranges: unknown[]): unknown {
		return withRecord((r: never) => {
			const location = (
				r as { occurrences: { location: { ranges: unknown[] } }[] }
			).occurrences[0]?.location;
			if (location) location.ranges = ranges;
		});
	}

	it("rejects an inverted range", () => {
		expect(() => parseRecord(withRanges([{ start: 10, end: 5 }]))).toThrow(
			ManifestError,
		);
	});

	it("rejects a negative offset", () => {
		expect(() => parseRecord(withRanges([{ start: -1, end: 5 }]))).toThrow(
			ManifestError,
		);
	});

	it("rejects a location with no ranges at all", () => {
		expect(() => parseRecord(withRanges([]))).toThrow(ManifestError);
	});

	it("accepts an empty range, which marks a zero-width position", () => {
		expect(() => parseRecord(withRanges([{ start: 3, end: 3 }]))).not.toThrow();
	});

	it("accepts a value split across a boundary", () => {
		// Two disjoint ranges: the case a pipeline matching within one line
		// misses, and the reason ranges are a list rather than a single span.
		expect(() =>
			parseRecord(
				withRanges([
					{ start: 0, end: 4 },
					{ start: 10, end: 16 },
				]),
			),
		).not.toThrow();
	});
});

describe("digest", () => {
	it("rejects anything that is not a SHA-256 hex", () => {
		for (const digest of ["", "abc", "A".repeat(64), "a".repeat(63)]) {
			expect(() =>
				parseRecord(
					withRecord((r: never) => {
						(r as { digest: string }).digest = digest;
					}),
				),
			).toThrow(ManifestError);
		}
	});
});
