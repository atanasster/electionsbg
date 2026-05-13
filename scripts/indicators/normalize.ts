/**
 * Normalize parsed source rows → app obshtina codes.
 *
 * The vast majority of rows come from AZ's modern XLSX which already
 * carries an internal code matching our `obshtina` field (e.g. VAR01,
 * BLG09). Two universal exceptions are handled via _name_aliases.json:
 *   - SOF46 (AZ "Sofia city") → SOF00 (synthetic city-aggregate key).
 *   - PAZ30 (AZ "Сърница")    → PAZ39 (app code).
 *
 * Pre-2024 files have no codes, so rows are matched by Bulgarian name
 * within the surrounding "Област" context. Ambiguous matches (the
 * obshtina-name is non-unique across oblasts) consult name_aliases for
 * an explicit override; the first run after dropping a new historical
 * year may emit "unmatched name" warnings — populate the alias file and
 * re-run.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALIAS_FILE = path.resolve(__dirname, "./sources/_name_aliases.json");
const MUNI_FILE = path.resolve(__dirname, "../../data/municipalities.json");

type AliasFile = {
  code_aliases: Record<string, string>;
  name_aliases?: Record<string, string>;
};

type Muni = {
  obshtina: string;
  name: string;
  oblast: string;
  nuts3?: string;
};

const loadAliases = (): AliasFile => {
  const raw = JSON.parse(fs.readFileSync(ALIAS_FILE, "utf8")) as AliasFile;
  return {
    code_aliases: raw.code_aliases ?? {},
    name_aliases: raw.name_aliases ?? {},
  };
};

const loadMunis = (): Muni[] => {
  return JSON.parse(fs.readFileSync(MUNI_FILE, "utf8")) as Muni[];
};

/**
 * Build an index: "oblast-name||muni-name" → obshtina code. Oblast name
 * is resolved from the Bulgarian short name where possible. Falls back
 * to the obshtina-code's leading 3 chars (which works for VAR, BLG, ...
 * but not the special S23/S24/S25 case).
 *
 * Notes on data shape: data/municipalities.json stores `oblast` as a 3-
 * letter code (VAR, BLG, ...) and `name` as the BG муниципалитет name
 * (e.g. "Аврен"). The XLSX uses oblast as a BG name (e.g. "Варна").
 * We need a code → BG-name map to bridge them — derived empirically by
 * grouping munis by `oblast` and picking the most common nuts3 prefix.
 */
// Each oblast may be referenced under multiple BG names across upstream
// sources. AZ uses "София (столица)"; МОН uses "СОФИЯ-ГРАД" / "СОФИЯ-ОБЛАСТ".
// All aliases must resolve to the same obshtina-code prefix.
const OBLAST_BG: Record<string, string[]> = {
  BLG: ["Благоевград"],
  BGS: ["Бургас"],
  VAR: ["Варна"],
  VTR: ["Велико Търново"],
  VID: ["Видин"],
  VRC: ["Враца"],
  GAB: ["Габрово"],
  DOB: ["Добрич"],
  KRZ: ["Кърджали"],
  KNL: ["Кюстендил"],
  LOV: ["Ловеч"],
  MON: ["Монтана"],
  PAZ: ["Пазарджик"],
  PER: ["Перник"],
  PVN: ["Плевен"],
  PDV: ["Пловдив"],
  "PDV-00": ["Пловдив"],
  RAZ: ["Разград"],
  RSE: ["Русе"],
  SLS: ["Силистра"],
  SLV: ["Сливен"],
  SML: ["Смолян"],
  SFO: ["София", "София-област"],
  S23: ["София (столица)", "София-град"],
  S24: ["София (столица)", "София-град"],
  S25: ["София (столица)", "София-град"],
  SZR: ["Стара Загора"],
  TGV: ["Търговище"],
  HKV: ["Хасково"],
  SHU: ["Шумен"],
  JAM: ["Ямбол"],
};

export type NormalizeInput = {
  year: number;
  azCode?: string;
  oblastContext?: string;
  muniName: string;
  value: number;
};

export type NormalizeOutput = {
  obshtinaCode: string;
  year: number;
  value: number;
};

export type NormalizeReport = {
  matched: NormalizeOutput[];
  unmatched: { input: NormalizeInput; reason: string }[];
};

