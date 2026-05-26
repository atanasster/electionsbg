// Lookup helpers for joining Bulgarian municipality names found in source
// documents (Article 53 of the State Budget Law, the Public Investment Program
// annex, etc.) to the canonical EKATTE record in data/municipalities.json.
//
// Edge cases handled:
//   - "СТОЛИЧНА ОБЩИНА" — Sofia city is its own oblast ("София-град"); the law
//     lists it as a standalone row between Smolyan and Sofiyska region. Mapped
//     to a synthetic 3-letter oblast code "SOF" (distinct from "SFO" which is
//     the surrounding Sofia region).
//   - Duplicate municipality names: "Бяла" exists in oblast VAR (Varna) AND
//     oblast RSE (Ruse). The lookup requires the running oblast context to
//     disambiguate.
//   - Whitespace drift in the source: "Бургас " (trailing space) or "Бобовдол"
//     (no space, vs canonical "Бобов дол"). Names are normalized by collapsing
//     whitespace and matching case-insensitively.
//
// Oblast names in the budget law are uppercased with the prefix "ОБЛАСТ "
// (e.g. "ОБЛАСТ БЛАГОЕВГРАД", "ОБЛАСТ СОФИЙСКА"). The map keys are uppercased
// and prefix-stripped before lookup.
//
// The data is read from disk at module init — change data/municipalities.json
// and you change the lookup. data/municipalities.json is the project's
// authoritative EKATTE registry, used by the election pipeline too.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MunicipalityRecord {
  ekatte: string;
  nameBg: string;
  nameEn: string;
  oblastCode: string; // 3-letter (BLG, BGS, …, SFO, SOF for Sofia city)
  obshtinaCode: string; // BLG01, …, SOF for Stolichna
  nuts3: string;
}

// data/municipalities.json shape — only the fields we need from the larger
// election-pipeline record. The extra columns (loc, dx/dy, etc.) are ignored.
interface RawMuni {
  ekatte: string;
  name: string;
  name_en: string;
  obshtina: string;
  nuts3: string;
  oblast: string;
}

// Oblast name (in the form used by the budget-law table headers, uppercased,
// without the "ОБЛАСТ " prefix) → canonical 3-letter code. "СОФИЙСКА" is the
// adjectival form of "София" the law uses for the surrounding region.
const OBLAST_NAME_TO_CODE: Record<string, string> = {
  БЛАГОЕВГРАД: "BLG",
  БУРГАС: "BGS",
  ВАРНА: "VAR",
  "ВЕЛИКО ТЪРНОВО": "VTR",
  ВИДИН: "VID",
  ВРАЦА: "VRC",
  ГАБРОВО: "GAB",
  ДОБРИЧ: "DOB",
  КЪРДЖАЛИ: "KRZ",
  КЮСТЕНДИЛ: "KNL",
  ЛОВЕЧ: "LOV",
  МОНТАНА: "MON",
  ПАЗАРДЖИК: "PAZ",
  ПЕРНИК: "PER",
  ПЛЕВЕН: "PVN",
  ПЛОВДИВ: "PDV",
  РАЗГРАД: "RAZ",
  РУСЕ: "RSE",
  СИЛИСТРА: "SLS",
  СЛИВЕН: "SLV",
  СМОЛЯН: "SML",
  СОФИЙСКА: "SFO", // surrounding Sofia region
  "СТАРА ЗАГОРА": "SZR",
  ТЪРГОВИЩЕ: "TGV",
  ХАСКОВО: "HKV",
  ШУМЕН: "SHU",
  ЯМБОЛ: "JAM",
  // Sofia city is the 28th oblast but is listed in Article 53 as a single row
  // "СТОЛИЧНА ОБЩИНА" between Smolyan and Sofiyska — not under any header.
  // Provided here for completeness, in case future sources use a header form.
  "СОФИЯ-ГРАД": "SOF",
};

const SOFIA_CAPITAL_RECORD: MunicipalityRecord = {
  ekatte: "68134",
  nameBg: "Столична",
  nameEn: "Sofia (capital)",
  oblastCode: "SOF",
  obshtinaCode: "SOF",
  nuts3: "BG411",
};

const normalize = (s: string): string =>
  stripQuotes(homoglyphify(s))
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Bulgarian Word/InDesign documents frequently mix visually-identical Latin
// letters into Cyrillic words (e.g. "Kресна" with Latin K, "Pазлог" with Latin
// P, "Cандански" with Latin C). The lead character is the most common
// offender — InDesign's autocorrect substitutes the keyboard's Latin letter
// when an "uppercase styling" rule fires. Normalise homoglyphs to their
// Cyrillic equivalents before the name lookup so the source's noise doesn't
// drop ~150 of 265 municipalities. The mapping covers the full visual-overlap
// set between basic Latin and Bulgarian Cyrillic.
const HOMOGLYPH_MAP: Record<string, string> = {
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
  Y: "У",
  a: "а",
  c: "с",
  e: "е",
  o: "о",
  p: "р",
  x: "х",
  y: "у",
};

