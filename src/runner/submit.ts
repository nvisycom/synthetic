/**
 * @fileoverview Submitting one record and collecting what the pipeline found.
 *
 * A record is uploaded, a detection is started, and the detection is polled
 * until it settles. Polling rather than streaming keeps the runner working
 * against any deployment and makes a timeout easy to bound; the cost is a few
 * requests while waiting, which backoff keeps small.
 *
 * Every failure is returned rather than thrown. A corpus is thousands of
 * records, and a transient error on one of them should cost that record, not
 * the run — a report can then say what was scored and what could not be, which
 * is a different statement from a low score.
 *
 * @module runner/submit
 */

import type { Nvisy } from "@nvisy/sdk";
import type { Audit } from "@nvisy/sdk/datatypes";
import type { Range } from "#/datatypes/location.ts";
import type { Detected, RecordOutcome } from "./outcome.ts";

/**
 * Returns whether a failure is worth retrying.
 *
 * A dropped connection or a server-side fault may not recur; a rejected payload
 * or an unauthorized request will, and retrying it only delays the report. The
 * check is on the message rather than a status code because the SDK surfaces
 * transport failures as plain errors.
 */
function isTransient(cause: unknown): boolean {
	const error = cause as { message?: string; statusCode?: number };
	if (error.statusCode !== undefined) {
		// 408 and 429 are explicitly retryable; 5xx may be a passing fault.
		return (
			error.statusCode === 408 ||
			error.statusCode === 429 ||
			error.statusCode >= 500
		);
	}
	return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(
		error.message ?? "",
	);
}

/**
 * Runs an operation, retrying a transient failure with backoff.
 *
 * @throws The last failure, when every attempt fails
 */
async function withRetry<T>(
	operation: () => Promise<T>,
	attempts: number,
): Promise<T> {
	let wait = 250;
	for (let attempt = 1; ; attempt++) {
		try {
			return await operation();
		} catch (cause) {
			if (attempt >= attempts || !isTransient(cause)) throw cause;
			await new Promise((resolve) => setTimeout(resolve, wait));
			wait *= 2;
		}
	}
}

/**
 * How long to wait between polls, and how long to keep waiting.
 */
export interface PollOptions {
	/** First wait, in milliseconds. */
	initialMs?: number;
	/** Longest wait between polls, in milliseconds. */
	maxMs?: number;
	/** Give up after this long, in milliseconds. */
	timeoutMs?: number;
	/** How many times to try an operation that fails transiently. */
	attempts?: number;
}

const DEFAULT_POLL: Required<PollOptions> = {
	initialMs: 200,
	maxMs: 2_000,
	timeoutMs: 120_000,
	attempts: 3,
};

/**
 * Node's own `File`, narrowed to what an upload needs.
 *
 * `lib.dom` is deliberately out of this project's tsconfig — it is a Node CLI,
 * not a browser library — so the global's own type is unavailable. Declaring
 * just the constructor keeps the exclusion without reaching for `any`.
 */
declare const File: new (
	parts: Uint8Array[],
	name: string,
	options?: { type?: string },
) => Blob;

/** Media types by document format, so an upload is not sniffed. */
const CONTENT_TYPES: Record<string, string> = {
	txt: "text/plain",
	json: "application/json",
	csv: "text/csv",
	xml: "application/xml",
	html: "text/html",
	pdf: "application/pdf",
};

/**
 * Reads a detection's entities out of an analysis report.
 *
 * The report's parts are a discriminated union on modality, so narrowing on it
 * gives the right entity type per part. Text and tabular parts are read, which
 * is what the rendered formats produce; image and audio entities are skipped
 * rather than mangled into a coordinate system they do not belong to.
 *
 * A text entity's source range is preferred over its decoded one, because that
 * is the space ground truth records: the raw file. A decoded range depends on
 * how the pipeline extracted text from the document, and comparing against it
 * would score the harness' agreement with one extractor rather than the
 * pipeline's detection. Nothing is translated here either way — this only
 * reshapes what came back into the run's own vocabulary.
 *
 * An unrecognized label is kept rather than dropped, since a label the harness
 * does not know is a fact worth reporting rather than hiding.
 */
function attribution(entity: {
	id: string;
	label: string;
	confidence: number;
	audit: { source: string }[];
}): Omit<Detected, "location"> {
	return {
		id: entity.id,
		label: entity.label,
		confidence: entity.confidence,
		// The first audit event names what found it, which is the most useful
		// single attribution for a report.
		...(entity.audit[0] !== undefined
			? { recognizer: entity.audit[0].source }
			: {}),
	};
}

