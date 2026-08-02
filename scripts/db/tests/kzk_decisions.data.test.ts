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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
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

// ── GATE A: source-truth freshness ──────────────────────────────────────────
//
// THE gate this whole plan exists to create. It answers "is our corpus current?"
// by comparing against the REGISTER's own newest act — recorded by the
// kzk_decisions watch source into state/watch/kzk_decisions.json, which IS
// committed — rather than against a calendar threshold.
//
// Why not "max(decision_date) is within N days": КЗК has August and Christmas
// recesses, so a day-count rule is flaky in exactly the months it would fire, and
// it cannot distinguish "no rulings published" from "we stopped reading them".
// The register's own newest act distinguishes them exactly, needs no network at
// test time, and fires the moment ONE act is missed.
//
// Why not anchored on kzk_appeals.decision_date: 1,838 of 4,836 decisions match
// no appeal at all (КЗК consolidates complaints, and the register carries acts
// for cases never ingested), so the joined column legitimately lags the register.
// A gate there fails on a perfectly current table. It anchors on the CORPUS.

const WATCH_STATE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "state",
  "watch",
  "kzk_decisions.json",
);

type WatchFile = {
  lastChecked?: string;
  meta?: { newestAct?: string | null; newestDate?: string | null };
};

const readWatchState = (): WatchFile | null => {
  if (!existsSync(WATCH_STATE)) return null;
  return JSON.parse(readFileSync(WATCH_STATE, "utf8")) as WatchFile;
};

// The anchor is the MEASURING INSTRUMENT, not the subject. It is a committed
// file, so on any established clone it exists — but it is written by a watcher
// that needs Bulgarian egress, so on a fresh source (like this one, before its
// first run) there is nothing to compare against yet.
//
// That is a "cannot tell", not a "stale", and the two must not be conflated: a
// permanently-red gate on every non-BG machine is one people learn to ignore,
// which is how a gate stops being a gate. So a MISSING anchor disarms the gate
// LOUDLY (a named skip), while a PRESENT anchor asserts unconditionally — and
// the present case is the one that matters, because the watcher runs daily from
// BG and commits its state.
//
// This is the one place this file departs from the procurement_payloads
// precedent in CLAUDE.md, and deliberately: there, the absent artifact IS the
// subject of the gate. Here the absent artifact is the ruler. The SUBJECT —
// kzk_decisions being populated and well-formed — is asserted above, without
// exception.
const watchState = readWatchState();
const anchorSkip = skip
  ? skip
  : !watchState
    ? "DISARMED: state/watch/kzk_decisions.json absent — run `npm run watch` from " +
      "Bulgarian egress so the watcher records the register's newest act"
    : !watchState.meta?.newestAct
      ? "DISARMED: the watch state carries no meta.newestAct — check " +
        "scripts/watch/sources/kzk_decisions.ts (a partial read should throw)"
      : false;

// ⚠️ `test.skipIf(reason)` NEVER RENDERS THE STRING — vitest prints a bare `↓`,
// so a disarmed gate is visually identical to a passing one. Say it out loud, the
// way person_prerender_set.data.test.ts does for the same reason.
if (anchorSkip && anchorSkip !== skip)
  console.warn(`[kzk_decisions.data.test] GATE A ${anchorSkip}`);

test.skipIf(anchorSkip)(
  "Gate A — the register's newest act is in our corpus",
  async () => {
    const state = readWatchState()!;
    const newestAct = state.meta!.newestAct!;

    const [row] = await allRows<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM kzk_decisions WHERE act_no = $1) AS present",
      [newestAct],
    );
    const [max] = await allRows<{ d: string | null; n: string }>(
      "SELECT max(decision_date) d, count(*) n FROM kzk_decisions",
    );
    assert.ok(
      row.present,
      `the register's newest act ${newestAct} (${state.meta?.newestDate ?? "?"}) is NOT in ` +
        `kzk_decisions, which holds ${max.n} acts through ${max.d ?? "—"}. The merits arm ` +
        "is STALE. Re-crawl and publish:\n" +
        "  npm run kzk:decisions -- --year <YYYY> --apply\n" +
        "  npm run db:load:kzk-decisions:pg\n" +
        "  npm run kzk:rejoin -- --apply\n" +
        "(This is the exact condition that went unnoticed for five weeks.)",
    );
  },
);

test.skipIf(anchorSkip)(
  "Gate A discriminates — removing the newest act fails it",
  async () => {
    // Prove the gate can fail. A freshness gate that has never been seen to fire
    // is indistinguishable from one asserting nothing — which is what the
    // `count(outcome) >= 2098` floor turned out to be.
    const newestAct = readWatchState()?.meta?.newestAct;
    if (!newestAct) return; // the assertion above already covers this

    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        const del = await c.query(
          "DELETE FROM kzk_decisions WHERE act_no = $1",
          [newestAct],
        );
        assert.equal(
          del.rowCount,
          1,
          "expected to remove exactly the newest act for this control",
        );
        const [{ present }] = (
          await c.query<{ present: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM kzk_decisions WHERE act_no = $1) AS present",
            [newestAct],
          )
        ).rows;
        assert.equal(
          present,
          false,
          "the gate's own probe still reports the act as present after deleting it — " +
            "it is not reading what it claims to read",
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
  },
);
