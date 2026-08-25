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
// one of the states this gate exists to catch. The two kzk_decisions-shaped tests
// additionally skip when migration 130 has not been applied here
// (kzk_decisions.data.test.ts owns that state). A kzk_decisions that exists but
// predates the `kind` column is NOT a skip — it is a hard failure, because on
// such a database this gate would measure a corpus the writer never uses.
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
import { setsMeritsOutcome } from "../../procurement/kzk_decisions_store";

// Gates C + D. NOT a hardcoded constant: the skill's original `>= 2098` floor
// protected the irreplaceable rows and also passed forever — it would have stayed
// green through the entire five-week freeze, because a floor that never moves
// cannot tell healthy from frozen. The ratchet is raised by every successful
// `kzk:rejoin --apply` and only ever upward, so coverage is monotonic by
// construction and a matcher change that silently loses outcomes fails here.
//
// ⚠️ THAT ARGUMENT ONLY HOLDS FOR A QUANTITY CORPUS GROWTH CANNOT SHRINK, and
// Gate D spent 2026-08-25 proving it. It ratcheted `matched`, which growth DOES
// shrink — a new complaint ambiguates an old group and the matcher withdraws the
// match — so it failed a correct ingest and told the operator to audit a matcher
// with nothing wrong with it. Gate D's bar is `reached`; Gate C's `outcomes` is
// genuinely append-only today and stays. See §5 of the plan for the one thing
// that would break Gate C the same way (revoking a derived outcome whose match
// disappeared, `kzk-matcher-ambiguity-v1.md` §11.4) — that change must move Gate
// C onto the reason-based footing below in the SAME commit.
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

// Hoisted: the same to_regclass round trip ran once per kzk_decisions-shaped test.
// As a skipIf it also promotes "130 was never applied here" from a silent green
// `return` to a visible skip, so `npm run test:data` separates a gate that held
// the line from one that never looked.
const hasDecisions =
  haveDb &&
  (await allRows<{ ok: string }>(
    "SELECT to_regclass('public.kzk_decisions') AS ok",
  )
    .then((r) => r[0]?.ok != null)
    .catch(() => false));
const skipDecisions =
  skip || (!hasDecisions && "kzk_decisions absent (130 not applied here)");

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
    `${r.n} outcomes, below the ratchet's ${baselines.outcomes} (last bar change ${baselines.updatedAt}). ` +
      "Coverage went DOWN. Either the matcher lost ground (check " +
      "scripts/procurement/kzk_match.ts against its unit tests) or the decisions " +
      "corpus shrank (check the loader's anti-shrink guard). Do not lower the " +
      "ratchet to make this pass — it only moves upward by design.",
  );
});

test.skipIf(skipDecisions)(
  "every machine-derived outcome cites an act that really exists",
  async () => {
    // `count(*) OVER ()` carries the TRUE total past the LIMIT. Without it the
    // message read "1+" or at most "5+" whatever the real number was, so the
    // operator could not tell one stale row from a corpus-wide shrink — which is
    // exactly the distinction the message then asks them to make.
    const orphans = await allRows<{
      total: string;
      complaint_no: string;
      act: string;
    }>(
      `SELECT count(*) OVER () AS total, a.complaint_no, a.decision_act_no AS act
         FROM kzk_appeals a
    LEFT JOIN kzk_decisions d ON d.act_no = a.decision_act_no
        WHERE a.decision_act_no IS NOT NULL AND d.act_no IS NULL
        LIMIT 5`,
    );
    assert.equal(
      orphans.length,
      0,
      `${orphans[0]?.total} appeal(s) cite a decision act absent from kzk_decisions — ` +
        `e.g. ${orphans[0]?.complaint_no} → ${orphans[0]?.act}. The provenance link is ` +
        "the audit trail for an outcome; a dangling one means the corpus shrank " +
        "underneath it (see the loader's shrink guard).",
    );
  },
);

