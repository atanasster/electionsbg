// The /sector/roads hub's figures come from a COMMITTED artifact —
// data/roads/derived/hub_stats.json, written by `npm run db:gen-roads-hub-stats`
// — so they fail the way every committed-derived artifact fails: the corpus
// reloads underneath the file and the hub keeps stating the old number at a 200.
//
// This re-derives each figure from Postgres and compares within a band (an
// ordinary ingest moves them by fractions of a percent; when one trips, re-run
// the generator — do not widen the band). It also holds the two agreements the
// plan names (docs/plans/roads-hub-v1.md T3):
//   · KPI 1 == sector_stats.json all.roads — one number, two pages;
//   · the generator's rows and the browser route's rows are the same columns.
// and asserts the REJECTED bases differ, so a regression onto one of them fails.
//
// Auto-skips only when Postgres is down; the two committed inputs must exist.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { roadRowAliases } from "../lib/roadsRows";
import {
  ROADS_INHOUSE_CONTRACTORS,
  ROADS_SECTOR_EIKS,
} from "@/lib/roadsReferenceData";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const ROOT = process.cwd();
const ARTIFACT = path.resolve(ROOT, "data/roads/derived/hub_stats.json");
const SECTOR_STATS = path.resolve(
  ROOT,
  "data/procurement/derived/sector_stats.json",
);

// Both are COMMITTED, so a missing copy is a broken checkout — fail, never skip.
assertCommitted(
  "data/roads/derived/hub_stats.json",
  "data/procurement/derived/sector_stats.json",
);

// The registry engine behind /procurement/contracts — CJS, so require()d.
const { runDbTable } = createRequire(import.meta.url)(
  "../../../functions/db_table.js",
) as {
  runDbTable: (
    q: (sql: string, params: unknown[]) => Promise<unknown[]>,
    req: Record<string, unknown>,
  ) => Promise<{ total: number; aggregates?: { count?: number } }>;
};

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const blob = (): RoadsHubStats =>
  JSON.parse(readFileSync(ARTIFACT, "utf8")) as RoadsHubStats;
const eiks = [...ROADS_SECTOR_EIKS];

const TOLERANCE = 0.02;
const near = (actual: number, stored: number, what: string) =>
  assert.ok(
    Math.abs(actual - stored) <= Math.max(1, Math.abs(stored) * TOLERANCE),
    `${what}: database ${actual} vs blob ${stored} — re-run db:gen-roads-hub-stats`,
  );

test.skipIf(skip)(
  "KPI 1 is sector_stats.json's roads headline, on the same basis",
  () => {
    const s = JSON.parse(readFileSync(SECTOR_STATS, "utf8")) as {
      all: { roads: { value: number; basis: string } };
    };
    assert.equal(s.all.roads.basis, "procurement");
    assert.equal(blob().procurement.eur, Math.round(s.all.roads.value));
  },
);

test.skipIf(skip)(
  "the headline and counts match, and the rejected bases do not",
  async () => {
    const b = blob().procurement;
    const [r] = await allRows<Record<string, string>>(
      `SELECT sum(amount_eur) FILTER (WHERE tag = 'contract') eur,
              sum(amount_eur) all_tags,
              sum(coalesce(signing_amount_eur, amount_eur))
                FILTER (WHERE tag = 'contract') at_signing,
              count(*) FILTER (WHERE tag = 'contract'
                AND consortium_role IS DISTINCT FROM 'member') n,
              count(*) FILTER (WHERE tag = 'contract') n_with_members
         FROM contracts WHERE awarder_eik = ANY($1)`,
      [eiks],
    );
    near(Number(r.eur), b.eur, "roll-up €");
    near(Number(r.n), b.contracts, "contracts");
    // The bases a figure could slide onto by accident (plan D6, R10).
    assert.notEqual(Math.round(Number(r.all_tags)), b.eur, "all-tag sum");
    assert.notEqual(Math.round(Number(r.at_signing)), b.eur, "pre-annex sum");
    assert.notEqual(Number(r.n_with_members), b.contracts, "member-inclusive");
  },
);

test.skipIf(skip)("single-bid and the national pair match", async () => {
  const b = blob().procurement;
  const [r] = await allRows<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE number_of_tenderers = 1) sb,
            count(*) FILTER (WHERE number_of_tenderers IS NOT NULL) bk
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
        AND consortium_role IS DISTINCT FROM 'member'`,
    [eiks],
  );
  near(Number(r.sb), b.singleBid, "single-bid");
  near(Number(r.bk), b.bidKnown, "bid-known");
  const [{ r: nat }] = await allRows<{
    r: { singleBidExMembers: number; bidKnownExMembers: number };
  }>("SELECT national_competition(NULL, NULL) AS r");
  near(nat.singleBidExMembers, b.nationalSingleBid, "national single-bid");
  near(nat.bidKnownExMembers, b.nationalBidKnown, "national bid-known");
});

test.skipIf(skip)("the in-house contractor figure matches", async () => {
  const b = blob().inhouse;
  assert.equal(b.eik, ROADS_INHOUSE_CONTRACTORS[0].eik);
  const [r] = await allRows<{ eur: string }>(
    `SELECT sum(amount_eur) eur FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = $2`,
    [eiks, b.eik],
  );
  near(Number(r.eur), b.eur, "in-house €");
});

test.skipIf(skip)(
  "the option cluster matches, and is mostly ал. 1 т. 1 options (R9)",
  async () => {
    const b = blob().annexOptions;
    const [r] = await allRows<{ n: string; growth: string }>(
      `SELECT count(*) n, sum(amount_eur - signing_amount_eur) growth
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
          AND signing_amount_eur > 0
          AND abs(amount_eur / signing_amount_eur - 1.5) < 0.005`,
      [eiks],
    );
    near(Number(r.n), b.contracts, "option contracts");
    near(Number(r.growth), b.growthEur, "option growth");
    // Each contract once — the reason split must sum back to the cluster.
    assert.equal(
      b.byReason.reduce((s, x) => s + x.contracts, 0),
      b.contracts,
    );
    const option = b.byReason.find((x) => x.reason === "option");
    assert.ok(
      option && option.growthEur > b.growthEur / 2,
      "the cluster is no longer mostly pre-set options — revisit the D6 wording",
    );
  },
);

test.skipIf(skip)("the EU-funds arm matches", async () => {
  const b = blob().euFunds;
  const [r] = await allRows<{ n: string; total: string }>(
    `SELECT count(*) n, sum(total_eur) total FROM fund_projects
      WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );
  near(Number(r.n), b.projects, "EU projects");
  near(Number(r.total), b.totalEur, "EU total €");
});

