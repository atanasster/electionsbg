// Местонахождение → ProjectLocation resolver for the ИСУН projects ingest.
//
// The raw field is unstructured: ~95 % of values are "гр.<name>" or "с.<name>"
// that map cleanly onto one EKATTE, but the long tail mixes muni-only labels,
// NUTS-2/-3 region tags, multi-muni comma lists, country names, foreign-
// country combinations, and Natura-2000 site codes. The resolver classifies
// each row into a `ProjectLocationKind` (settlement / muni / region / national
// / unresolved) and fills the corresponding fields on `ProjectLocation`.
//
// Tiebreaker for ambiguous settlement / muni names (the same name appearing
// in multiple oblasts — e.g. с.Абланица in BLG and LOV): parse the
// beneficiary's HQ address for the oblast (обл. <name> or гр.<oblast-capital>)
// and prefer the matching candidate. If still ambiguous, the row drops to
// `unresolved` with the candidate list preserved.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { ProjectLocation } from "./projects_types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTLEMENTS_FILE = path.resolve(__dirname, "../../data/settlements.json");
const MUNICIPALITIES_FILE = path.resolve(
  __dirname,
  "../../data/municipalities.json",
);

interface Settlement {
  ekatte: string;
  name: string;
  t_v_m?: string;
  obshtina: string;
  oblast: string;
  nuts3?: string;
}

interface Municipality {
  ekatte: string;
  name: string;
  obshtina: string;
  oblast: string;
  nuts3: string;
}

// PDV-00 is a single-row labelling quirk for гр.Пловдив itself — normalise it
// to PDV so the rest of the pipeline doesn't see two oblast codes for one
// administrative oblast.
const normalOblast = (raw: string): string => (raw === "PDV-00" ? "PDV" : raw);

// Bulgarian oblast Bulgarian-language name → oblast code. Stable list (the
// 28 administrative oblasts), independent of settlements.json which has
// quirks (no Sofia City entry, PDV-00, foreign-country pseudo-oblast "32").
// Names match the dominant forms seen in ИСУН HQ addresses and the parsed
// "Местонахождение" labels.
const OBLAST_NAME_TO_CODE: Record<string, string> = {
  Благоевград: "BLG",
  Бургас: "BGS",
  Варна: "VAR",
  "Велико Търново": "VTR",
  Видин: "VID",
  Враца: "VRC",
  Габрово: "GAB",
  Добрич: "DOB",
  Кърджали: "KRZ",
  Кюстендил: "KNL",
  Ловеч: "LOV",
  Монтана: "MON",
  Пазарджик: "PAZ",
  Перник: "PER",
  Плевен: "PVN",
  Пловдив: "PDV",
  Разград: "RAZ",
  Русе: "RSE",
  Силистра: "SLS",
  Сливен: "SLV",
  Смолян: "SML",
  "София-Град": "S22",
  София: "SFO",
  "Стара Загора": "SZR",
  Търговище: "TGV",
  Хасково: "HKV",
  Шумен: "SHU",
  Ямбол: "JAM",
};

// NUTS-3 code → oblast code (NUTS-3 ≡ oblast for Bulgaria). Used when the
// raw label embeds a NUTS code in parens, e.g. "Перник (BG414)".
const NUTS3_TO_OBLAST: Record<string, string> = {
  BG311: "VID",
  BG312: "MON",
  BG313: "VRC",
  BG314: "PVN",
  BG315: "LOV",
  BG321: "VTR",
  BG322: "GAB",
  BG323: "RSE",
  BG324: "RAZ",
  BG325: "SLS",
  BG331: "VAR",
  BG332: "DOB",
  BG333: "SHU",
  BG334: "TGV",
  BG341: "BGS",
  BG342: "SLV",
  BG343: "JAM",
  BG344: "SZR",
  BG411: "S22", // София-Град (Stolichna)
  BG412: "SFO", // София-Област
  BG413: "BLG",
  BG414: "PER",
  BG415: "KNL",
  BG421: "PDV",
  BG422: "HKV",
  BG423: "PAZ",
  BG424: "SML",
  BG425: "KRZ",
};

