/**
 * @fileoverview Reading a corpus from disk.
 *
 * Every file is validated on the way in. A corpus is often read long after it
 * was written, by a different version of this code, and an answer key the
 * scorer half-understands produces confident numbers that are wrong — worse
 * than no numbers at all.
 *
 * @module manifest/read
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	CorpusRecord,
	Manifest,
	RecordEntry,
} from "#/datatypes/record.ts";
import { MANIFEST_FILE, TRUTH_FILE } from "./layout.ts";
import { ManifestError, parseManifest, parseRecord } from "./schema.ts";

/**
 * Reads and parses a JSON file, framing a syntax error against its path.
 *
 * Node's own message names neither the file nor what was expected, which is
 * unhelpful when a run fails partway through four thousand records.
 */
async function readJson(path: string, subject: string): Promise<unknown> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (cause) {
		const reason =
			(cause as NodeJS.ErrnoException).code === "ENOENT"
				? "does not exist"
				: `could not be read (${(cause as Error).message})`;
		throw new ManifestError(`${subject} at ${path} ${reason}`, []);
	}

	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new ManifestError(`${subject} at ${path} is not valid JSON`, [
			(cause as Error).message,
		]);
	}
}

/**
 * Reads the corpus index.
 *
 * @param corpusDir - The corpus root, holding `manifest.json`
 */
export async function readManifest(corpusDir: string): Promise<Manifest> {
	const path = join(corpusDir, MANIFEST_FILE);
	return parseManifest(await readJson(path, "Manifest"));
}

/**
 * Reads one record's answer key.
 *
 * @param corpusDir - The corpus root
 * @param entry - The record's index entry, naming its directory
 * @throws {ManifestError} If the file is missing, malformed, or describes a
 * different record than the index claims
 */
export async function readRecord(
	corpusDir: string,
	entry: RecordEntry,
): Promise<CorpusRecord> {
	const path = join(corpusDir, entry.path, TRUTH_FILE);
	const record = parseRecord(await readJson(path, "Record"));

	// The index and the answer key are written separately, so they can disagree
	// — a half-finished run, a hand-edited file, two corpora merged. Catch it
	// here rather than scoring one record's detections against another's truth.
	if (record.id !== entry.id) {
		throw new ManifestError(
			`Record at ${path} claims id ${JSON.stringify(record.id)}, but the index lists ${JSON.stringify(entry.id)}`,
			[],
		);
	}
	if (record.digest !== entry.digest) {
		throw new ManifestError(
			`Record ${entry.id} has digest ${record.digest} in its answer key but ${entry.digest} in the index`,
			[],
		);
	}

	return record;
}

/**
 * Reads every record's answer key, in index order.
 *
 * Yields rather than returning an array: a full corpus is far larger than the
 * one record a caller is working on, and holding all of it defeats the reason
 * ground truth was split per record in the first place.
 */
export async function* readRecords(
	corpusDir: string,
	manifest: Manifest,
): AsyncGenerator<CorpusRecord> {
	for (const entry of manifest.records) {
		yield await readRecord(corpusDir, entry);
	}
}

/**
 * Returns the SHA-256 of a file, hex-encoded.
 *
 * Streamed rather than read whole, since a scanned corpus reaches gigabytes.
 */
export async function digestFile(path: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(path);

	return new Promise((resolve, reject) => {
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", reject);
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}

/**
 * Checks that a record's artifact is the one its answer key describes.
 *
 * Worth doing before scoring: an artifact that has been regenerated, truncated,
 * or swapped no longer matches the positions recorded against it, and every
 * offset in the answer key silently points at the wrong bytes.
 *
 * @returns The artifact's actual digest when it differs, or `undefined` when it
 * matches
 */
export async function verifyArtifact(
	corpusDir: string,
	entry: RecordEntry,
	record: CorpusRecord,
): Promise<string | undefined> {
	const path = join(corpusDir, entry.path, record.artifact);
	const actual = await digestFile(path);
	return actual === record.digest ? undefined : actual;
}
