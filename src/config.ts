/**
 * @fileoverview Package metadata for the CLI.
 *
 * @module config
 */

import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("../package.json") as {
	version: string;
	description: string;
};

/**
 * Harness version, read from `package.json` so the two cannot drift.
 */
export const version: string = pkg.version;

/**
 * One-line summary shown in the CLI's help output.
 */
export const description: string = pkg.description;
