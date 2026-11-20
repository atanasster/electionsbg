// The /sector/health hub's figures come from a COMMITTED artifact —
// data/health/derived/hub_stats.json, written by
// `pnpm run db:gen-health-hub-stats` — so they fail the way every
// committed-derived artifact fails: the corpus reloads underneath the file and
// the hub keeps stating the old number at a 200 (health-hub-v1 T2, T9).
//
// Each figure is RE-DERIVED here from contracts / nzok_hospital_payments /
// national_competition() — never read back from the blob — and compared within
// a band. When one trips after an ordinary ingest, re-run the generator; do not
// widen the band. Each gate below was broken once by hand to watch it fail
// (health-hub-v1 T9); the mutation arms keep that true.
//
// The ?universe / #fragment half of T9 is src/screens/health/healthRegistry.test.ts.
//
// Auto-skips only when Postgres is down; the committed blob must exist.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allRows, dbReachable, end } from "../lib/pg";
import { HEALTH_SECTOR_EIKS } from "@/lib/healthReferenceData";
import type { HealthHubStats } from "@/data/health/hubStats";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BLOB = "data/health/derived/hub_stats.json";
assertCommitted(BLOB);

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const blob = (): HealthHubStats =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), BLOB), "utf8"),
  ) as HealthHubStats;
const eiks = [...HEALTH_SECTOR_EIKS];

const TOLERANCE = 0.02;
const within = (actual: number, stored: number) =>
  Math.abs(actual - stored) <= Math.max(1, Math.abs(stored) * TOLERANCE);
const near = (actual: number, stored: number, what: string) =>
  assert.ok(
    within(actual, stored),
    `${what}: database ${actual} vs blob ${stored} — re-run pnpm run db:gen-health-hub-stats`,
  );

const model = async (ex: boolean) => {
  const [r] = await allRows<{ total: number; fw: number | null }>(
    `SELECT (m->>'totalEur')::float8 total, (m->>'frameworkEur')::float8 fw
       FROM awarder_group_model($1::text[], NULL, NULL, $2) m`,
    [eiks, ex],
  );
  return r;
};

test.skipIf(skip)(
  "KPI 4 is the awarder-group model over the roster MINUS the framework arm",
  async () => {
    const b = blob().procurement;
    const ex = await model(true);
    near(ex.total, b.eur, "procurement.eur");
    // Mutation arm: with the framework ceilings put back, the same gate must
    // fail — otherwise it cannot tell D3's correction from its absence.
    const all = await model(false);
    assert.ok(
      !within(all.total, b.eur),
      `the framework-inclusive total ${all.total} also passes against ${b.eur} — the gate cannot see D3`,
    );
  },
);

test.skipIf(skip)(
  "the framework arm is joint_kind='framework', re-derived from contracts",
  async () => {
    const [r] = await allRows<{ eur: number; n: number }>(
      `SELECT coalesce(sum(amount_eur), 0)::float8 eur, count(*)::int n
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)
          AND joint_kind = 'framework'`,
      [eiks],
    );
    const b = blob().procurement;
    near(r.eur, b.frameworkCeilingEur, "procurement.frameworkCeilingEur");
    assert.equal(r.n, b.frameworkCeilingContracts);
    assert.ok(r.n > 0, "no framework rows — the arm is vacuous");
    const ex = await model(true);
    near(ex.fw ?? 0, b.frameworkCeilingEur, "awarder_group_model frameworkEur");
  },
);

test.skipIf(skip)(
  "the facility counts drop the €0 placeholder rows (A2)",
  async () => {
    const b = blob();
    const streams = await allRows<{
      stream: string;
      paid: number;
      all: number;
    }>(
      `SELECT stream,
              count(DISTINCT reg_no) FILTER (WHERE month_eur <> 0)::int paid,
              count(DISTINCT reg_no)::int "all"
         FROM nzok_hospital_payments WHERE extract(year FROM period) = $1
        GROUP BY 1`,
      [b.year],
    );
    const [tot] = await allRows<{ paid: number; zero: number }>(
      `SELECT count(DISTINCT reg_no) FILTER (WHERE month_eur <> 0)::int paid,
              count(*) FILTER (WHERE month_eur = 0)::int zero
         FROM nzok_hospital_payments WHERE extract(year FROM period) = $1`,
      [b.year],
    );
    assert.equal(b.payments.facilities, tot.paid, "payments.facilities");
    assert.equal(
      b.payments.placeholderRows,
      tot.zero,
      "payments.placeholderRows",
    );
    for (const s of b.payments.byStream) {
      const db = streams.find((r) => r.stream === s.stream);
      assert.equal(s.facilities, db?.paid, `byStream[${s.stream}].facilities`);
    }
    // Non-vacuity, and the mutation: in the blob's OWN year, a count that
    // forgot the filter must differ in some stream — or the gate cannot see A2
    // for the figure it publishes. (2025: every placeholder facility also has
    // a paid `bmp` month, so the year totals agree; `drugs` is 48 vs 47 paid.)
    assert.ok(
      tot.zero === 0 || streams.some((r) => r.all !== r.paid),
      `placeholder rows in ${b.year} never add a facility in any stream — the A2 gate is vacuous this year; pick a witness`,
    );
  },
);

