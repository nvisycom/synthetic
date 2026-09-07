import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readManifest, readRecord, verifyArtifact } from "#/manifest/read.ts";
import { sliceByteRange } from "#/util/offset.ts";
import { runGenerate } from "./generate.ts";
import type { RecordSpec } from "./spec.ts";

let work: string;
let data: string;
let out: string;

beforeEach(async () => {
	work = await mkdtemp(join(tmpdir(), "synthetic-gen-"));
	data = join(work, "data");
	out = join(work, "corpus");
	await mkdir(join(data, "specs"), { recursive: true });
});

afterEach(async () => {
	await rm(work, { recursive: true, force: true });
});

const SPEC: RecordSpec = {
	version: 1,
	id: "test-letter",
	description: "One subject written three ways, plus a structured identifier.",
	format: "txt",
	slots: [
		{
			name: "subject",
			label: "person_name",
			surfaces: ["canonical", "abbreviated", "signature"],
		},
		{ name: "id", label: "government_id" },
	],
};

const TEMPLATE = `Dear {{subject}},

Your reference is {{id}}.
Filed for {{subject:abbreviated}}.

{{subject:signature}}
`;

/**
 * Writes a spec as the directory the loader expects: `spec.json` beside the
 * template it names.
 */
async function writeSpec(
	spec: RecordSpec = SPEC,
	template: string = TEMPLATE,
): Promise<void> {
	const dir = join(data, "specs", spec.id);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "spec.json"),
		JSON.stringify(spec, null, 2),
		"utf8",
	);
	await writeFile(join(dir, spec.template ?? "template.txt"), template, "utf8");
}

function options(overrides: Partial<Parameters<typeof runGenerate>[0]> = {}) {
	return { data, out, seed: "42", records: "3", ...overrides };
}