export const normalize = (rows: NormalizeInput[]): NormalizeReport => {
  const aliases = loadAliases();
  const munis = loadMunis();

  const validCodes = new Set(munis.map((m) => m.obshtina));
  // SOF00 is the synthetic Sofia-city aggregate — not in municipalities.json
  // by design (the 24 districts S2301..S2524 cover the city). The hook does
  // district → SOF00 fallback.
  validCodes.add("SOF00");

  // For name-based matching: build "<oblast-bg>||<muni-bg>" → code. Keys are
  // case-folded so sources like МОН that publish ALL-CAPS names match our
  // Title Case municipality names. Aliases (manual overrides) are also
  // folded so the lookup is uniform.
  const fold = (s: string): string => s.toLocaleUpperCase("bg-BG").trim();
  const byOblastName: Map<string, string> = new Map();
  for (const m of munis) {
    const bgNames = OBLAST_BG[m.oblast];
    if (!bgNames) continue;
    for (const bg of bgNames) {
      byOblastName.set(fold(`${bg}||${m.name}`), m.obshtina);
    }
  }
  const foldedNameAliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(aliases.name_aliases ?? {})) {
    if (k.startsWith("_")) continue;
    foldedNameAliases[fold(k)] = v;
  }

  const matched: NormalizeOutput[] = [];
  const unmatched: NormalizeReport["unmatched"] = [];

  for (const row of rows) {
    // Path A: AZ code present (2024+ files). Direct passthrough or alias.
    if (row.azCode) {
      const aliased = aliases.code_aliases[row.azCode] ?? row.azCode;
      if (validCodes.has(aliased)) {
        matched.push({
          obshtinaCode: aliased,
          year: row.year,
          value: row.value,
        });
        continue;
      }
      unmatched.push({
        input: row,
        reason: `AZ code "${row.azCode}" → "${aliased}" not in municipalities.json`,
      });
      continue;
    }

    // Path B: name match within oblast context (pre-2024 files).
    if (row.oblastContext) {
      // The XLSX sometimes parenthesizes the muni name with its oblast for
      // disambiguation ("Бяла (Русе)"). Strip that — the oblast is already
      // tracked separately. Match alias before/after stripping so explicit
      // aliases can override the canonical name if needed.
      const stripped = row.muniName
        .replace(/\s*\(\s*[^)]+\s*\)\s*$/u, "")
        .trim();
      const aliasKeys = [
        fold(`${row.oblastContext}||${row.muniName}`),
        fold(`${row.oblastContext}||${stripped}`),
      ];
      let resolved: string | undefined;
      for (const k of aliasKeys) {
        const a = foldedNameAliases[k];
        if (a && validCodes.has(a)) {
          resolved = a;
          break;
        }
      }
      if (resolved) {
        matched.push({
          obshtinaCode: resolved,
          year: row.year,
          value: row.value,
        });
        continue;
      }
      for (const k of aliasKeys) {
        const d = byOblastName.get(k);
        if (d) {
          resolved = d;
          break;
        }
      }
      if (resolved) {
        matched.push({
          obshtinaCode: resolved,
          year: row.year,
          value: row.value,
        });
        continue;
      }
      // Sofia city aggregate from various source naming conventions:
      //  - AZ:  Област "София (столица)"  / Община "София (столица)"
      //  - МОН: Област "София-град"       / Община "Столична"
      // All resolve to the synthetic SOF00 city code.
      const sofiaCityOblast =
        /столиц/i.test(row.oblastContext) ||
        /софия[-\s]?град/i.test(row.oblastContext);
      const sofiaCityMuni =
        /столиц/i.test(row.muniName) || /столичн/i.test(row.muniName);
      if (sofiaCityOblast && sofiaCityMuni) {
        matched.push({
          obshtinaCode: "SOF00",
          year: row.year,
          value: row.value,
        });
        continue;
      }
      // МОН's "ЧУЖБИНА" (abroad) row aggregates BG students taking the exam
      // outside the country — no geography, drop silently.
      if (/чужбин/i.test(row.oblastContext)) continue;
      unmatched.push({
        input: row,
        reason: `no muni match for "${row.oblastContext}||${row.muniName}"`,
      });
      continue;
    }

    unmatched.push({
      input: row,
      reason: "row has neither azCode nor oblastContext",
    });
  }

  return { matched, unmatched };
};
