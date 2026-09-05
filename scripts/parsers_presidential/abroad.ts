// Resolving an abroad section to a country.
//
// 2016 and 2021 publish „Country, City" and can be read directly. The three earlier eras
// publish a CITY AND NOTHING ELSE — 2011 rows read `ЧУЖБИНА;Чужбина;Канбера;100001`, 2006
// rows are a bare city with an empty ЕКАТТЕ, 2001's carry a „гр. " prefix — so the
// country has to come from somewhere, and the only honest somewhere is evidence this
// repo already holds.
//
// ⚠⚠ THE TABLE IS DERIVED FROM THE PARLIAMENTARY CORPORA, NOT WRITTEN FROM GEOGRAPHY.
// Thirteen committed `raw_data/<parliamentary cycle>/sections.txt` name a country beside
// each abroad city, so the mapping is a MEASUREMENT over 1,248 cities rather than an
// author's recollection. That matters more here than anywhere else in this ingest: a
// hand-written table is unfalsifiable, and a wrong entry files a real polling station in
// the wrong country while looking exactly like a right one.
//
// ⚠ AND THE HARVEST HAS TO READ EVERY LAYOUT, WHICH IS NOT THE SAME AS EVERY FILE. Five
// different `sections.txt` shapes are committed, and the first cut understood only the
// 2017-and-later one — so four cycles matched nothing, were counted as read, and their
// evidence was thrown away. The cost was not merely narrower coverage: on half the record
// Бостън resolved confidently to GB, Оукланд to NZ and Триполи to GR, each a real city in
// two countries. Partial evidence does not look partial.
//
// ⚠ COVERAGE IS 245 OF 286 CITY SPELLINGS (85.7%) AND 792 OF 876 SECTIONS (90.4%), AND
// THE REST STAY NULL. Plan T3.1 is explicit: an unresolved abroad section is written with
// `country: null` AND listed in the run summary, never dropped and never guessed.
//
// ⚠ AND FOUR CITIES ARE REFUSED RATHER THAN RESOLVED — see `AMBIGUOUS_CITIES`. Each is a
// real place in two countries with sections recorded in both, so they resolve to null
// like any other unknown.
//
// ⚠⚠ THE TABLE ANSWERS FOR ABROAD SECTIONS ONLY, AND THE CALLER MUST KNOW ITS SECTION IS
// ABROAD BEFORE ASKING. Nine keys are also the names of Bulgarian villages — Димитровград
// (Serbia), Охрид, Прилеп, Тетово (North Macedonia), Сараево, Подгорица, Есен, Мугла,
// Кортен — so handing this a domestic settlement name files its votes in another country.
// Every reader in this directory already marks abroad sections structurally (a `32`
// prefix, `29` in 2011, a form code in 2016/2021); that flag is the gate, not this table.
//
// Plan: docs/plans/presidential-elections-v1.md T3.1, §2.5-12.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Where the derived table is committed. */
export const ABROAD_CITIES_PATH = path.join(
  PROJECT_ROOT,
  "data/presidential/abroad_cities.json",
);

/**
 * Country spellings the raw feeds use that `data/settlements.json` does not carry.
 *
 * ⚠ EVERY ENTRY IS THE SAME COUNTRY UNDER ANOTHER NAME, never a country the catalogue
 * lacks. That distinction is what keeps this from becoming a place to invent entities:
 * „Индонезия" appears in the feed and is deliberately NOT here, because
 * `settlements.json` has no Indonesia and inventing an id for one would put a country on
 * the map that the rest of the site cannot render.
 *
 * ⚠ Dropping an unrecognised country name is NOT free, and it is why this table exists
 * at all. Measured without it, „Пърт" resolved cleanly to Australia — because the UK
 * spelling beside it had been discarded, so the city looked unambiguous. Discarding
 * evidence manufactures certainty.
 */
export const COUNTRY_ALIASES: Record<string, string> = {
  Великобритания: "GB",
  "Обединено кралство Великобритания и Северна Ирландия": "GB",
  "ФР Германия": "DE",
  "Германия ФР": "DE",
  "Република Македония": "MK",
  "Република Северна Македония": "MK",
  "Република Южна Африка": "ZA",
  "Чешка република": "CZ",
  Азърбайджан: "AZ",
  "Обединени арабски емирства": "AE",
  // Both follow `scripts/helpers/lookup_international_sections.ts`, which already maps
  // these two spellings the same way for the parliamentary tree — repo precedent rather
  // than a fresh judgement.
  Корея: "KR",
  Македония: "MK",
};

/**
 * Cities the parliamentary corpus places in more than one country.
 *
 * ⚠ REFUSED, not decided. Each is a real place in each country, and Bulgaria has run
 * sections in both — so no evidence in this repo can say which one an older protocol
 * meant. Naming either is a coin toss dressed as a fact.
 *
 *   Пърт      Perth, Australia          · Perth, Scotland
 *   Бостън    Boston, Massachusetts     · Boston, Lincolnshire
 *   Оукланд   Oakland, California       · Auckland, New Zealand
 *   Триполи   Tripoli, Libya            · Tripoli, Greece
 *
 * ⚠ THREE OF THE FOUR WERE FOUND BY READING MORE EVIDENCE, NOT BY THINKING HARDER, and
 * that is the argument for the harvest covering every cycle. While it silently skipped
 * the four oldest layouts, Бостън resolved confidently to US, Оукланд to NZ and Триполи
 * to LY — one country each, on half the record. Partial evidence does not look partial.
 */
