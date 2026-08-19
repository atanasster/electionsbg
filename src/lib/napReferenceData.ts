// Dependency-free reference data for the НАП (National Revenue Agency) revenue
// pack. Imported by BOTH the pack tiles and the nav/prerender surfaces.
//
// НАП is a COLLECTOR: the pack is revenue-first. The by-tax-type composition is
// read (monthly-ish, current) from data/budget/kfp.json `snapshots[].sections`
// — the КФП revenue section, whose tax-type children are already reconstructed
// by the ingest. The КИД-2008 by-sector VAT drill (2024-only) comes from
// data/budget/revenue_breakdown/vat/2024.json.

import { REVENUE_RAMP, REVENUE_RESIDUAL } from "./customsReferenceData";

export const NAP_EIK = "131063188";
export const NAP_AWARDER_PATH = `/awarder/${NAP_EIK}`;

export { REVENUE_RAMP, REVENUE_RESIDUAL };

// The by-tax-type composition. Each bucket matches one КФП revenue-section line
// by a keyword on its Bulgarian label; anything under "Данъчни приходи" that is
// not matched folds into the "other" residual.
//
// Order = draw order, and it is FIXED rather than size-sorted: the year picker
// re-renders the same bar, so a stable segment sequence is what makes two years
// comparable at a glance. It is close to descending but NOT equal to it — excise
// outranks cit in every year of the corpus, and outranks pit in 2021/2022 — so do
// not "restore" a biggest-first order; there is no year it would be correct for.
export type TaxTypeId = "vat" | "pit" | "cit" | "excise" | "customs" | "other";

export const TAX_TYPES: {
  id: TaxTypeId;
  bg: string;
  en: string;
  color: string;
  /** Regex tested against the КФП `labelBg` (NOT `groupLabelBg` — that is what
   *  TAX_REVENUE_GROUP is for). Case-insensitive, and ANCHOR where the stem could
   *  appear mid-label: `excise` is `/^акцизи/i` so the bucket cannot grab a line
   *  merely mentioning акцизи. `buildComposition` uses `TAX_TYPES.find`, so where
   *  two patterns overlap the FIRST in array order wins. */
  match: RegExp;
}[] = [
  {
    id: "vat",
    bg: "ДДС",
    en: "VAT",
    color: REVENUE_RAMP[0],
    // "Данък върху добавенаТА стойност" carries the definite article, so match
    // the stem, not "добавена стойност" (which the -та breaks).
    match: /добавен/i,
  },
  {
    id: "pit",
    bg: "ДДФЛ",
    en: "Personal income tax",
    color: REVENUE_RAMP[1],
    match: /доходите на физически/i,
  },
  {
    id: "cit",
    bg: "Корпоративен данък",
    en: "Corporate tax",
    color: REVENUE_RAMP[2],
    match: /корпоративен данък/i,
  },
  {
    id: "excise",
    bg: "Акцизи",
    en: "Excise",
    color: REVENUE_RAMP[3],
    match: /^акцизи/i,
  },
  {
    id: "customs",
    bg: "Мита",
    en: "Customs duties",
    color: REVENUE_RAMP[4],
    match: /мита и митнически/i,
  },
];

