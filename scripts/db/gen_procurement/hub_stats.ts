// Pre-generate the /procurement HUB stat-tile numbers as one small per-scope
// JSON, so the hub reads a static file instead of firing 2–4 live DB queries per
// load — and so the two counts too heavy to query live (flags = single-supplier
// concentration cases; places = settlements with procurement) can be included,
// computed offline where their cost doesn't matter.
//
// Keyed by the SAME scope key the frontend computes (useScopeWindow):
//   ns:<election>  — the selected parliament's tenure window [from, next election)
//   y:<year>       — one calendar year
//   all            — the full corpus
//
// Reads from Postgres (loaded by db:refresh before this runs) via the existing
// scoped functions — this is a NEW aggregate, not a reproduction of the ingest's
// JSON, so it doesn't fall under the "no JSON from PG" rule. Run after db:refresh:
//   npm run db:gen-hub-stats
// The output is committed + bucket-synced (procurement's exceptions in
// package.json bucket:sync), unlike the rest of the PG-served procurement tree.

import fs from "node:fs";
import path from "node:path";
import { allRows } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/procurement/derived/hub_stats.json");
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");

const dash = (d: string): string => d.replace(/_/g, "-");

interface HubStat {
  totalEur: number;
  contracts: number;
  contractors: number;
  connected: number;
  tenders: number;
  appeals: number;
  ngos: number;
  flags: number;
  places: number;
}

const one = async (
  from: string | null,
  to: string | null,
): Promise<HubStat> => {
  const [ov] = (await allRows("SELECT procurement_overview($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { totals: Record<string, number> };
  }[];
  const [hc] = (await allRows("SELECT procurement_hub_counts($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { tenders: number; appeals: number; ngos: number };
  }[];
  const [rf] = (await allRows("SELECT procurement_risk_feed($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { concentrationTotal: number };
  }[];
  const [bs] = (await allRows("SELECT procurement_by_settlement($1,$2) AS r", [
    from,
    to,
  ])) as {
    r: { settlementCount: number };
  }[];
  const t = ov.r.totals;
  return {
    totalEur: t.totalEur ?? 0,
    contracts: (t.contracts ?? 0) + (t.amendments ?? 0),
    contractors: t.contractorCount ?? 0,
    connected: (t.mpCount ?? 0) + (t.officialCount ?? 0),
    tenders: hc.r.tenders ?? 0,
    appeals: hc.r.appeals ?? 0,
    ngos: hc.r.ngos ?? 0,
    flags: rf.r.concentrationTotal ?? 0,
    places: bs.r.settlementCount ?? 0,
  };
};

const main = async (): Promise<void> => {
  const t0 = Date.now();
  const elections = JSON.parse(fs.readFileSync(ELECTIONS, "utf8")) as Array<{
    name: string;
  }>;
  // Distinct contract years present (for the y:<year> scopes the hub's year
  // picker offers).
  const yearRows = (await allRows(
    "SELECT DISTINCT left(date,4) AS y FROM contracts WHERE date >= '2011' ORDER BY y",
    [],
  )) as { y: string }[];

  const out: Record<string, HubStat> = {};

  // all-corpus
  out["all"] = await one(null, null);

  // per-parliament windows (newest-first: the next election sits at idx-1)
  for (let i = 0; i < elections.length; i++) {
    const from = dash(elections[i].name);
    const to = i > 0 ? dash(elections[i - 1].name) : null;
    out[`ns:${elections[i].name}`] = await one(from, to);
  }

  // per-year windows
  for (const { y } of yearRows) {
    const year = Number(y);
    if (!Number.isFinite(year)) continue;
    out[`y:${year}`] = await one(`${year}-01-01`, `${year + 1}-01-01`);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  console.log(
    `hub_stats: ${Object.keys(out).length} scope(s) → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(0);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
