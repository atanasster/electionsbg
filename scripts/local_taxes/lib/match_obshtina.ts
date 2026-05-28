// Resolve a Bulgarian município name (as it appears in ИПИ CSVs or naredba
// PDFs) to the canonical obshtina code used across the project.
//
// Strategy mirrors scripts/transparency/build_lisi.ts:
//   1. Read data/municipalities.json (list of settlement records, each with
//      {name, obshtina}). The município center is conventionally a
//      settlement named the same as the município itself, so a name-match
//      against this list is the de-facto município lookup.
//   2. Sofia is special — the synthetic SOF00 code aggregates the 24
//      районы — and gets a fixed alias.
//   3. When multiple settlement records share a name, the município center
//      is conventionally the lowest-numbered obshtina code (oblast
//      capitals come first alphabetically within their oblast prefix).
//   4. MANUAL_ALIASES captures the irreducible exceptions — município
//      names that don't share their administrative center's settlement
//      name. Verified empirically against the data/municipalities.json
//      master list.

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);
const MUNICIPALITIES_FILE = path.join(PROJECT_ROOT, "data/municipalities.json");

type Settlement = { name: string; obshtina: string };

// Município names whose município center is a differently-named settlement,
// OR aliases used by ИПИ that differ from the canonical spelling. Most of
// these are case-only mismatches ("Долна Баня" vs "Долна баня") — ИПИ
// title-cases multi-word names while the master list keeps the canonical
// "first-word-only-capitalised" Bulgarian convention.
const MANUAL_ALIASES: Record<string, string> = {
  Столична: "SOF00",
  "Столична община": "SOF00",
  София: "SOF00",
  "София-град": "SOF00",
  Добричка: "DOB15", // rural município around Добрич (settlement name "Добрич-селска")
  Вълчидол: "VAR09", // ИПИ writes the name without the canonical space
  "Долна Баня": "SFO59",
  "Долни Чифлик": "VAR13",
  "Минерални Бани": "HKV19",
};

// "Бяла" is ambiguous — there are two municípalities with that name (Varna
// VAR05 and Ruse RSE04). ИПИ disambiguates with `(Oblast)` in parens. Map
// each (name, oblast) → obshtina code.
const OBLAST_DISAMBIG: Record<string, Record<string, string>> = {
  Бяла: {
    Варна: "VAR05",
    Русе: "RSE04",
  },
};

let cache: Map<string, string[]> | null = null;

const loadIndex = (): Map<string, string[]> => {
  if (cache) return cache;
  const munis = JSON.parse(
    fs.readFileSync(MUNICIPALITIES_FILE, "utf-8"),
  ) as Settlement[];
  const byName = new Map<string, string[]>();
  for (const m of munis) {
    const arr = byName.get(m.name) ?? [];
    arr.push(m.obshtina);
    byName.set(m.name, arr);
  }
  // Dedupe each name's obshtina list and sort ascending so the
  // município-center candidate is at index 0.
  for (const [name, codes] of byName.entries()) {
    byName.set(name, Array.from(new Set(codes)).sort());
  }
  cache = byName;
  return byName;
};

export const matchObshtina = (rawName: string): string | null => {
  const name = rawName.trim();
  if (!name) return null;
  if (MANUAL_ALIASES[name]) return MANUAL_ALIASES[name];
  // Handle "Name (Oblast)" disambiguation form used by ИПИ for
  // same-named municípalities.
  const parenMatch = name.match(/^([^()]+?)\s*\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const base = parenMatch[1].trim();
    const oblast = parenMatch[2].trim();
    const table = OBLAST_DISAMBIG[base];
    if (table && table[oblast]) return table[oblast];
  }
  const byName = loadIndex();
  const candidates = byName.get(name);
  if (!candidates || candidates.length === 0) return null;
  // For a município-center name that matches multiple settlements, the
  // canonical obshtina-center code is conventionally the lowest-numbered
  // one (oblast-capitals sort first).
  return candidates[0];
};
