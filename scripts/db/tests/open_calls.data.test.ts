// Postgres gates for `open_calls` (migration 142).
//
// WHY THIS FILE IS STRICTER THAN ITS SIBLINGS. Every other dataset here is retrospective, so a
// stale row is a wrong number. This one is forward-looking: a row that says „отворено" when the
// deadline has passed sends somebody to prepare an application they cannot submit. The
// invariants below are the reason the feature is publishable at all, so they are asserted
// rather than assumed.
//
// TWO STATES THIS FILE DELIBERATELY DOES NOT SKIP OVER: an empty table and an absent `isun`
// source. Both are exactly what a broken crawl looks like, so they are assertions, not a green
// skip. (Postgres being unreachable IS a skip — that is a missing tool, not a missing corpus.)

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, withClient, end } from "../lib/pg";
import type { OpenCallsSnapshot } from "../../opencalls/types";
// The PRODUCTION predicate, so a gate cannot pass against a query nothing runs.
import { OPEN_CALLS_BY_OBSHTINA_SQL } from "../lib/opencalls_alerts";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

const REPO = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const snapshotPath = (s: string) =>
  path.join(REPO, "data", "opencalls", `${s}.json`);

afterAll(async () => {
  await end();
});

const count = async (where: string): Promise<number> => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM open_calls WHERE ${where}`,
  );
  return Number(r?.n ?? 0);
};

test.skipIf(skip)(
  "open_calls is populated and carries the isun source",
  async () => {
    assert.ok(
      (await count("true")) > 0,
      "open_calls is empty — the loader never ran",
    );
    assert.ok(
      (await count("source = 'isun'")) > 0,
      "no isun rows — the ИСУН crawl produced nothing, which is a broken crawl, not an empty register",
    );
  },
);

// ── INVARIANT 1: status is derived at QUERY time ────────────────────────────────────────
//
// NOTE ON HOW THIS IS TESTED. The obvious gate —
//   SELECT count(*) FROM open_calls_table WHERE status='open' AND closes_at < now()
// — is VACUOUS: the view computes `status` FROM `closes_at`, so that predicate is
// tautologically empty and the "test" can never fail. Verified by mutation: forcing a row's
// deadline into the past made the gate return 0, because the row's derived status became
// 'closed' at the same instant.
//
// So the derivation itself is what gets asserted, against rows CONSTRUCTED for the purpose in a
// rolled-back transaction. That catches the real risk: somebody reordering the CASE arms (the
// exact bug that shipped in this migration's first draft, where `kind='consultation'`
// short-circuited before any date test and expired drafts never closed).
const STATUS_CASES: { label: string; cols: string; want: string }[] = [
  {
    label: "past deadline → closed",
    cols: `'exact', now() - interval '2 days', NULL, 'call'`,
    want: "closed",
  },
  {
    label: "future deadline → open",
    cols: `'exact', now() + interval '6 days', NULL, 'call'`,
    want: "open",
  },
  {
    label: "not yet opened → upcoming",
    cols: `'exact', now() + interval '30 days', NULL, 'call'`,
    want: "upcoming",
  },
  {
    label: "month-range forecast → indicative",
    cols: `'indicative', NULL, 'В периода октомври-декември', 'call'`,
    want: "indicative",
  },
  {
    label: "live draft guidance → consultation",
    cols: `'exact', now() + interval '9 days', NULL, 'consultation'`,
    want: "consultation",
  },
  {
    label: "EXPIRED draft guidance → closed, not consultation",
    cols: `'exact', now() - interval '3 days', NULL, 'consultation'`,
    want: "closed",
  },
];

/** Run `fn` against a transaction that is ALWAYS rolled back.
 *
 *  `withTx` + a sentinel throw also works, but if that throw were lost in a refactor the
 *  synthetic rows would COMMIT into a table with no delete path — and one of them renders as a
 *  live open call. An explicit ROLLBACK in a `finally` cannot be lost the same way, and it is
 *  what the sibling gates (annex_fold_identity, cohort_benchmark) do. */
const inSandbox = async (
  fn: (c: import("pg").PoolClient) => Promise<void>,
): Promise<void> =>
  withClient(async (c) => {
    await c.query("BEGIN");
    try {
      await fn(c);
    } finally {
      await c.query("ROLLBACK");
    }
  });

test.skipIf(skip)(
  "open_calls_table derives every status correctly",
  async () => {
    await inSandbox(async (c) => {
      for (const [i, k] of STATUS_CASES.entries()) {
        const opens =
          k.want === "upcoming"
            ? `now() + interval '20 days'`
            : `now() - interval '1 day'`;
        await c.query(
          `INSERT INTO open_calls
           (source, source_key, title, date_precision, closes_at, period_label, kind,
            opens_at, source_url)
         VALUES ('isun', 'gate-${i}', 'gate case ${i}', ${k.cols}, ${opens}, 'u')`,
        );
      }
      const rows = await c.query<{ source_key: string; status: string }>(
        `SELECT source_key, status FROM open_calls_table
       WHERE source_key LIKE 'gate-%' ORDER BY source_key`,
      );
      for (const [i, k] of STATUS_CASES.entries()) {
        const got = rows.rows.find((r) => r.source_key === `gate-${i}`);
        assert.equal(got?.status, k.want, k.label);
      }
    });
  },
);

test.skipIf(skip)(
  "nothing the default list serves has a passed deadline",
  async () => {
    // NOT `SELECT DISTINCT status FROM open_calls_list()` — that asserts on `status` AFTER the
    // function filtered status='open', i.e. the same tautology as invariant 1, one call further
    // out. Proven vacuous by mutation: with the 'closed' arm deleted from the view,
    // open_calls_list() served 55 rows of which 10 had EXPIRED deadlines and the old gate still
    // reported [{status:'open'}].
    //
    // This looks at the underlying FACT — closes_at — which the function does not derive.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM open_calls_list() WHERE closes_at < now()`,
    );
    assert.equal(
      Number(r.n),
      0,
      "the default list is serving a call whose deadline has passed",
    );
  },
);