export function readAnalysis(analysis: Audit): Detected[] {
	const detected: Detected[] = [];

	for (const part of analysis.report.parts) {
		if (part.modality === "text") {
			for (const entity of part.entities) {
				const { coord } = entity.location;
				// The raw file ranges, which is what ground truth records. A decoded
				// coordinate carries them alongside; a source coordinate is already
				// in that space.
				// The raw file ranges. A decoded coordinate leaves `source` empty
				// exactly when the two coincide — a plain text file, where the bytes
				// on disk are the decoded text — so its own range is the file range
				// in that case.
				const source = coord.source?.map((span) => span.range) ?? [];
				const ranges =
					source.length > 0
						? source
						: coord.kind === "decoded"
							? [coord.range]
							: [];

				// A source coordinate with no spans places nothing, so it is left for
				// the scorer to report as unplaceable rather than guessed at here.
				if (ranges.length === 0) continue;

				detected.push({
					...attribution(entity),
					location: {
						kind: "text",
						ranges: ranges as [Range, ...Range[]],
					},
				});
			}
			continue;
		}

		if (part.modality === "tabular") {
			for (const entity of part.entities) {
				const { location } = entity;
				detected.push({
					...attribution(entity),
					location: {
						kind: "tabular",
						row: location.row_index,
						column: location.column_index,
						...(location.column_name !== undefined
							? { columnName: location.column_name }
							: {}),
						...(location.sheet_name !== undefined
							? { sheetName: location.sheet_name }
							: {}),
						// Unset offsets mean the whole cell, and are left unset rather
						// than filled in: a zero-width range at 0 is indistinguishable
						// from a genuine empty match there, and a made-up width would
						// score as a boundary miss against the value's real one.
						...(location.start_offset !== undefined ||
						location.end_offset !== undefined
							? {
									cell: {
										start: location.start_offset ?? 0,
										end: location.end_offset ?? location.start_offset ?? 0,
									},
								}
							: {}),
					},
				});
			}
		}
	}

	return detected;
}

/**
 * Waits for a detection to settle.
 *
 * @throws If it does not settle within the timeout
 */
async function awaitDetection(
	client: Nvisy,
	workspace: string,
	detectionId: string,
	poll: Required<PollOptions>,
): Promise<"complete" | "failed"> {
	const deadline = Date.now() + poll.timeoutMs;
	let wait = poll.initialMs;

	while (Date.now() < deadline) {
		const detection = (await client.detections.getDetection(
			workspace,
			detectionId,
		)) as { status?: string; metadata?: { error?: string } };

		if (detection.status === "complete" || detection.status === "failed") {
			return detection.status;
		}

		await new Promise((resolve) => setTimeout(resolve, wait));
		// Back off, so a slow document does not cost a request every 200ms.
		wait = Math.min(wait * 2, poll.maxMs);
	}

	throw new Error(
		`Detection ${detectionId} did not settle within ${poll.timeoutMs}ms`,
	);
}

/**
 * Submits one record and returns what happened to it.
 *
 * @param client - An authenticated client
 * @param workspace - The run's workspace
 * @param pipeline - The run's pipeline
 * @param record - The record's id, format, and bytes
 */
export async function submitRecord(
	client: Nvisy,
	workspace: string,
	pipeline: string,
	record: { id: string; format: string; artifact: string; bytes: Uint8Array },
	options: PollOptions = {},
): Promise<RecordOutcome> {
	const poll = { ...DEFAULT_POLL, ...options };
	const started = Date.now();

	let fileId: string;
	try {
		const type = CONTENT_TYPES[record.format] ?? "application/octet-stream";
		const file = new File([record.bytes], record.artifact, {
			type,
		});
		const uploaded = await withRetry(
			() => client.files.uploadFiles(workspace, file),
			poll.attempts,
		);
		const first = uploaded[0];
		if (first === undefined) {
			throw new Error("Upload returned no file");
		}
		fileId = first.id;
	} catch (cause) {
		return {
			status: "failed",
			recordId: record.id,
			stage: "upload",
			message: (cause as Error).message,
		};
	}

	let detectionId: string;
	try {
		// Not retried. The API takes no idempotency key, so a create whose
		// response was lost in transit would run twice on the server while the
		// run recorded one of them — a record billed and processed twice, and a
		// detection nothing ever reads. A failure here is reported instead.
		const detection = await client.detections.createDetection(
			workspace,
			pipeline,
			{ fileId },
		);
		detectionId = detection.id;
	} catch (cause) {
		return {
			status: "failed",
			recordId: record.id,
			stage: "detect",
			message: (cause as Error).message,
		};
	}

	try {
		const settled = await awaitDetection(client, workspace, detectionId, poll);
		if (settled === "failed") {
			return {
				status: "failed",
				recordId: record.id,
				stage: "await",
				message: "The pipeline reported the detection as failed",
				detectionId,
			};
		}
	} catch (cause) {
		return {
			status: "failed",
			recordId: record.id,
			stage: "await",
			message: (cause as Error).message,
			detectionId,
		};
	}

	try {
		// Entities live behind the analysis report, not on the detection itself.
		const analysis = await client.detections.getAnalysis(
			workspace,
			detectionId,
		);

		return {
			status: "detected",
			recordId: record.id,
			detectionId,
			detected: readAnalysis(analysis),
			durationMs: Date.now() - started,
		};
	} catch (cause) {
		return {
			status: "failed",
			recordId: record.id,
			stage: "read",
			message: (cause as Error).message,
			detectionId,
		};
	}
}