// The КФП revenue-section group whose children are the tax types above. Lines
// carry `groupLabelBg` = this label, so the composition builder can pick tax
// leaves without walking the tree.
//
// ⚠️ ANCHORED, and the anchors are the whole point — „Неданъчни приходи" CONTAINS
// „данъчни приходи". The КФП revenue section carries exactly two group labels and
// an unanchored /данъчни приходи/i admits BOTH, so five non-tax lines (приходи и
// доходи от собственост, превишение на приходите над разходите на БНБ, приходи от
// такси, глоби/санкции/лихви, други неданъчни приходи) entered the composition.
// None matches a TAX_TYPES bucket, so they all landed in the residual that renders
// as „Други данъци" / "Other taxes" — a segment 15× too large and 90-93% not a tax,
// on a card captioned „данъчни приходи · без осигуровки". Measured 2026-08-19: the
// headline was overstated 10.3%-15.8% in EVERY year (2025: €26.13bn shown against a
// true €22.77bn; the residual €3.59bn against a true €234M).
//
// Same substring trap as the ДДС bucket's definite-article note above, one constant
// apart — caught there, missed here. Do not "simplify" the anchors away.
//
// ⚠️ The INTERIOR `\s+` is load-bearing too, and for an unrelated reason: the МФ
// source re-spaces its labels between snapshots — „Трансфери  (нето)" (double) in
// the 2021-2024 snapshots is „Трансфери (нето)" (single) in 2025-2026, and six
// labels carry interior double spaces today, one of them a tax leaf this
// composition reads. A literal single space here would fail TOTALLY and SILENTLY
// the day the МФ re-spaces this one: `buildComposition` returns null, that year
// leaves `compositions`, and NapPack's `if (!comp) return null` drops the entire
// pack — composition, VAT drill and tax gap — with nothing thrown and nothing
// logged. `budgetSlices.ts` reads the same field and already normalises for
// exactly this, with its own regression test. JS `\s` covers NBSP, so this also
// survives a U+00A0 creeping in from the XLS.
//
// Gate: src/data/procurement/useNap.test.ts.
/** Test against a line's `groupLabelBg` — NEVER `labelBg`. The depth-0 subtotal's
 *  OWN labelBg is „Данъчни приходи" and matches this pattern, so testing labelBg
 *  returns the SUBTOTAL instead of its leaves — a row carrying the correct total,
 *  which is exactly the shape that survives a spot check and then double-counts
 *  the moment it is summed beside real leaves. */
export const TAX_REVENUE_GROUP = /^\s*данъчни\s+приходи\s*$/i;

export const taxTypeLabel = (id: TaxTypeId, lang: string): string => {
  if (id === "other") return lang === "bg" ? "Други данъци" : "Other taxes";
  const t = TAX_TYPES.find((x) => x.id === id);
  return t ? (lang === "bg" ? t.bg : t.en) : id;
};

export const taxTypeColor = (id: TaxTypeId): string =>
  id === "other"
    ? REVENUE_RESIDUAL
    : (TAX_TYPES.find((x) => x.id === id)?.color ?? REVENUE_RESIDUAL);

// EU tax-gap reference numbers (CASE / DG TAXUD "VAT Gap in the EU" 2024 ed. +
// "Mind the Gap" 2025). Hard-keyed, like the curated macro tables. `gapPct` is
// the compliance gap as % of theoretical liability (VTTL); `euMedianPct` the
// EU-wide figure. NOTE: BG's VAT gap is BELOW the EU figure — that is a
// good-news stat, so the "recoverable revenue" reading benchmarks against ZERO
// (full compliance), never "close to the EU median" (which is negative for VAT).
//
// The shape is UNIFORM across entries on purpose: `gapEur`/`euPct` are `null` where
// the source publishes no figure, rather than absent keys. An `as const` with an
// inline `null as number | null` widened that one property back out of the
// assertion, so the two entries had different types and no renderer could be
// written over both.
export interface TaxGapEntry {
  /** compliance gap as % of theoretical liability (VTTL) */
  gapPct: number;
  /** absolute gap in EUR; null where the source publishes no € figure */
  gapEur: number | null;
  /** the EU-wide gap; null where the source publishes none */
  euPct: number | null;
  year: number;
}

// `as const satisfies` rather than an annotation: the annotation form widens
// `vat.euPct` to `number | null`, which is wrong at the only call site that reads
// it (NapPack renders it unconditionally, because the VAT row is the one the
// source always publishes). This way the shape is checked AND the literals survive.
export const TAX_GAP = {
  vat: { gapPct: 8.6, gapEur: 781_000_000, euPct: 9.5, year: 2023 },
  pit: { gapPct: 13.8, gapEur: null, euPct: null, year: 2023 },
} as const satisfies Record<"vat" | "pit", TaxGapEntry>;