test("the browser route selects every column the generator reads", () => {
  // functions/db_routes.js cannot import TS, so its SELECT is a second copy of
  // scripts/db/lib/roadsRows.ts. A column the engine reads that one side lacks
  // makes the hub and the sub-pages count different rows, both looking right.
  const src = readFileSync(
    path.resolve(ROOT, "functions/db_routes.js"),
    "utf8",
  );
  const start = src.indexOf('"awarder-contracts":');
  const body = src.slice(start, src.indexOf("FROM contracts", start));
  for (const alias of roadRowAliases()) {
    const sel = new RegExp(`(AS "${alias}"|\\b${alias}\\b)`);
    assert.match(body, sel, `awarder-contracts does not select ${alias}`);
  }
});

test.skipIf(skip)("the artifact is small enough to be a hub blob", () => {
  // ~20 headline numbers plus the finder's corridor/ОПУ index (~2.6 KB of
  // Cyrillic names). Anything larger means a per-row payload crept in.
  const bytes = readFileSync(ARTIFACT).byteLength;
  assert.ok(bytes < 5120, `${bytes} B — the roads hub blob outgrew its budget`);
});

test.skipIf(skip)(
  "contractors, risk grades, in-house count and EU paid € match",
  async () => {
    const b = blob();
    const [r] = await allRows<Record<string, string>>(
      `SELECT count(DISTINCT contractor_eik) FILTER (
                WHERE consortium_role IS DISTINCT FROM 'member' AND amount_eur > 0) contractors,
              count(*) FILTER (WHERE contractor_eik = $2) inhouse
         FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [eiks, b.inhouse.eik],
    );
    near(Number(r.contractors), b.procurement.contractors, "contractors");
    near(Number(r.inhouse), b.inhouse.contracts, "in-house contracts");
    const grades = await allRows<{ grade: string; n: string }>(
      `SELECT r.grade, count(*) n
         FROM contracts c JOIN contract_risk_cache r ON r.key = c.key
        WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
          AND c.consortium_role IS DISTINCT FROM 'member' AND r.grade IS NOT NULL
        GROUP BY 1`,
      [eiks],
    );
    for (const g of grades)
      near(Number(g.n), b.riskGrades[g.grade] ?? 0, `grade ${g.grade}`);
    // Member rows carry no money and must not reach the histogram (T3 review).
    const graded = Object.values(b.riskGrades).reduce((s, n) => s + n, 0);
    assert.ok(graded <= b.procurement.contracts, `${graded} graded rows`);
    const [eu] = await allRows<{ paid: string }>(
      `SELECT sum(paid_eur) paid FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
      [eiks],
    );
    near(Number(eu.paid), b.euFunds.paidEur, "EU paid €");
  },
);

test.skipIf(skip)(
  "the KPI links open a browser that counts what the hub counts",
  async () => {
    // ROADS_KPI_TO.eur / .singleBid land on /procurement/contracts?sector=roads.
    // That screen sends tag + the pack's awarder set + (excludeConsortiumMembers)
    // not_consortium_member. Without the last one the hub's 2,367 contracts
    // opened onto 2,866 rows. Run through the real engine, not a restated WHERE.
    // (sectorPacks.tsx is a JSX module; roadsRegistry.test.ts pins the pack's
    // flag and its EIK set, so this arm takes the set from the register.)
    const q = (sql: string, params: unknown[]) => allRows(sql, params);
    const run = (extra: Record<string, unknown>[]) =>
      runDbTable(q, {
        resource: "contracts",
        page: 0,
        pageSize: 1,
        filters: {
          columns: [
            { id: "tag", value: ["contract"] },
            { id: "awarder_eik", value: eiks },
            { id: "not_consortium_member", value: "member" },
            ...extra,
          ],
        },
      });
    const b = blob().procurement;
    const all = await run([]);
    assert.equal(all.aggregates?.count ?? all.total, b.contracts);
    const single = await run([{ id: "number_of_tenderers", min: 1, max: 1 }]);
    assert.equal(single.aggregates?.count ?? single.total, b.singleBid);
  },
);

test.skipIf(skip)(
  "the direct-award KPI's unknown-procedure share is the database's",
  async () => {
    // procedureBucket's "unknown" is an empty method; independent SQL, not the engine.
    const [r] = await allRows<{ eur: string }>(
      `SELECT sum(amount_eur) eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
          AND consortium_role IS DISTINCT FROM 'member'
          AND coalesce(btrim(procurement_method), '') = ''`,
      [eiks],
    );
    const b = blob().procurement;
    assert.ok(b.unknownMethodEur != null, "re-run db:gen-roads-hub-stats");
    near(Number(r.eur), b.unknownMethodEur, "unknown-method €");
  },
);
