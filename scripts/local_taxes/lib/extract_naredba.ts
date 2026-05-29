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

const BGN_PER_EUR = 1.95583;

const numFromStr = (s: string): number => Number(s.replace(",", "."));

/** Tourist tax — published in three common shapes:
 *  A) Category-table: "1 звезда ... X лева/евро за нощ" (Plovdiv,
 *     Балчик, Мъглиж, Петрич, Razgrad). We anchor on "1 звезда" / "една
 *     звезда" because the 1-star row is the cheapest and the
 *     representative minimum charge. Some naredbi list dual BGN+EUR
 *     ("0,30 лева/0,15 евро"); we prefer EUR when both appear.
 *  B) Range: "от X до Y евро за всяка нощ" (Samokov). Pick the low end.
 *  C) Single-rate: "X лева за нощувка" (the original-pattern fallback).
 *
 *  Returns EUR/нощ. If only BGN is published, converts at 1 EUR =
 *  1.95583 BGN (the Bulgarian euro-adoption rate). Sanity bounds:
 *  0.05–3.00 EUR — ЗМДТ Чл. 60 caps tourist tax at 3 лв ≈ 1.53 EUR;
 *  the upper bound catches lev-not-converted errors.
 *
 *  No section slicing: Plovdiv's "1 звезда" is at offset 43433, far
 *  past any reasonable slice from the chapter heading. The "1 звезда"
 *  anchor itself is specific enough (never appears outside a tourist-
 *  tax tariff in BG naredbi). */
export const extractTouristTax = (
  text: string,
): { value: number; unit: string } | null => {
  const inBand = (v: number): boolean =>
    Number.isFinite(v) && v >= 0.05 && v <= 3.0;

  const fromBgn = (bgn: number): number => bgn / BGN_PER_EUR;

  // A) Category table — N-star row, walked to pick the minimum rate
  //    (= cheapest accommodation = representative low tourist tax
  //    burden). Most naredbi start at "1 звезда" but Varna's tariff
  //    starts at "2 звезди" (smaller accommodations may be registered
  //    under "клас В" only). The min-rate walk handles both.
  //
  //    When BGN and EUR both appear in the same row (dual-currency
  //    naredbi), we prefer EUR. No \b — JS's `\b` only matches ASCII
  //    word boundaries (Cyrillic letters are non-word in default mode,
  //    so "звезда\b" never matches). The N-star phrasing is itself
  //    specific enough; rely on the 200-char rate-lookahead window for
  //    further gating.
  const oneStarCandidates: Array<{ eur: number; converted: boolean }> = [];
  for (const a of text.matchAll(
    /(?:[1-5]\s+звезд(?:а|и)|(?:една|две|три|четири|пет)\s+звезд(?:а|и))/gi,
  )) {
    const aEnd = (a.index ?? 0) + a[0].length;
    const win = text.slice(aEnd, aEnd + 200);
    // EUR first within window
    const eurM = win.match(/(\d+(?:[.,]\d+)?)\s*(?:евро|EUR)/i);
    if (eurM) {
      const v = numFromStr(eurM[1]);
      if (inBand(v)) {
        oneStarCandidates.push({ eur: v, converted: false });
        continue;
      }
    }
    const bgnM = win.match(/(\d+(?:[.,]\d+)?)\s*(?:лв(?:\.?)|лева|BGN)/i);
    if (bgnM) {
      const bgn = numFromStr(bgnM[1]);
      const eur = fromBgn(bgn);
      if (inBand(eur)) {
        oneStarCandidates.push({ eur, converted: true });
      }
    }
  }
  if (oneStarCandidates.length > 0) {
    const eurNative = oneStarCandidates.filter((c) => !c.converted);
    const pick = (eurNative.length > 0 ? eurNative : oneStarCandidates).reduce(
      (best, c) => (c.eur < best.eur ? c : best),
    );
    return {
      value: Math.round(pick.eur * 100) / 100,
      unit: pick.converted ? "EUR/нощ (конв. от BGN)" : "EUR/нощ",
    };
  }

  // B) Range form (Samokov) — pick the low end.
  const range = text.match(
    /от\s+(\d+(?:[.,]\d+)?)\s*(?:евро|EUR)\s*до\s+\d+(?:[.,]\d+)?\s*(?:евро|EUR)\s*за\s*(?:всяка\s+)?нощ/i,
  );
  if (range) {
    const v = numFromStr(range[1]);
    if (inBand(v)) return { value: v, unit: "EUR/нощ" };
  }

  // C) Legacy single-rate. BGN-only — convert.
  const legacy = text.match(
    /(?<!\d)(\d+(?:[.,]\d+)?)\s*(?:лв|лева|BGN)\s*за\s+(?:нощувк|реализирана\s+нощувка)/i,
  );
  if (legacy) {
    const bgn = numFromStr(legacy[1]);
    const eur = fromBgn(bgn);
    if (inBand(eur)) {
      return {
        value: Math.round(eur * 100) / 100,
        unit: "EUR/нощ (конв. от BGN)",
      };
    }
  }

  return null;
};

