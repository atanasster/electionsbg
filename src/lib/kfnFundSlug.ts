// The /pension-fund/:slug identity.
//
// DERIVED, not stored. A fund has no code in the КФН register — only a name,
// and the register writes that name in the archive's own language (`УПФ
// "ДОВЕРИЕ"` in a BG quarter, `UPF "DOVERIE"` in an EN one), so `fundName`
// joins 0 of 21 rows across a language boundary and cannot be the key.
//
// `pillar` + `companyEn` CAN: it is stable across quarters, unique within one
// (verified: 31 funds, 31 distinct pairs), and readable in a URL. The trade is
// that a company RENAME moves the URL — the same trade /school/:id makes with
// its НЕИСПУО number, and the reason the slug is worth pinning by a test.
//
// One implementation, imported by the screen AND (later) the prerender builder
// and the sitemap enumerator, so the three cannot mint different URLs for the
// same fund — the drift that gives a sitemap <loc> with no page behind it.

import { isCrawlableSlug } from "./urlSlug";

/** Lowercase, ASCII-fold the few accents the register uses, hyphenate. */
export const kfnFundSlug = (pillar: string, companyEn: string): string =>
  `${pillar}-${companyEn}`
    .toLowerCase()
    .normalize("NFD")
    // Strip combining marks, so "Bălgaria"-style spellings fold rather than
    // producing a percent-encoded slug.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Pillar abbreviation as each language writes it. */
const PILLAR_ABBR: Record<string, { bg: string; en: string }> = {
  UPF: { bg: "УПФ", en: "UPF" },
  PPF: { bg: "ППФ", en: "PPF" },
  VPF: { bg: "ДПФ", en: "VPF" },
  VPFOS: { bg: "ДПФПС", en: "VPFOS" },
};

/**
 * A fund's display name in the READER's language.
 *
 * NOT `fundName`. The register writes that in the ARCHIVE's language, so it is
 * Cyrillic in a BG quarter and Latin in an EN one — which means the raw field
 * puts `УПФ "ДОВЕРИЕ"` on the English page today, and will put `UPF "DOVERIE"`
 * on the Bulgarian page after the next English ingest. Composing it from the
 * pillar and the language-specific company name is stable in both directions,
 * and is what KfnFundsTile already does for its rows.
 */
export const kfnFundName = (
  pillar: string,
  companyBg: string,
  companyEn: string,
  bg: boolean,
): string => {
  const abbr = PILLAR_ABBR[pillar];
  const company = bg ? companyBg : companyEn;
  if (!abbr) return company;
  // Bulgarian low-9/high-6 quotes on a Bulgarian page, straight quotes on an
  // English one. The name now lands in 31 English <title>s, <h1>s and JSON-LD
  // `name` fields via the prerender, so the quote pair has to follow the reader
  // rather than the source.
  return bg ? `${abbr.bg} „${company}“` : `${abbr.en} "${company}"`;
};

/** True when a slug carries nothing but its pillar — the degenerate case.
 *
 *  `companyOf()` in parse_kfn.ts falls back to the RAW fund name when it cannot
 *  map a company, and in a Bulgarian workbook that name is entirely Cyrillic,
 *  which this slugger strips to nothing: `kfnFundSlug("UPF", 'УПФ "НОВ ФОНД"')`
 *  is just `"upf"`. Two unmapped funds in one pillar then collide onto one URL
 *  and blend into a single trend, and the same fund splits across two URLs on a
 *  BG/EN flip. Cheap to detect, invisible otherwise. */
export const isDegenerateFundSlug = (slug: string, pillar: string): boolean =>
  slug === pillar.toLowerCase();

/** The crawlable gate — one named export used by BOTH the prerender builder and
 *  the sitemap enumerator, so the two cannot disagree about which funds have a
 *  page. A gate that lives in two copies is how a sitemap grows <loc>s with no
 *  `dist/<path>/index.html` behind them.
 *
 *  Rejects the degenerate slug above (two unmapped funds would collide onto one
 *  URL and blend into a single trend) and anything that is not a plain ASCII
 *  slug — the slugger strips Cyrillic to nothing, so a fully unmapped company
 *  yields an empty or pillar-only string rather than a percent-encoded one. */
export const isCrawlableFund = (slug: string, pillar: string): boolean =>
  isCrawlableSlug(slug) && !isDegenerateFundSlug(slug, pillar);
