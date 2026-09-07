import { isIPv4, isIPv6 } from "node:net";
import { faker } from "@faker-js/faker";
import { beforeEach, describe, expect, it } from "vitest";
import type { Label } from "#/datatypes/label.ts";
import { Random } from "#/random.ts";
import { fabricate, isFabricable } from "./fabricate.ts";

let random: Random;

beforeEach(() => {
	random = Random.fromSeed(42);
	faker.seed(42);
});

/**
 * Fabricates many values for a label, reseeding faker each time so the sample
 * spans the variants rather than one run's sequence.
 */
function sample(label: Label, count = 200): string[] {
	return Array.from({ length: count }, (_, index) => {
		faker.seed(index);
		return fabricate("ent_1", label, ["canonical"], random).value;
	});
}

/** Passes a Luhn check, as a real card number must. */
function luhnValid(value: string): boolean {
	const digits = value.replace(/\D/g, "");
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let digit = Number(digits[i]);
		if (double) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
		double = !double;
	}
	return digits.length > 0 && sum % 10 === 0;
}

describe("variety", () => {
	// One label is rarely one format in the world. A corpus that only ever shows
	// a detector one variant measures that variant, then reports the number as
	// though it covered the label.
	it.each([
		["crypto_address", 3],
		["ip_address", 3],
		["payment_card", 3],
		["government_id", 3],
		["phone_number", 3],
		["date_of_birth", 3],
		["postal_code", 3],
		["email_address", 3],
		["api_key", 3],
	] as const)("gives %s at least %i distinct shapes", (label, least) => {
		// Compare shapes rather than values: two random SSNs differ but are one
		// format, and it is formats a detector's patterns key on.
		const shapes = new Set(
			sample(label).map((value) =>
				value.replace(/[0-9]/g, "#").replace(/[a-zA-Z]/g, "a"),
			),
		);
		expect(shapes.size).toBeGreaterThanOrEqual(least);
	});
});

describe("structural validity", () => {
	// Values have to be plausible enough to survive a pipeline's own validators.
	// A card that fails its Luhn check is discarded before detection runs, and
	// the resulting miss says nothing about the detector.

	it("gives IP addresses that parse", () => {
		for (const value of sample("ip_address")) {
			const address = value.split("/")[0] ?? value;
			expect(isIPv4(address) || isIPv6(address)).toBe(true);
		}
	});

	it("covers both IPv4 and IPv6", () => {
		const values = sample("ip_address").map((v) => v.split("/")[0] ?? v);
		expect(values.some(isIPv4)).toBe(true);
		expect(values.some(isIPv6)).toBe(true);
	});

	it("gives card numbers that pass a Luhn check", () => {
		for (const value of sample("payment_card")) {
			expect(luhnValid(value)).toBe(true);
		}
	});

	it("covers Bitcoin and Ethereum address forms", () => {
		const values = sample("crypto_address");
		expect(values.some((v) => v.startsWith("0x"))).toBe(true);
		expect(values.some((v) => v.startsWith("bc1q"))).toBe(true);
		expect(values.some((v) => /^[13]/.test(v))).toBe(true);
	});

	it("keeps Bitcoin base58 addresses inside the base58 alphabet", () => {
		// 0, O, I and l are excluded as visually ambiguous, and a validating
		// matcher checks exactly that.
		for (const value of sample("crypto_address")) {
			if (!/^[13]/.test(value)) continue;
			expect(value).toMatch(/^[13][123456789A-HJ-NP-Za-km-z]+$/);
		}
	});

	it("never emits an unissued-looking value as a real SSN", () => {
		for (const value of sample("government_id")) {
			const match = /^(\d{3})[- ]?\d{2}[- ]?\d{4}$/.exec(value);
			if (!match?.[1]) continue;
			// 900-999 is never issued, keeping a plausible value unmistakably fake.
			expect(Number(match[1])).toBeGreaterThanOrEqual(900);
		}
	});
});

