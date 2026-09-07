/**
 * @fileoverview End-to-end generation against the repository's own specs.
 *
 * Deliberately black box. It runs the CLI as a subprocess and then reads the
 * corpus the way any consumer would — parsing JSON and slicing bytes with
 * nothing from `src/` — so it tests the artifact rather than the code that
 * produced it. Importing the harness's own reader would let a matching bug in
 * the writer and the reader agree with itself and pass, and would make a fault
 * in an offset helper surface here as a generation failure.
 *
 * What it is for is the class of failure the unit tests structurally cannot
 * see: a spec in `data/` that is wrong rather than code that is. A missing
 * `format`, a template naming a surface its slot never declares, a label
 * outside the taxonomy — all three shipped past a green unit suite during
 * development and only appeared when the generator was actually run.
 *
 * Offset arithmetic per format is covered by the renderer tests. This asserts
 * only that a generated corpus is internally consistent and reproducible.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CorpusRecord, Manifest } from "#/datatypes/record.ts";

const run = promisify(execFile);

/** The repository root, from this file's location. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Enough records that every spec is used at least once. */
const RECORDS = 22;

/**
 * A corpus as read from disk.
 *
 * The shapes are imported rather than restated: a type is erased at runtime, so
 * it cannot make a bug in the writer agree with a matching bug in the reader —
 * which is the only reason this file avoids `src/` at all. Restating them would
 * just be a second declaration to keep in step.
 *
 * What stays out is the harness's *logic*: the manifest reader, the offset
 * helpers, the digest utility. Those are reimplemented or replaced with
 * node built-ins below, so an assertion here is independent of the code it
 * checks.
 */
interface Corpus {
	manifest: Manifest;
	records: { truth: CorpusRecord; file: string }[];
}

let out: string;
let corpus: Corpus;

/** Generates a corpus into a fresh directory and returns its path. */
async function generate(seed: string, records: string): Promise<string> {
	const target = await mkdtemp(join(tmpdir(), "synthetic-e2e-"));
	await run(
		process.execPath,
		[
			"--experimental-strip-types",
			join(ROOT, "src/main.ts"),
			"generate",
			"--data",
			join(ROOT, "data"),
			"--out",
			target,
			"--seed",
			seed,
			"--records",
			records,
		],
		{ cwd: ROOT },
	);
	return target;
}

/** Reads a corpus from disk, as a consumer would. */
async function read(dir: string): Promise<Corpus> {
	const manifest = JSON.parse(
		await readFile(join(dir, "manifest.json"), "utf8"),
	) as Manifest;

	const records = await Promise.all(
		manifest.records.map(async (entry) => {
			const truth = JSON.parse(
				await readFile(join(dir, entry.path, "truth.json"), "utf8"),
			) as CorpusRecord;
			return {
				truth,
				file: await readFile(join(dir, entry.path, truth.artifact), "utf8"),
			};
		}),
	);

	return { manifest, records };
}

beforeAll(async () => {
	// Run from source rather than requiring a build first, so the suite works on
	// a clean checkout. This is also the path `npm start` takes, where a
	// construct Node's type stripping rejects fails and vitest's would not.
	out = await generate("20260314", String(RECORDS));
	corpus = await read(out);
}, 60_000);

afterAll(async () => {
	await rm(out, { recursive: true, force: true });
});

