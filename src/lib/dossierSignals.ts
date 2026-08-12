// A9 + B4 — risk signals derivable from the ЦАИС ЕОП dossier.
// docs/plans/tender-dossier-ingest-v1.md §5 (A9, B4).
//
// These are the signals the DOSSIER makes possible and the notice header alone did
// not: what the buyer published, when they published it, and what the specification
// says. Pure and React-free so the panel, the AI tools and any Node aggregator share
// one definition — same posture as tenderTransparency.ts.
//
// ⚠️ EVERY SIGNAL IS TRI-STATE, and that is the whole design. `null` means "this
// dossier cannot answer the question", which is a large and honest share of the
// corpus: the 2020–2023 notices expose no award criteria at all, tier-B spec text
// exists for a minority of procedures, and a procedure we have not crawled has no
// dossier. A boolean would force every one of those into `false` — i.e. into "we
// checked and it is fine" — which is a claim about a procurement we never made.
//
// ⚠️ NONE OF THESE IS A FINDING OF WRONGDOING. They are review prompts calibrated
// on the Bulgarian corpus, in the same register as the normalcy panels.

export type SignalVerdict = true | false | null;

export type DossierSignalKey =
  | "noSpecNamed"
  | "documentDuringOfferPhase"
  | "priceOnlyCriterion"
  | "shortOfferWindow"
  | "cancelledAfterCommittee"
  | "brandWithoutEquivalent";

export type DossierSignal = {
  key: DossierSignalKey;
  /** true = fired, false = checked and clear, null = not answerable here. */
  verdict: SignalVerdict;
  /** Why it is null, when it is — shown instead of a verdict. */
  unavailable?: string;
  /** Supporting number, when the signal has one. */
  detail?: string;
};

export type DossierSignalInput = {
  documents: {
    source: string;
    kind: string | null;
    created_at: string | null;
  }[];
  notices: { award_criteria: string[] | null }[];
  announcements: { title: string | null; created_at: string | null }[];
  offerPhaseStart: string | null;
  offerPhaseEnd: string | null;
  isCancelled: boolean;
  /** Extracted specification text, when tier B has it for this procedure. */
  specText: string | null;
};

const DAY_MS = 86_400_000;

const days = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const t0 = Date.parse(a);
  const t1 = Date.parse(b);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  return (t1 - t0) / DAY_MS;
};

/**
 * ⚠️ "No file is NAMED like a specification" — NOT "no specification was published".
 *
 * The register carries no document-type field, so this rides a filename classifier
 * that matches ~70% of tenders (eop_doc_kind.ts). A buyer who called theirs
 * "Част II" or "Приложение № 1.1" trips it while having published one. It fires
 * only when the procedure published attachments AND none of them is spec-named,
 * which is the narrowest honest form; with no attachments at all the answer is null,
 * because then we are looking at a crawl gap rather than at the buyer.
 */
const noSpecNamed = (i: DossierSignalInput): DossierSignal => {
  const attachments = i.documents.filter((d) => d.source === "attachment");
  if (!attachments.length)
    return {
      key: "noSpecNamed",
      verdict: null,
      unavailable: "no attachments captured for this procedure",
    };
  const named = attachments.filter((d) => d.kind === "spec").length;
  return {
    key: "noSpecNamed",
    verdict: named === 0,
    detail: `${attachments.length} attachment(s), ${named} named as a specification`,
  };
};

/**
 * A TENDER DOCUMENT published after the offer phase opened.
 *
 * Bidders price the documents that existed when they started; one added later moves
 * the target mid-race, and one added close to the deadline leaves no time to react.
 *
 * ⚠️ ATTACHMENTS ONLY. Award-stage documents (протоколи, доклади, решения) post-date
 * the offer phase BY DEFINITION — measured 6,515 of 6,523, i.e. 99.9%. Counting them
 * makes the signal fire on 79.4% of procedures instead of 4.1%: a 19x inflation that
 * says nothing except "the committee met after bids closed", which is how procurement
 * works. `noSpecNamed` already scopes to attachments; this now matches it.
 *
 * ⚠️ NOT "replaced" — `is_previous_version` is all-zero across the captured corpus,
 * so the register does not expose supersession to us and we do not claim it.
 */
