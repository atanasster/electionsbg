// The pure half of the coverage report: which register categories each ingest
// owns, and how many declarations we actually hold per register folder.
//
// Lives apart from coverage.ts because that module runs its CLI at import, and
// the equivalence these predicates encode is exactly what needs a test: the
// coverage report only means anything if its tier filter matches the ingest's
// own filter. A drift here makes the report compare the wrong two numbers and
// call a tier healthy while it holds half of what upstream publishes.

import fs from "fs";
import path from "path";
import { categoriseRaw } from "../officials/categorise";
import { MP_CATEGORY_SUBSTRING } from "../watch/sources/cacbg_declarations";
import { MUNICIPAL_CATEGORY_SUBSTRING } from "../watch/sources/cacbg_local";

export type Tier = {
  name: string;
  /** Where that tier's per-declarant JSON is written. */
  dir: string;
  /** Does this register category belong to this tier's ingest? */
  owns: (categoryName: string) => boolean;
};

export const TIERS: Tier[] = [
  {
    name: "MPs",
    dir: "data/parliament/declarations",
    owns: (n) => n.includes(MP_CATEGORY_SUBSTRING),
  },
  {
    name: "executive",
    dir: "data/officials/declarations",
    owns: (n) => categoriseRaw(n) !== null,
  },
  {
    name: "municipal",
    dir: "data/officials/municipal/declarations",
    owns: (n) => n.includes(MUNICIPAL_CATEGORY_SUBSTRING),
  },
];

/** Declarations we hold under `dir`, counted per register folder.
 *
 *  Counted as DISTINCT source URLs, not as rows. One upstream declaration is
 *  routinely written to more than one per-declarant file — an official who
 *  holds two posts is filed under both slugs, carrying the same filing twice —
 *  so a row count reads above the listed total and hides a real gap behind a
 *  negative one. The listed side counts URLs, and so must this. */
export const heldByFolder = (dir: string): Map<string, number> => {
  const seen = new Map<string, Set<string>>();
  if (!fs.existsSync(dir)) return new Map();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch {
      continue;
    }
    // A manifest or index.json dropped into a declarations directory parses
    // fine and is not a list of filings; skipping it keeps the whole report
    // from dying on one unexpected file.
    if (!Array.isArray(rows)) continue;
    for (const r of rows as { sourceUrl?: string }[]) {
      const url = r?.sourceUrl ?? "";
      const m = /cacbg\.bg\/([^/]+)\//.exec(url);
      if (!m) continue;
      const set = seen.get(m[1]) ?? new Set<string>();
      set.add(url);
      seen.set(m[1], set);
    }
  }
  return new Map([...seen].map(([folder, urls]) => [folder, urls.size]));
};
