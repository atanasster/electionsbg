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
import {
  readBaselines,
  HAND_SEEDED_FLOOR,
} from "../../procurement/kzk_baselines";
import { matchDecisions } from "../../procurement/kzk_match";
import type { MatchableDecision } from "../../procurement/kzk_match";

// Gates C + D. NOT a hardcoded constant: the skill's original `>= 2098` floor
// protected the irreplaceable rows and also passed forever — it would have stayed
// green through the entire five-week freeze, because a floor that never moves
// cannot tell healthy from frozen. The ratchet is raised by every successful
// `kzk:rejoin --apply` and only ever upward, so coverage is monotonic by
// construction and a matcher change that silently loses outcomes fails here.
const baselines = readBaselines();

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

test.skipIf(skip)("Gate C — outcome coverage has not regressed", async () => {
  const [r] = await allRows<{ n: string }>(
    "SELECT count(outcome) n FROM kzk_appeals",
  );
  assert.ok(
    Number(r.n) >= baselines.outcomes,
    `${r.n} outcomes, below the ratchet's ${baselines.outcomes} (set ${baselines.updatedAt}). ` +
      "Coverage went DOWN. Either the matcher lost ground (check " +
      "scripts/procurement/kzk_match.ts against its unit tests) or the decisions " +
      "corpus shrank (check the loader's anti-shrink guard). Do not lower the " +
      "ratchet to make this pass — it only moves upward by design.",
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

test.skipIf(skip)(
  "Gate D — the matcher still resolves at least as many appeals",
  async () => {
    // ⚠️ Gate C CANNOT cover this. `outcome` is only ever written, never cleared,
    // so `count(outcome)` is non-decreasing BY CONSTRUCTION and would stay green
    // through a matcher that got strictly worse. The only way to detect that is
    // to re-run the matcher and compare — which is cheap, because it is pure.
    const hasDecisions = await allRows<{ ok: string }>(
      "SELECT to_regclass('public.kzk_decisions') AS ok",
    ).then((r) => r[0]?.ok != null);
    if (!hasDecisions) return; // kzk_decisions.data.test.ts owns that state

    const appeals = await allRows<{
      complaintNo: string;
      complainant: string | null;
      respondent: string | null;
      complaintDate: string | null;
    }>(
      `SELECT complaint_no AS "complaintNo", complainant, respondent,
              complaint_date AS "complaintDate" FROM kzk_appeals`,
    );
    const decisions = await allRows<MatchableDecision>(
      `SELECT act_no AS no, decision_date AS ddate, pronouncement AS pron,
              initiators AS init, respondent AS resp FROM kzk_decisions`,
    );
    if (decisions.length === 0) return;

    const report = matchDecisions(appeals, decisions);
    assert.ok(
      report.matches.length >= baselines.matched,
      `the matcher now resolves ${report.matches.length} appeals, below the ratchet's ` +
        `${baselines.matched} (set ${baselines.updatedAt}). Match quality REGRESSED — ` +
        "check scripts/procurement/kzk_match.ts against kzk_match.test.ts. Do not lower " +
        "the ratchet to make this pass; it only moves upward by design.",
    );
  },
);
