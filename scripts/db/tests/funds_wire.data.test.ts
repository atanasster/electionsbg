// Postgres gates for the /funds wire and news rail (migration 144).
//
// THE ONE THING THIS FILE EXISTS FOR: a backfill must never be reported as news. The whole funds
// corpus was first seen on a single day, so a naive „new in the last 30 days" answers 82,011 —
// the load, not the world — and it does so at a 200 with a plausible-looking number. The
// `summarised` rule is REUSED from 007 rather than re-derived, and the gates below prove both
// halves: that a big day is excluded from the itemised figures, and that it is still REPORTED as
// a backfill rather than silently dropped.
//
// The second thing: every figure here is an INGEST window, because `fund_projects` has no date
// columns at all. A gate asserts that, so the day somebody adds a `signed_at` the labels get
// revisited rather than quietly becoming wrong in the other direction.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import { sumExecutionBuffers } from "../lib/explain_buffers";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  if (haveDb) await end();
});

interface Wire {
  checked_on: string | null;
  last_change_on: string | null;
  new_projects: number;
  new_eur: number;
  backfill_days: number;
  backfill_rows: number;
  open_calls: number;
}

const wire = async (days = 30): Promise<Wire> =>
  (await allRows<Wire>(`SELECT * FROM funds_wire($1)`, [days]))[0];

/**
 * Run inside a rolled-back REPEATABLE READ transaction — several gates plant a synthetic backfill
 * day and assert on the DIFFERENCE between two `funds_wire()` reads.
 *
 * REPEATABLE READ rather than the default: under READ COMMITTED each statement takes a fresh
 * snapshot, so anything another connection commits between the two reads lands in the delta and is
 * reported as a defect in this file. `npm run test:data` runs ~118 gate files against one database
 * in parallel, so that is a live hazard rather than a theoretical one. The sandbox's OWN writes
 * stay visible either way — the snapshot only freezes everybody else.
 */
const inSandbox = async (
  fn: (c: import("pg").PoolClient) => Promise<void>,
): Promise<void> =>
  withClient(async (c) => {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  });

/**
 * A day inside the wire's window whose backfill state this file fully CONTROLS.
 *
 * THE ORDER-DEPENDENCE THESE GATES USED TO CARRY, because it is not the one it looks like. Each
 * planted its synthetic day at a fixed offset from `now()` (`now() - interval '4 days'`), which
 * silently assumes that day is not ALREADY a backfill. The funds corpus has exactly one real
 * backfill — 2026-07-04, the 82,011-row initial load, `mode = 'summary'` — so the assumption holds
 * on most days and breaks on three. Run the summary-mode gate on 2026-07-08 and it plants its day
 * ON that backfill: `funds_wire` has already excluded the day before the gate inserts its own
 * summary batch, so the counterfactual asserts `X === X - 9` and fails with a bare number
 * mismatch. One day either side does the same to the small-day and backfill gates. The CALENDAR
 * was the variable, not the test order — which is why it reproduces on one run and not on a re-run
 * minutes later, and why it cannot be fixed by resetting state between tests.
 *
 * So pick a day carrying no `summary`-mode batch — that is the arm this file cannot undo, since
 * `ingest_batches` is the FK target of `ingest_first_seen` and its rows cannot simply be deleted —
 * and then clear that day's `changelog_days` row so the row-count arm is ours too. Both the delete
 * and everything the caller plants roll back with the sandbox.
 */
const controlledDay = async (
  c: import("pg").PoolClient,
  windowDays: number,
): Promise<string> => {
  // Today is excluded: it is the one day a concurrent ingest could still write to.
  const { rows } = await c.query<{ day: string }>(
    `SELECT d::date::text AS day
       FROM generate_series((now() - make_interval(days => $1::int))::date,
                            (now() - interval '1 day')::date,
                            interval '1 day') d
      WHERE NOT EXISTS (SELECT 1 FROM ingest_batches b
                         WHERE b.source = 'fund_project'
                           AND b.mode = 'summary'
                           AND b.loaded_at::date = d::date)
      ORDER BY d DESC
      LIMIT 1`,
    [windowDays],
  );
  assert.ok(
    rows.length,
    `every one of the last ${windowDays} days carries a summary-mode fund_project batch — ` +
      "there is no day whose backfill state these gates can control",
  );
  await c.query(
    `DELETE FROM changelog_days WHERE source = 'fund_project' AND day = $1::date`,
    [rows[0].day],
  );
  return rows[0].day;
};

