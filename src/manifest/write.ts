/**
 * @fileoverview Writing a corpus to disk.
 *
 * Two properties matter here, and both are about what happens when generation
 * goes wrong rather than when it goes right.
 *
 * Writes are atomic: a file is written beside its destination and renamed into
 * place, so a crash leaves either the previous file or the new one, never half
 * of either. A truncated answer key that still parses is the worst outcome
 * available — it would score as a corpus with missing values rather than as a
 * broken file.
 *
 * Output is deterministic: the same corpus written twice is byte-identical, so
 * a diff between two runs shows what actually changed rather than incidental
 * key reordering.
 *
 * @module manifest/write
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CorpusRecord, Manifest } from "#/datatypes/record.ts";
import { MANIFEST_FILE, TRUTH_FILE } from "./layout.ts";
import { parseManifest, parseRecord } from "./schema.ts";

/**
 * Writes a file atomically.
 *
 * The temporary file sits in the destination directory rather than the system
 * temp dir, so the rename stays within one filesystem and is therefore atomic.
 */
async function writeAtomic(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });

	// The pid keeps two concurrent generators from colliding on the temp name.
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, contents, "utf8");
	await rename(temporary, path);
}

/**
 * Serializes to stable JSON.
 *
 * Two-space indentation and a trailing newline, so a corpus is readable and a
 * diff between runs is legible. Key order follows insertion order, which the
 * schemas fix, so the same data always serializes identically.
 */
function serialize(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Writes the corpus index.
 *
 * Validates before writing. A manifest that would fail to read back is a
 * generator bug, and catching it here points at the cause rather than at a
 * confusing failure hours later when the corpus is scored.
 *
 * @param corpusDir - The corpus root
 */
export async function writeManifest(
	corpusDir: string,
	manifest: Manifest,
): Promise<void> {
	parseManifest(manifest);
	await writeAtomic(join(corpusDir, MANIFEST_FILE), serialize(manifest));
}

/**
 * Writes one record's answer key, beside the artifact it describes.
 *
 * @param corpusDir - The corpus root
 * @param recordPath - The record's directory, relative to the corpus root
 */
export async function writeRecord(
	corpusDir: string,
	recordPath: string,
	record: CorpusRecord,
): Promise<void> {
	parseRecord(record);
	await writeAtomic(join(corpusDir, recordPath, TRUTH_FILE), serialize(record));
}
