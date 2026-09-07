/**
 * @fileoverview The label taxonomy planted values are drawn from.
 *
 * These mirror the built-in labels in
 * {@link https://github.com/nvisycom/elide | elide}
 * (`crates/elide-core/src/entity/label/builtins.rs`), which is the canonical
 * list a pipeline detects against. Scoring compares a planted label to a
 * detected one directly, so the two vocabularies have to agree; a label the
 * harness invents on its own could never be matched, and would read as a total
 * recall failure rather than as the mismatch it is.
 *
 * Each entry carries its id, its display name, and its category. Sensitivity
 * tags (`pii`, `phi`, …) and long descriptions are deliberately left out: those
 * are policy detail that changes independently of the taxonomy, and a copy here
 * would be a stale second opinion about data the pipeline already owns. Names
 * and categories are kept because a report is read by people — a row reading
 * "national insurance or social-security equivalent" is worth more than one
 * reading `national_insurance_number`, and ninety labels need grouping into
 * sections that stay stable across runs.
 *
 * Categories describe *what the data is*, never which law governs it; mapping
 * one onto a regulatory regime is a policy concern.
 *
 * @module datatypes/label
 */

/**
 * The coarse group a label belongs to.
 *
 * Reports aggregate by category as well as by label, because ninety labels is
 * too many rows to read at a glance while thirteen categories is not.
 */
export type LabelCategory = (typeof LABEL_CATEGORIES)[number];

/**
 * Every category, in a stable order.
 */
export const LABEL_CATEGORIES = [
	/** Names and identity documents. */
	"identity",
	/** Ways to reach a person. */
	"contact",
	/** Places and geolocation. */
	"geographic",
	/** Population characteristics. */
	"demographic",
	/** Characteristics carrying heightened legal protection. */
	"protected_characteristic",
	/** Accounts, instruments, and payment data. */
	"financial",
	/** Medical identifiers and clinical data. */
	"health",
	/** Measurements of the body. */
	"biometric",
	/** Legal and criminal-justice records. */
	"judicial",
	/** Secrets granting access. */
	"credentials",
	/** Device and network identifiers. */
	"network",
	/** Companies and the people within them. */
	"organization",
	/** Entities defined by their role rather than their form. */
	"contextual",
] as const;

/**
 * Every built-in label, grouped by category.
 *
 * The `Label` union is derived from this table rather than declared alongside
 * it, so the two cannot drift: adding an entry here extends the type, and an id
 * absent from it is not a valid `Label`.
 */