test.skipIf(skip)(
  "the wire answers, and its figures are internally consistent",
  async () => {
    const w = await wire(30);
    assert.ok(w, "funds_wire returned nothing — apply 144_funds_wire.sql");
    assert.ok(w.checked_on, "no ingest day at all for source 'fund_project'");
    assert.ok(w.new_projects >= 0 && w.backfill_rows >= 0);
    // `last_change_on` is only set when there was a non-backfill change, so it cannot be present
    // while the itemised count is zero.
    if (w.last_change_on)
      assert.ok(
        w.new_projects > 0,
        "the wire names a change date but reports no new projects",
      );
    if (w.new_projects === 0)
      assert.equal(w.new_eur, 0, "no new projects must mean no new money");
  },
);

test.skipIf(skip)(
  "a BACKFILL is excluded from the itemised figures and reported separately",
  async () => {
    // The gate this file exists for. A synthetic day well over the 007 threshold must not turn
    // up as „N нови проекта" — it must move to the backfill counters instead.
    //
    // The day starts with no `changelog_days` row (see `controlledDay`), so a plain INSERT is
    // correct and the deltas below are exact rather than lower bounds.
    await inSandbox(async (c) => {
      const day = await controlledDay(c, 30);
      const before = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      await c.query(
        `INSERT INTO changelog_days (source, day, rows_new)
         VALUES ('fund_project', $1::date, 90000)`,
        [day],
      );
      const after = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      assert.equal(
        after.new_projects,
        before.new_projects,
        "a 90,000-row day leaked into the itemised count — the summarised rule is not applied",
      );
      assert.equal(
        after.backfill_rows,
        before.backfill_rows + 90000,
        "the backfill was not reported — excluded from the itemised figures AND dropped is the " +
          "one outcome worse than either",
      );
      assert.equal(after.backfill_days, before.backfill_days + 1);
    });
  },
);

test.skipIf(skip)(
  "a SMALL day is itemised — the exclusion is not exclude-everything",
  async () => {
    // Without this, a rule that excluded every day would pass the gate above.
    await inSandbox(async (c) => {
      const day = await controlledDay(c, 30);
      const before = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      await c.query(
        `INSERT INTO changelog_days (source, day, rows_new)
         VALUES ('fund_project', $1::date, 7)`,
        [day],
      );
      const after = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      assert.equal(
        after.new_projects,
        before.new_projects + 7,
        "a 7-row day should be itemised, not swallowed by the backfill rule",
      );
    });
  },
);

test.skipIf(skip)(
  "a SUMMARY-MODE batch is a backfill regardless of its row count",
  async () => {
    // The 007 rule has two arms and the row threshold is only one of them. A loader that declares
    // summary mode must be honoured even on a small day, or its per-row output would be blank.
    //
    // THREE LEGS, not two, and the middle one is the diagnosis. `before → itemised` proves the day
    // starts ITEMISED, which is the precondition the counterfactual rests on; `itemised → after`
    // proves the summary batch is what moves it. Asserting only the difference between the last
    // two — as this gate did — cannot tell "the summary arm is ignored" apart from "the day was
    // already a backfill", and reports both as the same bare number mismatch. That is precisely
    // how the calendar dependence `controlledDay` documents stayed unreadable for a whole run.
    await inSandbox(async (c) => {
      const dayRows = 9;
      const day = await controlledDay(c, 30);
      const before = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      await c.query(
        `INSERT INTO changelog_days (source, day, rows_new)
         VALUES ('fund_project', $1::date, $2)`,
        [day, dayRows],
      );
      const itemised = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      assert.equal(
        itemised.new_projects,
        before.new_projects + dayRows,
        `${day} was not itemised even before the summary batch — the counterfactual below ` +
          "would prove nothing",
      );
      // Noon rather than `now() - interval 'N days'`, so the batch's `loaded_at::date` is pinned
      // to the SAME day the changelog row carries under any session timezone.
      await c.query(
        `INSERT INTO ingest_batches (source, loaded_at, mode, rows_new)
         VALUES ('fund_project', $1::date + interval '12 hours', 'summary', $2)`,
        [day, dayRows],
      );
      const after = (await c.query<Wire>(`SELECT * FROM funds_wire(30)`))
        .rows[0];
      assert.equal(
        after.new_projects,
        before.new_projects,
        "a summary-mode batch was still itemised — only the row threshold is being honoured",
      );
      assert.equal(
        after.backfill_rows,
        before.backfill_rows + dayRows,
        "a summary-mode day was excluded from the itemised count but never reported as a backfill",
      );
    });
  },
);

