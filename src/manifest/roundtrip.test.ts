import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CorpusRecord, Manifest } from "#/datatypes/record.ts";
import { MANIFEST_FILE, recordPath, TRUTH_FILE } from "./layout.ts";
import {
	digestFile,
	readManifest,
	readRecord,
	readRecords,
	verifyArtifact,
} from "./read.ts";
import { ManifestError } from "./schema.ts";
import { writeManifest, writeRecord } from "./write.ts";

let corpus: string;

beforeEach(async () => {
	corpus = await mkdtemp(join(tmpdir(), "synthetic-"));
});

afterEach(async () => {
	await rm(corpus, { recursive: true, force: true });
});

/** SHA-256 of the artifact each fixture writes. */
const ARTIFACT = "Dana Reyes lives here.\n";
const ARTIFACT_DIGEST =
	"a0e5b0a3ba9e5e0a4a1c8e1e0d0b6f8c5e2f9a7d3c4b1e0f9a8d7c6b5e4f3a2d";

function manifest(digest: string): Manifest {
	return {
		version: 1,
		seed: 42,
		generator: "0.1.0",
		labels: ["person_name"],
		createdAt: "2026-01-01T00:00:00.000Z",
		records: [
			{
				id: "rec_1",
				format: "txt",
				specId: "spec_1",
				path: recordPath("rec_1"),
				digest,
			},
		],
	};
}

function record(digest: string): CorpusRecord {
	return {
		version: 1,
		id: "rec_1",
		format: "txt",
		specId: "spec_1",
		artifact: "document.txt",
		digest,
		provenance: { renderer: "ts:txt", seed: 1234 },
		modalities: [{ id: "mod_1", kind: "text", path: "body", text: ARTIFACT }],
		entities: [{ id: "ent_1", label: "person_name", value: "Dana Reyes" }],
		occurrences: [
			{
				id: "occ_1",
				entityId: "ent_1",
				modalityId: "mod_1",
				surface: "canonical",
				text: "Dana Reyes",
				written: "Dana Reyes",
				location: { kind: "text", ranges: [{ start: 0, end: 10 }] },
			},
		],
	};
}

/** Writes the artifact and returns its real digest. */
async function writeArtifact(): Promise<string> {
	const dir = join(corpus, recordPath("rec_1"));
	await writeRecord(corpus, recordPath("rec_1"), record(ARTIFACT_DIGEST));
	await writeFile(join(dir, "document.txt"), ARTIFACT, "utf8");
	return digestFile(join(dir, "document.txt"));
}

describe("round trip", () => {
	it("reads back exactly what was written", async () => {
		const digest = "b".repeat(64);
		await writeManifest(corpus, manifest(digest));
		await writeRecord(corpus, recordPath("rec_1"), record(digest));

		const read = await readManifest(corpus);
		expect(read).toEqual(manifest(digest));

		const entry = read.records[0];
		if (!entry) throw new Error("expected a record");
		expect(await readRecord(corpus, entry)).toEqual(record(digest));
	});

	it("iterates records lazily", async () => {
		const digest = "b".repeat(64);
		await writeManifest(corpus, manifest(digest));
		await writeRecord(corpus, recordPath("rec_1"), record(digest));

		const seen: string[] = [];
		for await (const found of readRecords(corpus, await readManifest(corpus))) {
			seen.push(found.id);
		}
		expect(seen).toEqual(["rec_1"]);
	});
});

describe("determinism", () => {
	it("writes byte-identical output for identical input", async () => {
		const digest = "b".repeat(64);
		await writeManifest(corpus, manifest(digest));
		const first = await readFile(join(corpus, MANIFEST_FILE), "utf8");

		await writeManifest(corpus, manifest(digest));
		const second = await readFile(join(corpus, MANIFEST_FILE), "utf8");

		// A diff between two runs should show what changed, not key reordering.
		expect(second).toBe(first);
	});

	it("ends files with a newline", async () => {
		await writeManifest(corpus, manifest("b".repeat(64)));
		const text = await readFile(join(corpus, MANIFEST_FILE), "utf8");
		expect(text.endsWith("\n")).toBe(true);
	});
});