export const LABELS = {
	/** Names and identity documents. */
	identity: [
		{ id: "person_name", name: "person name" },
		{ id: "date_of_birth", name: "date of birth" },
		{ id: "government_id", name: "government-issued identification number" },
		{ id: "tax_id", name: "tax identification number" },
		{ id: "drivers_license", name: "driver's license number" },
		{ id: "certificate_number", name: "certificate or license number" },
		{ id: "passport_number", name: "passport number" },
		{
			id: "national_insurance_number",
			name: "national insurance or social-security equivalent",
		},
		{ id: "vehicle_id", name: "vehicle identification number" },
		{ id: "license_plate", name: "license plate number" },
		{ id: "signature", name: "handwritten signature" },
	],
	/** Ways to reach a person. */
	contact: [
		{ id: "email_address", name: "email address" },
		{ id: "phone_number", name: "phone number" },
		{ id: "fax_number", name: "fax number" },
		{ id: "address", name: "physical or mailing address" },
		{ id: "street_address", name: "street address line" },
		{ id: "postal_code", name: "postal or ZIP code" },
		{ id: "communications_content", name: "communication message content" },
	],
	/** Places and geolocation. */
	geographic: [
		{ id: "city", name: "town or city name" },
		{ id: "state", name: "state or province" },
		{ id: "country", name: "country name" },
		{ id: "coordinates", name: "GPS coordinates" },
		{ id: "precise_geolocation", name: "precise geolocation" },
		{ id: "geolocation_metadata", name: "geolocation metadata" },
	],
	/** Population characteristics. */
	demographic: [
		{ id: "age", name: "age value" },
		{ id: "gender", name: "gender identity" },
		{ id: "nationality", name: "nationality" },
		{ id: "citizenship", name: "citizenship status" },
		{ id: "language", name: "language or dialect spoken" },
	],
	/** Characteristics carrying heightened legal protection. */
	protected_characteristic: [
		{ id: "ethnicity", name: "racial or ethnic background" },
		{ id: "religion", name: "religious affiliation" },
		{ id: "political_opinion", name: "political opinion or affiliation" },
		{ id: "trade_union_membership", name: "trade-union membership" },
		{ id: "sexual_orientation", name: "sexual orientation" },
		{ id: "sex_life", name: "sex-life information" },
	],
	/** Accounts, instruments, and payment data. */
	financial: [
		{ id: "payment_card", name: "payment card number" },
		{ id: "card_security_code", name: "payment card security code" },
		{ id: "card_track_data", name: "payment card track data" },
		{ id: "pin_block", name: "payment card PIN or PIN block" },
		{ id: "card_expiry", name: "payment card expiration date" },
		{ id: "bank_account", name: "bank account number" },
		{ id: "bank_routing", name: "bank routing or transit number" },
		{ id: "iban", name: "international bank account number" },
		{ id: "swift_code", name: "SWIFT/BIC code" },
		{ id: "crypto_address", name: "cryptocurrency wallet address" },
		{ id: "currency", name: "currency code or symbol" },
		{ id: "monetary_amount", name: "monetary amount" },
	],
	/** Medical identifiers and clinical data. */
	health: [
		{ id: "medical_id", name: "medical record number" },
		{ id: "insurance_id", name: "health insurance identifier" },
		{
			id: "prescription_id",
			name: "prescription identifier or medication regimen",
		},
		{ id: "diagnosis", name: "medical diagnosis or condition" },
		{ id: "medication", name: "medication name" },
		{ id: "health_narrative", name: "health narrative text" },
	],
	/** Measurements of the body. */
	biometric: [
		{ id: "fingerprint", name: "fingerprint biometric data" },
		{ id: "voiceprint", name: "voiceprint biometric data" },
		{ id: "retina_scan", name: "retina scan biometric data" },
		{ id: "facial_geometry", name: "facial geometry biometric data" },
		{ id: "genetic_data", name: "genetic data" },
		{ id: "face", name: "human face detected in an image or video frame" },
	],
	/** Legal and criminal-justice records. */
	judicial: [
		{ id: "criminal_record", name: "criminal conviction or offence record" },
		{ id: "criminal_charge", name: "pending criminal charge or accusation" },
		{ id: "court_case_number", name: "court case or docket number" },
		{ id: "judicial_narrative", name: "criminal-justice narrative text" },
	],
	/** Secrets granting access. */
	credentials: [
		{ id: "password", name: "password" },
		{
			id: "security_question_answer",
			name: "account security question or answer",
		},
		{ id: "api_key", name: "API key" },
		{ id: "auth_token", name: "authentication token" },
		{ id: "private_key", name: "private cryptographic key" },
	],
	/** Device and network identifiers. */
	network: [
		{ id: "url", name: "URL or hyperlink" },
		{ id: "ip_address", name: "IP address" },
		{ id: "mac_address", name: "MAC address" },
		{ id: "device_id", name: "device identifier" },
		{ id: "username", name: "username or handle" },
	],
	/** Companies and the people within them. */
	organization: [
		{ id: "organization_name", name: "organization or company name" },
		{ id: "company_id", name: "public company-registry identifier" },
		{ id: "department_name", name: "department or business-unit name" },
		{ id: "facility_name", name: "physical facility or location name" },
		{ id: "case_number", name: "case, matter, or docket number" },
		{ id: "internal_id", name: "operator-defined internal identifier" },
		{ id: "occupation", name: "occupation or job title" },
		{ id: "product", name: "product name" },
		{ id: "logo", name: "brand or organisation logo" },
	],
	/** Entities defined by their role rather than their form. */
	contextual: [
		{ id: "date_time", name: "date or time value" },
		{ id: "handwriting", name: "handwritten text" },
		{ id: "barcode", name: "barcode or QR code" },
		{ id: "individual_date", name: "individual-associated date" },
		{ id: "event", name: "named event reference" },
		{ id: "education_record", name: "education record entry" },
		{ id: "inference", name: "profile inference" },
		{ id: "unresolved", name: "unresolved entity" },
	],
} as const satisfies Record<
	LabelCategory,
	readonly { id: string; name: string }[]
>;

/**
 * A built-in label id.
 */
export type Label = (typeof LABELS)[LabelCategory][number]["id"];

/**
 * One label's definition.
 */
export interface LabelDefinition {
	/** Stable identifier, matching elide's label id. */
	id: Label;
	/** Natural-language name, as a detector would phrase it. */
	name: string;
	/** The coarse group this belongs to. */
	category: LabelCategory;
}

/**
 * Every label, in the order {@link LABELS} defines them.
 *
 * Reports iterate this so two runs list labels identically, which keeps a diff
 * between reports readable.
 */
export const LABEL_LIST: readonly LabelDefinition[] = LABEL_CATEGORIES.flatMap(
	(category) =>
		LABELS[category].map(
			(label) => ({ ...label, category }) as LabelDefinition,
		),
);

/**
 * Every label id, in the same order.
 */
export const LABEL_IDS: readonly Label[] = LABEL_LIST.map((label) => label.id);

/**
 * Labels indexed by id, for lookup while scoring.
 */
export const LABELS_BY_ID: ReadonlyMap<Label, LabelDefinition> = new Map(
	LABEL_LIST.map((label) => [label.id, label]),
);

/**
 * Returns whether a string is a known label id.
 *
 * Used when reading a detection back: an unrecognized label is reported rather
 * than silently dropped, since a label the harness does not know is a gap in
 * this file, not an absent detection.
 */
export function isLabel(value: string): value is Label {
	return LABELS_BY_ID.has(value as Label);
}

/**
 * Returns a label's display name, for report output.
 *
 * Falls back to the id, so an unknown label still names itself rather than
 * rendering as `undefined` in a report.
 */
export function labelName(id: Label | string): string {
	return LABELS_BY_ID.get(id as Label)?.name ?? id;
}