test.skipIf(skip)(
  "the news rail returns its three cards, and only those",
  async () => {
    const rows = await allRows<{ card: string; rank: number }>(
      `SELECT card, rank FROM funds_news(60, 4)`,
    );
    const cards = [...new Set(rows.map((r) => r.card))].sort();
    // „процедури, приключили наскоро" is deliberately absent — `fund_projects` has no completion
    // date, so ordering it by ingest date would present the crawl order as the finishing order.
    // Asserted so the omission stays a decision rather than becoming an oversight.
    assert.deepEqual(cards, ["by_place", "lowest_paid", "new_contracts"]);
    for (const card of cards) {
      const ranks = rows.filter((r) => r.card === card).map((r) => r.rank);
      assert.deepEqual(
        ranks,
        [...ranks].sort((a, b) => a - b),
        `${card} ranks are not in order`,
      );
      assert.equal(ranks[0], 1, `${card} does not start at rank 1`);
    }
  },
);

test.skipIf(skip)(
  "the lowest-disbursement card is restricted to the CLOSED period",
  async () => {
    // The restriction is what makes the card honest: the corpus has no signing date, so on the
    // full set a procedure at 0% is indistinguishable from one signed last month. Measured
    // before the restriction, the top three were all 0% and all 2021-2027 — recency presented as
    // underperformance.
    const rows = await allRows<{ href: string; pct: number }>(
      `SELECT href, pct FROM funds_news(60, 6) WHERE card = 'lowest_paid'`,
    );
    assert.ok(rows.length > 0, "the card returned nothing");
    for (const r of rows) {
      const code = r.href.replace("/funds/procedure/", "");
      const [row] = await allRows<{
        program_code: string;
        n: number;
        eur: number;
      }>(
        `SELECT program_code, project_count AS n, total_eur AS eur
           FROM fund_fit WHERE procedure_code = $1`,
        [code],
      );
      assert.ok(
        row.program_code?.startsWith("2014"),
        `${code} is on programme ${row.program_code} — only the closed 2014-2020 period belongs here`,
      );
      // And the small-denominator floor, without which one unpaid contract names a laggard.
      assert.ok(row.n >= 20, `${code} has only ${row.n} projects`);
      assert.ok(row.eur >= 1_000_000, `${code} totals only €${row.eur}`);
    }
  },
);

test.skipIf(skip)(
  "the news rail's place card speaks the CANONICAL oblast namespace",
  async () => {
    // Same trap as the resolver's: `fund_projects.oblast` keys the capital as the raw S2x shards
    // while every UI surface uses SOFIA_CITY. Here it would split Sofia's money four ways and
    // rank the fragments against whole provinces, and `FundsWire.tsx` renders the code verbatim
    // (`OBLAST_NAME[r.label] ?? r.label`), so the shard reaches the reader as „S22".
    //
    // MECHANISM BEFORE SYMPTOM, because the live rows are only as strong as the ingest window: on
    // a quiet corpus `fresh_days` is empty, the card returns nothing, and a loop over zero rows
    // passes while the installed function folds nothing at all. That is not hypothetical — it is
    // the shape this gate reported, and the two halves disagreed because NOTHING APPLIES 144. It
    // is a hand-run `apply_functions.ts` migration, so „the database is running a body older than
    // the file" is its ordinary state after any edit, not an exotic one.
    const [fn] = await allRows<{ def: string }>(
      `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'funds_news'`,
    );
    assert.ok(fn, "funds_news is absent — apply 144_funds_wire.sql");
    // The fold lives in the GROUP BY, which is what makes it structural: with it, Postgres refuses
    // a bare `oblast` in the output list, so the branch cannot emit a raw shard and still compile.
    assert.match(
      fn.def,
      /GROUP BY canon_oblast\(oblast\)/,
      "the INSTALLED funds_news groups the place card by a raw oblast — re-apply 144_funds_wire.sql",
    );
    // …and 143's fold still knows the shards it exists for. 144 depends on it and cannot restate
    // it; a narrowed `canon_oblast` would leak through every consumer at once.
    const [fold] = await allRows<{ s22: string; s25: string; pdv: string }>(
      `SELECT canon_oblast('S22') AS s22, canon_oblast('S25') AS s25,
              canon_oblast('PDV-00') AS pdv`,
    );
    assert.equal(fold.s22, "SOFIA_CITY", "canon_oblast no longer folds S22");
    assert.equal(fold.s25, "SOFIA_CITY", "canon_oblast no longer folds S25");
    assert.equal(fold.pdv, "PDV", "canon_oblast no longer folds PDV-00");

    // Window-independent: fold the WHOLE corpus exactly as the card's branch does. This is the
    // half that cannot go vacuous — it asserts both that there are shards to fold (otherwise
    // everything above gates nothing) and that folding them leaves none behind.
    const [raw] = await allRows<{ n: string }>(
      `SELECT count(*)::text AS n FROM fund_projects
        WHERE oblast IN ('S22', 'S23', 'S24', 'S25')`,
    );
    assert.ok(
      Number(raw.n) > 0,
      "fund_projects carries no Sofia shards at all — this gate no longer proves anything, so " +
        "check whether the loader started writing canonical codes before deleting it",
    );
    const folded = await allRows<{ label: string }>(
      `SELECT DISTINCT canon_oblast(oblast) AS label
         FROM fund_projects WHERE COALESCE(oblast, '') <> ''`,
    );
    for (const r of folded)
      assert.ok(
        !/^S2[2-5]$/.test(r.label),
        `${r.label} survives canon_oblast — the corpus carries a Sofia shard the fold misses`,
      );

    // And the live card, which is the thing a reader actually sees. Legitimately empty on a quiet
    // window, hence the checks above.
    const rows = await allRows<{ label: string }>(
      `SELECT label FROM funds_news(60, 10) WHERE card = 'by_place'`,
    );
    for (const r of rows)
      assert.ok(
        !/^S2[2-5]$/.test(r.label),
        `${r.label} is a raw Sofia shard — canon_oblast is not being applied`,
      );
  },
);

