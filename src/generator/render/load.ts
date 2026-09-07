/**
 * @fileoverview Loading a spec's template.
 *
 * Each format reads its template differently: `txt` takes the file as a string,
 * `json` parses it. Keeping that per format means a template is stored in the
 * shape its documents actually have, rather than every format squeezing through
 * one representation.
 *
 * @module generator/render/load
 */

import type { DocumentFormat } from "#/datatypes/record.ts";
import { parseCsv } from "./csv.parse.ts";

/**
 * Turns a template file's contents into what its renderer expects.
 */
export type TemplateLoader = (contents: string, path: string) => unknown;

/**
 * The default template filename for a format.
 */
const FILENAMES: Partial<Record<DocumentFormat, string>> = {
	txt: "template.txt",
	json: "template.json",
	csv: "template.csv",
	xml: "template.json",
};

const LOADERS: Partial<Record<DocumentFormat, TemplateLoader>> = {
	// Plain text is its own representation.
	txt: (contents) => contents,

	// Parsed, so the renderer walks a real object tree and writes the document
	// itself — which is what lets it record where each escape moved a value.
	json: (contents, path) => parseJson(contents, path),

	// A CSV template is itself CSV, so a table reads as a table and a diff shows
	// a changed row. The renderer quotes cells again on output, since a planted
	// value may introduce a comma the template never had.
	// An XML template describes the tree as JSON, so the structure is explicit
	// rather than parsed back out of angle brackets.
	xml: (contents, path) => parseJson(contents, path),

	csv: (contents, path) => {
		try {
			return parseCsv(contents);
		} catch (cause) {
			throw new SyntaxError(
				`Template at ${path} is not valid CSV: ${(cause as Error).message}`,
			);
		}
	},
};

/**
 * Parses a JSON template, naming the file in the error.
 */
function parseJson(contents: string, path: string): unknown {
	try {
		return JSON.parse(contents);
	} catch (cause) {
		throw new SyntaxError(
			`Template at ${path} is not valid JSON: ${(cause as Error).message}`,
		);
	}
}

/**
 * Returns the template filename a format expects by default.
 */
export function templateFilename(format: DocumentFormat): string {
	return FILENAMES[format] ?? "template.txt";
}

/**
 * Returns the loader for a format, or `undefined` when none exists.
 */
export function loaderFor(format: DocumentFormat): TemplateLoader | undefined {
	return LOADERS[format];
}
