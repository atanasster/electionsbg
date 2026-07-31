// The settlement page's two halves must count the SAME contracts.
//
// The page pairs `procurement_settlement_detail(ekatte, from, to)` — which feeds the KPI
// cards and the buyers table — with a DbDataTable over `contracts` scoped by the
// `awarder_ekatte` semi-join. Two different SQL paths answering one question, under a
// scope pill that names a single window. If they diverge, nothing errors: the page shows
// one total in the cards and a different row count in the table beneath them.
//
// Two ways they can diverge, both silent, both checked here:
//
//   1. The SEMI-JOIN could select a different set of buyers than the detail function's
//      `seats` CTE (source='geo' AND is_local_hq).
//   2. The DATE BOUND. The detail function is HALF-OPEN (`ct.date < p_to`); the table's
//      range filter is INCLUSIVE (`date <= max`). Handing the same `to` to both admits
//      one extra day into the table — a mistake that reconciles nowhere and looks like
//      real data. The client must pass the day BEFORE `to` as the table's max.
//
// Auto-skips when Postgres is down or the contracts corpus is empty — like the other
// *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

const haveDb = await dbReachable();
const contractsLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM awarder_seats WHERE source='geo' AND is_local_hq",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !contractsLoaded
    ? "awarder_seats has no local-tier geo rows"
    : false;

afterAll(async () => {
  await end();
});

/** The semi-join exactly as functions/db_table.js emits it for awarder_ekatte. */
const SEMI_JOIN = `awarder_eik IN (
  SELECT eik FROM awarder_seats
  WHERE source = 'geo' AND is_local_hq AND ekatte = $1
)`;

// round() on a double precision column returns double precision, which node-postgres
// parses as a JS number — while count() is bigint and arrives as a string. Both sides are
// normalised through Number() before comparison rather than trusting either shape.
type Agg = { n: number; eur: number };
const num = (v: unknown): number => Number(v ?? 0);

const viaSemiJoin = async (
  ekatte: string,
  from: string | null,
  to: string | null,
): Promise<Agg> =>
  await allRows<{ n: unknown; eur: unknown }>(
    `SELECT count(*) n, round(sum(amount_eur)) eur FROM contracts
       WHERE tag = 'contract' AND ${SEMI_JOIN}
         AND ($2::text IS NULL OR date >= $2)
         AND ($3::text IS NULL OR date <  $3)`,
    [ekatte, from, to],
  ).then((rows) => ({ n: num(rows[0]?.n), eur: num(rows[0]?.eur) }));

const viaDetailFn = async (
  ekatte: string,
  from: string | null,
  to: string | null,
): Promise<Agg> => {
  const r = (
    await allRows<{ j: { contractCount: number; totalEur: number } | null }>(
      "SELECT procurement_settlement_detail($1, $2, $3) AS j",
      [ekatte, from, to],
    )
  )[0]?.j;
  return { n: num(r?.contractCount), eur: num(r?.totalEur) };
};

// The three densest settlements plus a one-contract village — the sparse case takes a
// different query plan (seats-first rather than date-index-first), so it exercises a
// different code path in the planner even though the SQL is identical.
const SETTLEMENTS = ["68134", "56784", "10135", "07079"];

test.skipIf(skip)(
  "the semi-join and procurement_settlement_detail agree, corpus-wide",
  async () => {
    for (const ekatte of SETTLEMENTS) {
      const a = await viaSemiJoin(ekatte, null, null);
      const b = await viaDetailFn(ekatte, null, null);
      assert.equal(
        a.n,
        b.n,
        `${ekatte}: contract count differs (table ${a.n} vs cards ${b.n})`,
      );
      assert.equal(
        a.eur,
        b.eur,
        `${ekatte}: total differs (table ${a.eur} vs cards ${b.eur})`,
      );
    }
  },
);

test.skipIf(skip)("they agree inside a calendar-year window too", async () => {
  // useScopeWindow's y:2024 — half-open, passed verbatim to both sides.
  for (const ekatte of SETTLEMENTS) {
    const a = await viaSemiJoin(ekatte, "2024-01-01", "2025-01-01");
    const b = await viaDetailFn(ekatte, "2024-01-01", "2025-01-01");
    assert.equal(a.n, b.n, `${ekatte}: windowed contract count differs`);
    assert.equal(a.eur, b.eur, `${ekatte}: windowed total differs`);
  }
});

test.skipIf(skip)(
  "the window's upper bound is EXCLUSIVE — 1 January belongs to the next year",
  async () => {
    // The whole reason the table has to stop a day short of `to`. If this function were
    // ever changed to `<=`, the two halves of the page would silently disagree by one
    // day's contracts, and the year totals would double-count every 1 January.
    const boundary = (
      await allRows<{ n: string }>(
        `SELECT count(*) n FROM contracts ct
         JOIN awarder_seats s ON s.eik = ct.awarder_eik
         WHERE s.source='geo' AND s.is_local_hq AND ct.tag='contract'
           AND ct.date = '2025-01-01'`,
      )
    )[0];
    // Only meaningful if the corpus actually has contracts on that date.
    if (Number(boundary.n) === 0) return;

    const within = await viaDetailFn("68134", "2024-01-01", "2025-01-01");
    const next = await viaDetailFn("68134", "2025-01-01", "2026-01-01");
    const spanning = await viaDetailFn("68134", "2024-01-01", "2026-01-01");
    assert.equal(
      Number(within.n) + Number(next.n),
      Number(spanning.n),
      "adjacent half-open windows must partition the span exactly — no gap, no overlap",
    );
  },
);