test.skipIf(skip)(
  "the day columns are TEXT, so no layer can reinterpret them as instants",
  async () => {
    // A PG `date` has no timezone, but node-postgres converts one to a JS Date using the SERVER
    // PROCESS's TZ — under TZ=Europe/Sofia `2026-08-09` serialises as `2026-08-08T21:00:00Z` and
    // the page renders the day BEFORE. Reproduced; prod escapes it only because Cloud Run leaves
    // TZ unset. The type is the fix, so the type is what is asserted.
    const cols = await allRows<{ nm: string; ty: string }>(
      `SELECT p.proname AS nm, t.typname AS ty
         FROM pg_proc p
         JOIN unnest(p.proallargtypes, p.proargnames) AS a(oid, nm2) ON true
         JOIN pg_type t ON t.oid = a.oid
        WHERE p.proname = 'funds_wire' AND a.nm2 IN ('checked_on', 'last_change_on')`,
    );
    assert.equal(cols.length, 2, "expected both day columns on funds_wire");
    for (const c of cols)
      assert.equal(c.ty, "text", `funds_wire.${c.nm} is ${c.ty}, not text`);
    const [w] = await allRows<{ checked_on: string }>(
      `SELECT checked_on FROM funds_wire(30)`,
    );
    assert.match(
      w.checked_on,
      /^\d{4}-\d{2}-\d{2}$/,
      `checked_on came back as „${w.checked_on}" — a bare day is the whole point`,
    );
  },
);

test.skipIf(skip)(
  "a procedure with no name of its own is MARKED, not silently renamed",
  async () => {
    // 110 of the 119 procedures this card can draw from publish no name (ИСУН's export has no
    // such column), so without the marker the card prints one project's title as the name of the
    // scheme it is criticising. The leading „~" is what lets the UI disclose that.
    const rows = await allRows<{ href: string; label: string }>(
      `SELECT href, label FROM funds_news(60, 6) WHERE card = 'lowest_paid'`,
    );
    assert.ok(rows.length > 0);
    let borrowed = 0;
    for (const r of rows) {
      const code = r.href.replace("/funds/procedure/", "");
      const [ff] = await allRows<{ procedure_name: string | null }>(
        `SELECT procedure_name FROM fund_fit WHERE procedure_code = $1`,
        [code],
      );
      if (ff.procedure_name === null) {
        borrowed++;
        assert.ok(
          r.label.startsWith("~"),
          `${code} publishes no name but its label „${r.label}" is unmarked`,
        );
      } else {
        assert.ok(
          !r.label.startsWith("~"),
          `${code} HAS a name but is marked as borrowed`,
        );
      }
    }
    assert.ok(
      borrowed > 0,
      "no borrowed titles in the sample — the gate proved nothing",
    );
  },
);

test.skipIf(skip)(
  "funds_backfill reports the RAIL's window, which differs from the wire's",
  async () => {
    // The measured case: the real 81,616-row load sits inside 60 days and outside 30. Without a
    // per-window figure the rail drops those rows from cards that claim to cover 60 days and
    // nothing on the page says so.
    const [short] = await allRows<{ backfill_rows: number }>(
      `SELECT backfill_rows FROM funds_backfill(30)`,
    );
    const [long] = await allRows<{ backfill_rows: number }>(
      `SELECT backfill_rows FROM funds_backfill(90)`,
    );
    assert.ok(
      long.backfill_rows >= short.backfill_rows,
      "a longer window cannot contain fewer backfill rows",
    );
    assert.ok(
      long.backfill_rows > 0,
      "no backfill found in 90 days — this corpus was bulk-loaded, so the rule has nothing to prove",
    );
  },
);

