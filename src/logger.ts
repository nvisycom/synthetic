/**
 * @fileoverview Logging setup for the harness.
 *
 * A benchmark run has two audiences. A human watching four thousand records
 * render wants readable progress; a later reader asking why a score moved wants
 * a machine-readable record of what actually happened. Both come from the same
 * logger here, switched by where output is going: a terminal gets consola's
 * formatting, a pipe or file gets newline-delimited JSON.
 *
 * @module logger
 */

import type { ConsolaInstance, LogObject } from "consola";
import { createConsola } from "consola";

/**
 * How log output is rendered.
 */
export type LogFormat = "pretty" | "json";

/**
 * Options for {@link createLogger}.
 */
export interface LoggerOptions {
	/**
	 * Verbosity, as a consola level.
	 *
	 * Consola's scale runs 0 (fatal and error) through 5 (trace), with 3 adding
	 * informational messages and 4 debug.
	 */
	level?: number;

	/**
	 * Output rendering.
	 *
	 * Defaults to `pretty` when stderr is a terminal and `json` otherwise, so
	 * piping a run to a file yields a parseable record without a flag.
	 */
	format?: LogFormat;
}

/**
 * Emits each log entry as one line of JSON.
 *
 * Deliberately minimal and dependency-free: a run's log is an artifact that may
 * be read back long after the run, so the format should be obvious rather than
 * clever. Errors are unwrapped explicitly because a bare `Error` serialises to
 * `{}` through `JSON.stringify`, which would silently discard exactly the
 * detail worth keeping.
 */
const jsonReporter = {
	log(logObj: LogObject): void {
		const { date, level, type, tag, args, ...rest } = logObj;

		const [first, ...extra] = args;
		const message = typeof first === "string" ? first : undefined;
		const values = message === undefined ? args : extra;

		const entry: Record<string, unknown> = {
			time: date.toISOString(),
			level,
			type,
			...(tag ? { tag } : {}),
			...(message === undefined ? {} : { message }),
			...rest,
		};

		if (values.length > 0) {
			entry.data = values.map((value) =>
				value instanceof Error
					? { name: value.name, message: value.message, stack: value.stack }
					: value,
			);
		}

		process.stderr.write(`${JSON.stringify(entry)}\n`);
	},
};

/**
 * Creates a logger for a run.
 *
 * Everything goes to stderr, leaving stdout free for a command's actual result
 * — a report, a manifest path — so that `synthetic score > report.json` stays
 * usable while still showing progress on the terminal.
 */
export function createLogger(options: LoggerOptions = {}): ConsolaInstance {
	const format = options.format ?? (process.stderr.isTTY ? "pretty" : "json");

	return createConsola({
		level: options.level ?? 3,
		...(format === "json"
			? { reporters: [jsonReporter] }
			: { stdout: process.stderr }),
	});
}

/**
 * The harness logger.
 *
 * Commands import this rather than constructing their own, so that one run
 * produces one coherent log.
 */
export const logger: ConsolaInstance = createLogger();

/**
 * Flags controlling {@link configureLogger}.
 */
export interface LoggerFlags {
	/** Include debug detail. */
	verbose?: boolean;
	/** Suppress everything below a warning. Wins over {@link verbose}. */
	quiet?: boolean;
	/** Force JSON output, overriding terminal detection. */
	json?: boolean;
}

/**
 * Applies CLI flags to the shared {@link logger}.
 *
 * Reconfigures the existing instance rather than returning a new one, so that
 * modules importing {@link logger} at load time still observe the settings a
 * command applies afterwards.
 */
export function configureLogger(flags: LoggerFlags = {}): void {
	// Quiet beats verbose: asking for silence is the more specific request.
	logger.level = flags.quiet ? 1 : flags.verbose ? 4 : 3;

	if (flags.json) {
		logger.setReporters([jsonReporter]);
	}
}
