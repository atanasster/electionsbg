// Regression harness for the main-site header search. Mirrors how
// src/data/search/useSearchItems.tsx builds the Fuse index (settlements +
// municipalities + municipal officials, with officials romanized via
// transliterateName) and applies the SAME shared config (SEARCH_FUSE_OPTIONS +
// searchLimitForType from src/data/search/searchConfig) + per-type cap that
// SearchContext.tsx uses. Locks the typo / cross-script / same-name behaviour so
// a future threshold tweak can't silently regress it.
//
// Run: npm run search:test   (npx tsx scripts/search/search.harness.ts)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Fuse from "fuse.js";
import {
  SEARCH_FUSE_OPTIONS,
  searchLimitForType,
} from "@/data/search/searchConfig";
import { transliterateName } from "@/data/candidates/transliterateName";

const read = <T>(p: string): T =>
  JSON.parse(readFileSync(join(process.cwd(), "data", p), "utf8")) as T;

type Settlement = {
  ekatte: string;
  name: string;
  name_en: string;
  obshtina: string;
};
type Muni = { obshtina: string; name: string; name_en: string };
type OfficialFile = { entries: { slug: string; name: string }[] };

type Item = {
  type: "s" | "m" | "o";
  name: string;
  name_en?: string;
  obshtina?: string;
};

const settlements = read<Settlement[]>("settlements.json");
const munis = read<Muni[]>("municipalities.json");
const officials = read<OfficialFile>(
  "officials/municipal/search_index.json",
).entries;

const items: Item[] = [
  ...settlements.map((s) => ({
    type: "s" as const,
    name: s.name,
    name_en: s.name_en,
    obshtina: s.obshtina,
  })),
  ...munis.map((m) => ({
    type: "m" as const,
    name: m.name,
    name_en: m.name_en,
    obshtina: m.obshtina,
  })),
  // officials are Cyrillic-only in the source → romanize for Latin search
  ...officials.map((o) => ({
    type: "o" as const,
    name: o.name,
    name_en: transliterateName(o.name),
  })),
];

const fuse = new Fuse(
  items,
  SEARCH_FUSE_OPTIONS as ConstructorParameters<typeof Fuse<Item>>[1],
);

const PER_TYPE_LIMIT = 5;
// Mirror SearchContext: filter by per-type score limit, then cap 5 per type.
const query = (q: string): Item[] => {
  const passing = fuse
    .search(q)
    .filter((r) => (r.score ?? 1) <= searchLimitForType(r.item.type));
  const counts: Record<string, number> = {};
  const out: Item[] = [];
  for (const r of passing) {
    const c = counts[r.item.type] ?? 0;
    if (c >= PER_TYPE_LIMIT) continue;
    counts[r.item.type] = c + 1;
    out.push(r.item);
  }
  return out;
};

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures += 1;
};

console.log(`index: ${items.length} items`);

console.log("\n=== gap #1: settlement / muni typos resolve (0.2) ===");
const plovdv = query("Пловдв");
ok(
  plovdv.some((i) => i.name === "Пловдив"),
  `"Пловдв" -> Пловдив (got ${plovdv.length} results)`,
);
const turnovo = query("Veliko Turnovo");
ok(
  turnovo.some((i) => i.name === "Велико Търново"),
  `"Veliko Turnovo" (translit drift) -> Велико Търново`,
);
const kalofre = query("Калофре");
ok(
  kalofre.some((i) => i.name === "Калофер"),
  `"Калофре" (typo) -> Калофер`,
);

console.log("\n=== gap #2: officials are Latin-searchable ===");
const terziev = query("Terziev");
ok(
  terziev.some((i) => i.type === "o"),
  `"Terziev" (Latin) -> at least one official (got ${terziev.filter((i) => i.type === "o").length})`,
);
const cyrillic = query("Терзиев");
ok(
  cyrillic.some((i) => i.type === "o"),
  `"Терзиев" (Cyrillic) -> officials still work`,
);

console.log("\n=== same-name villages in different municipalities ===");
const banya = query("Баня").filter((i) => i.type === "s" && i.name === "Баня");
const distinctMunis = new Set(banya.map((i) => i.obshtina));
ok(
  banya.length >= 3,
  `"Баня" -> multiple settlements named exactly Баня (got ${banya.length})`,
);
ok(
  distinctMunis.size >= 3,
  `"Баня" villages span distinct municipalities (got ${distinctMunis.size}: ${[...distinctMunis].join(", ")})`,
);

console.log("\n=== over-reach guard: foreign / nonsense return nothing ===");
for (const q of ["Лондон", "Барселона", "xyzzyqwfp"]) {
  const r = query(q).filter((i) => i.type === "s" || i.type === "m");
  ok(r.length === 0, `"${q}" -> no settlement/muni match (got ${r.length})`);
}

console.log("\n=== exact queries stay clean + ranked first ===");
const exact = query("Пловдив");
ok(exact[0]?.name === "Пловдив", `"Пловдив" -> top result is Пловдив`);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — site search`,
);
process.exit(failures === 0 ? 0 : 1);
