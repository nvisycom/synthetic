/**
 * @fileoverview Planting values into a text template.
 *
 * A template is plain text with `{{slot}}` placeholders, and `{{slot:surface}}`
 * to write a slot in a particular form. Everything else is literal, so an
 * author controls exactly where a value lands.
 *
 * Offsets are recorded as the text is built rather than searched for
 * afterwards. Searching would find the wrong occurrence whenever a value
 * appears twice, or when one planted value happens to contain another — a
 * street number inside an account number, a first name inside an email — and
 * the resulting answer key would point at the wrong bytes while looking
 * entirely correct.
 *
 * @module generator/template
 */

import type { Entity, SurfaceForm } from "#/datatypes/entity.ts";
import type { Occurrence } from "#/datatypes/record.ts";
import { byteLength } from "#/util/offset.ts";

/**
 * `{{slot}}` or `{{slot:surface}}`.
 *
 * Global, and therefore stateful: every caller must reset `lastIndex` before
 * using it. {@link hasPlaceholder} exists so a one-off test does not have to
 * remember that, since forgetting leaves the next scan starting mid-string.
 */
export const PLACEHOLDER =
	/\{\{\s*([a-zA-Z0-9_-]+)\s*(?::\s*([a-zA-Z_]+)\s*)?\}\}/g;

/**
 * What a template produced.
 */
export interface Planted {
	/** The rendered text. */
	text: string;

	/** Every value planted in it, with its exact position. */
	occurrences: Occurrence[];
}

/**
 * Raised when a template and its slots disagree.
 */
export class TemplateError extends Error {
	override readonly name = "TemplateError";
}

/**
 * Returns whether a string carries a placeholder.
 *
 * Resets the shared pattern first, so a caller cannot be caught out by where a
 * previous scan happened to stop.
 */
export function hasPlaceholder(text: string): boolean {
	PLACEHOLDER.lastIndex = 0;
	return PLACEHOLDER.test(text);
}

/**
 * Looks up the value a placeholder asks for.
 *
 * Shared by every renderer, so a template means the same thing whatever format
 * it is written into.
 *
 * @throws {TemplateError} If the slot is unknown, or lacks the requested form
 */
export function resolveSlot(
	entities: ReadonlyMap<string, Entity>,
	name: string | undefined,
	requested: string | undefined,
): { entity: Entity; surface: SurfaceForm; value: string } {
	if (name === undefined) {
		throw new TemplateError("Malformed placeholder");
	}

	const entity = entities.get(name);
	if (entity === undefined) {
		throw new TemplateError(
			`Template references slot ${JSON.stringify(name)}, which the spec does not define`,
		);
	}

	const surface = (requested ?? "canonical") as SurfaceForm;
	const value =
		surface === "canonical" ? entity.value : entity.variants?.[surface];
	if (value === undefined) {
		throw new TemplateError(
			`Slot ${JSON.stringify(name)} has no ${JSON.stringify(surface)} form; declare it in the spec's surfaces`,
		);
	}

	return { entity, surface, value };
}

/**
 * Renders a template, planting entities and recording where each landed.
 *
 * @param body - The template text
 * @param entities - Entities by slot name
 * @param modalityId - The modality occurrences are recorded against
 * @throws {TemplateError} If a placeholder names an unknown slot, or asks for a
 * surface form the entity does not have
 */
export function plant(
	body: string,
	entities: ReadonlyMap<string, Entity>,
	modalityId: string,
): Planted {
	const occurrences: Occurrence[] = [];
	let text = "";
	// Tracked alongside the string so a value's offset never has to be searched
	// for. Bytes, not characters: the answer key records UTF-8 offsets.
	let bytes = 0;
	let last = 0;
	let index = 0;

	PLACEHOLDER.lastIndex = 0;
	let match = PLACEHOLDER.exec(body);
	while (match !== null) {
		const [placeholder, name, requested] = match;

		const literal = body.slice(last, match.index);
		text += literal;
		bytes += byteLength(literal);

		const { entity, surface, value } = resolveSlot(entities, name, requested);

		const start = bytes;
		text += value;
		bytes += byteLength(value);

		occurrences.push({
			id: `occ_${String(index).padStart(4, "0")}`,
			entityId: entity.id,
			modalityId,
			surface,
			text: value,
			location: { kind: "text", ranges: [{ start, end: bytes }] },
		});
		index++;

		last = match.index + placeholder.length;
		match = PLACEHOLDER.exec(body);
	}

	text += body.slice(last);

	return { text, occurrences };
}

/**
 * Returns every slot name a template references, in order of first use.
 *
 * Used to check a spec against its template before generating, so a typo in
 * either is caught once rather than at every record.
 */
export function slotsUsed(body: string): string[] {
	const names: string[] = [];
	PLACEHOLDER.lastIndex = 0;

	let match = PLACEHOLDER.exec(body);
	while (match !== null) {
		const name = match[1];
		if (name !== undefined && !names.includes(name)) names.push(name);
		match = PLACEHOLDER.exec(body);
	}

	return names;
}
