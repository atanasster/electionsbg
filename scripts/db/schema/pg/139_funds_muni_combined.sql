-- 139_funds_muni_combined.sql — the per-capita municipal EU-money ranking, with
-- the Interreg arm in it.
--
-- WHY THIS EXISTS. The ranking the site publishes today is computed offline in
-- scripts/funds/projects_ingest.ts from the ИСУН shards alone and stored in the
-- `muni-summary` payloads. ИСУН does not hold a single Interreg project — the
-- gap is a system boundary (Interreg runs on Jems), not a filter — and Interreg
-- is by definition cross-border, so the missing money lands on exactly the
-- border municipalities. Measured against the full corpus on 2026-08-07:
--
--   * 213 of the 256 ranked municipalities change rank.
--   * Генерал Тошево (DOB03) gains 43 places, €1,834 → €2,267 per resident.
--     Аксаково +40, Борово +36, Никопол +34, Девин +27, Тервел +27.
--   * 134 municipalities gain money; the largest single loss is 8 places, which
--     is what happens to everyone the movers pass.
--
-- The plan's §6 estimate — built on a 5.5% sample — predicted 10-18 places. The
-- full corpus gives 43. Understating the poorest, most depopulated border
-- municipalities is the harm the whole Interreg ingest exists to end, and this
-- function is where it actually gets fixed.
--
-- WHY IT READS fund_payloads. The ИСУН arm is not re-derived here. Its money is
-- attributed by `muniShare`'s even split (a contract naming N общини contributes
-- 1/N to each — scripts/funds/projects_share.ts), which is deliberate,
-- non-trivial and lives in TypeScript. Re-implementing that split in SQL would
-- be a second definition of the same number, free to drift. So this reads the
-- served `muni-summary` payload as the ИСУН arm's authority and adds the
-- Interreg arm beside it. READ ONLY: writing an `interreg-*` kind into
-- fund_payloads would be silently deleted by the next db:load:funds:pg, whose
-- stage merge runs an unscoped anti-join DELETE and whose parity guard would
-- still pass.
--
-- THE TWO ARMS ARE NEVER SILENTLY SUMMED INTO ONE NUMBER. Every payload below
-- carries `isunEur` and `interregEur` separately alongside the combined total,
-- because they have different bases: ИСУН money is *attributed* (even-split
-- across the общини a contract names), Interreg money is a partner's own
-- published budget at one address. A caller must be able to say which is which.
--
-- WHAT IS OUTSIDE THE RANKING, and it is not small:
--   * Столична община — €88,655,624 across 272 partner rows, 22.6% of the placed
--     Interreg money, excluded because the ИСУН ranking gives Sofia a NULL
--     perCapitaRank (ГРАО carries no Sofia city EKATTE). `excluded` names it so
--     no caption can imply the ranking covers the capital.
--
--     TWO INDEPENDENT REASONS used to hide behind each other here, which is why
--     the join now normalises. The two corpora call Sofia city different things:
--     `interreg_partners.obshtina` says `SFO_CITY`, `fund_payloads` keys it
--     `S22`. So `USING (obshtina)` could never have matched Sofia EVEN IF ГРАО
--     published the EKATTE tomorrow — the cohort gap would be fixed and the
--     €88.7m would still silently vanish, with every row count reconciling.
--     SOFIA_KEY below reconciles the vocabulary; the cohort gap then stands
--     alone, which is the point. funds_muni_combined.data.test.ts gate 9 fails
--     on any other unreconciled code.
--   * 3 municipalities (GAB05, SLV16, SLV20, €2.17m) that HAVE a payload row but
--     no published rank — they land in `excluded.outsideCohort`, correctly.
--   * 24 unplaced partner rows, €4,621,449 — honestly unplaced rather than
--     guessed (see 137's place_basis).
--
-- Depends on 137 and on fund_payloads (043). SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

-- GRANTS ARE ROLE-GUARDED, and that became load-bearing the moment this file
-- joined load_interreg_pg.ts's SCHEMA_FILES. roles_readonly.sql is a one-time
-- manual step, so on a database that has not run it a bare GRANT raises 42704 —
-- and exec() sends a migration as ONE implicit transaction, so that rolls the
-- whole file back and aborts the loader before a single Interreg row is written.
-- Same shape as 117/130/137.

-- The ranked cohort, both arms, old and new rank. One row per municipality.
--
-- The cohort is exactly the set the ИСУН ranking already ranks (a non-null
-- perCapitaRank in the payload — 256 of 273). Ranking a DIFFERENT cohort would
-- make `rankBefore` and `rank` incomparable, and the whole point of returning
-- both is that a reader can see the movement.
--
-- TWO RANKS, and conflating them would be a silent redefinition. The ИСУН
-- `perCapitaRank` already on the summary payload is scoped to the municipality's
-- OBLAST cohort — projects_ingest.ts:386 "scoped to oblast cohorts", which is
-- why MyAreaProjectsMapTile renders "място N от 13 общини в областта". The
-- plan's §6 movement table is a NATIONAL ranking over 256. Both are real and
-- they are not the same number, so this view carries both and each payload key
-- says which: `rank`/`rankBefore` are national, `oblastRank`/`oblastRankBefore`
-- are within the oblast. A surface swapping one for the other would change what
-- its number means with nothing failing.
CREATE OR REPLACE VIEW funds_muni_combined_v AS
WITH isun AS (
  SELECT f.key                                            AS obshtina,
         f.payload->>'oblastCode'                          AS oblast_code,
         (f.payload->'rollup'->>'totalEur')::double precision AS isun_eur,
         (f.payload->>'population')::double precision      AS population
    FROM fund_payloads f
   WHERE f.kind = 'muni-summary'
     -- ->> on a JSON null yields SQL NULL (NOT the text 'null'), so this reads
     -- as "has a published rank" via the COALESCE. Measured on the live
     -- payloads: 17 rows are JSON null there and ZERO stringify to 'null'. The
     -- COALESCE is load-bearing, not defensive padding — deleting it makes the
     -- predicate NULL for those 17 and drops them from the cohort silently.
     AND COALESCE(f.payload->>'perCapitaRank', 'null') <> 'null'
     AND COALESCE((f.payload->>'population')::double precision, 0) > 0
     -- THIS VIEW DEPENDS ON ANOTHER PIPELINE'S JSON SHAPE, so it must fail by
     -- EXCLUDING rather than by admitting a NULL. Without these two guards a
     -- rename in projects_ingest.ts makes isun_eur NULL, and a NULL sorts FIRST
     -- under `ORDER BY … DESC` — so the affected municipalities are promoted to
     -- the top of both leaderboards rather than dropping out of them. Out of the
     -- cohort is a visible absence; rank 1 is a wrong answer.
     AND f.payload->'rollup'->>'totalEur' IS NOT NULL
     AND f.payload->>'oblastCode' IS NOT NULL
), interreg AS (
  -- SFO_CITY → S22: the ONE place the two corpora disagree on a code. See the
  -- header — without this the reconciliation is hidden behind the cohort gap.
  SELECT CASE WHEN p.obshtina = 'SFO_CITY' THEN 'S22' ELSE p.obshtina END
           AS obshtina,
         SUM(p.budget_eur)                  AS interreg_eur,
         count(*)::int                      AS partner_count,
         count(DISTINCT p.keep_id)::int     AS operation_count,
         -- Rows whose programme published no budget at all. They count in
         -- partner_count and contribute ZERO to the money, so a surface dividing
         -- one by the other would mislead. 21 of 1,493 corpus-wide; no
         -- municipality is entirely unpublished, which is why the arm is only
         -- ever understated by a little — but 137 tracks budget_basis precisely
         -- so that "a little" can be said rather than assumed.
         count(*) FILTER (WHERE p.budget_basis = 'unpublished')::int
           AS unpublished_partner_count
    FROM interreg_partners p
   WHERE p.obshtina IS NOT NULL
     AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
   GROUP BY 1
)
SELECT i.obshtina,
       i.oblast_code,
       i.population,
       i.isun_eur,
       COALESCE(r.interreg_eur, 0)                    AS interreg_eur,
       i.isun_eur + COALESCE(r.interreg_eur, 0)       AS total_eur,
       COALESCE(r.partner_count, 0)                   AS partner_count,
       COALESCE(r.operation_count, 0)                 AS operation_count,
       COALESCE(r.unpublished_partner_count, 0)       AS unpublished_partner_count,
       (i.isun_eur + COALESCE(r.interreg_eur, 0)) / i.population AS per_capita_eur,
       i.isun_eur / i.population                      AS per_capita_eur_isun,
       -- rank(), not row_number(): two municipalities on the same €/жител are
       -- the same rank, and row_number() would order them arbitrarily and call
       -- it a difference.
       rank() OVER (ORDER BY (i.isun_eur + COALESCE(r.interreg_eur, 0)) / i.population DESC NULLS LAST)::int AS rank,
       rank() OVER (ORDER BY i.isun_eur / i.population DESC NULLS LAST)::int AS rank_before,
       -- The oblast cohort — the SAME quantity the ИСУН summary already
       -- publishes, recomputed with the Interreg arm added so the two are
       -- comparable. A NULL oblast_code cannot reach here (the CTE requires it),
       -- which matters because window PARTITION BY groups all NULLs into ONE
       -- partition — they would become a single national-sized pseudo-cohort
       -- rendered under a "в областта" label, not a cohort of one each.
       rank() OVER (PARTITION BY i.oblast_code
                    ORDER BY (i.isun_eur + COALESCE(r.interreg_eur, 0)) / i.population DESC NULLS LAST)::int
         AS oblast_rank,
       rank() OVER (PARTITION BY i.oblast_code
                    ORDER BY i.isun_eur / i.population DESC NULLS LAST)::int AS oblast_rank_before,
       count(*) OVER (PARTITION BY i.oblast_code)::int AS oblast_cohort_size
  FROM isun i
  LEFT JOIN interreg r USING (obshtina);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT SELECT ON funds_muni_combined_v TO app_readonly;';
  END IF;
END $$;

-- One municipality's combined figure, its rank, and how far the Interreg arm
-- moved it. NULL for a municipality outside the ranked cohort — the caller must
-- tell "not ranked" from "no money", so this does NOT degrade to zeros.
CREATE OR REPLACE FUNCTION funds_muni_combined(p_obshtina text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
  'obshtina',       v.obshtina,
  'population',     v.population,
  -- Both arms, always, and never only their sum. See the header.
  'isunEur',        v.isun_eur,
  'interregEur',    v.interreg_eur,
  'totalEur',       v.total_eur,
  'interregPartnerCount',   v.partner_count,
  'interregOperationCount', v.operation_count,
  'interregUnpublishedPartnerCount', v.unpublished_partner_count,
  'perCapitaEur',       v.per_capita_eur,
  'perCapitaEurIsun',   v.per_capita_eur_isun,
  'rank',           v.rank,
  -- What the rank was before Interreg was counted. A caller that renders only
  -- `rank` is correct; one that renders the movement needs both, and deriving
  -- `rankBefore` client-side would need the whole 256-row table.
  'rankBefore',     v.rank_before,
  'rankDelta',      v.rank_before - v.rank,
  'cohortSize',     (SELECT count(*)::int FROM funds_muni_combined_v),
  -- The oblast cohort — what MyAreaProjectsMapTile already renders. Kept
  -- separate from the national rank above; see the view header.
  'oblastCode',       v.oblast_code,
  'oblastRank',       v.oblast_rank,
  'oblastRankBefore', v.oblast_rank_before,
  'oblastRankDelta',  v.oblast_rank_before - v.oblast_rank,
  'oblastCohortSize', v.oblast_cohort_size
)
FROM funds_muni_combined_v v
WHERE v.obshtina = p_obshtina;
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION funds_muni_combined(text) TO app_readonly;';
  END IF;
END $$;

-- The leaderboard, plus what the ranking does NOT cover.
CREATE OR REPLACE FUNCTION funds_muni_combined_rank(p_limit int DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
  'cohortSize', (SELECT count(*)::int FROM funds_muni_combined_v),
  'movedCount', (SELECT count(*)::int FROM funds_muni_combined_v WHERE rank <> rank_before),
  'withInterregCount',
    (SELECT count(*)::int FROM funds_muni_combined_v WHERE interreg_eur > 0),
  -- The Interreg money the ranking cannot see, and why. Not decoration: it is
  -- 22.6% of the placed corpus, and a caption claiming the ranking covers the
  -- country would be wrong without it.
  'excluded', (
    SELECT jsonb_object_agg(reason, jsonb_build_object('rows', rows, 'eur', eur))
      FROM (
        -- Normalised the same way the view's join is, or Столична община would
        -- report as outsideCohort for ever — including on the day ГРАО publishes
        -- the Sofia city EKATTE and it actually enters the cohort.
        SELECT CASE WHEN p.obshtina IS NULL THEN 'unplaced'
                    WHEN (CASE WHEN p.obshtina = 'SFO_CITY' THEN 'S22'
                               ELSE p.obshtina END)
                         NOT IN (SELECT obshtina FROM funds_muni_combined_v)
                      THEN 'outsideCohort'
                    ELSE 'ranked' END                     AS reason,
               count(*)::int                              AS rows,
               COALESCE(SUM(p.budget_eur), 0)::double precision AS eur
          FROM interreg_partners p
         WHERE (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
         GROUP BY 1
      ) z),
  'munis', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'rank')::int, x->>'obshtina')
      FROM (
        SELECT jsonb_build_object(
                 'obshtina',     v.obshtina,
                 'population',   v.population,
                 'isunEur',      v.isun_eur,
                 'interregEur',  v.interreg_eur,
                 'totalEur',     v.total_eur,
                 'perCapitaEur', v.per_capita_eur,
                 'rank',         v.rank,
                 'rankBefore',   v.rank_before,
                 'rankDelta',    v.rank_before - v.rank) AS x
          FROM funds_muni_combined_v v
         ORDER BY v.rank, v.obshtina
         LIMIT GREATEST(p_limit, 1)
      ) t), '[]'::jsonb)
);
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION funds_muni_combined_rank(int) TO app_readonly;';
  END IF;
END $$;
