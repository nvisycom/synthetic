/**
 * @fileoverview Provisioning a workspace to benchmark against.
 *
 * Each run creates its own workspace, policy, and pipeline, then deletes them.
 * The reasoning is the same as generating a corpus from a seed: a run should
 * not be able to inherit configuration from a previous one, because two runs
 * are only comparable if what they ran against was the same.
 *
 * The policy is built from the corpus rather than from a compliance template.
 * Every shipped template is scoped to a regime — HIPAA, GDPR Article 9, PCI DSS,
 * CCPA — and none of them means "detect everything". Scoring against one would
 * count a missed IBAN as a recall failure when the policy never asked for it, so
 * a benchmark would be measuring policy scope rather than detection. The corpus
 * records the labels it plants, and the policy covers exactly those.
 *
 * @module runner/provision
 */

import type { Nvisy } from "@nvisy/sdk";
import type { Label } from "#/datatypes/label.ts";

/** Slug used for the policy and pipeline inside a run's own workspace. */
const SLUG = "benchmark";

/**
 * What a run was provisioned against.
 */
export interface Provisioned {
	/** The workspace created for this run. */
	workspace: string;

	/** The pipeline detections are submitted to. */
	pipeline: string;

	/** The labels the policy covers, as recorded by the corpus. */
	labels: readonly Label[];
}

/**
 * Creates a workspace, a policy scoped to the corpus, and a pipeline.
 *
 * @param client - An authenticated client
 * @param runId - Identifies this run; the workspace slug is derived from it
 * @param labels - Every label the corpus plants
 */
export async function provision(
	client: Nvisy,
	runId: string,
	labels: readonly Label[],
): Promise<Provisioned> {
	const workspace = `synthetic-${runId}`;

	await client.workspaces.createWorkspace({
		slug: workspace,
		displayName: `Synthetic ${runId}`,
		description: "Benchmark run. Created and deleted by the harness.",
	});

	// Everything after the workspace exists is undone on failure. A policy the
	// server rejects would otherwise strand the workspace, since the caller's
	// teardown only covers a run that started.
	try {
		// `inline` rather than a template: see the module note.
		await client.policies.createPolicy(workspace, {
			slug: SLUG,
			displayName: "Benchmark",
			source: "inline",
			definition: {
				name: "Benchmark",
				description: "Covers exactly the labels this corpus plants.",
				scopes: [{ name: "planted", labels: [...labels] }],
			},
		});

		// Created enabled: a pipeline defaults to `draft`, and submitting a
		// detection to a draft pipeline fails with a conflict rather than
		// queueing.
		await client.pipelines.createPipeline(workspace, {
			slug: SLUG,
			displayName: "Benchmark",
			status: "enabled",
			definition: { policySlugs: [SLUG] },
		});
	} catch (cause) {
		await teardown(client, workspace);
		throw cause;
	}

	return { workspace, pipeline: SLUG, labels };
}

/**
 * Deletes a run's workspace.
 *
 * Best-effort by design: teardown failing must not mask the failure that
 * prompted it, and a stranded benchmark workspace is a nuisance rather than a
 * correctness problem.
 *
 * @returns What went wrong, when it did
 */
export async function teardown(
	client: Nvisy,
	workspace: string,
): Promise<string | undefined> {
	try {
		await client.workspaces.deleteWorkspace(workspace);
		return undefined;
	} catch (cause) {
		return (cause as Error).message;
	}
}