// NUTS-2 (planning region) name → code. These labels appear in the raw field
// for projects that span an entire planning region (no single muni). Both
// the bare name and the "(BGXX)" suffixed form occur.
const NUTS2_NAME_TO_CODE: Record<string, string> = {
  Северозападен: "BG31",
  "Северен централен": "BG32",
  Североизточен: "BG33",
  Югоизточен: "BG34",
  Югозападен: "BG41",
  "Южен централен": "BG42",
};

// NUTS-1 (super-region) labels — rare but they occur.
const NUTS1_NAME_TO_CODE: Record<string, string> = {
  "Северна и югоизточна България": "BG3",
  "Югозападна и южно-централна България": "BG4",
};

// Synthetic settlement entry for "гр.София". The capital is not present in
// data/settlements.json (the codebase models Sofia via three election-MIR
// pseudo-oblasts S23/S24/S25 plus the SFO oblast for the surrounding province);
// the real EKATTE for Sofia City is 68134 — the same id used by ГРАО, the
// commercial register, and ИСУН itself when it serialises to a CSV row that
// includes an EKATTE column.
const SOFIA_SYNTHETIC: Settlement = {
  ekatte: "68134",
  name: "София",
  t_v_m: "гр.",
  obshtina: "S22", // Stolichna obshtina — pseudo-code consistent with the muni-district codes (S23xx etc.)
  oblast: "S22",
  nuts3: "BG411",
};

// Country names that appear in the raw field. Anything else flagged as a
// foreign country triggers kind="national" (multi-country / TA-like
// projects). Bulgaria is intentionally absent — "България" alone is also
// national, but mixed-country combinations explicitly include Bulgaria, so
// we treat "any foreign token" as the national signal.
const FOREIGN_COUNTRIES = new Set<string>([
  "Австралия",
  "Австрия",
  "Албания",
  "Армения",
  "Беларус",
  "Белгия",
  "Босна и Херцеговина",
  "Великобритания",
  "Германия",
  "Гърция",
  "Грузия",
  "Естония",
  "Ирландия",
  "Исландия",
  "Испания",
  "Италия",
  "Косово",
  "Латвия",
  "Литва",
  "Лихтенщайн",
  "Люксембург",
  "Македония",
  "Молдова",
  "Нидерландия",
  "Норвегия",
  "Полша",
  "Португалия",
  "Румъния",
  "Северна Македония",
  "Сърбия",
  "Словакия",
  "Словения",
  "Турция",
  "Украйна",
  "Финландия",
  "Франция",
  "Хърватия",
  "Чехия",
  "Чешка Република",
  "Черна гора",
  "Швеция",
  "Швейцария",
]);

const NATIONAL_KEYWORDS = new Set<string>([
  "България",
  "Територията на ЕС",
  "Extra-Regio NUTS 3 (BGZZZ)",
]);

interface Indices {
  // (t_v_m, name) → settlements with that pair. Most have one entry; ~600
  // collide across oblasts.
  byTypeAndName: Map<string, Settlement[]>;
  // bare name → settlements (used when the raw field omits the т_в_м prefix).
  byName: Map<string, Settlement[]>;
  // muni name (the seat-town name) → municipalities. Built from
  // data/municipalities.json — one entry per administrative obshtina (294 in
  // total). The "name" field on that file is the muni-seat settlement name,
  // which is what the ИСУН raw field actually carries when it names a muni
  // without a "гр./с." prefix (e.g. "Балчик", "Брезово").
  muniByName: Map<string, Municipality[]>;
}

// Build the lookup indices once per ingest run. The export will share the
// indices via a single buildResolver() call.
const buildIndices = (
  settlements: Settlement[],
  municipalities: Municipality[],
): Indices => {
  const byTypeAndName = new Map<string, Settlement[]>();
  const byName = new Map<string, Settlement[]>();
  for (const s of [...settlements, SOFIA_SYNTHETIC]) {
    // Skip the "oblast=32" foreign-country pseudo-entries (they share т_в_m
    // and a country name; we don't want them to participate in
    // settlement-name lookups).
    if (s.oblast === "32") continue;
    const norm = { ...s, oblast: normalOblast(s.oblast) };
    if (s.t_v_m) {
      const key = `${s.t_v_m}|${s.name}`;
      const arr = byTypeAndName.get(key) ?? [];
      arr.push(norm);
      byTypeAndName.set(key, arr);
    }
    const arr2 = byName.get(s.name) ?? [];
    arr2.push(norm);
    byName.set(s.name, arr2);
  }

  const muniByName = new Map<string, Municipality[]>();
  for (const m of municipalities) {
    const norm = { ...m, oblast: normalOblast(m.oblast) };
    const arr = muniByName.get(m.name) ?? [];
    arr.push(norm);
    muniByName.set(m.name, arr);
  }
  // Synthetic Stolichna муни — sits as one administrative unit but has no
  // entry in data/municipalities.json (the file lists 294 muni-seat
  // settlements and the capital isn't one of them by convention).
  muniByName.set("София", [
    {
      ekatte: "68134",
      name: "София",
      obshtina: "S22",
      oblast: "S22",
      nuts3: "BG411",
    },
  ]);

  return { byTypeAndName, byName, muniByName };
};