// ── INVARIANT 7: a consultation is never listed as a call ───────────────────────────────
test.skipIf(skip)(
  "the default list hides a consultation that really exists",
  async () => {
    // The count-over-live-rows form was vacuous TWICE: `open_calls_list('all','call') WHERE
    // kind <> 'call'` is unsatisfiable by the function's own filter, AND the corpus holds zero
    // consultation rows today (ИСУН's /PublicDiscussion tier was empty on 2026-08-08), so
    // deleting the kind filter altogether also passed. A constructed row is the only honest
    // test while the tier is empty.
    await inSandbox(async (c) => {
      await c.query(
        `INSERT INTO open_calls
           (source, source_key, title, date_precision, closes_at, kind, source_url)
         VALUES ('isun', 'gate-cons', 'draft guidance', 'exact',
                 now() + interval '9 days', 'consultation', 'u')`,
      );
      const leaked = await c.query<{ n: string }>(
        `SELECT count(*) n FROM open_calls_list() WHERE source_key = 'gate-cons'`,
      );
      assert.equal(
        Number(leaked.rows[0].n),
        0,
        "a draft-guidance row leaked into the default (kind='call') list",
      );
      // …and it IS reachable when asked for explicitly: hidden, not lost.
      const asked = await c.query<{ n: string }>(
        `SELECT count(*) n FROM open_calls_list('consultation', 'consultation')
         WHERE source_key = 'gate-cons'`,
      );
      assert.equal(
        Number(asked.rows[0].n),
        1,
        "the consultation tier cannot find its own row",
      );
    });
  },
);

