/**
 * @fileoverview Fabricating sensitive values.
 *
 * Every value here is invented. They are built to be structurally plausible —
 * a generated card number passes a Luhn check, an IBAN passes its checksum —
 * because a pipeline's checksum validators would otherwise reject them and the
 * corpus would score a detector that never had a fair chance. None of them
 * correspond to a real person, account, or record.
 *
 * @module generator/fabricate
 */

import { faker } from "@faker-js/faker";
import type { Entity, SurfaceForm } from "#/datatypes/entity.ts";
import type { Label } from "#/datatypes/label.ts";
import type { Random } from "#/random.ts";

/**
 * Builds a value for a label.
 */
type Builder = (random: Random) => string;

/**
 * The forms a label can take, drawn from with equal probability.
 *
 * One label is rarely one format in the world. A crypto address may be Bitcoin
 * (base58 or bech32) or Ethereum; an IP may be v4 or v6; a phone number may be
 * national, international, or punctuated a dozen ways. A corpus that only ever
 * shows a detector one variant measures how well it handles that variant, then
 * reports the number as though it covered the label.
 *
 * Variants also make a corpus honest about partial support: a pipeline strong
 * on IPv4 and blind to IPv6 scores near half here, which is the truth, rather
 * than scoring perfectly against a corpus that never showed it an IPv6 address.
 */
type Variants = readonly [Builder, ...Builder[]];

/**
 * Picks one form at random, so a corpus covers a label's real spread.
 */
function anyOf(...forms: Variants): Builder {
	return (random) => random.pick(forms)(random);
}

/**
 * Returns digits as a string, padded to a fixed width.
 */
function digits(random: Random, count: number): string {
	let out = "";
	for (let i = 0; i < count; i++) out += String(random.integer(0, 9));
	return out;
}

/** Uppercase letters, for identifier prefixes. */
function alpha(count: number): string {
	return faker.string.alpha({ length: count, casing: "upper" });
}

/** A month, zero-padded, for expiry dates. */
function month(random: Random): string {
	return String(random.integer(1, 12)).padStart(2, "0");
}

/** A birthdate for an adult. */
function birthdate(): Date {
	return faker.date.birthdate({ min: 18, max: 90, mode: "age" });
}

/**
 * Writes a date in one of the conventions a document might use.
 *
 * `us` and `eu` are deliberately ambiguous with each other — 03/04/1985 is two
 * different dates depending on the reader — which is a real source of both
 * missed and spurious detections.
 */
function formatDate(date: Date, style: "us" | "eu" | "long"): string {
	const day = String(date.getUTCDate()).padStart(2, "0");
	const mon = String(date.getUTCMonth() + 1).padStart(2, "0");
	const year = date.getUTCFullYear();

	switch (style) {
		case "us":
			return `${mon}/${day}/${year}`;
		case "eu":
			return `${day}.${mon}.${year}`;
		case "long":
			return date.toLocaleDateString("en-US", {
				year: "numeric",
				month: "long",
				day: "numeric",
				timeZone: "UTC",
			});
	}
}

/** Splits a string into fixed-width groups, as printed forms do. */
function group(value: string, size: number, separator: string): string {
	const groups: string[] = [];
	for (let i = 0; i < value.length; i += size) {
		groups.push(value.slice(i, i + size));
	}
	return groups.join(separator);
}

/**
 * Base58, the Bitcoin alphabet.
 *
 * Excludes 0, O, I, and l, which are visually ambiguous — a detail a pattern
 * validating the alphabet actually checks.
 */
function base58(random: Random, count: number): string {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
	let out = "";
	for (let i = 0; i < count; i++) {
		out += alphabet[random.integer(0, alphabet.length - 1)];
	}
	return out;
}

/** Bech32, the alphabet modern Bitcoin addresses use. */
function bech32(random: Random, count: number): string {
	const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
	let out = "";
	for (let i = 0; i < count; i++) {
		out += alphabet[random.integer(0, alphabet.length - 1)];
	}
	return out;
}

/**
 * Appends the check digit that makes a number pass a Luhn check.
 *
 * Card numbers are validated this way, so a card that fails the check would be
 * discarded by a pipeline before detection ever ran — scoring a miss that says
 * nothing about the detector.
 */
function withLuhn(prefix: string): string {
	let sum = 0;
	let double = true;
	for (let i = prefix.length - 1; i >= 0; i--) {
		let digit = Number(prefix[i]);
		if (double) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
		double = !double;
	}
	return prefix + String((10 - (sum % 10)) % 10);
}

/**
 * Builders for the labels the text formats exercise.
 *
 * Deliberately partial. The corpus grows label by label, and a builder is added
 * when a spec needs it rather than speculatively.
 */
