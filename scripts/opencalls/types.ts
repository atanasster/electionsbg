// The one shape every open-calls parser emits and the loader consumes.
//
// Kept deliberately close to migration 142's columns so the loader is a projection rather
// than a translation — a second mapping layer is where a `date_precision` gets lost.
//
// See docs/plans/funds-module-v2.md §4 for why the date and money fields are shaped this
// way; the short version is that both distinctions are STRUCTURAL, not conventions:
//   * an 'exact' call must carry closesAt; an 'indicative' one must carry periodLabel and
//     must NOT carry closesAt, so a forecast can never be read as a deadline;
//   * money stays NULL until a human reviews it, because an unverified figure in a
//     sortable column silently ranks the page.

/** Who may actually apply. Derived from the source's own eligibility prose by
 *  `audience.ts` — never guessed. `unknown` is a real answer („не е уточнено") and is what
 *  keeps institutional procedures (Техническа помощ, rail TEN-T) out of a small business's
 *  default view without pretending we know they are excluded. */
export type Audience =
  | "business"
  | "farmer"
  | "municipality"
  | "ngo"
  | "individual"
  | "school"
  | "institution"
  | "unknown";

export const AUDIENCES: readonly Audience[] = [
  "business",
  "farmer",
  "municipality",
  "ngo",
  "individual",
  "school",
  "institution",
  "unknown",
] as const;

/** 'call' = a real application procedure. 'consultation' = draft guidance out for public
 *  comment (ИСУН /PublicDiscussion): its date is a COMMENT deadline, its figures are draft,
 *  and it may be withdrawn. The two never share a list. */
export type CallKind = "call" | "consultation";

/** 'exact' — a published timestamp (ИСУН). 'indicative' — a month range (ДФЗ schedule). */
export type DatePrecision = "exact" | "indicative";

/** The six values `open_calls_table.status` can take. Derived in SQL from closes_at and
 *  kind — never stored, never set by a parser. Named here so consumers share one vocabulary.
 *   closed        — past its deadline (or past its comment deadline, for a consultation)
 *   consultation  — draft guidance out for public comment; NOT applyable
 *   indicative    — a forecast window (ДФЗ month range); no deadline exists yet
 *   upcoming      — published, opens later
 *   open          — applyable now */
export type CallStatus =
  | "open"
  | "upcoming"
  | "indicative"
  | "consultation"
  | "closed";

/** Where a money figure came from, and therefore whether it may reach a sortable column.
 *  See migration 142's header — 'auto' is barred, 'source' and 'reviewed' are allowed. */
export type MoneyProvenance = "none" | "source" | "auto" | "reviewed";

/** A document published alongside the call. We LINK these, never mirror them: ИСУН's URLs
 *  are GUID-keyed, so a link is always the current revision, and a mirrored „Условия" that
 *  has since been amended is worse than a dead link. */
export interface CallDoc {
  label: string;
  url: string;
}

export interface OpenCall {
  /** Which crawler produced this row. Half of the natural key. */
  source: "isun" | "sp2023" | "ahu" | "az" | "interreg";
  /** Stable id WITHIN the source: an ИСУН GUID, an intervention code, a page slug. */
  sourceKey: string;
  /** The public procedure/intervention code, when the source publishes one. */
  code: string | null;
  kind: CallKind;
  title: string;
  programmeCode: string | null;
  programmeName: string | null;
  objective: string | null;

  datePrecision: DatePrecision;
  /** ISO. Null when the source publishes no opening moment. */
  opensAt: string | null;
  /** ISO. Required when datePrecision is 'exact', forbidden when 'indicative'. */
  closesAt: string | null;
  /** The source's own words for an indicative window. Required when 'indicative'. */
  periodLabel: string | null;

  /** Money and eligibility ceilings. Null unless the source publishes them in a
   *  machine-readable field (the ДФЗ XLSX does; ИСУН's procedure page does not). */
  budgetEur: number | null;
  /** The raw budget string, always kept — several ДФЗ rows are prose („остатъчният
   *  бюджет след…") that cannot become a number without inventing one. */
  budgetNote: string | null;
  aidRatePct: number | null;
  grantMinEur: number | null;
  grantMaxEur: number | null;

  /** Verbatim eligibility text from the source. Kept whole even when `audience` resolves,
   *  because the derived facet is an indication and this is the evidence for it. */
  beneficiariesRaw: string | null;
  audience: Audience[];
  territory: string | null;

  sourceUrl: string;
  docs: CallDoc[];
  /** Defaults to 'none'. A parser that reads structured money columns (the ДФЗ XLSX) sets
   *  'source'; Stage 7 extraction sets 'auto'. The DDL refuses money without one of
   *  'source' | 'reviewed'. */
  enrichment?: MoneyProvenance;
}

/** What a crawl reports about itself, so "returned zero rows" and "never ran" stay
 *  distinguishable in the UI. Written to `open_calls_crawl`. */
export interface CrawlStamp {
  source: OpenCall["source"];
  crawledAt: string;
  rowsSeen: number;
  ok: boolean;
  note: string | null;
}

/** What a snapshot file under data/opencalls/<source>.json holds. Committed: at ~66 rows
 *  the size objection that drives PG-only for the 82k-row contracts corpus does not apply,
 *  and git history then becomes a free archive of what was open when. */
export interface OpenCallsSnapshot {
  source: OpenCall["source"];
  crawledAt: string;
  calls: OpenCall[];
}

/** Structural validation of the two invariants the database also enforces, so a parser bug
 *  fails in the parser's own unit test rather than as a CHECK violation mid-load.
 *  Returns the problems; an empty array means the row is well-formed. */
export const validateCall = (c: OpenCall): string[] => {
  const bad: string[] = [];
  if (!c.sourceKey) bad.push("sourceKey is empty");
  if (!c.title?.trim()) bad.push("title is empty");
  if (!c.sourceUrl) bad.push("sourceUrl is empty");
  if (c.datePrecision === "exact" && !c.closesAt)
    bad.push("exact call without closesAt");
  if (c.datePrecision === "indicative") {
    if (c.closesAt) bad.push("indicative call carrying closesAt");
    if (!c.periodLabel) bad.push("indicative call without periodLabel");
  }
  if (c.opensAt && c.closesAt && c.opensAt > c.closesAt)
    bad.push("opensAt after closesAt");
  return bad;
};