describe("surface forms", () => {
	it("derives the forms a person name supports", () => {
		const entity = fabricate(
			"ent_1",
			"person_name",
			["canonical", "abbreviated", "signature", "embedded"],
			random,
		);

		expect(entity.variants?.abbreviated).toMatch(/^[A-Z]\. /);
		expect(entity.variants?.signature).toMatch(/^([A-Z]\.)+$/);
		expect(entity.variants?.embedded).toContain("@");
		// The bug this guards: faker's fullName can carry a title, which turned
		// the email form into "mrs..stanton@" and initials into three letters.
		expect(entity.variants?.embedded).not.toContain("..");
	});

	it("always reformats a government id, however it was written", () => {
		// The bug this guards: once government_id could also produce an
		// unpunctuated form, `reformatted` had nothing to swap and returned
		// nothing — and a spec declaring that surface then failed the record.
		for (let index = 0; index < 100; index++) {
			faker.seed(index);
			const entity = fabricate(
				"ent_1",
				"government_id",
				["canonical", "reformatted"],
				random,
			);
			expect(entity.variants?.reformatted).toBeDefined();
			expect(entity.variants?.reformatted).not.toBe(entity.value);
		}
	});

	it("misspells by transposing letters, never across a space", () => {
		// "Apri lCase" is not a typo anyone makes; it would leave the misspelled
		// surface testing word segmentation rather than fuzzy matching.
		for (let index = 0; index < 100; index++) {
			faker.seed(index);
			const entity = fabricate(
				"ent_1",
				"person_name",
				["canonical", "misspelled"],
				random,
				"April Case",
			);
			const misspelled = entity.variants?.misspelled;
			expect(misspelled).toBeDefined();
			expect(misspelled).not.toBe("April Case");
			// Same words, same boundary; only letters moved.
			expect(misspelled?.indexOf(" ")).toBe("April Case".indexOf(" "));
		}
	});

	it("reformats a punctuated identifier", () => {
		const entity = fabricate(
			"ent_1",
			"government_id",
			["canonical", "reformatted"],
			random,
		);

		if (entity.variants?.reformatted) {
			expect(entity.variants.reformatted).not.toBe(entity.value);
		}
	});

	it("derives the same forms from either name order", () => {
		// "Reyes, Dana" used to take the initial from the surname and leave a
		// comma in the email local part, producing an address no detector should
		// be expected to match.
		const direct = fabricate(
			"ent_1",
			"person_name",
			["canonical", "abbreviated", "signature", "embedded"],
			random,
			"Dana Reyes",
		);
		const inverted = fabricate(
			"ent_1",
			"person_name",
			["canonical", "abbreviated", "signature", "embedded"],
			random,
			"Reyes, Dana",
		);

		expect(inverted.variants?.abbreviated).toBe(direct.variants?.abbreviated);
		expect(inverted.variants?.signature).toBe(direct.variants?.signature);
		expect(inverted.variants?.embedded).toBe(direct.variants?.embedded);
		expect(inverted.variants?.embedded).not.toContain(",");
	});

	it("can transpose the final letter pair", () => {
		// The loop bound excluded the last valid pair, so the end of a value was
		// never misspelled.
		const seen = new Set<string>();
		for (let index = 0; index < 300; index++) {
			faker.seed(index);
			seen.add(
				fabricate(
					"ent_1",
					"person_name",
					["canonical", "misspelled"],
					random,
					"Dana Reye",
				).variants?.misspelled ?? "",
			);
		}
		expect([...seen].some((value) => value.endsWith("Reey"))).toBe(true);
	});

	it("omits a form the value cannot take", () => {
		// An API key has no meaningful abbreviation, and inventing one would
		// plant a value no detector should be expected to link back.
		const entity = fabricate(
			"ent_1",
			"api_key",
			["canonical", "abbreviated", "signature"],
			random,
		);

		expect(entity.variants?.abbreviated).toBeUndefined();
		expect(entity.variants?.signature).toBeUndefined();
	});
});

describe("fixed values", () => {
	it("uses a curated value verbatim", () => {
		// Adversarial cases where the exact string is the point: a person named
		// April, an order number shaped like an SSN.
		const entity = fabricate(
			"ent_1",
			"person_name",
			["canonical"],
			random,
			"April Case",
		);
		expect(entity.value).toBe("April Case");
	});

	it("still derives forms from a curated value", () => {
		const entity = fabricate(
			"ent_1",
			"person_name",
			["canonical", "signature"],
			random,
			"April Case",
		);
		expect(entity.variants?.signature).toBe("A.C.");
	});
});

describe("determinism", () => {
	it("gives the same value for the same seed", () => {
		faker.seed(1);
		const first = fabricate(
			"ent_1",
			"person_name",
			["canonical"],
			Random.fromSeed(9),
		).value;

		faker.seed(1);
		const second = fabricate(
			"ent_1",
			"person_name",
			["canonical"],
			Random.fromSeed(9),
		).value;

		expect(second).toBe(first);
	});
});

describe("isFabricable", () => {
	it("reports which labels have a builder", () => {
		expect(isFabricable("person_name")).toBe(true);
		// No builder yet, and a spec asking for it should fail loudly rather
		// than plant a placeholder that scores as a miss.
		expect(isFabricable("health_narrative")).toBe(false);
	});
});