const BUILDERS: Partial<Record<Label, Builder>> = {
	person_name: anyOf(
		// First and last only: `fullName` can include a title or suffix ("Mrs.",
		// "Jr."), which are not part of the name and corrupt every derived form.
		() => `${faker.person.firstName()} ${faker.person.lastName()}`,
		() => `${faker.person.lastName()}, ${faker.person.firstName()}`,
		() =>
			`${faker.person.firstName()} ${faker.person.middleName()[0]}. ${faker.person.lastName()}`,
	),
	date_of_birth: anyOf(
		// The same date written four ways. A detector keyed to one format is
		// blind to the rest, and only a corpus carrying all of them shows it.
		() => birthdate().toISOString().slice(0, 10),
		() => formatDate(birthdate(), "us"),
		() => formatDate(birthdate(), "eu"),
		() => formatDate(birthdate(), "long"),
	),
	government_id: anyOf(
		// US SSN. The 900-999 area range is never issued, so a structurally
		// valid value stays unmistakably synthetic.
		(random) =>
			`${random.integer(900, 999)}-${digits(random, 2)}-${digits(random, 4)}`,
		(random) =>
			`${random.integer(900, 999)} ${digits(random, 2)} ${digits(random, 4)}`,
		(random) => `${random.integer(900, 999)}${digits(random, 6)}`,
		// UK National Insurance number.
		(random) =>
			`${alpha(2)} ${digits(random, 2)} ${digits(random, 2)} ${digits(random, 2)} ${alpha(1)}`,
	),
	passport_number: anyOf(
		(random) => `${alpha(1)}${digits(random, 8)}`,
		(random) => digits(random, 9),
		(random) => `${alpha(2)}${digits(random, 7)}`,
	),
	drivers_license: anyOf(
		(random) => `${alpha(1)}${digits(random, 7)}`,
		(random) => `${alpha(2)}-${digits(random, 3)}-${digits(random, 3)}`,
		(random) => digits(random, 8),
	),
	tax_id: anyOf(
		// US EIN.
		(random) => `${digits(random, 2)}-${digits(random, 7)}`,
		// EU VAT.
		(random) => `${alpha(2)}${digits(random, 9)}`,
	),

	email_address: anyOf(
		() => faker.internet.email(),
		() => faker.internet.email({ provider: "example.org" }),
		// A display-name form, which a bare address pattern can miss.
		() => `${faker.person.fullName()} <${faker.internet.email()}>`,
		// Plus-addressing, which some matchers truncate at the plus.
		() => faker.internet.email().replace("@", `+${faker.string.alpha(4)}@`),
	),
	phone_number: anyOf(
		() => faker.phone.number({ style: "national" }),
		() => faker.phone.number({ style: "international" }),
		(random) =>
			`${digits(random, 3)}.${digits(random, 3)}.${digits(random, 4)}`,
		(random) => `+44 ${digits(random, 4)} ${digits(random, 6)}`,
		(random) =>
			`(${digits(random, 3)}) ${digits(random, 3)}-${digits(random, 4)} ext. ${digits(random, 3)}`,
	),
	street_address: anyOf(
		() => faker.location.streetAddress(),
		() => faker.location.streetAddress(true),
		() => `PO Box ${faker.number.int({ min: 100, max: 99_999 })}`,
	),
	address: () => faker.location.streetAddress({ useFullAddress: true }),
	postal_code: anyOf(
		() => faker.location.zipCode("#####"),
		() => faker.location.zipCode("#####-####"),
		// UK and Canadian shapes, which a five-digit pattern misses entirely.
		() =>
			`${alpha(2)}${faker.number.int({ min: 1, max: 99 })} ${faker.number.int({ min: 1, max: 9 })}${alpha(2)}`,
		() =>
			`${alpha(1)}${faker.number.int({ min: 0, max: 9 })}${alpha(1)} ${faker.number.int({ min: 0, max: 9 })}${alpha(1)}${faker.number.int({ min: 0, max: 9 })}`,
	),
	city: () => faker.location.city(),
	state: anyOf(
		() => faker.location.state(),
		() => faker.location.state({ abbreviated: true }),
	),
	country: anyOf(
		() => faker.location.country(),
		() => faker.location.countryCode("alpha-2"),
		() => faker.location.countryCode("alpha-3"),
	),

	payment_card: anyOf(
		// Visa, Mastercard, and Amex differ in prefix, length, and grouping;
		// each exercises a different branch of a card matcher.
		(random) => withLuhn(`4${digits(random, 14)}`),
		(random) => group(withLuhn(`4${digits(random, 14)}`), 4, " "),
		(random) => group(withLuhn(`4${digits(random, 14)}`), 4, "-"),
		(random) => withLuhn(`5${random.integer(1, 5)}${digits(random, 13)}`),
		// Amex: 15 digits, grouped 4-6-5.
		(random) => {
			const value = withLuhn(`3${random.pick([4, 7])}${digits(random, 12)}`);
			return `${value.slice(0, 4)} ${value.slice(4, 10)} ${value.slice(10)}`;
		},
	),
	card_security_code: anyOf(
		(random) => digits(random, 3),
		// Amex uses four.
		(random) => digits(random, 4),
	),
	card_expiry: anyOf(
		(random) => `${month(random)}/${random.integer(27, 32)}`,
		(random) => `${month(random)}/20${random.integer(27, 32)}`,
		(random) => `${month(random)}-${random.integer(27, 32)}`,
	),
	bank_account: anyOf(
		(random) => digits(random, 10),
		(random) => digits(random, 12),
		(random) =>
			`${digits(random, 4)} ${digits(random, 4)} ${digits(random, 4)}`,
	),
	bank_routing: (random) => digits(random, 9),
	iban: anyOf(
		() => faker.finance.iban(),
		// Printed in groups of four, as a bank statement shows it.
		() => group(faker.finance.iban(), 4, " "),
	),
	swift_code: () => faker.finance.bic(),
	crypto_address: anyOf(
		// Ethereum.
		() => faker.finance.ethereumAddress(),
		// Bitcoin P2PKH, base58, leading 1.
		(random) => `1${base58(random, random.integer(25, 33))}`,
		// Bitcoin P2SH, base58, leading 3.
		(random) => `3${base58(random, random.integer(25, 33))}`,
		// Bitcoin bech32, the modern form, entirely different alphabet.
		(random) => `bc1q${bech32(random, 38)}`,
	),
	monetary_amount: anyOf(
		(random) => `$${random.integer(100, 999_999).toLocaleString("en-US")}`,
		(random) => `USD ${random.integer(100, 999_999)}.${digits(random, 2)}`,
		(random) =>
			`€${random.integer(100, 999_999).toLocaleString("de-DE")},${digits(random, 2)}`,
	),

	medical_id: anyOf(
		(random) => `MRN-${digits(random, 8)}`,
		(random) => `MRN${digits(random, 7)}`,
		(random) => digits(random, 9),
	),
	insurance_id: anyOf(
		(random) => `${alpha(3)}${digits(random, 9)}`,
		(random) => `${alpha(1)}${digits(random, 8)}-${digits(random, 2)}`,
	),
	prescription_id: (random) => `RX${digits(random, 9)}`,

	ip_address: anyOf(
		() => faker.internet.ipv4(),
		// Full IPv6, and the compressed form a v4-only pattern never sees.
		() => faker.internet.ipv6(),
		// Compressed form: the `::` elision a strict v4 pattern never matches.
		() =>
			`2001:db8::${faker.string.hexadecimal({ length: 4, prefix: "", casing: "lower" })}`,
		// CIDR notation, common in logs and configuration.
		(random) => `${faker.internet.ipv4()}/${random.integer(8, 32)}`,
	),
	mac_address: anyOf(
		() => faker.internet.mac(),
		() => faker.internet.mac({ separator: "-" }),
		() => faker.internet.mac().replaceAll(":", "").toUpperCase(),
	),
	url: anyOf(
		() => faker.internet.url(),
		() => `${faker.internet.url()}/${faker.lorem.slug()}`,
		() => `${faker.internet.url()}?id=${faker.string.alphanumeric(8)}`,
		() => faker.internet.domainName(),
	),
	username: anyOf(
		() => faker.internet.username(),
		() => `@${faker.internet.username().toLowerCase()}`,
		() => faker.internet.displayName(),
	),
	device_id: anyOf(
		() => faker.string.uuid(),
		() => faker.string.uuid().toUpperCase(),
		() => faker.string.alphanumeric({ length: 16, casing: "upper" }),
	),
	case_number: anyOf(
		(random) => `CASE-${digits(random, 7)}`,
		(random) => `${random.integer(2020, 2026)}-CV-${digits(random, 5)}`,
		(random) => `No. ${digits(random, 2)}-${digits(random, 4)}`,
	),
	api_key: anyOf(
		() => `sk_live_${faker.string.alphanumeric(32)}`,
		() => `sk_test_${faker.string.alphanumeric(32)}`,
		() => faker.string.hexadecimal({ length: 40, prefix: "" }),
		// A JWT-shaped token, three base64url segments.
		() =>
			`eyJ${faker.string.alphanumeric(20)}.eyJ${faker.string.alphanumeric(30)}.${faker.string.alphanumeric(43)}`,
	),
	password: anyOf(
		() => faker.internet.password({ length: 12 }),
		() => faker.internet.password({ length: 20, memorable: false }),
	),
	auth_token: () => `Bearer ${faker.string.alphanumeric(40)}`,

	organization_name: anyOf(
		() => faker.company.name(),
		() => `${faker.company.name()}, Inc.`,
		() => `${faker.company.name()} GmbH`,
	),
	occupation: () => faker.person.jobTitle(),
	department_name: () => `${faker.commerce.department()} Department`,
};

