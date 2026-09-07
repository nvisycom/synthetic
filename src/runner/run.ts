/**
 * @fileoverview What a benchmark run produces.
 *
 * A run submits a corpus to a pipeline and records what came back, one file per
 * record. It records outcomes rather than only results: a record whose upload
 * or detection failed is written as a failure and the run continues, so a
 * transient error partway through four thousand records costs one record rather
 * than the whole run. A report can then say what was scored and what could not
 * be, which is a different statement from a low score.
 *
 * Nothing here interprets what came back. Deciding whether a detection matches
 * a planted value is scoring's job, and keeping the two apart means a run can
 * be re-scored — after a metric changes, or a bug in matching is fixed —
 * without resubmitting anything.
 *
 * @module runner/run
 */

import type { Location } from "#/datatypes/location.ts";

/**
 * One value a pipeline reported finding.
 *
 * Deliberately close to the SDK's entity shape rather than to ground truth: it
 * is what the pipeline said, recorded verbatim. Ground truth says what is
 * there; scoring compares the two.
 */
export interface Detected {
	/** The pipeline's own identifier for this detection. */
	id: string;

	/**
	 * The label the pipeline assigned.
	 *
	 * Typed as a plain string rather than {@link Label}, because a pipeline may
	 * report a label this harness does not know — a newer taxonomy, a custom
	 * recognizer. Dropping it at read time would hide the mismatch; scoring
	 * reports it as unrecognized instead, and `isLabel` decides which it is.
	 */
	label: string;

	/** Where the pipeline says the value sits. */
	location: Location;

	/** The text the pipeline reports covering, when it says. */
	text?: string;

	/** The pipeline's confidence, when it reports one. */
	confidence?: number;

	/** Which recognizer found it, when the pipeline says. */
	recognizer?: string;
}

/**
 * Why a record could not be submitted or completed.
 */
export type FailureStage = "upload" | "detect" | "await" | "read";

/**
 * What happened to one record.
 */
export type RecordOutcome =
	| {
			status: "detected";
			/** The record this covers; joins to a corpus record's id. */
			recordId: string;
			/** The pipeline's detection id, for tracing back to the platform. */
			detectionId: string;
			/** Everything the pipeline reported. */
			detected: Detected[];
			/** How long the pipeline took, in milliseconds. */
			durationMs: number;
	  }
	| {
			status: "failed";
			recordId: string;
			/** How far the record got before it failed. */
			stage: FailureStage;
			/** What went wrong, as reported. */
			message: string;
			/** The detection id, when one was created before the failure. */
			detectionId?: string;
	  };

/**
 * A benchmark run.
 *
 * The index for a run, mirroring how a corpus is an index plus per-record
 * files: this names what was submitted and to what, while each record's
 * outcome lives beside it.
 */
export interface Run {
	/**
	 * Schema version.
	 *
	 * A reader refuses a version it does not understand rather than guessing.
	 */
	version: 1;

	/** Stable identifier for this run. */
	id: string;

	/** The corpus that was submitted, by its manifest's seed. */
	corpusSeed: number;

	/**
	 * Digest of the corpus manifest.
	 *
	 * Pins the run to the exact corpus it scored. Two runs are only comparable
	 * if this matches, and a report that silently compares across corpora is
	 * comparing nothing.
	 */
	corpusDigest: string;

	/** The workspace the corpus was submitted to. */
	workspace: string;

	/** The pipeline that processed it. */
	pipeline: string;

	/** Harness version that produced the run. */
	runner: string;

	/** When the run started, as an ISO 8601 timestamp. */
	startedAt: string;

	/** When it finished, as an ISO 8601 timestamp. */
	finishedAt: string;

	/** Every record's outcome, in corpus order. */
	records: { recordId: string; path: string; status: "detected" | "failed" }[];
}
