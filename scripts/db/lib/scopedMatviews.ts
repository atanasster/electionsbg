// The per-scope procurement precomputes — the ONE list, and the ONE way to refresh them.
//
// WHY A lib/ MODULE. Five loaders need this: the scopes loader that creates them
// (load_procurement_scopes_pg), the contracts reload (load_pg), the awarder_seats / place_dim
// loaders, and the TR reload (load_tr_pg) — every one of them changes what these contain.
// Hanging it off one of those CLI entry points would make four scripts depend on a fifth
// script's module body staying side-effect-free forever, and the list itself is exactly the
// kind of thing that goes stale in a second copy: a future migration joins one list and not
// the other, and the page it feeds serves the previous corpus with nothing red anywhere.
//
// Everything that must not drift lives here together: the names, their ORDER, the
// existence guard and the not-populated fallback.

import { exec, allRows, withClient } from "./pg";

/** The tables a precompute is built FROM. A loader that reloads one of these names its
 *  input and gets exactly the matviews that input can affect — see refreshScopedPrecomputes.
 *
 *  `procurement_scopes` is deliberately absent: a scope change re-applies all the DDL files,
 *  so that path refreshes everything by definition and has no need to filter.
 *
 *  `company_politicians` and `tr_companies` are reloaded by the SAME loader (load_tr_pg) and
 *  could have been one name. They are two because they are two tables, and a future loader
 *  that touches only one of them should not be forced to rebuild for the other. */
export const SCOPED_INPUTS = [
  "contracts",
  "awarder_seats",
  "place_dim",
  "company_politicians",
  "tr_companies",
] as const;

/** Derived from the array above rather than declared beside it, so the runtime list a data
 *  gate iterates and the compile-time union can never drift: adding a member in one place
 *  adds it in both. procurement_payloads.data.test.ts checks each matview's declared `inputs`
 *  against what it actually reads, and it can only check the inputs it knows about. */
export type ScopedInput = (typeof SCOPED_INPUTS)[number];

/** Every per-scope precompute, in refresh order, with what it reads.
 *
 *  Exported so the data gates can assert the list is exhaustive — a migration that adds a
 *  matview without adding it here is invisible at runtime and shows up only as a page
 *  serving stale numbers. */
export const SCOPED_MATVIEWS = [
  // 119 — /procurement/by-settlement. Unnests procurement_by_settlement (030), which reads
  // awarder_seats to decide which buyers are local-tier, and LEFT JOINs place_dim for the
  // English settlement name the table sorts and searches by.
  {
    name: "procurement_settlement_rank",
    inputs: ["contracts", "awarder_seats", "place_dim"],
  },
  {
    name: "procurement_geo_payloads",
    inputs: ["contracts", "awarder_seats", "place_dim"],
  },
  // 122 — /procurement/contractors. Reads contracts, company_politicians and tr_companies;
  // it has NO settlement dimension, so neither awarder_seats nor place_dim can move it. That
  // is why a seats or place reload does not rebuild this pair — they are the expensive half
  // of the list, and rebuilding them on an input they cannot see is pure cost.
  //
  // contractor_rank BEFORE contractor_scope_kpis: the KPI matview reads the rank matview, so
  // it must see the freshly-refreshed rows.
  {
    name: "contractor_rank",
    inputs: ["contracts", "company_politicians", "tr_companies"],
  },
  {
    name: "contractor_scope_kpis",
    inputs: ["contracts", "company_politicians", "tr_companies"],
  },
  // 123 — the per-settlement payloads. Independent of the four above (it unnests
  // procurement_settlement_detail, not procurement_by_settlement), so its position is free;
  // last keeps the pairwise ordering above undisturbed. It stores the place hero, so
  // place_dim is a real input here and not merely a display join.
  {
    name: "procurement_settlement_payloads",
    inputs: ["contracts", "awarder_seats", "place_dim"],
  },
  // 124 — the six procurement DASHBOARD payloads behind /api/db/procurement-{overview,flow,
  // rankings,concentration,sectors,benchmarks}. Independent of everything above (it unnests
  // 025/026/027/031/036/037, none of which any other entry reads), so its position is free.
  //
  // Four inputs, and only ONE of them is obvious. Traced from pg_get_functiondef, not assumed:
  //   contracts            all six
  //   company_politicians  overview, flow, rankings — the MP/official-tied money
  //   tr_companies         overview, flow, rankings, concentration — contractor display names
  //   awarder_seats        concentration ALONE, for each row's `oblast` (026 line 62; 86.6% of
  //                        the `all` scope's 2,755 rows carry one)
  // Declaring contracts alone would let a standalone seats or TR reload leave
  // /procurement/concentration on the previous attribution, and the MP-tied figures on the
  // whole dashboard on the previous link set, at a 200 — the exact failure this module's
  // header describes. place_dim is genuinely absent from all six.
  {
    name: "procurement_payloads",
    inputs: [
      "contracts",
      "awarder_seats",
      "company_politicians",
      "tr_companies",
    ],
  },
] as const satisfies readonly {
  name: string;
  inputs: readonly ScopedInput[];
}[];

/** How long a plain REFRESH may WAIT for its AccessExclusiveLock before giving up. Bounds
 *  the reader pileup, not the rebuild: a queued exclusive lock request blocks every
 *  SELECT behind it, so an unbounded wait turns one stuck reader into a stalled page. */
