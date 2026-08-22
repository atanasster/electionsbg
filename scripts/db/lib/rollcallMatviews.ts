// The roll-call precomputes — the ONE list, and the ONE way to refresh them.
//
// Same reasoning as lib/scopedMatviews.ts, which this mirrors: the names, their ORDER, what
// each is built FROM, and the existence guard live together, because a second copy of the
// list is exactly the thing that goes stale. A migration that adds a matview without adding
// it here is invisible at runtime — the page it feeds simply serves the previous corpus,
// with nothing red anywhere.

import { exec, allRows } from "./pg";

/** The tables a precompute is built FROM. A loader that reloads one of these names its
 *  input and gets exactly the matviews that input can affect. */
export const ROLLCALL_INPUTS = ["vote_item", "vote_cast"] as const;
export type RollcallInput = (typeof ROLLCALL_INPUTS)[number];

export interface RollcallMatview {
  name: string;
  inputs: readonly RollcallInput[];
  /** Roughly what a full refresh costs locally — the number that decides whether this can
   *  ride an interactive reload or belongs in a nightly. */
  costNote: string;
}

/** In refresh order. Nothing here depends on another entry, so the order is by cost:
 *  the cheap three first, so a run that dies on the quadratic one still leaves the rest
 *  current rather than leaving everything on the previous vintage. */
export const ROLLCALL_MATVIEWS: readonly RollcallMatview[] = [
  {
    name: "mp_attendance",
    inputs: ["vote_item", "vote_cast"],
    costNote: "<1 s (2,366 rows)",
  },
  {
    name: "party_cohesion",
    inputs: ["vote_item", "vote_cast"],
    costNote: "~2 s local / 10 s cloud (4,269 rows)",
  },
  {
    // The per-(ns, party) rollup 181 adds. Its median and member count are the two columns
    // party_cohesion's per-DATE grain cannot reproduce — a median does not fold — and both
    // are rendered by /parliament/cohesion and the dashboard tile. Listed HERE and not only
    // in 181 because a matview absent from this array is refreshed by nothing: the page it
    // feeds simply serves the previous corpus, with nothing red anywhere.
    name: "party_cohesion_summary",
    inputs: ["vote_item", "vote_cast"],
    costNote: "~6 s local (69 rows; its own per_item pass over 4M casts)",
  },
  {
    name: "mp_dissent",
    inputs: ["vote_item", "vote_cast"],
    // 90,542, NOT the 105,571 the plan records and this note used to print. That figure
    // predates P1's fix to the tie-break — `mode() WITHIN GROUP (ORDER BY vote)` breaks ties
    // toward 'a' while majorityFor breaks them toward yes, which flipped 4,976 rows and
    // changed which of them qualify as a dissent at all. The stale note printed beside the
    // real count on every run, local and cloud, inviting exactly the "which of these two is
    // right?" that the whole module has been audited to remove.
    costNote: "~2 s local / 30 s cloud (90,542 rows)",
  },
  {
    // Must precede mp_similarity in spirit though not in dependency: the score is
    // meaningless without it, so a run that built one and not the other would serve
    // divide-by-zero.
    name: "mp_vote_norm",
    inputs: ["vote_item", "vote_cast"],
    costNote: "<1 s (2,366 rows)",
  },
  {
    // The one that dominates. Quadratic in members per item, so it is a matview by
    // necessity rather than by preference — one member's row costs ~36k buffers live,
    // 18x over the budget that keeps a query off a db-g1-small's 10 s timeout.
    name: "mp_similarity",
    inputs: ["vote_item", "vote_cast"],
    // MEASURED on Cloud SQL 2026-08-06: 744.5 s — 12.4 minutes, 11x the local build, on a
    // db-g1-small with the corpus at 4,017,519 casts. No longer "unmeasured": budget a
    // quarter of an hour for this one alone and do not chain it behind anything urgent.
    costNote: "~67 s local / 745 s cloud (297,493 rows)",
  },
] as const;

/** True when the relation exists at all. A matview that was never created is not an error
 *  here — it means the DDL has not been applied to this database yet, which is exactly the
 *  first-deploy state the serving routes degrade for. */
const exists = async (name: string): Promise<boolean> =>
  (
    await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.${name}') IS NOT NULL AS ok`,
    )
  )[0]?.ok === true;

/** Refresh every precompute affected by the given inputs, in declared order.
 *
 *  NOT CONCURRENTLY, deliberately. A concurrent refresh needs the matview to already hold
 *  data and takes roughly twice as long; these are built WITH NO DATA, so the first refresh
 *  on any database would fail. Nothing serves them mid-refresh either — the routes degrade
 *  on 55000/55P03 rather than blocking (functions/db_routes.js), which is the whole reason
 *  that contract exists. */
export const refreshRollcallMatviews = async (
  changed: readonly RollcallInput[] = ROLLCALL_INPUTS,
): Promise<string[]> => {
  const refreshed: string[] = [];
  // ONE transaction. mp_similarity's scores are divided by mp_vote_norm's, so a failure
  // partway through would publish cosines built from two different vintages — a wrong
  // number rather than a stale one. REFRESH takes an AccessExclusiveLock either way; the
  // serving routes degrade on 55P03 rather than blocking, which is what makes that
  // acceptable.
  await exec("BEGIN");
  try {
    for (const mv of ROLLCALL_MATVIEWS) {
      if (!mv.inputs.some((i) => changed.includes(i))) continue;
      if (!(await exists(mv.name))) {
        console.warn(
          `rollcall-derived: ${mv.name} does not exist — apply 135_rollcall_derived.sql first`,
        );
        continue;
      }
      const started = Date.now();
      await exec(`REFRESH MATERIALIZED VIEW ${mv.name}`);
      refreshed.push(mv.name);
      console.log(
        `rollcall-derived: refreshed ${mv.name} in ${((Date.now() - started) / 1000).toFixed(1)}s (${mv.costNote})`,
      );
    }
    await exec("COMMIT");
  } catch (e) {
    await exec("ROLLBACK");
    throw e;
  }
  return refreshed;
};
