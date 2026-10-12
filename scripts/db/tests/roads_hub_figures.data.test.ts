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
// Auto-skips when Postgres is down or the artifact has never been generated.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { roadRowAliases } from "../lib/roadsRows";
import {
  ROADS_INHOUSE_CONTRACTORS,
  ROADS_SECTOR_EIKS,
} from "@/lib/roadsReferenceData";
import type { RoadsHubStats } from "@/data/roads/hubStats";
import { reportSkip } from "../../lib/report_skip";

const ROOT = process.cwd();
const ARTIFACT = path.resolve(ROOT, "data/roads/derived/hub_stats.json");
const SECTOR_STATS = path.resolve(
  ROOT,
  "data/procurement/derived/sector_stats.json",
);

const haveDb = await dbReachable();
const skip = !haveDb
  ? "Postgres unreachable"
  : !existsSync(ARTIFACT)
    ? "data/roads/derived/hub_stats.json absent — run db:gen-roads-hub-stats"
    : false;
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