/**
 * Returns whether a label has a real builder.
 *
 * Used to fail a spec that asks for a label the generator cannot fabricate
 * well, rather than quietly planting a placeholder that no detector would
 * recognize and that would then score as a miss.
 */
export function isFabricable(label: Label): boolean {
	return label in BUILDERS;
}

/**
 * Derives alternative renderings of a value.
 *
 * The point of surfaces: one person written six ways is one subject, and a
 * pipeline that catches the canonical spelling but misses the initials has
 * still leaked. Only forms that make sense for the value are produced.
 */
function deriveVariant(
	label: Label,
	value: string,
	surface: SurfaceForm,
	random: Random,
): string | undefined {
	switch (surface) {
		case "canonical":
			return value;

		case "abbreviated": {
			if (label !== "person_name") return undefined;
			const parts = value.split(" ");
			const first = parts[0];
			const last = parts.at(-1);
			if (!first || !last || parts.length < 2) return undefined;
			// "Dana Reyes" becomes "D. Reyes".
			return `${first[0]}. ${last}`;
		}

		case "misspelled": {
			// Transpose two adjacent letters, the way a human mistypes. Positions
			// touching a space are excluded: swapping across a word boundary gives
			// "Apri lCase", which is not a typo anyone makes and would have the
			// misspelled surface testing word segmentation rather than fuzzy
			// matching.
			const positions: number[] = [];
			for (let i = 1; i < value.length - 2; i++) {
				if (
					/[a-zA-Z]/.test(value[i] ?? "") &&
					/[a-zA-Z]/.test(value[i + 1] ?? "")
				) {
					positions.push(i);
				}
			}
			if (positions.length === 0) return undefined;

			const at = random.pick(positions);
			return (
				value.slice(0, at) + value[at + 1] + value[at] + value.slice(at + 2)
			);
		}

		case "reformatted": {
			// Repunctuate a structured identifier: 555-01-0199 to 555 01 0199.
			if (value.includes("-")) return value.replaceAll("-", " ");
			if (value.includes(" ")) return value.replaceAll(" ", "-");

			// An unpunctuated identifier still has a reformatted form: introduce
			// the separators a reader would. Returning nothing here would make a
			// declared surface silently unavailable, which fails the record.
			if (/^\d{9}$/.test(value)) {
				return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
			}
			if (/^\d{8,}$/.test(value)) {
				return group(value, 4, " ");
			}
			return undefined;
		}

		case "signature": {
			if (label !== "person_name") return undefined;
			const parts = value.split(" ");
			if (parts.length < 2) return undefined;
			// Initials, as they would appear in a signature block.
			return parts.map((part) => part[0]).join(".") + ".";
		}

		case "embedded": {
			if (label !== "person_name") return undefined;
			const parts = value.toLowerCase().split(" ");
			const first = parts[0];
			const last = parts.at(-1);
			if (!first || !last || parts.length < 2) return undefined;
			// The name inside an email address, which pattern matchers miss.
			return `${first}.${last}@example.com`;
		}

		// Applied by a renderer's lossy channel, not derivable here.
		case "transcribed":
			return undefined;

		default:
			return undefined;
	}
}