const documentDuringOfferPhase = (i: DossierSignalInput): DossierSignal => {
  const start = i.offerPhaseStart ? Date.parse(i.offerPhaseStart) : NaN;
  // Guard the parse. Without it NaN makes every comparison false and the signal
  // returns "checked and clear" for a date it could not read at all.
  if (!Number.isFinite(start))
    return {
      key: "documentDuringOfferPhase",
      verdict: null,
      unavailable: "no readable offer-phase start",
    };
  const dated = i.documents.filter(
    (d) =>
      d.source === "attachment" &&
      d.created_at &&
      Number.isFinite(Date.parse(d.created_at)),
  );
  if (!dated.length)
    return {
      key: "documentDuringOfferPhase",
      verdict: null,
      unavailable: "no attachment carries a readable publication date",
    };
  const late = dated.filter((d) => Date.parse(d.created_at as string) > start);
  return {
    key: "documentDuringOfferPhase",
    verdict: late.length > 0,
    detail: `${late.length} of ${dated.length} attachment(s) published after the offer phase opened`,
  };
};

/**
 * Awarded on price alone.
 *
 * Legal and ordinary for a commodity; a review prompt on complex works, where the
 * cheapest bid and the best outcome part company. null for the entire 2020–2023
 * tier, which exposes no criteria — rendering that as `false` would assert
 * multi-criteria evaluation for three years of procurements.
 */
const priceOnlyCriterion = (i: DossierSignalInput): DossierSignal => {
  const withCriteria = i.notices.filter(
    (n) => n.award_criteria && n.award_criteria.length,
  );
  if (!withCriteria.length)
    return {
      key: "priceOnlyCriterion",
      verdict: null,
      unavailable: "the notice does not expose award criteria (pre-eForms)",
    };
  const all = withCriteria.flatMap((n) => n.award_criteria as string[]);
  const norm = all.map((c) => c.trim().toLowerCase());
  // ⚠️ CLOSED VOCABULARY, PINNED. BT-539-Lot is an enum and the corpus uses exactly
  // these three (measured: Цена / Качество / Разходи, 1,127 of 1,516 price-only).
  // Without the pin an unrecognised token falls through `every(=== цена)` to FALSE,
  // i.e. to "multi-criteria" — asserting a richer evaluation than the notice
  // described, which is the wrong direction to be wrong in.
  const KNOWN = new Set(["цена", "качество", "разходи"]);
  const unknown = norm.filter((c) => !KNOWN.has(c));
  if (unknown.length)
    return {
      key: "priceOnlyCriterion",
      verdict: null,
      unavailable: `unrecognised award criterion: ${[...new Set(unknown)].join(", ")}`,
    };
  return {
    key: "priceOnlyCriterion",
    verdict: norm.every((c) => c === "цена"),
    detail: `criteria: ${[...new Set(all)].join(", ")}`,
  };
};

/** The EU reference minimum for an open procedure, in days. Below it, competition
 *  is suppressed by the calendar rather than by the market. */
export const SHORT_WINDOW_DAYS = 14;

const shortOfferWindow = (i: DossierSignalInput): DossierSignal => {
  const d = days(i.offerPhaseStart, i.offerPhaseEnd);
  if (d === null)
    return {
      key: "shortOfferWindow",
      verdict: null,
      unavailable: "the offer phase has no start or end",
    };
  // ⚠️ A NEGATIVE window is corrupt data, not a very short deadline. One real row
  // ends 61.8 days before it starts; reporting that as "fires, -62 day window" is a
  // finding about the register's data quality dressed up as one about the buyer.
  if (d < 0)
    return {
      key: "shortOfferWindow",
      verdict: null,
      unavailable: `the offer phase ends before it starts (${d.toFixed(1)} days)`,
    };
  return {
    key: "shortOfferWindow",
    verdict: d < SHORT_WINDOW_DAYS,
    // ⚠️ floor, not round: Math.round printed "14 day window" for the 27 real
    // procedures in [13.5, 14) that it simultaneously flagged as under 14.
    detail: `${Math.floor(d)} day window`,
  };
};

/**
 * The procedure was cancelled AND a committee had met.
 *
 * ⚠️ NOT AN ORDERING CLAIM, despite what "after" would suggest. Nothing in this
 * input carries a cancellation DATE — `tenders.is_cancelled` is a flag — so
 * "cancelled after the committee met" is not derivable and is not asserted. What
 * fires is the co-occurrence, which is the honest weaker statement: evaluation was
 * under way at some point and the procedure ended without an award.
 */