test.skipIf(skip)(
  "both functions read the rule from ONE definition",
  async () => {
    // „Reuse, do not re-derive" (§3.2 rule 3). An earlier draft copied the predicate — literal
    // 500 included — into both function bodies, taking the number of copies in the schema from
    // two to four. This asserts the literal appears once on this side and that both callers go
    // through `funds_ingest_days`.
    const bodies = await allRows<{ nm: string; src: string }>(
      `SELECT proname AS nm, prosrc AS src FROM pg_proc
        WHERE proname IN ('funds_wire', 'funds_news', 'funds_ingest_days')`,
    );
    const withLiteral = bodies.filter((b) => /rows_new > 500/.test(b.src));
    assert.deepEqual(
      withLiteral.map((b) => b.nm),
      ["funds_ingest_days"],
      "the 500 threshold appears outside funds_ingest_days — it has been copied again",
    );
    for (const nm of ["funds_wire", "funds_news"]) {
      const b = bodies.find((x) => x.nm === nm)!;
      assert.match(
        b.src,
        /funds_ingest_days/,
        `${nm} does not call funds_ingest_days`,
      );
    }
  },
);

test.skipIf(skip)("fund_projects still has no date column", async () => {
  // The premise of every label on these two surfaces. If ИСУН ever starts publishing a signing
  // date, „нови в ИСУН" becomes needlessly weak wording and the rail's missing fourth card
  // becomes buildable — both worth revisiting deliberately rather than discovering later.
  const rows = await allRows<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'fund_projects'
        AND (data_type LIKE '%date%' OR data_type LIKE 'timestamp%')`,
  );
  assert.deepEqual(
    rows.map((r) => r.column_name),
    [],
    "fund_projects now has a date column — revisit the wire's new-in-ISUN wording and the " +
      "recently-completed card that 144 documents as uncomputable",
  );
});

test.skipIf(skip)(
  "both functions stay cheap enough for a hub page",
  async () => {
    // The wire runs on EVERY /funds view, so its budget is tighter than a drilldown's.
    //
    // WHAT THE NUMBER IS. `sumExecutionBuffers` adds up EVERY `Buffers:` line in the execution
    // section, and a parent node's counter already includes its children's — so on a nested plan
    // the figure is several times the root total (measured here: 6,254 against a root of 1,562).
    // That is the shared instrument every other ceiling in this repo is calibrated against, so the
    // ceilings below are set in the same units rather than against the root. They are a regression
    // tripwire, not a physical byte count.
    //
    // The headroom is deliberate but not generous: this pair was 30,105 and 433 ms before
    // `idx_ifs_source_seen` (144) — `idx_ifs_seen` carries no `source`, so a time-range predicate
    // pulled every dataset's rows out of a 15M-row table. Now 2.3 ms and 4.2 ms.
    const plan = async (sql: string) =>
      withClient(async (c) => {
        const { rows } = await c.query<{ "QUERY PLAN": string }>(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
        );
        return sumExecutionBuffers(rows);
      });
    const w = await plan(`SELECT * FROM funds_wire(30)`);
    const n = await plan(`SELECT * FROM funds_news(60, 4)`);
    assert.ok(w < 10_000, `funds_wire touched ${w} buffers (ceiling 10000)`);
    assert.ok(n < 25_000, `funds_news touched ${n} buffers (ceiling 25000)`);
  },
);

test.skipIf(skip)(
  "the source-scoped index is what keeps the window cheap",
  async () => {
    // Without this the ceiling above is decorative: it would pass on the 30,105-buffer plan too
    // if the numbers had been chosen loosely. This asserts the INDEX exists and that the wire's
    // scan actually uses it, which is the mechanism rather than the symptom.
    const idx = await allRows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'ingest_first_seen' AND indexname = 'idx_ifs_source_seen'`,
    );
    assert.equal(
      idx.length,
      1,
      "idx_ifs_source_seen is missing — apply 144_funds_wire.sql",
    );
    assert.match(idx[0].indexdef, /\(source, first_seen_at\)/);
    const plan = await withClient(async (c) => {
      const { rows } = await c.query<{ "QUERY PLAN": string }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM funds_wire(30)`,
      );
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    });
    assert.match(
      plan,
      /idx_ifs_source_seen/,
      "the wire is not using the source-scoped index — it is scanning ingest_first_seen by time alone",
    );
  },
);
