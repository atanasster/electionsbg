// The hand-picked entities whose full JSON we snapshot as golden fixtures
// (Tier 2). Chosen to exercise the edge cases a SQL rewrite is most likely to
// regress: the biggest rollups, contractors with amendments (contract-only
// total rule), the euro/legacy boundary, geo-resolved awarders, and one of each
// faceted/derived output. The set is deliberately small (~30 files, a few
// hundred KB) — enough for readable diffs, light enough to refresh on the
// fortnightly data update via `npm run db:goldens`.
//
// Targets are resolved against what's on disk; anything missing is skipped with
// a warning rather than failing the snapshot.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PROC_DIR } from "./lib/paths";

// Top contractors (measured 2026-06-30) + two contractors that carry
// amendments, so the golden pins the contract-only totalEur behaviour.
const CONTRACTOR_EIKS = [
  "103267194", // Софарма трейдинг АД (largest)
  "177367106", // Обединение Консорциум Аркад
  "203283623", // Фьоникс Фарма ЕООД
  "121699202", // ЛУКОЙЛ-БЪЛГАРИЯ ЕООД
  "101105090", // Никмар кънстракшън (5 amendments — edge case)
  "101111481", // Етерна кънстръкшън (amendment — edge case)
];

// Kept deliberately SMALL: the heavy bulk categories (month shards,
// awarder_contracts) are covered byte-for-byte by the manifest + full map, so
// goldens carry only compact, representative files for readable diffs. The
// month-shard ROW shape is exercised here via the per-entity contract list.
const STATIC_TARGETS = [
  "index.json",
  "debarred.json",
  // Faceted aggregates.
  "by_ns/2013_05_12.json",
  "by_settlement/index.json",
  "by_settlement/_national.json",
  "by_settlement/00084.json",
  // Derived analytics (the curated, repo-committed ones).
  "derived/top_contractors.json",
  "derived/flow_full.json",
  "derived/cpv_competition.json",
  ...CONTRACTOR_EIKS.map((e) => `contractors/${e}.json`),
  // One compact per-entity contract list (an amendment-bearing contractor, so
  // the golden also pins the full Contract row shape readably).
  "contractor_contracts/101105090.json",
];

/** Read the top awarder EIK from the awarders index so a geo-bearing awarder
 *  rollup is always in the set without hardcoding an EIK that may rotate. */
const topAwarderTargets = (): string[] => {
  const idx = path.join(PROC_DIR, "derived", "awarders_index.json");
  if (!existsSync(idx)) return [];
  try {
    const data = JSON.parse(readFileSync(idx, "utf8")) as {
      entries?: Array<{ eik: string }>;
      awarders?: Array<{ eik: string }>;
    };
    const list = data.entries ?? data.awarders ?? [];
    const eik = list[0]?.eik;
    // Rollup only — the full awarder_contracts list is heavy (АПИ ≈ 2.7 MB) and
    // already covered by the manifest.
    return eik ? [`awarders/${eik}.json`] : [];
  } catch {
    return [];
  }
};

/** Relpaths (relative to PROC_DIR) of golden targets that exist on disk. */
export const getGoldenTargets = (): string[] => {
  const all = [...STATIC_TARGETS, ...topAwarderTargets()];
  const present: string[] = [];
  for (const rel of all) {
    if (existsSync(path.join(PROC_DIR, rel))) present.push(rel);
    else console.warn(`  (skip missing golden target: ${rel})`);
  }
  return present;
};