// Extract an oblast hint from a beneficiary's HQ address. Returns an oblast
// code or null. Strategy:
//   1. Look for "обл. <name>" or "област <name>" — the most explicit form.
//   2. Look for "гр.<oblast-capital>" or "София-Град" / "София-Област".
//   3. Fall back to a settlement-name match that pinpoints exactly one oblast.
// The tiebreaker only narrows candidates; it never invents an oblast.
const parseHqOblast = (hq: string): string | null => {
  if (!hq) return null;
  // Form 1: "обл. <name>"
  const m1 = hq.match(
    /обл\.?\s*([А-ЯЁ][А-Яа-я\s-]+?)(?=[,.;]|\s+(?:гр|с|ул|бл|кв)|$)/,
  );
  if (m1) {
    const name = m1[1].trim();
    if (OBLAST_NAME_TO_CODE[name]) return OBLAST_NAME_TO_CODE[name];
    // Match prefix-substring (the HQ often runs the name into the next token).
    for (const [k, v] of Object.entries(OBLAST_NAME_TO_CODE)) {
      if (name.startsWith(k)) return v;
    }
  }
  // Form 2: explicit Sofia variants.
  if (/София-Град|гр\.?\s*София/.test(hq)) return "S22";
  if (/София-Област/.test(hq)) return "SFO";
  // Form 3: "гр.<oblast capital>" — the oblast capital usually shares its
  // name with the oblast (Burgas → BGS, Plovdiv → PDV, etc.). We match the
  // first гр.X occurrence and look it up.
  const m3 = hq.match(/гр\.?\s*([А-ЯЁ][А-Яа-я\s-]+?)(?=[,.;]|$)/);
  if (m3) {
    const name = m3[1].trim();
    if (OBLAST_NAME_TO_CODE[name]) return OBLAST_NAME_TO_CODE[name];
  }
  return null;
};

// Stolichna obshtina spans four obshtina codes in this codebase's model —
// S22 is the synthetic anchor for гр.София itself, S23/S24/S25 are the
// election-MIR pseudo-oblasts that group Sofia City's administrative
// districts. When the source field says "Столична" or "София-Град" we accept
// settlements from any of them.
const SOFIA_OBLAST_GROUP = new Set(["S22", "S23", "S24", "S25"]);

const expandOblast = (code: string): Set<string> => {
  if (SOFIA_OBLAST_GROUP.has(code)) return SOFIA_OBLAST_GROUP;
  return new Set([code]);
};

// Pick from candidates by oblast preference. Returns the single match, or
// null if not exactly one.
const narrowByOblast = <T extends { oblast: string }>(
  candidates: T[],
  hqOblast: string | null,
): T | null => {
  if (candidates.length === 1) return candidates[0];
  if (!hqOblast) return null;
  const accepted = expandOblast(hqOblast);
  const filtered = candidates.filter((c) =>
    accepted.has(normalOblast(c.oblast)),
  );
  if (filtered.length === 1) return filtered[0];
  return null;
};

// Alias map for muni names that ИСУН writes differently from
// data/municipalities.json. Each entry maps a raw name to one or more
// canonical names present in muniByName. Multi-target aliases handle the
// "city muni vs rural muni share a name" case — when ИСУН writes "общ.Добрич"
// for a rural village, both DOB28 (city муни "Добрич") AND DOB15 (rural муни
// "Добрич-селска") are candidates; the actual settlement membership picks
// the right one.
const MUNI_NAME_ALIASES: Record<string, string[]> = {
  "Добрич-град": ["Добрич"],
  Добричка: ["Добрич-селска"],
  Столична: ["София"],
  // "Добрич" alone is genuinely ambiguous between DOB28 (city) and DOB15
  // (rural). Listing both lets the settlement-membership pin in resolveOnePart
  // disambiguate.
  Добрич: ["Добрич", "Добрич-селска"],
};