// Dog tax lives in the FEES naredba (НОАМТЦУ) as a такса, not in the
// TAX naredba (НОРМД) where property/tourist live. ЗМДТ Чл. 175(2)
// puts it on the ветеринарномедицинска authority, hence the placement
// in the такси document. Parsers must pass FEES text here.
//
// Sofia FEES is structured as: Чл. 2 lists every fee (куче appears in
// the list), then much later Приложение №8 carries the per-year rate.
// The naive "slice from first куче" approach misses Приложение entirely
// (Sofia's Приложение №8 sits ~15 KB past Чл. 2). We instead walk
// every "куче" mention in the whole document and gate each on a
// "година"-anchored rate within a tight 150-char window — only the
// rate-bearing mentions clear the gate.

/** Dog tax — published in three common shapes:
 *  A) Anchored inline: "Такса за притежаване на куче ... в размер на X
 *     лв/евро" (Razgrad, Maglizh, Petrich, Samokov-FEES). Often has
 *     "годишна" between куче and the rate; sometimes not (Balchik).
 *  B) Dual inline: "куче ... 10.00 лв./5.11 евро" (Balchik). Both
 *     currencies in the same row separated by `/` or `,`.
 *  C) Tabular no-unit pair: "куче 30.00 15.34" (Plovdiv) — the units
 *     are in column headers far above; we recognise the "куче NN.NN
 *     NN.NN" two-decimal pattern and take the second as EUR.
 *
 *  Anchors on specific dog-tax phrasings ("за притежаване на куче",
 *  "такса за куче", "куче ... собственици"), not bare "куче" — that
 *  avoids matching dog-related mentions in unrelated tariffs.
 *
 *  Returns EUR/година. Prefers EUR-native, converts BGN at the fixed
 *  adoption rate. Picks the min EUR across candidates so multi-zone
 *  tariffs surface the conservative lowest charge. Sanity band 2-200
 *  EUR. */
export const extractDogTax = (
  text: string,
): { value: number; unit: string } | null => {
  const inBand = (v: number): boolean =>
    Number.isFinite(v) && v >= 2 && v <= 200;

  type Candidate = { eur: number; converted: boolean };
  const candidates: Candidate[] = [];

  // Specific dog-tax anchors only — bare "куче" matches too liberally.
  const DOG_ANCHOR_RX =
    /(?:за\s+)?(?:притежаване|притежаването)\s+(?:на\s+)?куче|такса\s+(?:за\s+)?куч[ае]|куч[ае][^.]{0,40}?собственик[аи]/gi;

  for (const a of text.matchAll(DOG_ANCHOR_RX)) {
    const aEnd = (a.index ?? 0) + a[0].length;
    const win = text.slice(aEnd, aEnd + 300);

    // A+B) Look for a rate + unit (optionally dual). Picks EUR when
    //      both currencies appear in the same row.
    const singleM = win.match(
      /(\d+(?:[.,]\d+)?)\s*(лв(?:\.?)|лева|евро|EUR|BGN)/i,
    );
    if (singleM) {
      // Try dual right after: "X лв./Y евро" or "X лв. / Y евро"
      const dualWin = win.slice((singleM.index ?? 0) + singleM[0].length, 60);
      const eurAfter = dualWin.match(
        /[\s/,.-]+(\d+(?:[.,]\d+)?)\s*(?:евро|EUR)/i,
      );
      if (eurAfter) {
        const eur = Number(eurAfter[1].replace(",", "."));
        if (inBand(eur)) candidates.push({ eur, converted: false });
      } else {
        const raw = Number(singleM[1].replace(",", "."));
        const isBgn = /лв|лева|BGN/i.test(singleM[2]);
        const eur = isBgn ? raw / BGN_PER_EUR : raw;
        if (inBand(eur)) candidates.push({ eur, converted: isBgn });
      }
      continue;
    }

    // C) Tabular no-unit pair: "куче NN.NN NN.NN" (Plovdiv). The two
    //    numbers are BGN then EUR (column convention). Require two
    //    consecutive 2-decimal numbers in close proximity — distinctive
    //    enough to not false-positive on other tabular data.
    const tabularM = win.match(/(\d+\.\d{2})\s+(\d+\.\d{2})(?!\d)/);
    if (tabularM) {
      const eur = Number(tabularM[2]);
      if (inBand(eur)) candidates.push({ eur, converted: false });
    }
  }

  if (candidates.length === 0) return null;
  const eurNative = candidates.filter((c) => !c.converted);
  const pick = (eurNative.length > 0 ? eurNative : candidates).reduce(
    (best, c) => (c.eur < best.eur ? c : best),
  );
  return {
    value: Math.round(pick.eur * 100) / 100,
    unit: pick.converted ? "EUR/година (конв. от BGN)" : "EUR/година",
  };
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