const cancelledAfterCommittee = (i: DossierSignalInput): DossierSignal => {
  if (!i.announcements.length)
    return {
      key: "cancelledAfterCommittee",
      verdict: null,
      unavailable: "no award-stage record captured",
    };
  const committee = i.announcements.some((a) =>
    /протокол|доклад/i.test(a.title ?? ""),
  );
  if (!committee)
    return {
      key: "cancelledAfterCommittee",
      verdict: null,
      unavailable: "no committee protocol in the record",
    };
  return {
    key: "cancelledAfterCommittee",
    verdict: i.isCancelled,
    detail: i.isCancelled
      ? "cancelled, and a committee protocol was published"
      : undefined,
  };
};

/**
 * B4 — a brand named in the specification without "или еквивалент".
 *
 * ЗОП чл. 49 ал. 2 forbids naming a product unless the reference is followed by
 * "или еквивалентно", precisely because naming one locks the market to it.
 *
 * ⚠️ THIS SIGNAL PUBLISHES NO VERDICT, DELIBERATELY. Its "product-like token"
 * heuristic was measured against all 142 extracted specifications and matched
 * **87.6%** of them — so the guard that was supposed to make it conservative removes
 * only 12.4%, and it had degenerated into "does this document contain the phrase",
 * which the docstring explicitly said it must not be. What it actually matched:
 *
 *   • Roman numerals out of „Част III" / „Част VII" — the largest source
 *   • every capitalised noun of an entire German-language specification
 *     (`Typengr` ×117, `Tiefe`, `Breite`, `Konsole`)
 *   • material and standard classes: `PVC` ×63, `SN8`, `D400`, `PEHD`, `ISO`
 *   • interfaces: `USB`, `LED`, `HDMI`, `GPS`
 *   • EU programme codes: `BG16FFPR003-2`, `Interreg VI`
 *
 * A false positive here is not a mis-styled chip: it asserts that a named buyer
 * breached чл. 49 ал. 2. At a 1-in-8 precision that is not publishable, and no
 * threshold tuning fixes a heuristic that cannot tell a brand from a Roman numeral.
 *
 * The code path and its measurement are kept so the next attempt starts from the
 * evidence rather than from scratch. Reaching a verdict needs a real brand list
 * (a curated stop-list of the classes above is necessary but demonstrably not
 * sufficient) — until then this reports "not checkable", which is true.
 */
const BRANDISH = /\b[A-Z][A-Za-z0-9]{2,}(?:[-\s][A-Z0-9][A-Za-z0-9]*)?\b/;
const EQUIVALENT = /или\s+еквивалент/i;

/** Set true only when a validated brand list exists. See the note above. */
const BRAND_SIGNAL_PUBLISHABLE = false;

const brandWithoutEquivalent = (i: DossierSignalInput): DossierSignal => {
  if (!BRAND_SIGNAL_PUBLISHABLE)
    return {
      key: "brandWithoutEquivalent",
      verdict: null,
      unavailable:
        "brand detection is not reliable enough to publish (87.6% of specifications trip the heuristic)",
    };
  if (!i.specText || i.specText.trim().length < 200)
    return {
      key: "brandWithoutEquivalent",
      verdict: null,
      unavailable: "no extracted specification text for this procedure",
    };
  if (!BRANDISH.test(i.specText))
    return {
      key: "brandWithoutEquivalent",
      verdict: null,
      unavailable: "the specification names no product-like token",
    };
  return {
    key: "brandWithoutEquivalent",
    verdict: !EQUIVALENT.test(i.specText),
    detail: EQUIVALENT.test(i.specText)
      ? "„или еквивалент“ is present"
      : "a product-like name appears without „или еквивалент“",
  };
};

/** Every dossier signal, in display order. Signals that cannot be answered are
 *  RETURNED with verdict null rather than omitted — a caller must be able to say
 *  "we could not check this" instead of quietly showing a shorter list. */
export const computeDossierSignals = (
  i: DossierSignalInput,
): DossierSignal[] => [
  noSpecNamed(i),
  documentDuringOfferPhase(i),
  priceOnlyCriterion(i),
  shortOfferWindow(i),
  cancelledAfterCommittee(i),
  brandWithoutEquivalent(i),
];

/** How many signals fired, and how many could be evaluated at all. The pair is the
 *  honest headline: "2 of 4 checks fired" says something; "2 signals" does not say
 *  how many of the six were answerable. */
export const dossierSignalSummary = (
  signals: DossierSignal[],
): { fired: number; evaluated: number } => ({
  fired: signals.filter((s) => s.verdict === true).length,
  evaluated: signals.filter((s) => s.verdict !== null).length,
});