// Match "<т_в_м>.<name>" against the settlement index. Returns the matched
// settlement (after oblast narrowing) or the candidate set on ambiguity.
type SettlementMatch =
  | { kind: "unique"; settlement: Settlement }
  | { kind: "ambiguous"; candidates: Settlement[] }
  | { kind: "none" };

const matchSettlement = (
  indices: Indices,
  tvm: string,
  name: string,
  hqOblast: string | null,
): SettlementMatch => {
  const key = `${tvm}|${name}`;
  const cands = indices.byTypeAndName.get(key) ?? [];
  if (cands.length === 0) return { kind: "none" };
  const single = narrowByOblast(cands, hqOblast);
  if (single) return { kind: "unique", settlement: single };
  return { kind: "ambiguous", candidates: cands };
};

// Match a bare muni name against the municipalities index.
type MuniMatch =
  | { kind: "unique"; muni: Municipality }
  | { kind: "ambiguous"; candidates: Municipality[] }
  | { kind: "none" };

// Resolve an alias to the union of muni candidates across all alias targets.
const aliasMuniCandidates = (
  indices: Indices,
  name: string,
): Municipality[] => {
  const targets = MUNI_NAME_ALIASES[name] ?? [name];
  const out: Municipality[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    for (const c of indices.muniByName.get(t) ?? []) {
      if (!seen.has(c.obshtina)) {
        seen.add(c.obshtina);
        out.push(c);
      }
    }
  }
  return out;
};

const matchMuni = (
  indices: Indices,
  name: string,
  hqOblast: string | null,
): MuniMatch => {
  const cands = aliasMuniCandidates(indices, name);
  if (cands.length === 0) return { kind: "none" };
  const single = narrowByOblast(cands, hqOblast);
  if (single) return { kind: "unique", muni: single };
  return { kind: "ambiguous", candidates: cands };
};

// Paren-aware comma split — the raw field uses commas both as the multi-loc
// separator AND inside parenthetical hints like "(общ.Бяла, обл.Варна)".
// We only split on commas at paren-depth zero.
const splitTopLevel = (raw: string, sep: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  out.push(raw.slice(start));
  return out.map((p) => p.trim()).filter((p) => p !== "");
};

// Extract "(общ.<muni>, обл.<oblast>)" hint from a part and strip it so the
// remainder can be matched cleanly. ИСУН embeds these as a first-class
// disambiguator — they OVERRIDE the HQ-oblast tiebreaker.
interface PartHint {
  muniName: string | null;
  oblastName: string | null;
}

const stripAndParseHint = (part: string): { core: string; hint: PartHint } => {
  const m = part.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { core: part, hint: { muniName: null, oblastName: null } };
  const inner = m[2];
  // Inner can mix any of: общ.X, обл.X, NUTS code, Natura-2000 site. Only
  // peel the parens when they carry муни / обл hints — leave NUTS / Natura
  // codes attached (the part is then a region-label "Перник (BG414)" or a
  // Natura-2000 site "(BG0000214)").
  if (/^BG[A-Z\d]{2,7}$/.test(inner.trim())) {
    return { core: part, hint: { muniName: null, oblastName: null } };
  }
  let muniName: string | null = null;
  let oblastName: string | null = null;
  for (const piece of splitTopLevel(inner, ",")) {
    const muniMatch = piece.match(/^общ\.\s*(.+)$/);
    if (muniMatch) muniName = muniMatch[1].trim();
    const oblastMatch = piece.match(/^обл\.\s*(.+)$/);
    if (oblastMatch) oblastName = oblastMatch[1].trim();
  }
  if (muniName || oblastName) {
    return { core: m[1].trim(), hint: { muniName, oblastName } };
  }
  return { core: part, hint: { muniName: null, oblastName: null } };
};

// Resolve a single comma-separated label part. Returns one of the four
// concrete bucket kinds or "unresolved".
type PartResult =
  | { kind: "settlement"; settlement: Settlement }
  | { kind: "muni"; muni: Municipality }
  | { kind: "region"; nutsCode: string }
  | { kind: "national" }
  | { kind: "unresolved"; raw: string; ambiguousCandidates?: string[] };