/**
 * Fabricates one entity.
 *
 * @param id - Stable identifier, unique within the record
 * @param label - What kind of value to build
 * @param surfaces - Which renderings to derive, beyond the canonical one
 * @param random - The record's own stream, so one record's values do not shift
 * when another record changes
 */
export function fabricate(
	id: string,
	label: Label,
	surfaces: readonly SurfaceForm[],
	random: Random,
	fixed?: string,
): Entity {
	const build = BUILDERS[label];
	const value = fixed ?? (build ? build(random) : faker.lorem.word());

	const variants: Partial<Record<SurfaceForm, string>> = {};
	for (const surface of surfaces) {
		if (surface === "canonical") continue;
		const variant = deriveVariant(label, value, surface, random);
		if (variant !== undefined) variants[surface] = variant;
	}

	return {
		id,
		label,
		value,
		...(Object.keys(variants).length > 0 ? { variants } : {}),
	};
}

/**
 * Seeds faker from a record's own stream.
 *
 * Faker keeps global state, so it has to be reseeded per record; deriving the
 * seed from the record's stream keeps the two sources of randomness in step
 * without either depending on how much the other consumed.
 */
export function seedFaker(random: Random): void {
	faker.seed(random.integer(0, Number.MAX_SAFE_INTEGER));
}