describe("generate, end to end", () => {
	it("writes a manifest naming the seed it was given", () => {
		expect(corpus.manifest.version).toBe(1);
		expect(corpus.manifest.seed).toBe(20260314);
		expect(corpus.manifest.records).toHaveLength(RECORDS);
	});

	it("uses every spec in data/", async () => {
		// A spec that never renders is a spec nobody notices is broken.
		const available = (
			await readdir(join(ROOT, "data/specs"), { withFileTypes: true })
		)
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);

		const used = new Set(corpus.records.map(({ truth }) => truth.specId));
		expect([...used].sort()).toEqual(available.sort());
	});

	it("covers every renderable format", () => {
		const formats = new Set(corpus.records.map(({ truth }) => truth.format));
		expect(formats).toEqual(new Set(["txt", "json", "csv", "xml"]));
	});

	it("agrees between the index and each answer key", () => {
		// They are written separately, so they can disagree — a half-finished run,
		// a hand edit, two corpora merged.
		for (const [index, entry] of corpus.manifest.records.entries()) {
			const truth = corpus.records[index]?.truth;
			expect(truth?.id).toBe(entry.id);
			expect(truth?.digest).toBe(entry.digest);
			expect(truth?.format).toBe(entry.format);
		}
	});

	it("matches every artifact to its recorded digest", async () => {
		// Hashed independently rather than through the harness's own helper.
		const { createHash } = await import("node:crypto");
		for (const { truth, file } of corpus.records) {
			const digest = createHash("sha256").update(file, "utf8").digest("hex");
			expect(digest).toBe(truth.digest);
		}
	});

	it("links every occurrence to an entity and a modality of its record", () => {
		for (const { truth } of corpus.records) {
			const entities = new Set(truth.entities.map((entity) => entity.id));
			const modalities = new Set(truth.modalities.map((m) => m.id));
			for (const occurrence of truth.occurrences) {
				expect(entities).toContain(occurrence.entityId);
				expect(modalities).toContain(occurrence.modalityId);
			}
		}
	});

	it("plants every entity at least once", () => {
		// An entity with no occurrence sits in the answer key as a value the
		// pipeline missed but that was never in the document.
		for (const { truth } of corpus.records) {
			const planted = new Set(truth.occurrences.map((o) => o.entityId));
			for (const entity of truth.entities) {
				expect(planted).toContain(entity.id);
			}
		}
	});

	it("writes a non-empty artifact for every record", () => {
		// Format correctness is the renderers' own business, and their tests
		// assert it per format. What matters here is that the flow reached disk:
		// a spec was loaded, a record was generated, and bytes were written.
		for (const { truth, file } of corpus.records) {
			expect(
				file.length,
				`${truth.id} wrote an empty artifact`,
			).toBeGreaterThan(0);
			expect(truth.artifact).toBe(`document.${truth.format}`);
			expect(truth.occurrences.length).toBeGreaterThan(0);
		}
	});

	it("plants values the pipeline must not detect", () => {
		// Without these the corpus measures recall only, and a pipeline that
		// redacts everything scores perfectly.
		const ignored = corpus.records.flatMap(({ truth }) =>
			truth.entities.filter((entity) => entity.expect === "ignored"),
		);
		expect(ignored.length).toBeGreaterThan(0);
	});

	it("plants adversarial values", () => {
		const adversarial = corpus.records.flatMap(({ truth }) =>
			truth.entities.filter((entity) => entity.adversarial !== undefined),
		);
		expect(adversarial.length).toBeGreaterThan(0);
	});

	it("gives the same corpus for the same seed", async () => {
		// If this ever fails, every score the harness has produced is
		// incomparable to every other.
		const second = await generate("20260314", String(RECORDS));
		try {
			const repeat = await read(second);
			expect(repeat.manifest.records).toEqual(corpus.manifest.records);
			for (const [index, { truth, file }] of corpus.records.entries()) {
				expect(repeat.records[index]?.truth).toEqual(truth);
				expect(repeat.records[index]?.file).toBe(file);
			}
		} finally {
			await rm(second, { recursive: true, force: true });
		}
	}, 60_000);

	it("gives a different corpus for a different seed", async () => {
		const other = await generate("20260315", "3");
		try {
			const changed = await read(other);
			expect(changed.records[0]?.truth.digest).not.toBe(
				corpus.records[0]?.truth.digest,
			);
		} finally {
			await rm(other, { recursive: true, force: true });
		}
	}, 60_000);
});