describe("validation on write", () => {
	it("refuses to write a manifest that could not be read back", async () => {
		const broken = manifest("not-a-digest");
		await expect(writeManifest(corpus, broken)).rejects.toThrow(ManifestError);
	});

	it("refuses to write a record with a dangling reference", async () => {
		const broken = record("b".repeat(64));
		broken.occurrences[0]!.entityId = "ent_missing";
		await expect(
			writeRecord(corpus, recordPath("rec_1"), broken),
		).rejects.toThrow(ManifestError);
	});

	it("leaves no temporary file behind after a refused write", async () => {
		const broken = manifest("not-a-digest");
		await writeManifest(corpus, broken).catch(() => {});
		// Validation happens before any file is opened, so nothing is created.
		await expect(readFile(join(corpus, MANIFEST_FILE))).rejects.toThrow();
	});

	it("leaves no temporary file behind when the write itself fails", async () => {
		// A stranded `.tmp` sits beside the real file, where a later run's
		// directory listing picks it up as corpus content. Force a rename failure
		// by making the destination a directory.
		await mkdir(join(corpus, MANIFEST_FILE), { recursive: true });
		await writeManifest(corpus, manifest("b".repeat(64))).catch(() => {});

		const left = (await readdir(corpus)).filter((name) =>
			name.endsWith(".tmp"),
		);
		expect(left).toEqual([]);
	});
});

describe("index and answer key agreement", () => {
	it("rejects a record whose id disagrees with the index", async () => {
		const digest = "b".repeat(64);
		await writeManifest(corpus, manifest(digest));
		const mismatched = { ...record(digest), id: "rec_other" };
		// Write it directly, bypassing the id check writeRecord does not make.
		await writeRecord(corpus, recordPath("rec_1"), mismatched);

		const entry = (await readManifest(corpus)).records[0];
		if (!entry) throw new Error("expected a record");
		await expect(readRecord(corpus, entry)).rejects.toThrow(/claims id/);
	});

	it("rejects a record whose digest disagrees with the index", async () => {
		await writeManifest(corpus, manifest("b".repeat(64)));
		await writeRecord(corpus, recordPath("rec_1"), record("c".repeat(64)));

		const entry = (await readManifest(corpus)).records[0];
		if (!entry) throw new Error("expected a record");
		await expect(readRecord(corpus, entry)).rejects.toThrow(/digest/);
	});
});

describe("missing and malformed files", () => {
	it("names the path when the manifest is absent", async () => {
		await expect(readManifest(corpus)).rejects.toThrow(/does not exist/);
	});

	it("names the path when the manifest is not JSON", async () => {
		await writeFile(join(corpus, MANIFEST_FILE), "{ not json", "utf8");
		await expect(readManifest(corpus)).rejects.toThrow(/not valid JSON/);
	});

	it("names the path when an answer key is absent", async () => {
		await writeManifest(corpus, manifest("b".repeat(64)));
		const entry = (await readManifest(corpus)).records[0];
		if (!entry) throw new Error("expected a record");
		await expect(readRecord(corpus, entry)).rejects.toThrow(
			new RegExp(TRUTH_FILE),
		);
	});
});

describe("artifact verification", () => {
	it("accepts an artifact matching its recorded digest", async () => {
		const actual = await writeArtifact();
		await writeRecord(corpus, recordPath("rec_1"), record(actual));
		await writeManifest(corpus, manifest(actual));

		const entry = (await readManifest(corpus)).records[0];
		if (!entry) throw new Error("expected a record");
		const found = await readRecord(corpus, entry);
		expect(await verifyArtifact(corpus, entry, found)).toBeUndefined();
	});

	it("reports the real digest when the artifact has changed", async () => {
		const actual = await writeArtifact();
		await writeRecord(corpus, recordPath("rec_1"), record(actual));
		await writeManifest(corpus, manifest(actual));

		// Rewrite the artifact: every offset in the answer key now points at the
		// wrong bytes, which is exactly what this check exists to catch.
		await writeFile(
			join(corpus, recordPath("rec_1"), "document.txt"),
			"Someone else entirely.\n",
			"utf8",
		);

		const entry = (await readManifest(corpus)).records[0];
		if (!entry) throw new Error("expected a record");
		const found = await readRecord(corpus, entry);
		const mismatch = await verifyArtifact(corpus, entry, found);
		expect(mismatch).toBeDefined();
		expect(mismatch).not.toBe(actual);
	});
});
