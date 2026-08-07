// Per-municipality Interreg operations, for the My-Area alert feed.
//
// WHY THIS READS POSTGRES AND NOT THE COMMITTED TREE. `data/funds/interreg/`
// carries the corpus but NOT its place resolution — the Tier L/P cascade runs
// inside `load_interreg_pg.ts`, because tiers L1 and L2 read `awarder_seats`
// and `tr_company_place`, which live in Postgres. So the on-disk partners carry
// a free-text `town` and no EKATTE, and the only place a partner is bound to a
// municipality is the loaded table. `build_alerts.ts` already reads Postgres
// (readMunicipalAwardersByEkatte), so this is its existing contract, not a new
// dependency.
//
// ONE QUERY FOR EVERY MUNICIPALITY, like its sibling: the alert builder walks
// ~265 places and a per-place round trip would be 265 of them.
//
// FAILS SOFT TO AN EMPTY MAP. A checkout without the corpus, or a database
// before migration 137, must still produce alerts — the Interreg arm is
// additive, and an alerts run that aborted on its absence would take every
// other event down with it.

import { Pool } from "pg";
import { DATABASE_URL } from "./pg";

export interface InterregAlertRow {
  obshtina: string;
  keepId: number;
  titleEn: string;
  titleBg: string | null;
  period: string;
  programmeName: string | null;
  budgetEur: number | null;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
}

export const readInterregByObshtina = async (
  perMuni = 5,
): Promise<Map<string, InterregAlertRow[]>> => {
  const out = new Map<string, InterregAlertRow[]>();
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const { rows } = await pool.query<InterregAlertRow>(
      // Grouped to the (obshtina, operation) grain and summed over the PARTNER
      // budget — a municipality can hold two partners on one cross-border
      // project, and listing the operation twice would double-count it in the
      // feed. `o.total_budget_eur` is never used: it is the whole cross-border
      // project (€1,419,208 on BSB00963 against Малко Търново's €357,183), so
      // an alert carrying it would overstate a 2,628-person municipality
      // fourfold.
      `WITH per_op AS (
         SELECT p.obshtina, p.keep_id,
                SUM(p.budget_eur) AS budget_eur
           FROM interreg_partners p
          WHERE p.obshtina IS NOT NULL
            -- Redundant today — a placed row is Bulgarian by construction, and
            -- 0 rows with an obshtina fail this — but it is what makes the
            -- Bulgarian scope explicit rather than a consequence of the place
            -- cascade, which is the assumption most likely to change.
            AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
          GROUP BY p.obshtina, p.keep_id
       ), ranked AS (
         SELECT r.obshtina, r.keep_id, r.budget_eur,
                o.title_en, o.title_bg, o.period, o.status,
                o.start_date::text AS start_date, o.end_date::text AS end_date,
                g.name_bg AS programme_name,
                row_number() OVER (PARTITION BY r.obshtina
                                   ORDER BY r.budget_eur DESC NULLS LAST, r.keep_id) rn
           FROM per_op r
           JOIN interreg_operations o USING (keep_id)
           -- LEFT: the catalogue's only contribution is the optional detail
           -- subtitle, so a programme code with no row must cost that label and
           -- not the whole alert. Zero orphans today; this is about the day
           -- keep.eu mints a code the curated registry has not admitted yet.
           LEFT JOIN interreg_programmes g ON g.code = o.programme_code
       )
       SELECT obshtina, keep_id AS "keepId", title_en AS "titleEn",
              title_bg AS "titleBg", period, programme_name AS "programmeName",
              budget_eur AS "budgetEur", start_date AS "startDate",
              end_date AS "endDate", status
         FROM ranked WHERE rn <= $1`,
      [Math.max(perMuni, 1)],
    );
    for (const r of rows) {
      const list = out.get(r.obshtina) ?? [];
      list.push(r);
      out.set(r.obshtina, list);
    }
  } catch (e) {
    const code = (e as { code?: string })?.code;
    // 42P01 (no such table) is a database before 137; anything else is worth
    // seeing, but never worth aborting the whole alerts run for.
    console.warn(
      `interreg alerts: skipped (${code ?? (e as Error).message}) — ` +
        "no Interreg events will be emitted. Run db:load:interreg:pg.",
    );
  } finally {
    await pool.end();
  }
  return out;
};
