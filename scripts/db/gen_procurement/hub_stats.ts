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
// Reads from Postgres via the existing scoped functions — this is a NEW
// aggregate, not a reproduction of the ingest's JSON, so it doesn't fall under
// the "no JSON from PG" rule. The output is committed + bucket-synced
// (procurement's exceptions in package.json bucket:sync), unlike the rest of the
// PG-served procurement tree.
//
//   npm run db:gen-hub-stats
//
// ⚠️ IN `db:refresh`, immediately after db:load:ngo-funding:pg — which is the
// EARLIEST safe slot, not an arbitrary one. Five of the nine fields below come
// from tables loaded across the whole chain (tenders/kzk_appeals at the tenders
// step, awarder_seats after agri, ngo_funding last of the four), so running this
// any earlier — e.g. next to db:load:annexes:pg, where it visually belongs —
// regenerates them from the PREVIOUS vintage and reconciles against nothing.
// See DEPENDENCIES below; refresh_coverage.test.ts holds the chain membership.
//
// This file is also the ONLY applier of 062_procurement_hub_counts.sql. Until
// 2026-08-04 nothing in the repo applied it, so procurement_hub_counts() existed
// only where it had been run by hand.

import fs from "node:fs";
import path from "node:path";
import { allRows, exec, end } from "../lib/pg";
import {
  missingRelations,
  missingFunctions,
  isEmpty,
  warnSkip,
} from "./preflight";
import {
  newestFirst,
  parliamentWindow,
  type ElectionRef,
} from "../../../src/data/scope/windows";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/procurement/derived/hub_stats.json");
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");
const MIGRATION = path.join(
  ROOT,
  "scripts/db/schema/pg/062_procurement_hub_counts.sql",
);

// Every relation the four scoped functions below touch, and which db:refresh step
// fills it — the machine-readable form of the placement note in the header.
//
// company_politicians (008) + tr_companies (003) are the exception: their only
// loader is db:load:tr:pg, a REFRESH_EXCLUSIONS member (multi-hour, uncommitted
// corpus). So on a clone that has never run the TR ingest they are ABSENT, not
// merely stale — and procurement_risk_feed reads both, which is why this preflight
// probes relations rather than assuming the chain implies them.
const RELATIONS = [
  "contracts", //           db:load:pg
  "awarder_seats", //       db:load:awarder-seats:pg
  "tenders", //             db:load:tenders:pg
  "kzk_appeals", //         db:load:tenders:pg (042) + kzk:rejoin
  "ngo_funding", //         db:load:ngo-funding:pg  ← the last one, hence the slot
  "company_politicians", // db:load:tr:pg (EXCLUDED from db:refresh)
  "tr_companies", //        db:load:tr:pg (EXCLUDED from db:refresh)
];

// 062 is applied by this file; the other three ride db:load:pg.
const FUNCTIONS = [
  "procurement_overview(text,text)", //      025
  "procurement_risk_feed(text,text)", //     029
  "procurement_by_settlement(text,text)", // 030
];

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

  // 062 first: `SET check_function_bodies = off` at its head means it applies
  // even where tenders/kzk_appeals/ngo_funding do not exist yet, and its GRANT is
  // role-guarded, so this is safe on a cold database. CREATE OR REPLACE, so it is
  // idempotent on a warm one.
  await exec(fs.readFileSync(MIGRATION, "utf8"));

  const relGaps = await missingRelations(RELATIONS);
  const fnGaps = await missingFunctions(FUNCTIONS);
  if (relGaps.length || fnGaps.length) {
    warnSkip(
      "hub_stats",
      `missing ${[
        relGaps.length ? `relation(s): ${relGaps.join(", ")}` : "",
        fnGaps.length ? `function(s): ${fnGaps.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ")}`,
      // Only point at the TR ingest when it is the WHOLE story — those two are
      // the sole gap db:refresh cannot close by itself, so naming it while
      // `contracts` is also missing sends the operator down the wrong (multi-hour)
      // path.
      !fnGaps.length &&
        relGaps.every(
          (r) => r === "company_politicians" || r === "tr_companies",
        )
        ? "Run `npm run db:load:tr:pg` (the TR ingest — the one dependency db:refresh excludes)."
        : "Run `npm run db:refresh` — its loaders fill these.",
    );
    await end();
    return;
  }

  // Present-but-empty is the fresh-clone shape: db:load:pg applies its migrations
  // and then finds no shards to load. Generating from it would write nine zeros
  // per scope over a good committed artifact, which reconciles against nothing and
  // is strictly worse than not running.
  if (await isEmpty("contracts")) {
    warnSkip(
      "hub_stats",
      "the contracts table is empty",
      "Run the procurement ingest, then `npm run db:load:pg`.",
    );
    await end();
    return;
  }

  // newestFirst + parliamentWindow rather than a local copy of the formula: the loop below
  // reads elections[i-1] as the next-newer election, which is only correct while the source
  // happens to be sorted. src/data/scope/windows is the one definition the React hook and
  // every other scoped precompute share.
  const elections = newestFirst(
    JSON.parse(fs.readFileSync(ELECTIONS, "utf8")) as ElectionRef[],
  );
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
  for (const e of elections) {
    const { from, to } = parliamentWindow(elections, e.name);
    out[`ns:${e.name}`] = await one(from, to);
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
