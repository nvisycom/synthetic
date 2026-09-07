/**
 * @fileoverview Corpus generation.
 *
 * @module generator/generate
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { version } from "#/config.ts";
import type { Manifest, RecordEntry } from "#/datatypes/record.ts";
import { logger } from "#/logger.ts";
import { recordPath } from "#/manifest/layout.ts";
import { writeManifest, writeRecord } from "#/manifest/write.ts";
import { Random } from "#/random.ts";
import { GeneratorError, generateRecord, validateSpec } from "./record.ts";
import { parseSpec } from "./spec.schema.ts";
import type { LoadedSpec } from "./spec.ts";

/**
 * Options accepted by {@link runGenerate}.
 */
export interface GenerateOptions {
	/** Directory of tracked corpus specifications to build from. */
	data: string;
	/** Directory to render the corpus into. */
	out: string;
	/** Seed making the corpus reproducible. */
	seed: string;
	/** Number of records to generate. */
	records: string;
}

/**
 * Loads every spec in a data directory, in a stable order.
 *
 * Sorted by filename so the corpus does not depend on directory iteration
 * order, which varies by filesystem and would break reproducibility across
 * machines while looking identical on one.
 */
async function loadSpecs(dataDir: string): Promise<LoadedSpec[]> {
	const specsDir = join(dataDir, "specs");

	let dirs: string[];
	try {
		dirs = (await readdir(specsDir, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		throw new GeneratorError(`No specs directory at ${specsDir}`);
	}

	if (dirs.length === 0) {
		throw new GeneratorError(`No specs found in ${specsDir}`);
	}

	const specs: LoadedSpec[] = [];
	// Sorted by directory name so the corpus does not depend on filesystem
	// iteration order, which varies by machine and would break reproducibility
	// across them while looking identical on one.
	for (const dir of dirs.sort()) {
		const specPath = join(specsDir, dir, "spec.json");

		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(specPath, "utf8"));
		} catch (cause) {
			throw new GeneratorError(
				`Spec at ${specPath} could not be read: ${(cause as Error).message}`,
			);
		}

		// Validated rather than cast: a spec is hand-written, so it is the one
		// input here most likely to carry a typo, and the error should name the
		// file that is wrong rather than surface three steps downstream.
		const spec = parseSpec(raw, specPath);

		const templatePath = join(specsDir, dir, spec.template ?? "template.txt");
		let template: string;
		try {
			template = await readFile(templatePath, "utf8");
		} catch {
			throw new GeneratorError(
				`Spec ${JSON.stringify(spec.id)} names a template at ${templatePath}, which does not exist`,
			);
		}

		const loaded = { spec, template };
		validateSpec(loaded);
		specs.push(loaded);
	}

	return specs;
}

/**
 * Generates a synthetic corpus and its ground-truth manifest.
 */
export async function runGenerate(options: GenerateOptions): Promise<void> {
	const seed = Random.parseSeed(options.seed);
	const count = Number(options.records);
	if (!Number.isInteger(count) || count < 1) {
		throw new GeneratorError(
			`Record count must be a positive integer, got ${JSON.stringify(options.records)}`,
		);
	}

	const specs = await loadSpecs(options.data);
	logger.info("loaded specs", { count: specs.length, from: options.data });

	const root = Random.fromSeed(seed);
	const entries: RecordEntry[] = [];

	for (let index = 0; index < count; index++) {
		// Each record draws from its own stream, so changing one record — or the
		// number of them — leaves every other record byte-identical.
		const stream = root.fork();
		const recordSeed = stream.integer(0, Number.MAX_SAFE_INTEGER);

		const loaded = specs[index % specs.length];
		if (loaded === undefined)
			throw new GeneratorError("No spec to generate from");

		const id = `rec_${String(index + 1).padStart(4, "0")}`;
		const { record, artifact } = generateRecord(loaded, id, stream, recordSeed);

		const path = recordPath(id);
		await mkdir(join(options.out, path), { recursive: true });
		await writeFile(join(options.out, path, record.artifact), artifact, "utf8");
		await writeRecord(options.out, path, record);

		entries.push({
			id,
			format: record.format,
			specId: record.specId,
			path,
			digest: record.digest,
		});

		logger.debug("generated record", { id, spec: loaded.spec.id });
	}

	const manifest: Manifest = {
		version: 1,
		seed,
		generator: version,
		createdAt: new Date().toISOString(),
		records: entries,
	};
	await writeManifest(options.out, manifest);

	logger.success("generated corpus", {
		records: entries.length,
		seed,
		out: options.out,
	});
}
