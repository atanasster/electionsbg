// Gate for procurement_payloads (migration 124) — the per-scope precompute behind the six
// /api/db/procurement-* dashboard routes. Sibling of contractor_rank.data.test.ts,
// cpv_catalog.data.test.ts and procurement_settlement_payloads.data.test.ts.
//
//   npm run test:data
//
// Requires Postgres + `db:load:procurement-scopes:pg`; auto-skips when Postgres or the
// contracts corpus is absent — like the other *.data.test.ts gates.
//
// WHAT A PRECOMPUTE TRADES. The route is fast now, and it degrades to the live functions when
// the matview cannot answer, so nothing here fails loudly on its own. What it CANNOT protect
// against is staleness: a matview built from last week's corpus serves last week's totals at a
// 200, on a page that looks perfectly healthy. That is what this file is for — plus one check
// (the last) that no other gate in the repo makes.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, withClient, end } from "../lib/pg";
import { SCOPED_MATVIEWS, SCOPED_INPUTS } from "../lib/scopedMatviews";

// The six aggregates 124 unnests, and the kind each is stored under.
const KINDS = {
  overview: "procurement_overview",
  flow: "procurement_flow",
  rankings: "procurement_rankings",
  concentration: "procurement_concentration",
  sectors: "procurement_sectors",
  benchmarks: "procurement_benchmarks",
} as const;

