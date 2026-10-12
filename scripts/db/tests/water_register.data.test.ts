// The water register's LIVENESS (docs/plans/water-hub-v1.md T1 / D6).
//
// `WaterOperator.status` decides how a row reads on /water/operators and in the
// finder — "в ликвидация", "в несъстоятелност", "неактивен" or nothing at all.
// Until 2026-10-12 only two of the 45 carried one, while the Commerce Registry
// had three more in liquidation or insolvency and two had no record at all, so
// five dead companies read as working water operators.
//
// A row with NO status must still look alive in at least one independent
// source; a row marked liquidated/bankrupt must not contradict the registry.
// Auto-skips only when Postgres is down.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { WATER_OPERATORS } from "@/lib/vikReferenceData";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

/** A live row needs a contract within this many months of the corpus's newest
 *  contract, OR an `active` Commerce Registry status. */
const RECENT_MONTHS = 36;

interface Row {
  eik: string;
  tr_status: string | null;
  last_contract: string | null;
}

const facts = async (): Promise<Map<string, Row>> => {
  const rows = await allRows<Row>(
    `SELECT e AS eik,
            (SELECT status FROM tr_companies WHERE uic = e) AS tr_status,
            (SELECT max(date) FROM contracts
              WHERE awarder_eik = e AND tag = 'contract') AS last_contract
       FROM unnest($1::text[]) e`,
    [WATER_OPERATORS.map((o) => o.eik)],
  );
  return new Map(rows.map((r) => [r.eik, r]));
};

test.skipIf(skip)(
  "every row without a status is alive in the corpus or the registry",
  async () => {
    const [{ max }] = await allRows<{ max: string }>(
      `SELECT max(date) AS max FROM contracts WHERE tag = 'contract' AND date ~ '^[12][0-9]{3}-'`,
    );
    const cutoff = new Date(max.slice(0, 10));
    cutoff.setMonth(cutoff.getMonth() - RECENT_MONTHS);
    const floor = cutoff.toISOString().slice(0, 10);
    const f = await facts();
    const live = WATER_OPERATORS.filter((o) => !o.status);
    // Non-vacuity: the register is mostly live operators.
    assert.ok(live.length > 30, `only ${live.length} live rows`);
    const dead = live.filter((o) => {
      const r = f.get(o.eik);
      const recent = (r?.last_contract ?? "") >= floor;
      return !recent && r?.tr_status !== "active";
    });
    assert.deepEqual(
      dead.map(
        (o) =>
          `${o.eik} ${o.name}: TR ${f.get(o.eik)?.tr_status ?? "—"}, last contract ${f.get(o.eik)?.last_contract ?? "—"}`,
      ),
      [],
      "rows with no status that look dead — set status + statusSource in vikReferenceData.ts",
    );
  },
);

// The label each registry status REQUIRES. `active` and a missing record
// require nothing here — the first test decides whether such a row looks dead.
const REQUIRED_STATUS: Record<string, readonly string[]> = {
  in_liquidation: ["liquidated"],
  bankrupt: ["bankrupt"],
  // A deregistered company is dead whichever label it carries.
  ceased: ["liquidated", "bankrupt", "dormant"],
};

test.skipIf(skip)(
  "every status agrees with the Commerce Registry",
  async () => {
    const f = await facts();
    const wrong: string[] = [];
    for (const o of WATER_OPERATORS) {
      const tr = f.get(o.eik)?.tr_status ?? null;
      const required = tr ? REQUIRED_STATUS[tr] : undefined;
      if (required && !required.includes(o.status ?? ""))
        wrong.push(
          `${o.eik} ${o.name}: TR ${tr}, labelled ${o.status ?? "live"}`,
        );
      // liquidated/bankrupt are claims the registry can refute outright.
      if (
        (o.status === "liquidated" || o.status === "bankrupt") &&
        tr === "active"
      )
        wrong.push(`${o.eik} ${o.name}: TR active, labelled ${o.status}`);
    }
    assert.deepEqual(wrong, []);
  },
);