const resolveOnePart = (
  indices: Indices,
  rawPart: string,
  hqOblast: string | null,
): PartResult => {
  const trimmed = rawPart.trim();
  if (trimmed === "") return { kind: "unresolved", raw: rawPart };

  // First peel any "(общ.X, обл.Y)" hint — this overrides hqOblast.
  const { core, hint } = stripAndParseHint(trimmed);
  const raw = core;
  // Resolve the hint's oblast name → code. Special-cases: "Столична"
  // appearing as a муни hint means Stolichna obshtina (S22), and "София-Град"
  // as an oblast hint means BG411 / S22.
  let hintOblast: string | null = null;
  if (hint.oblastName) {
    if (OBLAST_NAME_TO_CODE[hint.oblastName])
      hintOblast = OBLAST_NAME_TO_CODE[hint.oblastName];
    else {
      // Allow the oblast name to be a prefix of a known oblast (e.g. the
      // source sometimes writes "обл.Софийска" instead of the canonical
      // "София-Област"). Fall back silently when no match.
      for (const [k, v] of Object.entries(OBLAST_NAME_TO_CODE)) {
        if (hint.oblastName.startsWith(k)) {
          hintOblast = v;
          break;
        }
      }
    }
  }
  if (!hintOblast && hint.muniName === "Столична") hintOblast = "S22";
  const effectiveOblast = hintOblast ?? hqOblast;

  // National keywords first — cheapest check.
  if (NATIONAL_KEYWORDS.has(raw)) return { kind: "national" };
  if (FOREIGN_COUNTRIES.has(raw)) return { kind: "national" };

  // NUTS code in parens — "Перник (BG414)", "Югозападен (BG41)", "Северна и
  // югоизточна България (BG3)", or a Natura-2000 site code "(BG0000214)".
  // Uses `trimmed` because stripAndParseHint leaves NUTS / Natura parens
  // attached.
  const nutsM = trimmed.match(/\((BG[A-Z\d]{1,7})\)\s*$/);
  if (nutsM) {
    const code = nutsM[1];
    if (NUTS3_TO_OBLAST[code]) return { kind: "region", nutsCode: code };
    if (
      Object.values(NUTS2_NAME_TO_CODE).includes(code) ||
      Object.values(NUTS1_NAME_TO_CODE).includes(code)
    ) {
      return { kind: "region", nutsCode: code };
    }
    // BG3 / BG4 — NUTS-1 super-regions, recognised by code alone.
    if (code === "BG3" || code === "BG4")
      return { kind: "region", nutsCode: code };
    // BGZZZ — Extra-Regio NUTS 3
    if (code === "BGZZZ") return { kind: "national" };
    // Natura-2000 site (BG\d{7}) — has no muni / NUTS meaning; preserve raw.
    return { kind: "unresolved", raw: trimmed };
  }

  // NUTS-2/NUTS-1 by bare name.
  if (NUTS2_NAME_TO_CODE[raw])
    return { kind: "region", nutsCode: NUTS2_NAME_TO_CODE[raw] };
  if (NUTS1_NAME_TO_CODE[raw])
    return { kind: "region", nutsCode: NUTS1_NAME_TO_CODE[raw] };

  // "София-Град" / "София-Област" without parens.
  if (raw === "София-Град") return { kind: "region", nutsCode: "BG411" };
  if (raw === "София-Област") return { kind: "region", nutsCode: "BG412" };

  // Bare "Столична" — Stolichna муни. Resolves via the alias map; handled
  // generically by matchMuni below.

  // "<т_в_м>.<name>" — the dominant single-settlement form.
  const stM = raw.match(/^(гр|с|м|мах|кв|жк)\.\s*(.+)$/);
  if (stM) {
    const tvm = `${stM[1]}.`;
    const name = stM[2].trim();
    // If the part carried an explicit "(общ.X)" hint, pin the settlement
    // search to the candidate муни's obshtina code(s). When the hint name
    // maps to multiple muni candidates (e.g. "Добрич" → both DOB28 city муни
    // and DOB15 rural муни), we test ALL of them — the actual settlement
    // membership disambiguates without needing the HQ-oblast tiebreaker.
    // Skips the pin for "Столична" — the four-pseudo-oblast Sofia group is
    // handled by the generic oblast-set filter.
    const candList = indices.byTypeAndName.get(`${tvm}|${name}`) ?? [];
    if (hint.muniName && hint.muniName !== "Столична") {
      const muniCands = aliasMuniCandidates(indices, hint.muniName);
      const pinnedCodes = new Set(muniCands.map((c) => c.obshtina));
      if (pinnedCodes.size > 0) {
        const pinnedSettlements = candList.filter((c) =>
          pinnedCodes.has(c.obshtina),
        );
        if (pinnedSettlements.length === 1)
          return { kind: "settlement", settlement: pinnedSettlements[0] };
        if (pinnedSettlements.length > 1) {
          // Further narrow by oblast if the muni names overlap multiple
          // oblasts (the same-name-different-oblast cases — rare for muni
          // names but possible).
          const single = narrowByOblast(pinnedSettlements, effectiveOblast);
          if (single) return { kind: "settlement", settlement: single };
        }
      }
    }
    const m = matchSettlement(indices, tvm, name, effectiveOblast);
    if (m.kind === "unique")
      return { kind: "settlement", settlement: m.settlement };
    if (m.kind === "ambiguous") {
      return {
        kind: "unresolved",
        raw: trimmed,
        ambiguousCandidates: m.candidates.map((c) => `${c.ekatte}/${c.oblast}`),
      };
    }
    // No match for that name + т_в_м — fall through to muni / by-name attempts.
  }

  // Bare name — try as a muni first (matches "Балчик", "Брезово", etc.).
  const muniM = matchMuni(indices, raw, effectiveOblast);
  if (muniM.kind === "unique") return { kind: "muni", muni: muniM.muni };
  if (muniM.kind === "ambiguous") {
    return {
      kind: "unresolved",
      raw: trimmed,
      ambiguousCandidates: muniM.candidates.map(
        (c) => `${c.obshtina}/${c.oblast}`,
      ),
    };
  }

  // Bare settlement name (no т_в_м prefix in source). Rare — only fires when
  // the muni lookup misses. Falls back to byName.
  const bareCands = indices.byName.get(raw) ?? [];
  if (bareCands.length > 0) {
    const single = narrowByOblast(bareCands, effectiveOblast);
    if (single) return { kind: "settlement", settlement: single };
    return {
      kind: "unresolved",
      raw: trimmed,
      ambiguousCandidates: bareCands.map((c) => `${c.ekatte}/${c.oblast}`),
    };
  }

  return { kind: "unresolved", raw: trimmed };
};

