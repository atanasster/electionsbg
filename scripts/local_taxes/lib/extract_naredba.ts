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

const PROMIL_BASIS_RX =
  /промил(?:[^.]{0,200}(?:данъчн(?:а|ата)\s+оценк|данъчн(?:а|ата)\s+стойн))/i;

const USERS_BASIS_RX =
  /(?:бро(?:й|я)\s+ползватели|бро(?:й|я)\s+живущи|на\s+лице|на\s+обитател)/i;

const VOLUME_BASIS_RX =
  /(?:количество\s+(?:на\s+)?битови(?:те)?\s+отпадъци|съд(?:овете|ове)\s+за\s+(?:съхран|събиране)|на\s+литър|на\s+тон|по\s+(?:вид|обем)\s+на\s+съд)/i;

const AREA_BASIS_RX =
  /(?:РЗП|разгъната\s+застро(?:ена|йна)\s+площ|квадратен\s+метър)/i;

/** Detect which basis the município uses for residential ТБО.
 *  Returns the first matching basis or `null` if no strong signal. */
export const detectTboBasis = (
  text: string,
): "promil" | "users" | "area" | "volume" | null => {
  // Restrict the search to the ТБО section to avoid false hits in other
  // chapters — most naredbi label it "Раздел I — Такса за битови отпадъци"
  // or similar.
  const section = sliceTboSection(text);
  if (PROMIL_BASIS_RX.test(section)) return "promil";
  if (VOLUME_BASIS_RX.test(section)) return "volume";
  if (USERS_BASIS_RX.test(section)) return "users";
  if (AREA_BASIS_RX.test(section)) return "area";
  return null;
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

/** Roll up all extracted fields into a NaredbaBlock, dropping `null`s. */
export const buildNaredbaBlock = (
  text: string,
  meta: { year: number; url: string },
): NaredbaBlock => {
  const block: NaredbaBlock = { year: meta.year, url: meta.url };
  const basis = detectTboBasis(text);
  if (basis) {
    block.tboResidential = { basis };
    if (basis === "promil") {
      const rate = extractTboPromilRate(text);
      if (rate != null) {
        block.tboResidential.rate = rate;
        block.tboResidential.unit = "‰";
      } else {
        block.tboResidential.note =
          "Конкретната ставка се определя с ежегодно решение на общинския съвет";
      }
    }
  }
  const tourist = extractTouristTax(text);
  if (tourist) block.touristTax = tourist;
  const dog = extractDogTax(text);
  if (dog) block.dogTax = dog;
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
  // The ТБО chapter is typically 3-15 KB. Cap to 20 KB after the heading
  // to avoid bleeding into the next chapter.
  return text.slice(head, head + 20_000);
};
