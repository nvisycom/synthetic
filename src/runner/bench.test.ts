import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGenerate } from "#/generator/generate.ts";
import { BenchError, runBench } from "./bench.ts";

let work: string;

beforeEach(async () => {
	work = await mkdtemp(join(tmpdir(), "synthetic-bench-"));
});

afterEach(async () => {
	await rm(work, { recursive: true, force: true });
});

/** Generates a small corpus to submit. */
async function corpus(records = 8): Promise<string> {
	const out = join(work, "corpus");
	await runGenerate({
		data: join(new URL("../..", import.meta.url).pathname, "data"),
		out,
		seed: "1",
		records: String(records),
	});
	return out;
}

describe("runBench", () => {
	it("refuses to start without a reachable server", async () => {
		// Reported as a message about the server rather than a failed signup:
		// nothing answered, which has a different fix.
		await expect(
			runBench({
				corpus: await corpus(2),
				out: join(work, "runs"),
				// A port nothing listens on.
				baseUrl: "http://127.0.0.1:9",
			}),
		).rejects.toThrow(/No API server/);
	}, 30_000);

	it("writes no run index when it cannot start", async () => {
		// A partial run must not leave a file that looks like a benchmark result.
		const out = join(work, "runs");
		await runBench({
			corpus: await corpus(2),
			out,
			baseUrl: "http://127.0.0.1:9",
		}).catch(() => {});

		// The index lives under the run's own id, so check the output directory
		// holds nothing rather than probing a path the runner never writes.
		await expect(readdir(out)).rejects.toThrow();
	}, 30_000);

	it("accepts a concurrency of one, for reproducing a failure serially", async () => {
		// The flag exists so a run can be made deterministic in submission order
		// when a failure needs chasing.
		await expect(
			runBench({
				corpus: await corpus(2),
				out: join(work, "runs"),
				baseUrl: "http://127.0.0.1:9",
				concurrency: 1,
			}),
		).rejects.toThrow(/No API server/);
	}, 30_000);

	it("rejects a concurrency that is not a positive integer", async () => {
		// `Math.max(1, NaN)` is NaN, which spawns no workers: the loop never runs
		// and an empty run would be written as a success.
		for (const concurrency of [Number.NaN, 0, -1, 1.5]) {
			await expect(
				runBench({
					corpus: await corpus(2),
					out: join(work, "runs"),
					baseUrl: "http://127.0.0.1:9",
					concurrency,
				}),
			).rejects.toThrow();
		}
	}, 30_000);

	it("explains how to use an existing account instead", async () => {
		try {
			await runBench({
				corpus: await corpus(2),
				out: join(work, "runs"),
				baseUrl: "http://127.0.0.1:9",
			});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(BenchError);
			expect((error as Error).message).toContain("--base-url");
		}
	}, 30_000);
});