// Aggregate the per-part results into a single ProjectLocation. Multi-part
// rows are replicated across each named муни per the scoping decision (so a
// "Поморие,Несебър,Руен" row appears on each of the three муни pages).
const aggregate = (raw: string, parts: PartResult[]): ProjectLocation => {
  // Single-part fast path.
  if (parts.length === 1) {
    const p = parts[0];
    if (p.kind === "settlement") {
      return {
        kind: "settlement",
        raw,
        ekatte: p.settlement.ekatte,
        munis: [p.settlement.obshtina],
        oblasts: [normalOblast(p.settlement.oblast)],
      };
    }
    if (p.kind === "muni") {
      return {
        kind: "muni",
        raw,
        munis: [p.muni.obshtina],
        oblasts: [normalOblast(p.muni.oblast)],
      };
    }
    if (p.kind === "region")
      return { kind: "region", raw, nutsCodes: [p.nutsCode] };
    if (p.kind === "national") return { kind: "national", raw };
    return {
      kind: "unresolved",
      raw,
      ambiguousCandidates: p.ambiguousCandidates,
    };
  }

  // Multi-part: aggregate by precedence. If any part is unresolved, keep the
  // resolved parts but flag the row — we still want it on the resolved muni
  // pages.
  const settlements = parts.flatMap((p) =>
    p.kind === "settlement" ? [p.settlement] : [],
  );
  const munis = parts.flatMap((p) => (p.kind === "muni" ? [p.muni] : []));
  const regions = parts.flatMap((p) =>
    p.kind === "region" ? [p.nutsCode] : [],
  );
  const hasNational = parts.some((p) => p.kind === "national");
  const allResolved = parts.every(
    (p) =>
      p.kind === "settlement" ||
      p.kind === "muni" ||
      p.kind === "region" ||
      p.kind === "national",
  );

  if (
    hasNational &&
    regions.length === 0 &&
    munis.length === 0 &&
    settlements.length === 0
  ) {
    return { kind: "national", raw };
  }
  // Region wins over muni/settlement when both appear — projects spanning a
  // planning region don't sensibly attach to a single muni.
  if (regions.length > 0) {
    return { kind: "region", raw, nutsCodes: dedup(regions) };
  }
  // Settlement(s) + muni(s): collapse settlement(s) to their muni and report
  // a muni-level row. We lose per-settlement granularity for these rows, but
  // they're only ~0.5 % of the corpus.
  const muniCodes = [
    ...munis.map((m) => m.obshtina),
    ...settlements.map((s) => s.obshtina),
  ];
  const oblastCodes = [
    ...munis.map((m) => normalOblast(m.oblast)),
    ...settlements.map((s) => normalOblast(s.oblast)),
  ];
  if (muniCodes.length > 0) {
    return {
      kind: "muni",
      raw,
      munis: dedup(muniCodes),
      oblasts: dedup(oblastCodes),
      ...(allResolved
        ? {}
        : {
            ambiguousCandidates: parts.flatMap((p) =>
              p.kind === "unresolved" ? [p.raw] : [],
            ),
          }),
    };
  }
  // All parts unresolved.
  return {
    kind: "unresolved",
    raw,
    ambiguousCandidates: parts.flatMap((p) =>
      p.kind === "unresolved" ? [p.raw] : [],
    ),
  };
};

