/**
 * Types for parsing data.egov.bg's daily Commerce Registry (TR) JSON dumps and
 * for the reconstructed company state.
 *
 * See docs/plans/mp-financial-connections-slice3-tr-design.md for the schema
 * derivation. The TR JSON is verbose: every leaf scalar is wrapped as
 * { "_": "value" } and every collection is an array. The parser unwraps this
 * into clean change events.
 */

/** Roles a person can hold in a Bulgarian commercial entity or ЮЛНЦ. */
export type TrRole =
  | "manager"
  | "representative"
  | "director" // BoardOfDirectors member
  | "board_of_managers"
  | "controlling_board"
  | "procurator"
  | "liquidator"
  | "branch_manager"
  | "partner"
  | "sole_owner"
  | "actual_owner"
  | "foreign_trader"
  // Non-profit legal entity (ЮЛНЦ) roles — сдружения/фондации/читалища.
  | "ngo_board" // член на управителния орган (управителен съвет)
  | "ngo_representative" // представляващ ЮЛНЦ
  | "trustee" // настоятел (читалищно настоятелство)
  | "verifier"; // член на проверителна комисия

/** What scalar field on the company itself a meta event refers to. */
export type TrCompanyMetaField =
  | "name"
  | "legal_form"
  | "seat"
  | "funds"
  | "deposited_funds"
  | "cessation"
  | "addemption"
  | "bankruptcy_open"
  | "bankruptcy_declared"
  | "liquidation"
  // ЮЛНЦ-specific metadata.
  | "objectives" // цели
  | "means" // средства за постигане на целите
  | "public_benefit" // определено за общественополезна дейност
  | "private_benefit"; // определено за частна дейност

export type TrPersonAddedEvent = {
  kind: "person_added";
  uic: string;
  companyName: string | null;
  role: TrRole;
  personName: string;
  // NOTE: the source `Indent` element holds a hash+salt of the person's EGN.
  // EGN is sensitive personal data under Bulgarian law; we do not extract,
  // store, or display it (or its hash) anywhere — not in events, not in
  // SQLite, not in /public outputs. Person-level joins are by normalized
  // plain-text name only. See docs/plans/mp-financial-connections-slice3-tr-design.md.
  positionLabel: string | null;
  /** Country of the person (CountryName, e.g. "БЪЛГАРИЯ"; falls back to the
   * ISO CountryCode). Used to flag foreign-controlled entities. Not personal
   * data — a jurisdiction, not an identifier. */
  country: string | null;
  /** For partners/owners — the declared capital share as an absolute amount
   * (e.g. 3825) + its currency. The percentage is derived downstream (a
   * partner's amount ÷ the company's total partner shares). */
  shareAmount: number | null;
  shareCurrency: string | null;
  filingDate: string; // ISO
  recordId: string;
  groupId: string | null;
  fieldIdent: string;
};

/** Section-level wipe: TR Erase events carry no record refs, so erasing a
 * section means "delete all currently-active records of this fieldIdent for
 * this uic". A subsequent Add reseeds the section. */
export type TrPersonSectionErasedEvent = {
  kind: "person_section_erased";
  uic: string;
  fieldIdent: string;
  filingDate: string;
};

export type TrCompanyMetaEvent = {
  kind: "company_meta";
  uic: string;
  field: TrCompanyMetaField;
  value: string | null;
  filingDate: string;
  recordId: string | null;
  fieldIdent: string;
};

export type TrCompanyMetaErasedEvent = {
  kind: "company_meta_erased";
  uic: string;
  recordId: string;
  fieldIdent: string;
  filingDate: string;
};

export type TrChangeEvent =
  | TrPersonAddedEvent
  | TrPersonSectionErasedEvent
  | TrCompanyMetaEvent
  | TrCompanyMetaErasedEvent;

/** State of one person record attached to a company. `erasedAt === null`
 * means currently active; a non-null value preserves the historical link so
 * Phase-4 reverse lookups ("ever held this role") still work.
 *
 * NB: no EGN-derived field is stored here. People are identified across
 * filings by normalized plain-text name only (see policy in
 * docs/plans/mp-financial-connections-slice3-tr-design.md). */
export type TrPersonState = {
  role: TrRole;
  name: string;
  nameNormalized: string;
  positionLabel: string | null;
  country: string | null;
  shareAmount: number | null;
  shareCurrency: string | null;
  recordId: string;
  groupId: string | null;
  fieldIdent: string;
  addedAt: string;
  erasedAt: string | null;
};

export type TrCompanyState = {
  uic: string;
  name: string | null;
  legalForm: string | null;
  seat: string | null;
  funds: { amount: string; currency: string } | null;
  status:
    | "active"
    | "in_liquidation"
    | "bankrupt"
    | "ceased"
    | "erased"
    | "unknown";
  lastUpdated: string | null;
  /** ЮЛНЦ metadata (null for commercial entities). */
  objectives: string | null;
  means: string | null;
  publicBenefit: boolean | null;
  privateBenefit: boolean | null;
  /** keyed by `${recordId}|${fieldIdent}` — the natural unique-id of a record. */
  persons: Map<string, TrPersonState>;
};
