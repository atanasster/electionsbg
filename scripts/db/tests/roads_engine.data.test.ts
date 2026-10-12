// The roads engine (src/lib/roadAttributes.ts) run over the REAL АПИ corpus.
//
// Every /sector/roads tile is computed client-side by buildRoadsModel over the
// `awarder-contracts` rows, so the engine's parsing rules ARE the page. The unit
// tests pin each rule on a fixture; this gate pins what the rules do to the
// corpus, because each defect below was invisible on a fixture and only showed
// as a number on the page (docs/plans/roads-hub-v1.md §2, measured 2026-10-12):
//
//   R10  €0 consortium-member rows counted a joint award once per member firm
//        (499 of 2,826 rows; winter maintenance 90.0% single-bid vs a true 76.9%)
//   R12  a lot naming several ОПУ went to one oblast (€800.6M; Шумен €0.6M)
//   R14  the 0–165 Струма cap rejected every construction lot (13 contracts on
//        the strip against a €943.9M corridor)
//   R1/O the model total must stay the hub headline's basis
//
// Bands and inequalities, never exact figures — the corpus reloads fortnightly.
// Auto-skips only when Postgres is down or the corpus is not loaded.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import type { ProcurementContract } from "@/data/dataTypes";
import {
  API_EIK,
  buildChainageStrips,
  buildRoadsModel,
  MULTI_REGION,
} from "@/lib/roadAttributes";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const [{ n } = { n: "0" }] = haveDb
  ? await allRows<{ n: string }>(
      "SELECT count(*) n FROM contracts WHERE awarder_eik = $1",
      [API_EIK],
    )
  : [];
const skip = !haveDb
  ? "Postgres unreachable"
  : Number(n) === 0
    ? "АПИ has no contracts loaded — run db:load:pg"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// The columns the engine reads, in the route's casing. Kept to what
// buildRoadsModel touches so a renamed column fails here, not on the page.
const rowsOf = () =>
  allRows<ProcurementContract>(
    `SELECT key, tag, date, contractor_eik AS "contractorEik",
            contractor_name AS "contractorName", amount_eur AS "amountEur",
            signing_amount_eur AS "signingAmountEur", title, cpv,
            procurement_method AS "procurementMethod",
            number_of_tenderers AS "numberOfTenderers",
            consortium_role AS "consortiumRole"
       FROM contracts WHERE awarder_eik = $1`,
    [API_EIK],
  );

test.skipIf(skip)(
  "the model total is the headline basis and counts no consortium member (R1, R10)",
  async () => {
    const rows = await rowsOf();
    const m = buildRoadsModel(rows);
    const [sql] = await allRows<{ eur: string; n: string; members: string }>(
      `SELECT sum(amount_eur) eur,
              count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
              count(*) FILTER (WHERE consortium_role = 'member') members
         FROM contracts WHERE awarder_eik = $1 AND tag = 'contract'`,
      [API_EIK],
    );
    assert.ok(
      Math.abs(m.totalEur - Number(sql.eur)) < 1,
      `model €${m.totalEur} vs SQL €${sql.eur}`,
    );
    assert.equal(m.rows.length, Number(sql.n));
    // Non-vacuity: the guard only means something while members exist.
    assert.ok(Number(sql.members) > 100, "no member rows — retire this arm");
  },
);

test.skipIf(skip)(
  "every single-bid share is on non-member rows — re-derived per component (R10)",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    for (const c of m.components) {
      const own = m.rows.filter(
        (r) => r.component === c.component && r.c.numberOfTenderers != null,
      );
      const single = own.filter((r) => r.c.numberOfTenderers === 1).length;
      if (!own.length) continue;
      assert.ok(
        Math.abs((c.singleBidShare ?? 0) - single / own.length) < 1e-9,
        c.component,
      );
    }
    assert.ok(
      m.rows.every((r) => r.c.consortiumRole !== "member"),
      "a member row reached the model",
    );
  },
);

test.skipIf(skip)(
  "multi-ОПУ lots are their own bucket, not the longest oblast (R12)",
  async () => {
    const m = buildRoadsModel(await rowsOf());
    const multi = m.regions.find((r) => r.region === MULTI_REGION);
    assert.ok(multi, "no multi-ОПУ bucket");
    assert.ok(multi.totalEur > 300e6, `multi-ОПУ only €${multi.totalEur}`);
    // АМ „Тракия" OP3 (€193M across 7 ОПУ) is what used to make Стара Загора
    // the largest single oblast.
    const sz = m.regions.find((r) => r.region === "Стара Загора");
    assert.ok(
      (sz?.totalEur ?? 0) < 300e6,
      "Стара Загора re-absorbed a multi lot",
    );
  },
);

test.skipIf(skip)(
  "Struma construction lots sit on the I-1 axis (R14)",
  async () => {
    const strips = buildChainageStrips(buildRoadsModel(await rowsOf()).rows);
    const i1 = strips.find((s) => s.axis.axisKey === "Струма I-1");
    assert.ok(i1, "no Струма I-1 strip");
    assert.ok(i1.contracts >= 10, `Струма I-1 holds ${i1.contracts}`);
    assert.ok(i1.totalEur > 200e6, `Струма I-1 €${i1.totalEur}`);
  },
);

test.skipIf(skip)(
  "national_competition carries a member-free pair that differs from the raw one",
  async () => {
    const [{ r }] = await allRows<{
      r: {
        singleBid: number;
        bidKnown: number;
        singleBidExMembers?: number;
        bidKnownExMembers?: number;
      };
    }>("SELECT national_competition(NULL, NULL) AS r");
    assert.ok(
      r.bidKnownExMembers != null,
      "167 lacks the ex-member keys — apply 167_national_competition.sql",
    );
    assert.ok(r.bidKnownExMembers! < r.bidKnown, "the two pairs are equal");
  },
);