const dedup = <T>(arr: T[]): T[] => [...new Set(arr)];

export interface LocationResolver {
  resolve(locationRaw: string, hqAddress: string): ProjectLocation;
}

export const buildResolver = (): LocationResolver => {
  const settlements: Settlement[] = JSON.parse(
    fs.readFileSync(SETTLEMENTS_FILE, "utf-8"),
  );
  const municipalities: Municipality[] = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_FILE, "utf-8"),
  );
  const indices = buildIndices(settlements, municipalities);

  return {
    resolve(locationRaw: string, hqAddress: string): ProjectLocation {
      const raw = locationRaw.trim();
      if (raw === "") return { kind: "unresolved", raw: "" };
      const hqOblast = parseHqOblast(hqAddress);
      const parts = splitTopLevel(raw, ",");

      // Pass 1: resolve each part with no hqOblast. Anything that comes back
      // resolved here matched without needing an oblast tiebreaker — i.e. it
      // had exactly one candidate or carried an explicit "(общ.X, обл.Y)"
      // hint. Those are the confident parts.
      const passOne = parts.map((p) => resolveOnePart(indices, p, null));

      // Collect the oblasts of confident parts. These are stronger evidence
      // than the HQ address: when a row says "Камено,Средец" and Камено
      // anchors confidently to BGS, "Средец" should disambiguate to BGS06
      // (Burgas муни) even when the beneficiary HQ is in Sofia — otherwise
      // the resolver picks S2401 (Sofia район Средец) just because the HQ
      // oblast group includes it.
      const coLocatedOblasts: string[] = [];
      const seenOblasts = new Set<string>();
      for (const r of passOne) {
        let oblast: string | null = null;
        if (r.kind === "settlement") oblast = normalOblast(r.settlement.oblast);
        else if (r.kind === "muni") oblast = normalOblast(r.muni.oblast);
        if (oblast && !seenOblasts.has(oblast)) {
          seenOblasts.add(oblast);
          coLocatedOblasts.push(oblast);
        }
      }

      // Pass 2: parts confident in pass 1 stay as-is. For the rest, try each
      // co-located oblast in turn before falling back to hqOblast. Settles
      // the same-name-different-oblast cases (Средец, Левски, Бяла, …) in
      // favour of the oblast already evidenced by sibling parts.
      const partResults = parts.map((p, i) => {
        const confident = passOne[i];
        if (
          confident.kind === "settlement" ||
          confident.kind === "muni" ||
          confident.kind === "region" ||
          confident.kind === "national"
        ) {
          return confident;
        }
        for (const oblast of coLocatedOblasts) {
          const r = resolveOnePart(indices, p, oblast);
          if (
            r.kind === "settlement" ||
            r.kind === "muni" ||
            r.kind === "region" ||
            r.kind === "national"
          ) {
            return r;
          }
        }
        return resolveOnePart(indices, p, hqOblast);
      });

      return aggregate(raw, partResults);
    },
  };
};