const PLAIN_REFRESH_LOCK_TIMEOUT = "5s";

/** REFRESH the per-scope precomputes, CONCURRENTLY where possible.
 *
 *  CONCURRENTLY because all of these sit on a serving path and a plain REFRESH holds an
 *  AccessExclusiveLock for the whole recompute — it would stall the page rather than merely
 *  delay its data. It requires a populated matview and a unique index (119, 122, 123 and 124
 *  each create their own), so the first refresh after a CREATE falls back to the plain form.
 *  Cannot run inside a transaction, hence exec()/withClient() rather than withTx().
 *
 *  THE FALLBACK MEANS SOMETHING DIFFERENT TO EACH CALLER, which is why it is loud:
 *  - the scopes loader re-applies all three DDL files immediately before calling here, and
 *    each DROPs + recreates WITH NO DATA, so the fallback fires on EVERY run and is simply
 *    the normal path;
 *  - for every other caller it means a matview exists that somebody applied and never
 *    populated — an aborted scopes load, a hand-run apply — and the plain REFRESH is then an
 *    unannounced multi-minute exclusive lock on a relation that /procurement/by-settlement
 *    and /procurement/contractors read WITHOUT degrading (they queue, burn the 10 s
 *    statement_timeout and 500). That reads to an operator as "the loader is slow".
 *
 *  @param changed the inputs the caller just reloaded. Omit to refresh everything (the
 *    contracts reload and the scopes loader, which can move all of them). Naming an input
 *    refreshes only the matviews built from it — a PLACE reload skips 122 and 124, which have
 *    no settlement dimension and are the expensive half of the list; a TR reload skips 119 and
 *    123, which read neither company_politicians nor tr_companies. (A SEATS reload no longer
 *    skips 124 — one of its six aggregates, procurement_concentration, reads awarder_seats.) */
export const refreshScopedPrecomputes = async (
  changed?: readonly ScopedInput[],
): Promise<void> => {
  const due = changed
    ? SCOPED_MATVIEWS.filter((mv) => mv.inputs.some((i) => changed.includes(i)))
    : SCOPED_MATVIEWS;
  if (!due.length) return;

  // ONE catalogue round-trip for the whole list rather than one per name: over a Cloud SQL
  // proxy the serial hops are the expensive part, not the lookup.
  const found = await allRows<{ mv: string }>(
    `SELECT mv FROM unnest($1::text[]) AS mv WHERE to_regclass(mv) IS NOT NULL`,
    [due.map((mv) => mv.name)],
  );
  const present = new Set(found.map((r) => r.mv));
  // Announce BEFORE the work, not only after it. On Cloud SQL this loop is minutes long and
  // otherwise silent — indistinguishable from a hung proxy, and the natural response (Ctrl-C)
  // leaves a mix of vintages, which is the exact state these refreshes exist to prevent.
  console.log(
    `scoped precomputes: refreshing ${present.size}/${due.length}` +
      `${changed ? ` (changed: ${changed.join(", ")})` : ""} — ` +
      `minutes on Cloud SQL, see 123_procurement_settlement_payloads.sql`,
  );

  let refreshed = 0;
  for (const { name: mv } of due) {
    // Guarded on existence so this is safe to call from loaders that run BEFORE the DDL has
    // ever been applied — a contracts-first load, or a cloud database that has not yet had
    // the migration applied. Announced, because a silent skip lets a first-deploy cloud load
    // report complete success while the pages it feeds serve nothing. Worded for BOTH
    // contexts: on a fresh db:refresh the scopes loader creates them a few steps later, so
    // "apply its migration" would be advice the operator has already taken.
    if (!present.has(mv)) {
      console.log(
        `  ${mv}: not present — skipped (db:load:procurement-scopes:pg creates it).`,
      );
      continue;
    }
    console.log(`  ${mv}: refreshing…`);
    try {
      await exec(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${mv}`);
    } catch (err) {
      // ONLY 0A000 (feature_not_supported) — Postgres raises it for "CONCURRENTLY cannot be
      // used when the materialized view is not populated". 119, 122 and 123 all create their
      // matviews WITH NO DATA, so the first refresh after an apply always lands here and
      // must fall back to the plain form. (0A000, not the more intuitive 55000: verified
      // against the server.)
      //
      // Narrow on purpose: a bare catch would swallow a lock timeout, a permissions error
      // or a unique violation and then silently take the very AccessExclusiveLock the
      // CONCURRENTLY form exists to avoid — turning a loud failure into a stalled page.
      if ((err as { code?: string })?.code !== "0A000") throw err;
      console.warn(
        `  ${mv}: not populated — falling back to a PLAIN REFRESH (AccessExclusiveLock).`,
      );
      // SET + REFRESH + RESET on ONE client. exec() takes a fresh pooled connection per
      // call, so issuing these as three exec()s would set the timeout on a connection the
      // REFRESH never runs on — a no-op that looks like a guard.
      await withClient(async (c) => {
        await c.query(`SET lock_timeout = '${PLAIN_REFRESH_LOCK_TIMEOUT}'`);
        try {
          await c.query(`REFRESH MATERIALIZED VIEW ${mv}`);
        } finally {
          await c.query("RESET lock_timeout");
        }
      });
    }
    refreshed++;
  }
  console.log(`scoped precomputes: refreshed ${refreshed}/${due.length}`);
};