test.skipIf(skip)("KPI 2 and KPI 3 are parts of KPI 1, not peers", () => {
  const b = blob();
  const whole = b.nzok.expenditureEur;
  assert.ok(whole > 0, "KPI 1 is empty");
  assert.ok(
    b.payments.careEur < whole,
    `hospital care €${b.payments.careEur} ≥ НЗОК €${whole}`,
  );
  assert.ok(
    b.medicines.eur < whole,
    `medicines €${b.medicines.eur} ≥ НЗОК €${whole}`,
  );
  assert.ok(
    b.payments.careEur + b.medicines.eur < whole,
    "care + medicines overshoot the whole — the parts overlap",
  );
});

test.skipIf(skip)(
  "the top-contractor list is keyed by EIK, never by name (A4)",
  async () => {
    const rows = blob().topContractors;
    assert.ok(rows.length > 0, "empty contractor list");
    const ids = rows.map((r) => r.eik);
    // An identifier, never a name: each key must BE a contractor_eik on a
    // roster contract. A shape regex cannot do this — a one-word Latin name
    // („MEDTRONIC") passes any [0-9A-Za-z-]+ test.
    const [k] = await allRows<{ missing: string[] }>(
      `SELECT coalesce(array_agg(id), '{}') missing FROM unnest($2::text[]) id
        WHERE NOT EXISTS (SELECT 1 FROM contracts
                           WHERE tag = 'contract' AND awarder_eik = ANY($1)
                             AND contractor_eik = id)`,
      [eiks, ids],
    );
    assert.deepEqual(
      k.missing,
      [],
      "contractor rows keyed by something that is no contractor_eik",
    );
    assert.equal(new Set(ids).size, ids.length, "an EIK appears twice");
    // Each row's € is the whole EIK, not one spelling of it.
    const [top] = rows;
    const [r] = await allRows<{ eur: number }>(
      `SELECT sum(amount_eur)::float8 eur FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = $2
          AND consortium_role IS DISTINCT FROM 'member'
          AND joint_kind IS DISTINCT FROM 'framework'`,
      [eiks, top.eik],
    );
    near(r.eur, top.eur, `topContractors[${top.eik}].eur`);
  },
);

test.skipIf(skip)(
  "the competition baseline is on the figure's own window",
  async () => {
    const p = blob().procurement;
    // The sector pair spans the roster's whole corpus…
    const [w] = await allRows<{ first: string; last: string }>(
      `SELECT min(date) first, max(date) last FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
      [eiks],
    );
    assert.equal(p.firstDate, w.first, "procurement.firstDate");
    assert.ok(p.lastDate, "procurement.lastDate is empty");
    // …so the national pair must be the all-time one, ex-member like the sector.
    const [n] = await allRows<{
      r: { singleBidExMembers: number; bidKnownExMembers: number };
    }>("SELECT national_competition(NULL, NULL) r");
    near(n.r.singleBidExMembers, p.nationalSingleBid, "nationalSingleBid");
    near(n.r.bidKnownExMembers, p.nationalBidKnown, "nationalBidKnown");
    // Mutation arm: a one-year national window must NOT pass as the baseline.
    const [y] = await allRows<{ r: { bidKnownExMembers: number } }>(
      "SELECT national_competition($1, NULL) r",
      [`${p.lastDate!.slice(0, 4)}-01-01`],
    );
    assert.ok(
      !within(y.r.bidKnownExMembers, p.nationalBidKnown),
      "a single-year baseline is indistinguishable from the all-time one",
    );
  },
);
