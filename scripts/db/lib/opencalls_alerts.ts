// Per-municipality OPEN CALLS, for the My-Area alert feed.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE ASSUMING THIS FILE IS BROKEN: on the corpus as it stands (2026-08-09) it
// correctly returns an EMPTY MAP, and that is the honest answer rather than a bug.
//
// Measured over all 66 loaded rows:
//   * all 55 ИСУН rows have `audience = '{}'`, `territory = NULL` and `beneficiaries_raw = NULL`
//     — the ИСУН procedure page publishes no eligibility structurally at all. Deriving it from
//     the guidance documents is Stage 7 (`enrich-open-calls`), which is a separate skill
//     precisely because it must not publish without human sign-off;
//   * all 11 ДФЗ rows DO carry a territory, and every one of them is national („на територията
//     на цялата страна") or a broad category („Селски райони"). Not one names an obshtina;
//   * ZERO rows across both sources have 'municipality' in `audience`.
//
// So the design this was specified as — „calls whose territory names the user's obshtina, or that
// are national" (funds-module-v2 §Stage 3.3) — would today put the same eleven farmer-facing
// forecasts into all 265 municipal feeds. That is 265 identical copies in a feed whose entire
// premise is „what is notable HERE", and it would dilute every real per-place event around it.
// The predicate below is therefore the one the surface actually means, and it fills in on its own
// the moment `territory` starts naming municipalities — which is Stage 7's job, since ИСУН
// publishes eligibility only in the guidance documents. NOTE it is `territory` and not `audience`:
// populating `audience` alone leaves this arm emitting exactly nothing.
//
// A NATIONAL call is deliberately NOT emitted. /funds and /funds/calls already serve the national
// list, and the My-Area feed's job is the part that is specific to a place.
// ─────────────────────────────────────────────────────────────────────────────────────────
//
// WHY POSTGRES AND NOT THE COMMITTED TREE. `data/opencalls/*.json` is the loader's SOURCE: it
// carries no derived status (that is computed at query time from `closes_at`, migration 142) and
// no place resolution. `build_alerts.ts` already reads Postgres for awarders and Interreg, so
// this is its existing contract rather than a new dependency.
//
// ONE QUERY FOR EVERY MUNICIPALITY, like its siblings — the alert builder walks ~265 places and a
// per-place round trip would be 265 of them.
//
// FAILS SOFT TO AN EMPTY MAP. A checkout before migration 142, or a database where the loader has
// never run, must still produce alerts: this arm is additive, and a run that aborted on its
// absence would take every other event down with it.

import { Pool } from "pg";
import { DATABASE_URL } from "./pg";

export interface OpenCallAlertRow {
  /** The obshtina this row is scoped to. Never null — a national row is not emitted. */
  obshtina: string;
  code: string | null;
  title: string;
  programmeName: string | null;
  /** ISO instant. Present by construction: the query only takes status='open', and 142's CHECK
   *  requires an 'exact' row to have one. */
  closesAt: string;
  daysLeft: number | null;
  budgetEur: number | null;
  grantMaxEur: number | null;
  sourceUrl: string;
  source: string;
  /** When WE first saw it. Used as the feed's event date — see build_alerts. */
  firstSeenAt: string;
}

/** THE PREDICATE, EXPORTED — one copy, and the tests run THIS.
 *
 *  It was written out by hand a second time in `open_calls.data.test.ts`, which meant the gates
 *  could not fail on a regression: deleting the national exclusion or the status filter from the
 *  production query left all three green. `readOpenCallsByObshtina` has exactly one importer and it
 *  is not a test, so the SQL is the only thing a gate can hold onto.
 *
 *  $1 = the obshtina NAME list, $2 = the per-place cap.
 */

export const OPEN_CALLS_BY_OBSHTINA_SQL = `WITH scoped AS (
   SELECT c.*, o.name AS obshtina
     FROM open_calls_table c
     JOIN unnest($1::text[]) AS o(name)
       ON c.territory ~* ('(^|[^А-Яа-яA-Za-z])(общин[аиата]*|обл[.]|област)[[:space:]]+'
                         || o.name || '([^А-Яа-яA-Za-z]|$)')
    WHERE c.status = 'open'
      AND c.kind = 'call'
      -- A NATIONAL call is not a per-place event: /funds/calls already serves those, and
      -- copying them into 265 feeds would drown the events that are actually local.
      AND c.territory IS NOT NULL
      AND c.territory !~* 'цялата (страна|територия)'
 ), ranked AS (
   SELECT obshtina, code, title, programme_name, closes_at, days_left,
          budget_eur, grant_max_eur, source_url, source, first_seen_at,
          row_number() OVER (PARTITION BY obshtina
                             ORDER BY closes_at ASC, id) rn
     FROM scoped
 )
 SELECT obshtina, code, title,
        programme_name AS "programmeName",
        closes_at::text AS "closesAt",
        days_left AS "daysLeft",
        budget_eur AS "budgetEur",
        grant_max_eur AS "grantMaxEur",
        source_url AS "sourceUrl", source,
        first_seen_at::text AS "firstSeenAt"
   FROM ranked WHERE rn <= $2`;

/**
 * Open calls scoped to a specific municipality, keyed by obshtina name.
 *
 * `obshtinaNames` is the canonical set the alert builder walks; a call is matched to one of them
 * when its `territory` names that obshtina administratively („община X"). There is no `audience`
 * branch — the SQL above reads `territory` only. `perMuni` caps the per-place list.
 */
export const readOpenCallsByObshtina = async (
  obshtinaNames: string[],
  perMuni = 3,
): Promise<Map<string, OpenCallAlertRow[]>> => {
  const out = new Map<string, OpenCallAlertRow[]>();
  if (obshtinaNames.length === 0) return out;
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<OpenCallAlertRow>(
      OPEN_CALLS_BY_OBSHTINA_SQL,
      [obshtinaNames, Math.max(perMuni, 1)],
    );
    for (const r of rows) {
      const list = out.get(r.obshtina) ?? [];
      list.push(r);
      out.set(r.obshtina, list);
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // 42P01 / 42883 is a database before 142; anything else is worth seeing, but never worth
    // aborting the whole alerts run for.
    console.warn(
      `open-calls alerts: skipped (${code ?? (e as Error).message}) — ` +
        "no open-call events will be emitted. Run db:load:open-calls:pg.",
    );
  } finally {
    await pool.end();
  }
  return out;
};