// ── INVARIANT 8: an unreviewed figure never reaches a sortable column ───────────────────
test.skipIf(skip)("only 'source' or 'reviewed' rows carry money", async () => {
  const bad = await allRows<{
    source: string;
    source_key: string;
    enrichment: string;
  }>(
    `SELECT source, source_key, enrichment FROM open_calls
     WHERE enrichment NOT IN ('source', 'reviewed')
       AND (budget_eur IS NOT NULL OR aid_rate_pct IS NOT NULL
            OR grant_min_eur IS NOT NULL OR grant_max_eur IS NOT NULL)`,
  );
  assert.deepEqual(
    bad,
    [],
    "an unverified figure is in a sortable/filterable column, where it silently drives ranking",
  );
});

// ── INVARIANT 2: the two date precisions never blur ─────────────────────────────────────
test.skipIf(skip)(
  "exact rows have a deadline; indicative rows have a period and none",
  async () => {
    assert.equal(
      await count("date_precision = 'exact' AND closes_at IS NULL"),
      0,
      "an exact-dated call with no deadline",
    );
    assert.equal(
      await count("date_precision = 'indicative' AND closes_at IS NOT NULL"),
      0,
      "a forecast carrying a deadline — it would render with a countdown",
    );
    assert.equal(
      await count("date_precision = 'indicative' AND period_label IS NULL"),
      0,
      "a forecast with no window to show",
    );
  },
);

test.skipIf(skip)(
  "every row is attributable — it links its own source",
  async () => {
    assert.equal(
      await count("source_url IS NULL OR source_url = ''"),
      0,
      "we are an index, not the authority: a row a reader cannot verify upstream must not exist",
    );
  },
);

test.skipIf(skip)("audience values are all known facets", async () => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM open_calls
     WHERE NOT (audience <@ ARRAY['business','farmer','municipality','ngo',
                                  'individual','school','institution','unknown']::text[])`,
  );
  assert.equal(
    Number(r.n),
    0,
    "an unknown audience value never matches the facet filter",
  );
});

test.skipIf(skip)(
  "142's CHECK constraints are actually present on this database",
  async () => {
    // The data gates above restate constraints, so they can only fire once bad data exists —
    // all of them stay green on a database where the constraint was DROPPED (verified). That
    // misses the exact failure 142's own header documents: `CREATE TABLE IF NOT EXISTS` is a
    // no-op on a warm database, so a constraint edited in the migration never reaches it.
    // Assert the catalog, not only the rows.
    const want = [
      "open_calls_kind_check",
      "open_calls_date_precision_check",
      "open_calls_enrichment_check",
      "open_calls_exact_has_close",
      "open_calls_indicative_no_close",
      "open_calls_money_needs_provenance",
      "open_calls_source_known",
      "open_calls_audience_known",
    ];
    const rows = await allRows<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'open_calls'::regclass AND contype = 'c'`,
    );
    const have = new Set(rows.map((r) => r.conname));
    assert.deepEqual(
      want.filter((c) => !have.has(c)),
      [],
      "missing CHECK(s) — re-apply 142_open_calls.sql; its reconcile block exists for this",
    );
  },
);

// ── The loader must never delete ────────────────────────────────────────────────────────
test.skipIf(skip)(
  "the table is a superset of the current snapshots",
  async () => {
    // The crawler reads /Active, so a CLOSED call leaves the snapshot. The table keeps it. If the
    // table ever holds FEWER rows for a source than its snapshot, something deleted — which
    // would erase the archive one release at a time.
    for (const source of ["isun", "sp2023"]) {
      const p = snapshotPath(source);
      if (!existsSync(p)) continue;
      const snap = JSON.parse(readFileSync(p, "utf-8")) as OpenCallsSnapshot;
      const inDb = await count(`source = '${source}'`);
      assert.ok(
        inDb >= snap.calls.length,
        `${source}: table has ${inDb} rows for a snapshot of ${snap.calls.length} — the loader deleted something`,
      );
    }
  },
);