export const AMBIGUOUS_CITIES = ["Бостън", "Оукланд", "Пърт", "Триполи"];

/**
 * Latin letters that look like Cyrillic ones, folded to their Cyrillic twin.
 *
 * ⚠ NOT COSMETIC — §2.5-12. The 2006 sections file spells Melbourne „Mелбърн" with a
 * LATIN M and Villalba „Вилялбa" with a LATIN a. Both render identically to a reader and
 * match nothing, so a Cyrillic-only lookup drops two real polling stations while every
 * count still reconciles. The fold runs in ONE direction, Latin → Cyrillic, because the
 * corpus is Cyrillic and the strays are typing accidents in it.
 */
const HOMOGLYPHS: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
};

/**
 * The lookup key for a city name.
 *
 * Strips the „гр. " 2001 puts in front of every settlement, folds Latin homoglyphs that
 * have strayed into a Cyrillic word, lowercases, and collapses whitespace. It does NOT
 * fold Cyrillic letters into each other — „Бургас" and „Бургаз" are different places, and
 * a fuzzy key here would merge two countries' sections under one. See `foldToken`.
 */
export const cityKey = (city: string): string =>
  city
    .replace(/^гр\.\s*/u, "")
    .trim()
    .split(/\s+/u)
    .map(foldToken)
    .join(" ")
    .toLowerCase();

/**
 * Fold one whitespace-separated token.
 *
 * ⚠ ONLY A TOKEN THAT ALREADY CONTAINS CYRILLIC IS FOLDED, and that guard is the whole
 * rule rather than a refinement of it. A wholly-Latin token is a real Latin word, not a
 * typing accident: the corpus carries „Пърт, UK", and folding its `K` to Cyrillic „К"
 * rewrites a correct string into one that matches nothing. Measured — that is exactly
 * what happened on the first cut, and the city silently dropped out of the table.
 *
 * ⚠ AND FOLD BEFORE LOWERCASING. Lowercasing first turns the Latin „M" of „Mелбърн" into
 * a Latin „m", which is not a homoglyph of Cyrillic „м" and survives the map — the exact
 * city §2.5-12 names. Measured: the other order left Melbourne unresolved.
 */
const foldToken = (token: string): string => {
  if (!/\p{Script=Cyrillic}/u.test(token)) return token;
  return [...token].map((ch) => HOMOGLYPHS[ch] ?? ch).join("");
};

/**
 * The lookup key for a COUNTRY name.
 *
 * ⚠ COLLAPSES EVERY KIND OF SPACE, and that is not tidiness. The corpus spells Bosnia
 * with a NON-BREAKING space — „Босна\u00a0и Херцеговина" — while `data/settlements.json`
 * uses an ordinary one, so the two strings render identically, compare unequal, and the
 * country silently failed to resolve. Found only because the test printed two „identical"
 * values that were not equal.
 */
export const countryKey = (name: string): string =>
  name.replace(/\s+/gu, " ").trim().toLowerCase();

export interface AbroadCityTable {
  /** How the table was produced, so a reader can re-derive it. */
  builtFrom: string;
  /** `cityKey` → ISO-2 country id, as `data/settlements.json` spells it at oblast 32. */
  cities: Record<string, string>;
  /** City names excluded because the evidence names more than one country. */
  ambiguous: string[];
}

let cached: AbroadCityTable | null = null;

/** The committed table, read once. */
export const abroadCityTable = (): AbroadCityTable => {
  if (cached) return cached;
  cached = JSON.parse(
    fs.readFileSync(ABROAD_CITIES_PATH, "utf8"),
  ) as AbroadCityTable;
  return cached;
};

/**
 * A city's country id, or null when nothing in the corpus can say.
 *
 * ⚠ ONLY CALL THIS FOR A SECTION ALREADY KNOWN TO BE ABROAD — see the banner. Nine keys
 * are also Bulgarian village names.
 *
 * @param city - As the section file spells it, „гр. " and homoglyphs included.
 * @returns The ISO-2 id `data/settlements.json` uses at oblast 32, or null. ⚠ NULL IS AN
 *   ANSWER — „no evidence names this city's country" — and a caller must render it as
 *   unknown rather than dropping the section, whose votes are real either way.
 */
export const resolveAbroadCity = (city: string): string | null => {
  // ⚠ `hasOwnProperty`, not a bare index. A plain object answers `cities["constructor"]`
  // with `Function.prototype.constructor` — truthy, and returned as though it were a
  // country id under a signature that promises `string | null`. A city string reaches
  // this straight from a raw file, so the input is not ours to trust.
  const table = abroadCityTable().cities;
  const key = cityKey(city);
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
};