const homoglyphify = (s: string): string =>
  s.replace(/[A-Za-z]/g, (ch) => HOMOGLYPH_MAP[ch] ?? ch);

// Strip Bulgarian opening („) / closing (") quote marks and ASCII double
// quotes — the law wraps some municipality names like „Марица" / „Родопи" /
// „Тунджа" in quotes. Also handle the curly Unicode " " variants.
const stripQuotes = (s: string): string => s.replace(/[„“”"]/g, "");

let muniIndex: Map<string, MunicipalityRecord[]> | null = null;

const buildIndex = (): Map<string, MunicipalityRecord[]> => {
  const filePath = path.resolve(__dirname, "../../../data/municipalities.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as RawMuni[];
  const idx = new Map<string, MunicipalityRecord[]>();
  for (const m of raw) {
    if (!m.ekatte || !m.name) continue;
    // Skip the abroad pseudo-entries (oblast code "32") and Sofia voting
    // districts ("S2XXX" obshtina) — the latter are subdivisions used by the
    // election pipeline, not municipalities for budget purposes.
    if (m.oblast === "32") continue;
    if (m.oblast?.startsWith("S2")) continue;
    const rec: MunicipalityRecord = {
      ekatte: m.ekatte,
      nameBg: m.name,
      nameEn: m.name_en,
      oblastCode: m.oblast === "PDV-00" ? "PDV" : m.oblast,
      obshtinaCode: m.obshtina,
      nuts3: m.nuts3,
    };
    const key = normalize(m.name);
    const list = idx.get(key) ?? [];
    list.push(rec);
    idx.set(key, list);
  }
  return idx;
};

const ensureIndex = (): Map<string, MunicipalityRecord[]> => {
  if (muniIndex === null) muniIndex = buildIndex();
  return muniIndex;
};

// "ОБЛАСТ БЛАГОЕВГРАД" → "BLG"; "ОБЛАСТ СОФИЙСКА" → "SFO". Returns null when
// the input is not a recognizable oblast header. Case- and whitespace-tolerant.
export const oblastHeaderToCode = (header: string): string | null => {
  const cleaned = normalize(header).toUpperCase();
  const stripped = cleaned.replace(/^ОБЛАСТ\s+/, "").trim();
  return OBLAST_NAME_TO_CODE[stripped] ?? null;
};

// Resolve a municipality row from its bare name + the running oblast code.
// Returns null when the name doesn't match any known municipality. Sofia
// ("СТОЛИЧНА ОБЩИНА") matches regardless of `runningOblastCode` because the
// budget law lists it without an oblast header.
export const resolveMunicipality = (
  rawName: string,
  runningOblastCode: string | null,
): MunicipalityRecord | null => {
  const normalized = normalize(rawName);
  // Sofia capital — recognise both the law's uppercase form and any plain
  // "Столична" / "Столична община" the parser might encounter elsewhere.
  if (
    normalized === "столична община" ||
    normalized === "столична" ||
    normalized.startsWith("столична ")
  ) {
    return SOFIA_CAPITAL_RECORD;
  }
  // Known law-side spellings that don't match data/municipalities.json:
  //   "Бобовдол" (no space) → "Бобов дол" (canonical, with space)
  //   "Добричка" (law, adjectival form) → "Добрич-селска" (canonical)
  // Bulgarian quote marks („…") around names like „Марица" / „Родопи" /
  // „Тунджа" are stripped during the normalise step, not aliased.
  const NAME_ALIASES: Record<string, string> = {
    бобовдол: "бобов дол",
    добричка: "добрич-селска",
  };
  const lookupKey = NAME_ALIASES[normalized] ?? normalized;
  const idx = ensureIndex();
  const candidates = idx.get(lookupKey);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Duplicate name — disambiguate by the running oblast (e.g. Бяла in VAR vs
  // RSE; Бяла Слатина in VRC). If the caller hasn't provided one, return the
  // first match deterministically.
  if (runningOblastCode) {
    const byOblast = candidates.find((c) => c.oblastCode === runningOblastCode);
    if (byOblast) return byOblast;
  }
  return candidates[0];
};

// Exposed for the parser's "did we cover every municipality?" sanity check.
export const allMunicipalities = (): MunicipalityRecord[] => {
  const idx = ensureIndex();
  const flat: MunicipalityRecord[] = [];
  for (const list of idx.values()) flat.push(...list);
  flat.push(SOFIA_CAPITAL_RECORD);
  return flat;
};