test.skipIf(skip)("first_seen_at survives a reload", async () => {
  // NOT a comparison against last_seen_at: those are two different clocks. `first_seen_at` is
  // when the row first reached this database; `last_seen_at` is the SOURCE's crawl time, which
  // is necessarily earlier than the load that carried it. Comparing them fails on every row of
  // a healthy corpus (measured: 66/66).
  //
  // The real invariant is that `first_seen_at` does not MOVE — it is excluded from the merge's
  // column list so a reload cannot re-stamp it, which is what makes „ново" mean anything.
  assert.equal(
    await count("first_seen_at > checked_at + interval '1 second'"),
    0,
    "a row was first seen AFTER we last checked it — impossible unless first_seen_at is being rewritten",
  );

  // After more than one load, at least one row must predate the newest load. If every row's
  // first_seen_at equalled the latest checked_at, the merge would be re-stamping all of them.
  const [batches] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM ingest_batches WHERE source = 'open_call'`,
  );
  if (Number(batches?.n ?? 0) < 2) return; // a single load proves nothing either way
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM open_calls
     WHERE first_seen_at < (SELECT max(checked_at) FROM open_calls)`,
  );
  assert.ok(
    Number(r.n) > 0,
    "every row claims to have been first seen at the most recent load — first_seen_at is being reset",
  );
});

// ── Freshness is a UI requirement, so the stamp must exist ──────────────────────────────
test.skipIf(skip)("every loaded source has a crawl stamp", async () => {
  const rows = await allRows<{ source: string }>(
    `SELECT DISTINCT c.source FROM open_calls c
     LEFT JOIN open_calls_crawl k ON k.source = c.source
     WHERE k.source IS NULL`,
  );
  assert.deepEqual(
    rows,
    [],
    "a source with rows but no crawl stamp — the freshness banner cannot say when we last looked",
  );
});

test.skipIf(skip)(
  "open_calls_list stays cheap enough to serve live",
  async () => {
    // reference_pg_query_performance: nothing above ~2,000 buffers is served live. Measured on
    // the worst shape this route issues — every kind, every status.
    const rows = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
     SELECT * FROM open_calls_list('all', 'all', NULL, NULL, 2000)`,
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    // hit AND read: a cold cache turns hits into reads, so counting only hits under-reports
    // the work on exactly the run that matters. Both sibling gates sum the pair.
    const buffers = [...plan.matchAll(/shared (?:hit|read)=(\d+)/gu)].reduce(
      (a, m) => a + Number(m[1]),
      0,
    );
    assert.ok(
      buffers < 2_000,
      `open_calls_list touched ${buffers} buffers (ceiling 2000)`,
    );
  },
);

test.skipIf(skip)(
  "money columns are double precision, so the API serves NUMBERS not strings",
  async () => {
    // node-postgres serializes PG `numeric` as a STRING. Shipped exactly that way once: the ДФЗ
    // rows carried real budgets, `/api/db/table` returned "10000000", `formatEur()` got a string
    // and every money cell on /funds/calls and the /funds tile rendered BLANK — at a 200, with
    // the number present in the payload. No SQL-side assertion can see it, because through SQL
    // the value reads correctly either way; only the wire format differs.
    //
    // The type therefore has to be asserted from the CATALOG. 142 carries a reconcile ALTER for
    // this, since `CREATE TABLE IF NOT EXISTS` cannot retype a warm table's column.
    const rows = await allRows<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'open_calls'
          AND column_name IN ('budget_eur','aid_rate_pct','grant_min_eur','grant_max_eur')
        ORDER BY column_name`,
    );
    assert.equal(rows.length, 4, "expected four money columns on open_calls");
    for (const r of rows)
      assert.equal(
        r.data_type,
        "double precision",
        `open_calls.${r.column_name} is ${r.data_type}; node-postgres serializes numeric as a string, which blanks every money cell`,
      );
  },
);