describe("runGenerate", () => {
	it("writes an artifact and an answer key per record", async () => {
		await writeSpec();
		await runGenerate(options());

		const manifest = await readManifest(out);
		expect(manifest.records).toHaveLength(3);
		expect(manifest.seed).toBe(42);
	});

	it("produces ground truth that slices back out of the real artifact", async () => {
		// The property the whole benchmark rests on: read the corpus back from
		// disk exactly as the scorer will, and check every recorded offset against
		// the bytes actually on disk.
		await writeSpec();
		await runGenerate(options());

		const manifest = await readManifest(out);
		let checked = 0;

		for (const entry of manifest.records) {
			const record = await readRecord(out, entry);
			expect(await verifyArtifact(out, entry, record)).toBeUndefined();

			const text = await readFile(
				join(out, entry.path, record.artifact),
				"utf8",
			);
			for (const occurrence of record.occurrences) {
				if (occurrence.location.kind !== "text") continue;
				const found = occurrence.location.ranges
					.map((range) => sliceByteRange(text, range))
					.join("");
				expect(found).toBe(occurrence.text);
				checked++;
			}
		}

		expect(checked).toBeGreaterThan(0);
	});

	it("plants one subject several ways, all tracing to one entity", async () => {
		await writeSpec();
		await runGenerate(options({ records: "1" }));

		const manifest = await readManifest(out);
		const entry = manifest.records[0];
		if (!entry) throw new Error("expected a record");
		const record = await readRecord(out, entry);

		const subject = record.entities.find((e) => e.label === "person_name");
		if (!subject) throw new Error("expected a person");

		const forms = record.occurrences
			.filter((o) => o.entityId === subject.id)
			.map((o) => o.surface);
		expect(new Set(forms)).toEqual(
			new Set(["canonical", "abbreviated", "signature"]),
		);
	});

	it("is reproducible: one seed always gives one corpus", async () => {
		await writeSpec();

		await runGenerate(options());
		const first = await readFile(
			join(out, "records/rec_0001/document.txt"),
			"utf8",
		);

		await rm(out, { recursive: true, force: true });
		await runGenerate(options());
		const second = await readFile(
			join(out, "records/rec_0001/document.txt"),
			"utf8",
		);

		expect(second).toBe(first);
	});

	it("gives different corpora for different seeds", async () => {
		await writeSpec();

		await runGenerate(options({ seed: "42" }));
		const first = await readFile(
			join(out, "records/rec_0001/document.txt"),
			"utf8",
		);

		await rm(out, { recursive: true, force: true });
		await runGenerate(options({ seed: "43" }));
		const second = await readFile(
			join(out, "records/rec_0001/document.txt"),
			"utf8",
		);

		expect(second).not.toBe(first);
	});

	it("leaves earlier records untouched when more are generated", async () => {
		// What forking buys: generating five records must not shift the three
		// that a previous run produced, or a corpus would stop being comparable
		// to itself as it grows.
		await writeSpec();

		await runGenerate(options({ records: "3" }));
		const before = await readFile(
			join(out, "records/rec_0002/document.txt"),
			"utf8",
		);

		await rm(out, { recursive: true, force: true });
		await runGenerate(options({ records: "5" }));
		const after = await readFile(
			join(out, "records/rec_0002/document.txt"),
			"utf8",
		);

		expect(after).toBe(before);
	});

	it("refuses a spec whose template names an undeclared slot", async () => {
		await writeSpec(SPEC, "Dear {{nobody}},\n");
		await expect(runGenerate(options())).rejects.toThrow(/not declared/);
	});

	it("refuses a spec with a slot that is never planted", async () => {
		// An unplanted slot would sit in the answer key with no occurrence,
		// scoring as a value the pipeline missed but that was never there.
		await writeSpec(SPEC, "Reference {{id}} only.\n");
		await expect(runGenerate(options())).rejects.toThrow(/never planted/);
	});

	it("rejects a non-integer seed rather than coercing it", async () => {
		await writeSpec();
		await expect(runGenerate(options({ seed: "" }))).rejects.toThrow(TypeError);
	});

	it("reads the template from its own file, not from spec.json", async () => {
		// A template on one escaped line of JSON is unreadable and undiffable;
		// keeping it beside the spec is what makes a case reviewable.
		await writeSpec(SPEC, "Only {{id}} here, filed by {{subject}}.\n");
		await runGenerate(options({ records: "1" }));

		const manifest = await readManifest(out);
		const entry = manifest.records[0];
		if (!entry) throw new Error("expected a record");
		const text = await readFile(join(out, entry.path, "document.txt"), "utf8");

		expect(text).toMatch(/^Only .+ here, filed by .+\.\n$/);
	});

	it("honours a template named by the spec", async () => {
		await writeSpec({ ...SPEC, template: "letter.txt" }, TEMPLATE);
		await expect(runGenerate(options({ records: "1" }))).resolves.not.toThrow();
	});

	it("reports a spec whose template file is missing", async () => {
		const dir = join(data, "specs", SPEC.id);
		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "spec.json"), JSON.stringify(SPEC), "utf8");
		// No template.txt beside it.
		await expect(runGenerate(options())).rejects.toThrow(/does not exist/);
	});

	it("ignores a stray file that is not a spec directory", async () => {
		await writeSpec();
		await writeFile(join(data, "specs", "notes.md"), "not a spec", "utf8");
		await expect(runGenerate(options({ records: "1" }))).resolves.not.toThrow();
	});

	it("refuses a format that has no renderer", async () => {
		// Accepting one would write plain text into a document.pdf and record it
		// as a valid PDF record — a corpus that looks generated and is not.
		await writeSpec({ ...SPEC, format: "pdf" });
		await expect(runGenerate(options())).rejects.toThrow(/no renderer/);
	});

	it("leaves an existing corpus untouched when generation fails", async () => {
		// Without staging, a failure partway through leaves a manifest from one
		// run beside records from another: a corpus that validates cleanly while
		// pairing every answer key with the wrong artifact.
		await writeSpec();
		await runGenerate(options({ seed: "1", records: "3" }));
		const before = await readFile(
			join(out, "records/rec_0001/document.txt"),
			"utf8",
		);

		// A template referencing a surface the spec does not declare fails inside
		// the generation loop, after the first records are already written.
		await writeSpec(SPEC, `${TEMPLATE}{{subject:misspelled}}\n`);
		await expect(
			runGenerate(options({ seed: "2", records: "3" })),
		).rejects.toThrow();

		const manifest = await readManifest(out);
		expect(manifest.seed).toBe(1);
		expect(
			await readFile(join(out, "records/rec_0001/document.txt"), "utf8"),
		).toBe(before);
	});

	it("leaves no staging directory behind after a failure", async () => {
		await writeSpec(SPEC, `${TEMPLATE}{{subject:misspelled}}\n`);
		await expect(runGenerate(options())).rejects.toThrow();
		await expect(
			readFile(join(`${out}.staging`, "manifest.json")),
		).rejects.toThrow();
	});

	it("reports a missing specs directory", async () => {
		await expect(runGenerate(options())).rejects.toThrow(/No specs/);
	});
});
