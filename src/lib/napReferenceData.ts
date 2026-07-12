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
// not matched folds into the "other" residual. Order = draw order (biggest
// first for the typical year). `match` is tested against the line's labelBg.
export type TaxTypeId = "vat" | "pit" | "cit" | "excise" | "customs" | "other";

export const TAX_TYPES: {
  id: TaxTypeId;
  bg: string;
  en: string;
  color: string;
  /** keyword(s) matched (case-insensitive substring) against the КФП labelBg */
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
export const TAX_REVENUE_GROUP = /данъчни приходи/i;

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
export const TAX_GAP = {
  vat: {
    gapPct: 8.6,
    gapEur: 781_000_000,
    euPct: 9.5,
    year: 2023,
  },
  pit: {
    gapPct: 13.8,
    euPct: null as number | null,
    year: 2023,
  },
} as const;