test.skipIf(skip)(
  "the view exposes the same money types as the table it reads",
  async () => {
    // The reconcile ALTER has to DROP the view to retype the columns, and the view is recreated
    // later in the same file. A reconcile that dropped it without the recreate landing would
    // leave `open_calls_table` missing — and both the registry resource and every route read it,
    // so this asserts the pair converged rather than only the table half.
    const rows = await allRows<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'open_calls_table'
          AND column_name IN ('budget_eur','aid_rate_pct','grant_max_eur','days_left')
        ORDER BY column_name`,
    );
    const byName = new Map(rows.map((r) => [r.column_name, r.data_type]));
    assert.equal(byName.get("budget_eur"), "double precision");
    assert.equal(byName.get("aid_rate_pct"), "double precision");
    assert.equal(byName.get("grant_max_eur"), "double precision");
    // `days_left` is computed in the view; integer keeps `count`-based pluralisation honest.
    assert.equal(byName.get("days_left"), "integer");
  },
);

// ── The My-Area alert predicate ────────────────────────────────────────────────────────────
//
// `readOpenCallsByObshtina` correctly returns NOTHING on today's corpus — all 55 ИСУН rows carry
// `territory = NULL`, and every ДФЗ territory is national. That makes the live behaviour useless as
// evidence: a predicate that never matched anything would look identical. So these gates plant a
// territory in a sandbox and prove what the SQL actually has to get right.
//
// They run `OPEN_CALLS_BY_OBSHTINA_SQL` — the PRODUCTION query, imported — rather than a hand-typed
// copy. The first version of this block re-typed it, which meant deleting the national exclusion or
// the status filter from the real query left all three gates green.

test.skipIf(skip)(
  "open-call alerts: today's corpus really is place-less, as documented",
  async () => {
    // If this ever fails, the documentation in opencalls_alerts.ts is out of date and the arm has
    // started producing events — which is the intended outcome of Stage 7, not a defect. Asserted so
    // that transition cannot happen unnoticed.
    const [row] = await allRows<{ placed: number; national: number }>(
      `SELECT count(*) FILTER (WHERE territory IS NOT NULL
                                 AND territory !~* 'цялата (страна|територия)')::int AS placed,
              count(*) FILTER (WHERE territory ~* 'цялата (страна|територия)')::int  AS national
         FROM open_calls`,
    );
    assert.equal(
      row.placed,
      1,
      `expected exactly the one broad-category ДФЗ territory ("Селски райони"); got ${row.placed}. ` +
        "If territories are now published per obshtina, update opencalls_alerts.ts's header — it " +
        "documents this arm as emitting nothing.",
    );
    assert.ok(
      row.national >= 1,
      "the ДФЗ national territories should be present",
    );
  },
);

/** Plant a territory on one open call and run the PRODUCTION predicate over it, in a sandbox. */
const matchTerritory = async (
  c: import("pg").PoolClient,
  territory: string,
  names: string[],
): Promise<string[]> => {
  await c.query(
    `UPDATE open_calls SET territory = $1::text
      WHERE id = (SELECT id FROM open_calls_table
                   WHERE status = 'open' AND kind = 'call' ORDER BY id LIMIT 1)`,
    [territory],
  );
  const { rows } = await c.query<{ obshtina: string }>(
    OPEN_CALLS_BY_OBSHTINA_SQL,
    [names, 3],
  );
  return rows.map((r) => r.obshtina).sort();
};

test.skipIf(skip)(
  "open-call alerts: matches an obshtina named ADMINISTRATIVELY",
  async () => {
    await inSandbox(async (c) => {
      const got = await matchTerritory(
        c,
        "Допустими са проекти на територията на община Своге и община Мездра",
        ["Мездра", "Свищов", "Своге"],
      );
      assert.deepEqual(
        got,
        ["Мездра", "Своге"],
        "expected exactly the two named obshtini",
      );
    });
  },
);

test.skipIf(skip)(
  "open-call alerts: a municipality name used as an ordinary NOUN is not a place match",
  async () => {
    // This is the failure that will actually occur once Stage 7 fills `territory` from guidance
    // prose. Dozens of municipality names are common Bulgarian nouns, and a boundary-only predicate
    // matched every one of these — measured before the administrative qualifier was required.
    await inSandbox(async (c) => {
      const got = await matchTerritory(
        c,
        "Изграждане на отоплителен котел и водна кула по поречието на река Искър, в Родопите и по Марица",
        ["Котел", "Кула", "Искър", "Марица", "Завет"],
      );
      assert.deepEqual(
        got,
        [],
        `prose matched as places: ${got.join(", ")} — the „община"/„област" qualifier is what prevents this`,
      );
    });
  },
);

test.skipIf(skip)(
  "open-call alerts: the word boundary still holds inside the qualifier form",
  async () => {
    // „община Родопи" must not match a needle that is a PREFIX of the name, and vice versa.
    await inSandbox(async (c) => {
      const got = await matchTerritory(c, "Проекти в община Родопите", [
        "Родопи",
        "Ро",
      ]);
      assert.deepEqual(got, [], "a prefix is not a name");
    });
  },
);

test.skipIf(skip)(
  "open-call alerts: a NATIONAL call is never emitted as a place event",
  async () => {
    // /funds/calls already serves the national list. Copying it into 265 municipal feeds would
    // drown every event that is genuinely local — the reason the exclusion exists.
    await inSandbox(async (c) => {
      const got = await matchTerritory(
        c,
        "Цялата територия на Република България, включително община Своге",
        ["Своге"],
      );
      assert.deepEqual(
        got,
        [],
        "a territory naming the whole country must be excluded even when it also names an obshtina",
      );
    });
  },
);

test.skipIf(skip)(
  "open-call alerts: an EXPIRED call can never reach an alert",
  async () => {
    // Asserted SEPARATELY from the consultation case below, because the two are excluded by
    // different clauses and a combined assertion passes on either one alone.
    await inSandbox(async (c) => {
      await c.query(
        `INSERT INTO open_calls
           (source, source_key, title, kind, date_precision, closes_at, territory, source_url)
         VALUES ('isun', 'sandbox-expired', 'Изтекла', 'call', 'exact',
                 now() - interval '3 days', 'община Своге', 'https://x')`,
      );
      const { rows } = await c.query<{ obshtina: string }>(
        OPEN_CALLS_BY_OBSHTINA_SQL,
        [["Своге"], 3],
      );
      assert.equal(
        rows.length,
        0,
        "a call whose deadline has passed is the one thing an alert must never point at",
      );
    });
  },
);

test.skipIf(skip)(
  "open-call alerts: a CONSULTATION can never reach an alert",
  async () => {
    await inSandbox(async (c) => {
      await c.query(
        `INSERT INTO open_calls
           (source, source_key, title, kind, date_precision, closes_at, territory, source_url)
         VALUES ('isun', 'sandbox-consult', 'Насоки', 'consultation', 'exact',
                 now() + interval '9 days', 'община Своге', 'https://x')`,
      );
      const { rows } = await c.query<{ obshtina: string }>(
        OPEN_CALLS_BY_OBSHTINA_SQL,
        [["Своге"], 3],
      );
      assert.equal(
        rows.length,
        0,
        "an alert is a thing you can act on; a draft you may comment on is not",
      );
    });
    // NOTE the `kind = 'call'` clause in the production SQL is belt-and-braces: 142's status CASE
    // returns 'consultation' before it could ever return 'open', so `status = 'open'` already
    // excludes this row. Removing `kind` would not fail this gate — it is kept as defence against a
    // future edit to that CASE, and this note is here so nobody reads the gate as proving it.
  },
);
