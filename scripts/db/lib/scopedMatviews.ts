// The per-scope procurement precomputes — the ONE list, and the ONE way to refresh them.
//
// WHY A lib/ MODULE. Four loaders now need this: the scopes loader that creates them
// (load_procurement_scopes_pg), the contracts reload (load_pg), and the awarder_seats /
// place_dim loaders that change what they contain. Hanging it off one of those CLI entry
// points would make three scripts depend on a fourth script's module body staying
// side-effect-free forever, and the list itself is exactly the kind of thing that goes
// stale in a second copy: a future migration joins one list and not the other, and the
// page it feeds serves the previous corpus with nothing red anywhere.
//
// Everything that must not drift lives here together: the names, their ORDER, the
// existence guard and the not-populated fallback.

import { exec, allRows, withClient } from "./pg";

/** Every per-scope precompute, in refresh order.
 *
 *  Exported so the data gates can assert the list is exhaustive — a migration that adds a
 *  matview without adding it here is invisible at runtime and shows up only as a page
 *  serving stale numbers. */
export const SCOPED_MATVIEWS = [
  // 119 — /procurement/by-settlement.
  "procurement_settlement_rank",
  "procurement_geo_payloads",
  // 122 — /procurement/contractors. contractor_rank BEFORE contractor_scope_kpis: the KPI
  // matview reads the rank matview, so it must see the freshly-refreshed rows.
  "contractor_rank",
  "contractor_scope_kpis",
  // 123 — the per-settlement payloads. Independent of the four above (it unnests
  // procurement_settlement_detail, not procurement_by_settlement), so its position is free;
  // last keeps the pairwise ordering above undisturbed.
  "procurement_settlement_payloads",
] as const;

/** How long a plain REFRESH may WAIT for its AccessExclusiveLock before giving up. Bounds
 *  the reader pileup, not the rebuild: a queued exclusive lock request blocks every
 *  SELECT behind it, so an unbounded wait turns one stuck reader into a stalled page. */
const PLAIN_REFRESH_LOCK_TIMEOUT = "5s";

/** REFRESH the per-scope precomputes, CONCURRENTLY where possible.
 *
 *  CONCURRENTLY because all of these sit on a serving path and a plain REFRESH holds an
 *  AccessExclusiveLock for the whole recompute — it would stall the page rather than merely
 *  delay its data. It requires a populated matview and a unique index (119, 122 and 123
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
 *    statement_timeout and 500). That reads to an operator as "the loader is slow". */
export const refreshScopedPrecomputes = async (): Promise<void> => {
  // ONE catalogue round-trip for the whole list rather than one per name: over a Cloud SQL
  // proxy the serial hops are the expensive part, not the lookup.
  const found = await allRows<{ mv: string }>(
    `SELECT mv FROM unnest($1::text[]) AS mv WHERE to_regclass(mv) IS NOT NULL`,
    [SCOPED_MATVIEWS as readonly string[]],
  );
  const present = new Set(found.map((r) => r.mv));

  let refreshed = 0;
  for (const mv of SCOPED_MATVIEWS) {
    // Guarded on existence so this is safe to call from loaders that run BEFORE the DDL has
    // ever been applied — a contracts-first load, or a cloud database that has not yet had
    // the migration applied. Announced, because a silent skip lets a first-deploy cloud load
    // report complete success while the pages it feeds serve nothing.
    if (!present.has(mv)) {
      console.log(
        `${mv}: not present — skipped (apply its migration, then re-run).`,
      );
      continue;
    }
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
        `${mv}: not populated — falling back to a PLAIN REFRESH (AccessExclusiveLock).`,
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
  console.log(
    `scoped precomputes: refreshed ${refreshed}/${SCOPED_MATVIEWS.length}`,
  );
};
