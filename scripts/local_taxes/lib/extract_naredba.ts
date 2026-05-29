// Pattern pack for extracting Tier B tax fields out of a município's
// Наредба text. Each extractor returns `null` when the field isn't
// confidently present — never guess.
//
// Two distinct naredbi typically carry these fields:
//   - **TAX naredba** ("Наредба за определяне размера на местните
//     данъци") — tourist tax, dog tax, property-tax zoning.
//   - **FEES naredba** ("Наредба за определяне и администриране на
//     местните такси и цени на услуги") — ТБО (битови отпадъци).
//
// In practice the per-município parser knows which document type its
// URL points at and calls only the matching extractors.

import type { NaredbaBlock } from "../types";

// Strong residential signal: "жилищни имоти" + a промил/на-хиляда rate
// + "пропорционално" / "данъчн[аата] оценк[аата]". When this matches,
// the município is definitely on the promil basis FOR RESIDENTIAL —
// even if the section also describes a volume option for non-residential
// (the common case under ЗМДТ Art. 67).
const RESIDENTIAL_PROMIL_RX =
  /жилищн(?:и|ите)\s+имот(?:и|ите)[^.]{0,400}?(?:промил|на\s+хиляда|‰)|(?:промил|на\s+хиляда|‰)[^.]{0,400}?жилищн(?:и|ите)\s+имот/i;

const PROMIL_BASIS_RX =
  /(?:промил|на\s+хиляда|‰)(?:[^.]{0,300}?(?:данъчн(?:а|ата|ите)\s+оценк|данъчн(?:а|ата)\s+стойн|пропорционално))/i;

const USERS_BASIS_RX =
  /(?:бро(?:й|я)\s+ползватели|бро(?:й|я)\s+живущи|на\s+лице|на\s+обитател)/i;

const VOLUME_BASIS_RX =
  /(?:количество\s+(?:на\s+)?битови(?:те)?\s+отпадъци|съд(?:овете|ове)\s+за\s+(?:съхран|събиране)|на\s+литър|на\s+тон|по\s+(?:вид|обем)\s+на\s+съд)/i;

const AREA_BASIS_RX =
  /(?:РЗП|разгъната\s+застро(?:ена|йна)\s+площ|квадратен\s+метър)/i;

/** Detect which basis the município uses for **residential** ТБО.
 *  Strategy: residential-promil pattern wins outright; otherwise fall
 *  back to the generic ordering. Returns `null` if no strong signal. */
export const detectTboBasis = (
  text: string,
): "promil" | "users" | "area" | "volume" | null => {
  // Restrict the search to the ТБО section to avoid false hits in other
  // chapters — most naredbi label it "Раздел I — Такса за битови отпадъци"
  // or similar.
  const section = sliceTboSection(text);
  // Residential-anchored promil match wins regardless of order — it's
  // the most specific signal and tells us the resident-facing rate uses
  // the property's tax-assessment value as the basis.
  if (RESIDENTIAL_PROMIL_RX.test(section)) return "promil";
  if (PROMIL_BASIS_RX.test(section)) return "promil";
  if (VOLUME_BASIS_RX.test(section)) return "volume";
  if (USERS_BASIS_RX.test(section)) return "users";
  if (AREA_BASIS_RX.test(section)) return "area";
  return null;
};

/** Lift the residential ТБО rate when the naredba carries it inline.
 *  Walks every (rate, unit) hit in the section, finds the closest
 *  "жилищни" tag preceding it within 400 chars, and rejects the match
 *  if "нежилищни" appears closer — that's the non-residential rate
 *  that often sits right above the residential one in the tariff table.
 *  Returns the lowest-numbered residential rate hit, since that's the
 *  city-centre / "zone 1" rate (other zones are typically higher). */
export const extractResidentialTboRate = (text: string): number | null => {
  const section = sliceTboSection(text);
  const rateRx = /(\d+(?:[.,]\d+)?)\s*(?:‰|на\s+хиляда|промил(?:а)?)/gi;
  const matches: number[] = [];
  for (const m of section.matchAll(rateRx)) {
    const start = m.index ?? 0;
    const before = section.slice(Math.max(0, start - 400), start).toLowerCase();
    const zhilLast = before.lastIndexOf("жилищн");
    const nezhilLast = before.lastIndexOf("нежилищн");
    // No "жилищни" tag in the lookback → not a residential rate hit.
    if (zhilLast < 0) continue;
    // "Нежилищни" sits closer to the rate than "жилищни" → this is the
    // non-residential rate, skip.
    if (nezhilLast > zhilLast) continue;
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v < 50) matches.push(v);
  }
  if (matches.length === 0) return null;
  // Filter to a plausibly-residential band (0.4-5‰). Real-world
  // residential ТБО rates almost always sit in this band per the ЗМДТ
  // benchmarks — non-residential rates are 5-8‰+ and sub-rate fractions
  // are 0.05-0.4‰. Then pick the highest hit in the band, which is
  // typically the headline total (sub-rates each sit below it).
  const inBand = matches.filter((v) => v >= 0.4 && v <= 5);
  if (inBand.length === 0) return null;
  return Math.max(...inBand);
};

