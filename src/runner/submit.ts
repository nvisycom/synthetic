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
import type { Detected, RecordOutcome } from "./run.ts";

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
 * gives the right entity type per part. Only text parts are read for now, since
 * only text-bearing formats render; image, audio, and tabular entities are
 * skipped rather than mangled into a text location.
 *
 * The pipeline reports a decoded coordinate, which is the same space the corpus
 * records its `ranges` in, so nothing is translated here — this only reshapes
 * what came back into the run's own vocabulary. An unrecognized label is kept
 * rather than dropped, since a label the harness does not know is a fact worth
 * reporting rather than hiding.
 */
export function readAnalysis(analysis: Audit): Detected[] {
	const detected: Detected[] = [];

	for (const part of analysis.report.parts) {
		if (part.modality !== "text") continue;

		for (const entity of part.entities) {
			const { coord } = entity.location;
			// A source-only coordinate has no decoded range to compare against
			// ground truth, so it is left for the scorer to report as unplaceable
			// rather than guessed at here.
			if (coord.kind !== "decoded") continue;

			detected.push({
				id: entity.id,
				label: entity.label,
				location: {
					kind: "text",
					ranges: [{ start: coord.range.start, end: coord.range.end }],
				},
				confidence: entity.confidence,
				// The first audit event names what found it, which is the most
				// useful single attribution for a report.
				...(entity.audit[0] !== undefined
					? { recognizer: entity.audit[0].source }
					: {}),
			});
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
