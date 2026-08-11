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

/**
 * A registered transfer of shares (прехвърляне на дружествени дялове) — the ONE node in the
 * daily feed that names somebody LEAVING a company.
 *
 * It is what recovers a shareholder the replay never saw arrive. The feed starts
 * 2021-01-01 and `person_section_erased` can only erase a record already in state, so a
 * stake entered before the window is invisible even though the filing that ended it is on
 * disk. Measured across all 1,666 daily files: 161,953 transfers naming 112,623 distinct
 * exiting owners, ~39,100 of whom have no TR record of any kind, including 995 people the
 * site already tracks as public figures with no company links at all.
 *
 * It is an EXIT, not a range: the node says when the stake was given up and to whom, never
 * when it was acquired. Any consumer that renders a two-bound period from this is inventing
 * the other bound.
 *
 * No `Indent` here either — the transferor is identified by plain-text name, on the same
 * policy as every other person in this feed.
 */
export type TrShareTransferEvent = {
  kind: "share_transferred";
  uic: string;
  companyName: string | null;
  /** The shareholder who gave the stake up. */
  oldOwnerName: string;
  /** Who received it — context for the exit, not a claim about their entry date. */
  newOwnerName: string | null;
  /** 'sole_owner' when this filing left the recipient sole owner, else 'partner'. */
  role: TrRole;
  shareAmount: number | null;
  country: string | null;
  /** When the transfer was REGISTERED. The node's own `Date` is the contract date; this
   *  is the one every other event in this feed is stamped with, so they sort together. */
  filingDate: string;
  recordId: string;
  fieldIdent: string;
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
  | TrShareTransferEvent
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
  /**
   * When the record was ENTERED, or null when that is genuinely unknown.
   *
   * Null happens for exactly one shape: a shareholder recovered from a `ShareTransfers`
   * node (see TrShareTransferEvent) whose stake predates the 2021-01-01 feed window. The
   * transfer says when they LEFT and nothing about when they arrived, so the column is the
   * honest carrier of that ignorance — a consumer that draws a period gets no start and
   * must drop the row rather than render a zero-length or invented span.
   */
  addedAt: string | null;
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