/** Lift the rate for residential ТБО when it appears in the standard
 *  "X на хиляда" / "X промила" form. Returns `null` if missing or
 *  ambiguous — most Sofia-tier municípios set the rate by annual
 *  council resolution rather than putting it in the naredba itself. */
export const extractTboPromilRate = (text: string): number | null => {
  const section = sliceTboSection(text);
  // Look for patterns like "1,7 на хиляда", "0.8 промила", "промил 1,7"
  // — accept comma OR dot as decimal separator.
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:на\s+хиляда|‰|промил(?:а)?)/i,
    /(?:в\s+размер\s+на|по\s+ставка)\s+(\d+(?:[.,]\d+)?)\s*(?:на\s+хиляда|‰|промил(?:а)?)/i,
  ];
  for (const rx of patterns) {
    const m = section.match(rx);
    if (m) {
      const v = Number(m[1].replace(",", "."));
      if (Number.isFinite(v) && v > 0 && v < 50) return v;
    }
  }
  return null;
};

// Property tax on residential real estate — lives in the TAX naredba
// (Наредба за определяне размера на местните данъци, typically Чл. 5-15
// depending on the município). The anchoring is tight on purpose: we
// require "данък върху недвижими имоти" *before* the rate AND "данъчна
// оценка" *after* it. Without those anchors the regex matches almost
// any rate-shaped number in the document.
const PROPERTY_TAX_ANCHOR_RX =
  /данък(?:а|ът)?\s+върху\s+недвижими(?:те)?\s+имот(?:и|ите)/gi;
const PROPERTY_TAX_RATE_RX =
  /(\d+(?:[.,]\d+)?)\s*(?:‰|на\s+хиляда|промил(?:а|и)?)/gi;
const PROPERTY_TAX_TAIL_RX = /данъчн(?:а|ата)\s+оценк/i;

/** Lift the property-tax rate for individuals (in ‰ of данъчна оценка)
 *  from a TAX naredba's text. Scans every (rate, ‰) hit, gates each on
 *  an "данък върху недвижими имоти" anchor within 300 chars before AND
 *  "данъчна оценка" within 120 chars after — rejecting either side if a
 *  sentence-boundary period sits in between. Picks the *max* in-band
 *  hit because some municípios (Plovdiv historically) publish a lower
 *  promotional rate for new buildings alongside the standard rate; the
 *  headline rate is the higher one. Sanity bounds: 0.05-5‰ — the legal
 *  range is 0.1-4.5‰ per Чл. 22 ЗМДТ; a small margin catches edge
 *  phrasings. Returns `null` if no candidate clears all gates. */
// Strip decimal-internal periods (e.g. "2.3" → "__") before the
// sentence-boundary check below. Without this, multi-rate clauses like
// Petrich's "- 2,3 на хиляда /2.3 ‰ (нежилищни)... - 3 на хиляда /3 ‰
// (жилищни)" reject the residential rate because the "2.3" decimal in
// the preceding tariff entry looks like a sentence period.
const hasSentencePeriod = (s: string): boolean =>
  s.replace(/\d\.\d/g, "__").includes(".");

export const extractPropertyTaxIndividualsRate = (
  text: string,
): number | null => {
  const candidates: number[] = [];
  for (const m of text.matchAll(PROPERTY_TAX_RATE_RX)) {
    const rateStart = m.index ?? 0;
    const rateEnd = rateStart + m[0].length;
    const lookback = text.slice(Math.max(0, rateStart - 300), rateStart);
    // Walk every anchor occurrence in the lookback; the closest one
    // wins. Reject if a sentence-period sits between that anchor and
    // the rate.
    let anchorEndLocal = -1;
    for (const a of lookback.matchAll(
      new RegExp(PROPERTY_TAX_ANCHOR_RX.source, "gi"),
    )) {
      anchorEndLocal = (a.index ?? 0) + a[0].length;
    }
    if (anchorEndLocal < 0) continue;
    if (hasSentencePeriod(lookback.slice(anchorEndLocal))) continue;
    const lookahead = text.slice(rateEnd, rateEnd + 120);
    const tail = PROPERTY_TAX_TAIL_RX.exec(lookahead);
    if (!tail) continue;
    if (hasSentencePeriod(lookahead.slice(0, tail.index))) continue;
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v) && v >= 0.05 && v <= 5) candidates.push(v);
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
};

const TOURIST_TAX_RX =
  /туристическ(?:и|и я|ия)\s+данък[^]{0,400}?(\d+(?:[.,]\d+)?)\s*(?:лв|лева|BGN)\s*(?:за\s+(?:нощувк|реализирана\s+нощувка))/i;

/** Tourist tax — typically published as "X лева за нощувка". */
export const extractTouristTax = (
  text: string,
): { value: number; unit: string } | null => {
  const m = text.match(TOURIST_TAX_RX);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  if (!Number.isFinite(v) || v <= 0 || v > 200) return null;
  return { value: v, unit: "BGN/нощувка" };
};

