// kzk_decisions (130) must be POPULATED and must hold only well-formed acts.
//
// WHY: this table is the durable home of a corpus that, until the T4 crawler's
// backfill is proven, has NO committed generator — its source file is gitignored
// and was produced interactively once. An empty or malformed table is not a
// cosmetic problem; it is the corpus being gone, and nothing at request time can
// detect it.
//
// It is also the anchor for the freshness gate. That gate CANNOT read
// `max(kzk_appeals.decision_date)`: 1,838 of 4,836 decisions match no appeal, so
// the joined column legitimately lags the register and a gate there would fail on
// a perfectly current table. The source-truth half of the gate (comparing against
// the register's newest act recorded in state/watch/kzk_decisions.json) arrives
// with T5/T6; the two structural invariants below hold today and are what protect
// T1's own work.
//
// ABSENT / UNPOPULATED IS AN ASSERTION, NOT A SKIP — the
// procurement_payloads.data.test.ts precedent in CLAUDE.md. Those two states are
// exactly what this file exists to catch. It skips only when Postgres itself is
// down, like every other *.data.test.ts gate.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { ACT_NO_RE } from "../../procurement/kzk_decisions_store";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("kzk_decisions is populated", async () => {
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM kzk_decisions",
  );
  assert.ok(
    Number(r.n) > 0,
    "kzk_decisions is EMPTY — run `npm run db:load:kzk-decisions:pg`. Until the T4 " +
      "crawler's backfill is proven this table and the gitignored " +
      "data/procurement/kzk_decisions.json are the only copies of the corpus.",
  );
});

test.skipIf(skip)(
  "every stored act is well-formed — no rejected row reached the table",
  async () => {
    const rows = await allRows<{ act_no: string; decision_date: string }>(
      "SELECT act_no, decision_date FROM kzk_decisions",
    );
    assert.ok(rows.length > 0, "kzk_decisions is empty (see the test above)");

    const badActNo = rows.filter((r) => !ACT_NO_RE.test(r.act_no));
    assert.equal(
      badActNo.length,
      0,
      `${badActNo.length} act number(s) do not match "АКТ-<n>-<DD.MM.YYYY>" — e.g. ` +
        `${JSON.stringify(badActNo[0]?.act_no)?.slice(0, 120)}. The loader rejects these; ` +
        "one in the table means it was written by something that skipped validateDecisions.",
    );

    // The act number carries its own date; the loader cross-checks it against
    // decision_date. A disagreement in the table means a row bypassed that check,
    // and a wrong date is worse than a missing one — it joins the wrong appeal and
    // can drag the freshness gate to a day КЗК never published.
    const mismatched = rows.filter((r) => {
      const m = /^АКТ-\d+-(\d{2})\.(\d{2})\.(\d{4})$/.exec(r.act_no);
      return !m || `${m[3]}-${m[2]}-${m[1]}` !== r.decision_date;
    });
    assert.equal(
      mismatched.length,
      0,
      `${mismatched.length} row(s) whose decision_date disagrees with the act number's ` +
        `own date — e.g. ${mismatched[0]?.act_no} vs ${mismatched[0]?.decision_date}`,
    );
  },
);
