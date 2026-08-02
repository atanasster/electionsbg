// "Never regress the 2,098" is stated as a rule in four files. This is where it
// is enforced.
//
// The ~2,098 hand-seeded tier-2 outcomes were produced interactively before any
// crawler existed and cannot be regenerated from committed code. Migration 131
// marks them: `decision_act_no IS NULL` + a non-null outcome means hand-made and
// protected; a non-null act means machine-derived and re-derivable. Every writer
// is supposed to honour that, and nothing checked it.
//
// Auto-skips only when Postgres is down or the appeals corpus has not been
// ingested on this machine — NOT when the provenance column is missing, which is
// one of the states this gate exists to catch.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";

/** The floor. Measured 2026-08-02; may only ever grow. */
const HAND_SEEDED_FLOOR = 2098;

const haveDb = await dbReachable();
const appealsLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>("SELECT count(*) n FROM kzk_appeals").catch(
        () => [{ n: "0" }],
      )
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !appealsLoaded
    ? "kzk_appeals is empty — run the КЗК intake crawl first"
    : false;

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the provenance column exists", async () => {
  const rows = await allRows<{ ok: boolean }>(
    `SELECT true AS ok FROM information_schema.columns
      WHERE table_name = 'kzk_appeals' AND column_name = 'decision_act_no'`,
  );
  assert.equal(
    rows.length,
    1,
    "kzk_appeals.decision_act_no is MISSING — run `npm run kzk:rejoin -- --apply`, " +
      "which applies 131_kzk_appeal_provenance.sql. Without it every writer must " +
      "fall back to fill-only COALESCE, which freezes any wrong outcome for ever.",
  );
});

test.skipIf(skip)("the hand-seeded outcomes have not regressed", async () => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM kzk_appeals
        WHERE decision_act_no IS NULL AND outcome IS NOT NULL`,
  );
  assert.ok(
    Number(r.n) >= HAND_SEEDED_FLOOR,
    `only ${r.n} hand-seeded outcomes remain, below the ${HAND_SEEDED_FLOOR} floor. ` +
      "These cannot be regenerated from committed code. Something overwrote or " +
      "cleared them — do NOT re-run the writer; recover from a restore point first.",
  );
});

test.skipIf(skip)(
  "every machine-derived outcome cites an act that really exists",
  async () => {
    const hasDecisions = await allRows<{ ok: string }>(
      "SELECT to_regclass('public.kzk_decisions') AS ok",
    ).then((r) => r[0]?.ok != null);
    if (!hasDecisions) return; // 130 not applied here; kzk_decisions.data.test.ts owns that

    const orphans = await allRows<{ complaint_no: string; act: string }>(
      `SELECT a.complaint_no, a.decision_act_no AS act
         FROM kzk_appeals a
    LEFT JOIN kzk_decisions d ON d.act_no = a.decision_act_no
        WHERE a.decision_act_no IS NOT NULL AND d.act_no IS NULL
        LIMIT 5`,
    );
    assert.equal(
      orphans.length,
      0,
      `${orphans.length}+ appeal(s) cite a decision act absent from kzk_decisions — ` +
        `e.g. ${orphans[0]?.complaint_no} → ${orphans[0]?.act}. The provenance link is ` +
        "the audit trail for an outcome; a dangling one means the corpus shrank " +
        "underneath it (see the loader's shrink guard).",
    );
  },
);