test.skipIf(skipDecisions)(
  "Gate D — the matcher still reaches at least as many appeals",
  async () => {
    // ⚠️ Gate C CANNOT cover this — though NOT for the reason this comment gave
    // until 2026-08-24. `outcome` is not append-only: partitionByProvenance()
    // puts a match with a NULL outcome into `writable` whenever the row is
    // already machine-owned (classifyOutcome returns null for a costs-only or
    // clerical act, deliberately), and the writer's UPDATE assigns it — so a
    // re-derivation CAN clear a value and count(outcome) CAN fall.
    //
    // What Gate C actually misses is the row that stops being matched at all: it
    // is simply absent from `writable`, so its stale outcome survives untouched
    // and the count does not move. The only way to see that is to re-run the
    // matcher and compare — which is cheap, because it is pure.
    const appeals = await allRows<{
      complaintNo: string;
      complainant: string | null;
      respondent: string | null;
      complaintDate: string | null;
    }>(
      `SELECT complaint_no AS "complaintNo", complainant, respondent,
              complaint_date AS "complaintDate" FROM kzk_appeals`,
    );
    // ⚠️ THE `kind` FILTER IS LOAD-BEARING, and this gate ran without it until
    // 2026-08-24. kzk_rejoin.ts selects `WHERE ${MERITS_ELIGIBLE_SQL}` — an
    // определение must never claim an appeal, or the решение that decides the
    // same case reads as a second claimant and the appeal is dropped as
    // ambiguous. Reading the whole table here measured the matcher over a corpus
    // the writer never uses: 4,779 rows against the writer's 4,502, and 2,940
    // matches against a ratchet of 2,920 — 20 matches of slack, enough to stay
    // green through a real regression.
    //
    // Filtered through setsMeritsOutcome(), whose SQL twin MERITS_ELIGIBLE_SQL
    // the writer now uses, so "one definition" is a fact rather than a hope.
    //
    // ⚠️ DRIFT IS DETECTED IN ONE DIRECTION ONLY. A writer that WIDENS its filter
    // raises the ratchet past what this gate can reach and fails here; one that
    // NARROWS it lowers its own output, the monotonic ratchet does not follow,
    // and this gate stays green. The mutation check below pins the excluded set;
    // a narrowing on some other column is still invisible.
    //
    // ⚠️ When the plan's kzk_case_no arm lands (kzk-matcher-ambiguity-v1 §10.1),
    // this SELECT must gain that column too — the writer would raise the ratchet
    // with it while this gate ran a degraded matcher against it. The failure
    // direction is safe (fewer matches → loud), but it is a real coupling.
    const hasKind = await allRows<{ ok: boolean }>(
      `SELECT true AS ok FROM information_schema.columns
        WHERE table_name = 'kzk_decisions' AND column_name = 'kind'`,
    ).then((r) => r.length === 1);
    assert.ok(
      hasKind,
      "kzk_decisions.kind is MISSING — this database predates the определения " +
        "arm. Run `npm run db:load:kzk-decisions:pg`, which re-applies 130. " +
        "Without the column this gate would measure 4,779 rows against a writer " +
        "that sees 4,502.",
    );

    const decisions = await allRows<
      MatchableDecision & { kind: string | null }
    >(
      `SELECT act_no AS no, decision_date AS ddate, pronouncement AS pron,
              initiators AS init, respondent AS resp, kind FROM kzk_decisions`,
    );
    if (decisions.length === 0) return;

    const merits = decisions.filter((d) => setsMeritsOutcome(d.kind));

    // MUTATION CHECK. Two reachable regressions put the 20 matches of slack back
    // with nothing red: setsMeritsOutcome() ceasing to discriminate (this file is
    // its only runtime call site), and the corpus losing its `kind` labels —
    // kindFromHeader() returns null on an unrecognised header, the loader stores
    // it, and a null kind is ELIGIBLE by design, so a register re-skin would
    // silently re-admit every определение into the PRODUCT, not merely here.
    // kzk_decisions.data.test.ts makes no assertion about `kind` at all.
    const [k] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM kzk_decisions WHERE kind = 'определения'",
    );
    assert.ok(
      Number(k.n) > 0,
      "no определения in the corpus — the merits filter is untested here. " +
        "Re-run `npm run db:load:kzk-decisions:pg`; a corpus with no определения " +
        "means the crawler's register enumeration (ot=6) or kindFromHeader() has " +
        "regressed.",
    );
    assert.equal(
      decisions.length - merits.length,
      Number(k.n),
      "setsMeritsOutcome() no longer excludes exactly the определения — the gate " +
        "is back to measuring a corpus the writer never uses.",
    );
    assert.ok(
      merits.length > 0,
      `all ${decisions.length} stored decisions are определения — that is a corpus ` +
        "problem, not a matcher one. Re-run `npm run db:load:kzk-decisions:pg` " +
        "(решения is ot=2). kzk_rejoin.ts refuses the same state.",
    );

    const report = matchDecisions(appeals, merits);

    // ⚠️ THE BAR IS `reached`, NOT `matches`, AND THE SWAP IS THE WHOLE POINT.
    // This gate ratcheted `report.matches.length` until 2026-08-25 and asserted
    // in its own failure text that the number "only moves upward by design". It
    // does not. A new complaint joining a matched appeal's (complainant,
    // respondent) group makes that group ambiguous; `matchDecisions` then refuses
    // to guess which of the two a ruling decides — the refusal that stops a
    // ruling being attributed to the wrong named firm — and the count FALLS.
    //
    // That fired on a routine ingest of nine real complaints (2,920 → 2,918) and
    // sent the operator after an untouched matcher whose 21 unit tests passed.
    // Worse, it was a false NEGATIVE too: breaking a name fold destroys
    // COLLISIONS faster than matches, so two of four injected fold regressions
    // RAISE the count (quote fold → 2,934) and sailed straight through.
    //
    // `reached` — the coarse candidate union, before the 1:1 test — is monotone
    // under growth of EITHER corpus (0 violations over 122 corpus sizes, against
    // 3 for `matches`) and catches all four regressions. Full argument and
    // measurements: docs/plans/kzk-gate-d-ambiguity-v1.md §2–§4.
    assert.ok(
      baselines.reached != null,
      "the ratchet carries no `reached` bar, so Gate D has nothing to assert. " +
        "This checkout predates the 2026-08-25 swap, or the mint never ran. Fix:\n" +
        "  DATABASE_URL='postgres://postgres:postgres@localhost:5433/electionsbg' \\\n" +
        "    npm run kzk:rejoin -- --apply\n" +
        "then commit data/procurement/derived/kzk_baselines.json. It MUST be minted " +
        "from LOCAL Postgres — kzk:rejoin:cloud deliberately refuses, because a bar " +
        "local cannot reach turns every local run red with no available fix. Reading " +
        "an absent bar as 0 would pass forever, which is the failure the ratchet " +
        "replaced.",
    );
    assert.ok(
      report.reached >= baselines.reached,
      `the matcher now reaches ${report.reached} appeals, below the ratchet's ` +
        `${baselines.reached} (last bar change ${baselines.updatedAt}). Unlike ` +
        "the old `matched` bar this cannot be caused by corpus GROWTH — an appeal " +
        "only joins a candidate group and an act only points at more of them. " +
        "Four causes, in the order worth checking:\n" +
        "  1. the matcher stopped reaching appeals it used to reach — check " +
        "scripts/procurement/kzk_match.ts against kzk_match.test.ts: " +
        "normalizeParty's folds, splitInitiators' ';' split, then the " +
        "`c.y === y || c.y === y - 1` window;\n" +
        "  2. a candidate-NARROWING rule (R1, R2/kzk_case_no) was added ABOVE the " +
        "`reached.add` loop — not a regression, move it below the loop;\n" +
        "  3. the DECISIONS corpus shrank — the loader's anti-join DELETE tolerates " +
        "5% silently, so check its shrink guard rather than the matcher (this is " +
        "the cause Gate C's message names, and it lands here identically);\n" +
        "  4. a corpus CORRECTION — a re-spelled party, or legacy acts newly " +
        "labelled определения.\n" +
        "Only 3 and 4 are legitimate; verify, then re-mint with " +
        "`npm run kzk:rejoin -- --apply` against LOCAL Postgres. Do not lower the " +
        "ratchet by hand.\n" +
        `  matched, for context: ${report.matches.length} against the last ` +
        `observed ${baselines.matched} — this is NOT a bar and a fall in it ` +
        "alone is a healthy crawl, not a defect.",
    );
  },
);
