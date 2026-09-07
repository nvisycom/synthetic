/**
 * @fileoverview CLI entrypoint for the synthetic benchmark harness.
 *
 * @module main
 */

export {};

/**
 * Runs the CLI.
 *
 * @param argv - Arguments, with the node binary and script path already removed
 * @returns The process exit code
 */
async function main(argv: readonly string[]): Promise<number> {
	void argv;
	return 0;
}

process.exitCode = await main(process.argv.slice(2));
