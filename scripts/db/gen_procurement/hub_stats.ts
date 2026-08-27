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
import type { HubStat } from "../../../src/data/procurement/useProcurementHubStats";
import {
  missingRelations,
  missingFunctions,
  isEmpty,
  warnSkip,
} from "./preflight";
import { hubStatFor, hubScopes } from "./hub_stats_source";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/procurement/derived/hub_stats.json");
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

// The shape lives on the src/ side and is imported here — ONE declaration, per §1 ("A shared
// type gets ONE declaration. Put it on the `src/` side and import it from `scripts/`"). The
// two hand-copied halves had already drifted: this one required `topAwarders`, the reader's
// declared it optional.
//
// ⚠ THE COST OF `topAwarders` IS LOAD-BEARING, and the first comment here understated it by
// ~4×. Measured: the ranked list is 13,969 B across the 30 scopes and takes the blob
// 4,614 → 18,583 B against a 24,000 B gate. THREE rows, not five — five would be ~26.8 KB and
// break it. Every visitor to /procurement downloads this.

// `one()` and the scope enumeration now live in ./hub_stats_source, so the freshness gate
// (scripts/db/tests/procurement_hub_stats.data.test.ts) re-derives from the SAME code this
// generator writes from. A second copy in the gate would assert that two implementations
// agree rather than that the artifact matches the corpus. This module cannot be imported —
// it calls main() at module scope and exits — which is why the shared half is its own file.
const one = hubStatFor;

/** The name a buyer is MOST OFTEN filed under, per EIK.
 *
 *  ⚠ `procurement_overview()` returns `MIN(awarder_name COLLATE "C")` — an arbitrary alias,
 *  and this corpus is full of them: EIK 000696327 (Столична община) is filed as „Район
 *  „Банкя"", „Район витоша", „Район „Витоша"" and more, so the head published a single
 *  district as the identity of the whole municipality. Alphabetically-first is not a name
 *  anybody chose; the most-used one at least is.
 *
 *  This does NOT canonicalise the awarder side properly — 025 does that for CONTRACTORS via
 *  `tr_companies` and leaves buyers raw, which is the real fix and a migration. Until then
 *  the head shows the alias the register itself uses most.
 *
 *  One query for every EIK the fold selected, not one per scope. */
const commonestNames = async (eiks: string[]): Promise<Map<string, string>> => {
  if (!eiks.length) return new Map();
  const rows = (await allRows(
    `SELECT DISTINCT ON (awarder_eik) awarder_eik AS eik, awarder_name AS name
       FROM contracts
      WHERE awarder_eik = ANY($1::text[]) AND awarder_name IS NOT NULL
      GROUP BY awarder_eik, awarder_name
      ORDER BY awarder_eik, count(*) DESC, length(awarder_name) DESC`,
    [eiks],
  )) as { eik: string; name: string }[];
  return new Map(rows.map((r) => [r.eik, r.name]));
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

  // The scope list and each scope's figures come from ./hub_stats_source, which the
  // freshness gate imports too — see the note on `one` above.
  const out: Record<string, HubStat> = {};
  for (const { key, from, to } of await hubScopes())
    out[key] = await one(from, to);

  // Replace the arbitrary alias `procurement_overview()` returns with the name the register
  // uses most for that EIK. One query for every buyer any scope selected.
  const eiks = [
    ...new Set(
      Object.values(out).flatMap((h) => h.topAwarders.map((a) => a.eik)),
    ),
  ];
  const names = await commonestNames(eiks);
  let renamed = 0;
  for (const h of Object.values(out))
    for (const a of h.topAwarders) {
      const better = names.get(a.eik);
      if (better && better !== a.name) {
        a.name = better;
        renamed++;
      }
    }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  if (renamed)
    console.log(
      `  ${renamed} awarder name(s) replaced with the register's most-used alias (${eiks.length} distinct buyer(s))`,
    );
  console.log(
    `hub_stats: ${Object.keys(out).length} scope(s) → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(0);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