const DOG_TAX_RX =
  /данък\s+(?:върху\s+)?(?:притежаването|притежаване)\s+(?:на\s+)?куче[^]{0,400}?(\d+(?:[.,]\d+)?)\s*(?:лв|лева|BGN)/i;

/** Dog tax — typically published as "X лева годишно". */
export const extractDogTax = (
  text: string,
): { value: number; unit: string } | null => {
  const m = text.match(DOG_TAX_RX);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  if (!Number.isFinite(v) || v <= 0 || v > 1000) return null;
  return { value: v, unit: "BGN/година" };
};

/** Detect the year referenced as "in force" — many naredbi carry
 *  "в сила от 1.01.YYYY" in the header. Fallback: max 4-digit year seen
 *  in the first 5 KB of text. */
export const extractInForceYear = (text: string, fallback: number): number => {
  const m = text
    .slice(0, 8000)
    .match(/в\s+сила\s+от\s+\d{1,2}[.\s-]\d{1,2}[.\s-](\d{4})/i);
  if (m) {
    const y = Number(m[1]);
    if (y >= 2000 && y < 2100) return y;
  }
  const years = Array.from(text.slice(0, 5000).matchAll(/(20\d{2})/g)).map(
    (m) => Number(m[1]),
  );
  return years.length > 0 ? Math.max(...years) : fallback;
};

/** Roll up all auto-detected fields into a NaredbaBlock. Rate detection
 *  is *not* attempted by the generic extractor — too many naredbi have
 *  multiple zones / sub-rates / non-residential rates that overlap into
 *  the residential band and produce wrong picks. Each parser passes a
 *  known headline rate explicitly via the `overrides` arg. */
export const buildNaredbaBlock = (
  text: string,
  meta: {
    year: number;
    url: string;
    overrides?: {
      tboResidentialRate?: number;
      tboResidentialZone?: string;
      touristTax?: { value: number; unit: string };
      dogTax?: { value: number; unit: string };
      propertyTaxIndividualsRate?: number;
      propertyTaxIndividualsNote?: string;
    };
  },
): NaredbaBlock => {
  const block: NaredbaBlock = { year: meta.year, url: meta.url };
  const overrides = meta.overrides ?? {};
  const basis = detectTboBasis(text);
  if (basis) {
    block.tboResidential = { basis };
    if (basis === "promil") {
      if (overrides.tboResidentialRate != null) {
        block.tboResidential.rate = overrides.tboResidentialRate;
        block.tboResidential.unit = "‰";
        if (overrides.tboResidentialZone)
          block.tboResidential.zone = overrides.tboResidentialZone;
      } else {
        // Surfacing the absence honestly is better than guessing —
        // many municípios (Sofia in particular) defer the rate to a
        // separate annual council resolution rather than printing it
        // in the naredba.
        block.tboResidential.note =
          "Конкретната ставка се определя с ежегодно решение на общинския съвет";
      }
    }
  }
  // Tourist and dog tax stay auto-detected — those values are usually
  // adjacent to a unique tax-name phrase and the regex hits cleanly.
  // Parsers can still override.
  block.touristTax =
    overrides.touristTax ?? extractTouristTax(text) ?? undefined;
  block.dogTax = overrides.dogTax ?? extractDogTax(text) ?? undefined;
  if (!block.touristTax) delete block.touristTax;
  if (!block.dogTax) delete block.dogTax;
  // Property tax on individuals — explicit-only. The extractor anchors
  // tightly on "данък върху недвижими имоти … данъчна оценка" but
  // running it against arbitrary text (e.g. a FEES naredba quoting ЗМДТ
  // Чл. 22 in an explanatory note) risks lifting a stale or wrong rate.
  // Parsers that want it pass `propertyTaxIndividualsRate` explicitly,
  // having already run `extractPropertyTaxIndividualsRate` against the
  // correct TAX-naredba text. (Sofia + Plovdiv: see parsers/sof.ts.)
  if (overrides.propertyTaxIndividualsRate != null) {
    block.propertyTaxIndividuals = {
      rate: overrides.propertyTaxIndividualsRate,
      year: meta.year,
    };
    if (overrides.propertyTaxIndividualsNote) {
      block.propertyTaxIndividuals.note = overrides.propertyTaxIndividualsNote;
    }
  }
  return block;
};

const TBO_SECTION_HEAD_RX =
  /(?:такса\s+за\s+битови\s+отпадъци|раздел\s+I\s*[—–-]?\s*такса)/i;

/** Carve out the ТБО chapter from the full naredba text so basis/rate
 *  regexes don't false-positive on tourist-tax or services-pricing
 *  sections. Falls back to the whole text if no clear section break. */
const sliceTboSection = (text: string): string => {
  const head = text.search(TBO_SECTION_HEAD_RX);
  if (head < 0) return text;
  // The ТБО chapter is typically 3-15 KB but Varna's tariff appendix
  // pushes the residential-rate clause past 130 KB into the document
  // (long history of amendments + per-zone tables). Cap at 200 KB so
  // we capture the appendices. False positives are gated downstream by
  // the "нежилищни-closer-than-жилищни" check in
  // extractResidentialTboRate.
  return text.slice(head, head + 200_000);
};