// SKIP ON THE SOURCE, NEVER ON THE TARGET — the rule the sibling gate states in as many
// words, and the one an earlier draft of this file broke.
//
// Gating on `procurement_payloads` itself looks equivalent and is the opposite: the two states
// this gate exists to catch are "the matview was never created" and "it was created and never
// refreshed", and BOTH would have reported 5 skipped and a green run. The second is especially
// quiet — `SELECT count(*)` on a WITH NO DATA matview raises 55000 rather than returning 0, so
// a bare catch turns an aborted scopes load, or a first cloud deploy, into a pass.
//
// So the skip asks only whether the INPUTS are here (a machine with no contracts corpus, which
// is the legitimate reason to skip). Whether the target exists and is populated is an
// ASSERTION, below.
const reachable = async (): Promise<boolean> => {
  try {
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM procurement_scopes",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / procurement_scopes empty";

afterAll(async () => {
  await end();
});

// ── Shape ────────────────────────────────────────────────────────────────────

test.skipIf(skip)("the matview exists and is populated", async () => {
  // An ASSERTION, not part of the skip condition — see the note on `reachable`. These are the
  // two states the rest of this file cannot check and that a target-gated skip would hide.
  const [t] = await allRows<{ ok: boolean }>(
    "SELECT to_regclass('public.procurement_payloads') IS NOT NULL AS ok",
  );
  assert.equal(
    t?.ok,
    true,
    "procurement_payloads does not exist — run `npm run db:load:procurement-scopes:pg`",
  );
  // Reading a WITH NO DATA matview raises 55000 rather than returning zero rows, so this
  // has to be caught and re-reported: an unhandled 55000 reads as an infrastructure error
  // rather than as "the loader applied the DDL and never refreshed".
  const n = await allRows<{ n: string }>(
    "SELECT count(*) n FROM procurement_payloads",
  ).catch((e: { code?: string }) => {
    assert.fail(
      e?.code === "55000"
        ? "procurement_payloads exists but was never REFRESHed (WITH NO DATA) — " +
            "run `npm run db:load:procurement-scopes:pg`"
        : `procurement_payloads is unreadable (${e?.code})`,
    );
  });
  assert.ok(Number(n[0].n) > 0, "procurement_payloads is empty");
});

test.skipIf(skip)(
  "every (kind x scope) pair is present with a non-NULL payload",
  async () => {
    // 6 kinds x every scope in the table. The zero-NULL property is LOAD-BEARING, not an
    // observation: the route reads "row present, payload NULL" as unambiguously not-built and
    // warns on it (pp:not-built). A kind that legitimately returned NULL for some window would
    // make that warning fire for ever on a perfectly healthy database, and an operator would
    // learn to ignore the one line that says the loader never ran.
    const [{ scopes }] = await allRows<{ scopes: number }>(
      "SELECT count(*)::int AS scopes FROM procurement_scopes",
    );
    const rows = await allRows<{ kind: string; n: number; nulls: number }>(
      `SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE payload IS NULL)::int AS nulls
         FROM procurement_payloads GROUP BY kind ORDER BY kind`,
    );
    assert.deepEqual(
      rows.map((r) => r.kind),
      Object.keys(KINDS).sort(),
      "every kind the routes ask for must be stored",
    );
    for (const r of rows) {
      assert.equal(r.n, scopes, `${r.kind}: one row per scope`);
      assert.equal(r.nulls, 0, `${r.kind}: no NULL payloads`);
    }
  },
);

// ── Staleness: the assertion a row count cannot make ─────────────────────────

test.skipIf(skip)(
  "the stored payload equals a freshly computed one, across all three scope kinds",
  async () => {
    // One scope of each kind: `all` (both bounds NULL — the widest, and what the AI tools
    // send), a closed parliament, and a calendar year. A stale matview has the right row count
    // and the wrong numbers, so this is the only assertion that sees it.
    //
    // COMPARED AT THE SERVER'S CURRENT SETTINGS, and that is a real limitation worth stating
    // precisely, because the obvious summary of it is wrong.
    //
    // `SUM()` over `double precision` is order-dependent, so a change in GROUPING STRATEGY can
    // move a ROUNDed EUR scalar by 1. Measured, against the stored rows:
    //   parallelism 4, hashagg on   →  0/18 differ   (parallelism alone is NOT the trigger)
    //   enable_hashagg = off        →  7/18 differ
    //   work_mem = '64kB'           →  6/18 differ   (spills GroupAggregate differently)
    // So the driver is whether the planner picks HashAggregate, and `work_mem` reaches that
    // too. This gate cannot pin its way out of it — an explicit `SET enable_hashagg = on` is a
    // no-op, since it is already the default — so it compares under whatever the server is
    // configured with and accepts that a memory-settings change can turn it red for a reason
    // that is not staleness. If that happens, re-REFRESH before believing the numbers moved.
    //
    // NOTE the correction this replaces: an earlier draft claimed `flow` was plan-stable once
    // 027 gained its ORDER BY. The ORDER BY was still worth adding — its aggregates had no
    // defined order at ALL, which is a different and worse problem — but it does not make the
    // payload plan-independent, because the float sums inside it still move. `flow/all` is
    // among the 7 that differ under enable_hashagg=off.
    // FOUR scopes, not three, and the fourth is the point: the OPEN-ENDED parliament
    // (date_to NULL) is the page's default window and one of the two the route's own header
    // calls "the two that matter". An earlier draft selected `ns:%` with
    // `date_to IS NOT NULL`, which excluded precisely it — leaving the default window's
    // freshness unverified while the test read as covering "all three scope kinds".
    const scopes = await allRows<{ scope_key: string }>(
      `SELECT scope_key FROM procurement_scopes
        WHERE scope_key = 'all'
           OR scope_key = (SELECT scope_key FROM procurement_scopes
                            WHERE date_from IS NOT NULL AND date_to IS NULL
                            ORDER BY scope_key LIMIT 1)
           OR scope_key = (SELECT scope_key FROM procurement_scopes
                            WHERE scope_key LIKE 'ns:%' AND date_to IS NOT NULL
                            ORDER BY scope_key LIMIT 1)
           OR scope_key = (SELECT scope_key FROM procurement_scopes
                            WHERE scope_key LIKE 'y:%' ORDER BY scope_key DESC LIMIT 1)
        ORDER BY scope_key`,
    );
    assert.equal(
      scopes.length,
      4,
      "all, an open-ended parliament, a closed one and a year must all exist",
    );
    assert.ok(
      scopes.some((s) => s.scope_key === "all"),
      "the corpus scope must be in the sample",
    );

    // withClient, not allRows: the comparisons share one backend so a mid-run config change
    // cannot split the sample. No SET here — an earlier draft issued
    // `SET max_parallel_workers_per_gather = 0` + `SET enable_hashagg = on`, which pinned
    // nothing (see above) and, being SET rather than SET LOCAL on a POOLED connection, leaked
    // both settings to whichever later test drew the same client.
    await withClient(async (c) => {
      for (const { scope_key } of scopes) {
        for (const [kind, fn] of Object.entries(KINDS)) {
          const { rows } = await c.query<{ same: boolean }>(
            `SELECT p.payload = ${fn}(s.date_from, s.date_to) AS same
               FROM procurement_payloads p
               JOIN procurement_scopes s ON s.scope_key = p.scope_key
              WHERE p.kind = $1 AND p.scope_key = $2`,
            [kind, scope_key],
          );
          assert.equal(
            rows[0]?.same,
            true,
            `${kind}/${scope_key}: stored payload differs from live — the matview is STALE. ` +
              `Run \`npm run db:load:procurement-scopes:pg\`.`,
          );
        }
      }
    });
  },
);

test.skipIf(skip)(
  "the stored concentration rows carry a live oblast",
  async () => {
    // The awarder_seats half of §3.2, and it needs its own assertion because the equality test
    // above cannot make it: a matview built against a stale `awarder_seats` equals a live call
    // made against the SAME stale table. Only comparing against the table itself sees it.
    //
    // 026 resolves each row's `oblast` from awarder_seats and this matview STORES it, so a
    // seats reload that skipped the refresh shows up here and nowhere else — the row count is
    // unchanged and every other page has already moved on.
    const [{ stale, checked, placed }] = await allRows<{
      stale: number;
      checked: number;
      placed: number;
    }>(
      `SELECT count(*) FILTER (WHERE (e->>'oblast') IS DISTINCT FROM s.oblast)::int AS stale,
              count(*)::int AS checked,
              count(*) FILTER (WHERE s.oblast IS NOT NULL)::int AS placed
         FROM procurement_payloads p,
              jsonb_array_elements(p.payload->'rows') e
         LEFT JOIN awarder_seats s ON s.eik = e->>'awarderEik'
        WHERE p.kind = 'concentration'`,
    );
    // NON-VACUITY FIRST. `payload->'rows'` yielding nothing — a renamed key, an empty corpus —
    // would make the comparison below assert 0 == 0 and pass for ever, which is precisely the
    // shape of failure a staleness gate must not have. Measured today: 26,202 elements, 24,379
    // of them with a real oblast.
    assert.ok(
      checked > 1000,
      `only ${checked} concentration rows unnested — is 'rows' still the payload key?`,
    );
    assert.ok(
      placed > checked / 2,
      `only ${placed}/${checked} rows carry an oblast — awarder_seats may be empty`,
    );
    assert.equal(
      stale,
      0,
      "a stored `oblast` diverges from awarder_seats — refresh 124 " +
        "(`npm run db:load:awarder-seats:pg` now does it; a hand-run reload may not have)",
    );
  },
);

// ── The list, and the thing no other gate checks ─────────────────────────────

test.skipIf(skip)("procurement_payloads is in SCOPED_MATVIEWS", async () => {
  // The converse — a matview reading procurement_scopes that is NOT in the list — is already
  // asserted by procurement_settlement_payloads.data.test.ts, which covers this file's subject
  // too. This direction is the cheap half: the name is there and spelled right.
  assert.ok(
    SCOPED_MATVIEWS.some((m) => m.name === "procurement_payloads"),
    "no loader would ever refresh it",
  );
});

test.skipIf(skip)(
  "the declared `inputs` cover every table the matview actually reads",
  async () => {
    // THE CHECK NOTHING ELSE IN THE REPO MAKES, and the one that would have caught this
    // migration's own first draft. The exhaustiveness gate next door asserts a matview is
    // PRESENT in SCOPED_MATVIEWS; it cannot tell whether the `inputs` it declares match what
    // the matview reads. A wrong `inputs` array is invisible to every other test: the loader
    // for the undeclared table simply never refreshes this matview, and the page it feeds
    // serves the previous attribution at a 200.
    //
    // 124's first COMMITTED draft declared inputs: ["contracts", "awarder_seats"] and missed
    // both TR tables, which four of its six aggregates read — the `oblast` dependency had been
    // caught by then, the politician↔company one had not. Read the bodies out of the catalogue
    // rather than the files, so this tracks what is actually installed on the database served.
    const declared = new Set<string>(
      SCOPED_MATVIEWS.find((m) => m.name === "procurement_payloads")?.inputs ??
        [],
    );
    // Only tables that HAVE a ScopedInput can be declared, so only those can be missing. A
    // dependency with no ScopedInput member would need one adding before it could be declared,
    // which is a code change and not a test failure.
    //
    // Read from the EXPORTED array, not re-listed here: a hand-copied list silently stops
    // checking whatever a later migration adds, which is the same drift this whole module
    // exists to prevent. `ScopedInput` is derived from the same array, so the two cannot part.
    const CANDIDATES = SCOPED_INPUTS;
    const bodies = await allRows<{ proname: string; def: string }>(
      `SELECT p.proname, pg_get_functiondef(p.oid) AS def
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
      [Object.values(KINDS)],
    );
    assert.equal(
      bodies.length,
      Object.keys(KINDS).length,
      "every aggregate 124 unnests must exist",
    );

    const missing: string[] = [];
    for (const t of CANDIDATES) {
      // Word-boundary match so `contracts` does not also match `contractor_rank`, and
      // `place_dim` is not found inside a comment mentioning another table.
      const re = new RegExp(`\\b${t}\\b`);
      const readers = bodies
        .filter((b) => re.test(b.def))
        .map((b) => b.proname);
      if (readers.length && !declared.has(t)) {
        missing.push(`${t} (read by ${readers.join(", ")})`);
      }
    }
    assert.deepEqual(
      missing,
      [],
      "procurement_payloads reads a table it does not declare in SCOPED_MATVIEWS " +
        "(scripts/db/lib/scopedMatviews.ts), so that table's loader will never refresh it: " +
        missing.join("; "),
    );
  },
);
