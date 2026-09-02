-- 194_interreg_programme.sql — the per-PROGRAMME Interreg detail behind
-- /funds/interreg/programme/:code.
--
-- The grain between the national overview (138's `interreg_overview()`, which
-- returns only a top-N *summary* row per programme) and one operation
-- (138's `interreg_operation()`). `interreg_overview()`'s programme row answers
-- "how big is this programme"; this answers "what did it fund, and where" —
-- the two questions a reader actually has once they click a programme name.
--
-- SAME INVARIANT AS 138, restated here because a third serving function over
-- this corpus is exactly the place a copy-paste could drop it: **no money
-- aggregate crosses the operation↔partner join.** Every € here is
-- `SUM(interreg_partners.budget_eur)` over the Bulgarian partner rows of ONE
-- programme. `interreg_operations.total_budget_eur` is the whole cross-border
-- project and appears below only as a per-operation scalar, never summed.
--
-- BULGARIAN PARTNER ROWS ONLY, same as `interreg_overview()` — a programme's
-- Bulgarian budget share, not the whole programme's cross-border total (that
-- figure already exists, on `interreg_programmes`/keep.eu, and is not this
-- page's subject).
--
-- SERVED LIVE, not from a precompute. A programme's operation count tops out
-- at 169 (ИНТЕРРЕГ V-A Румъния — България 2014-2020) and its partner count in
-- the low thousands, so filtering `interreg_operations`/`interreg_partners` by
-- `programme_code` — already indexed by `idx_interreg_operations_programme`
-- (137) — is cheap without a matview.
--
-- 200 + a NULL programme, for an unknown code, matching `interreg_operation()`'s
-- convention: a route can then distinguish "no such programme" from a fetch
-- failure rather than surfacing both as the same error.
--
-- Depends on 137. SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

-- GRANTS ARE ROLE-GUARDED — see 137/138's header for why: roles_readonly.sql
-- is a one-time manual step, and a bare GRANT on a database without the role
-- raises 42704, which rolls the whole file back under exec()'s one-transaction
-- semantics.

CREATE OR REPLACE FUNCTION interreg_programme(
  p_code       text,
  p_op_limit   int DEFAULT 30,
  p_muni_limit int DEFAULT 15
) RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH bg AS (
  SELECT p.keep_id, p.budget_eur, p.budget_basis, p.eik, p.ekatte,
         -- SFO_CITY → S22: the ONE place this corpus and the rest of the site
         -- disagree on a code (139's header). Without this, Sofia's `munis`
         -- row below is keyed to a code /governance/:id and municipalities.json
         -- do not recognise — €22.9m of ROBG-1420 alone, its single largest
         -- municipality.
         CASE WHEN p.obshtina = 'SFO_CITY' THEN 'S22' ELSE p.obshtina END
           AS obshtina
    FROM interreg_partners p
    JOIN interreg_operations o USING (keep_id)
   WHERE o.programme_code = p_code
     AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
)
SELECT jsonb_build_object(
  'code',         g.code,
  'nameBg',       g.name_bg,
  'nameEn',       g.name_en,
  'period',       g.period,
  'cci',          g.cci,
  'eligibleNuts', to_jsonb(g.eligible_nuts),
  'coverageNote', g.coverage_note,
  -- Same shape as one entry of `interreg_overview().programmes`, scoped to
  -- this one code, so the two surfaces cannot disagree about a programme's
  -- own totals.
  'budgetEur',      (SELECT COALESCE(SUM(budget_eur), 0)::double precision FROM bg),
  'partnerCount',   (SELECT count(*)::int FROM bg),
  'operationCount', (SELECT count(DISTINCT keep_id)::int FROM bg),
  'placedCount',    (SELECT count(*) FILTER (WHERE ekatte IS NOT NULL)::int FROM bg),
  'linkedCount',    (SELECT count(*) FILTER (WHERE eik IS NOT NULL)::int FROM bg),
  'unpublishedPartnerCount',
    (SELECT count(*) FILTER (WHERE budget_basis = 'unpublished')::int FROM bg),
  -- Top operations in this programme by the Bulgarian budget share — same
  -- per-operation shape `interreg_by_place()` (138) already returns, so the
  -- client can render both with one row component.
  'operations', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'localBudgetEur')::double precision DESC NULLS LAST,
                                (x->>'keepId')::int)
      FROM (
        SELECT jsonb_build_object(
          'keepId',         o.keep_id,
          'operationId',    o.operation_id,
          'programmeCode',  g.code,
          'programmeBg',    g.name_bg,
          'programmeEn',    g.name_en,
          'period',         o.period,
          'titleEn',        o.title_en,
          'titleLang',      o.title_lang,
          'titleBg',        o.title_bg,
          'status',         o.status,
          'startDate',      o.start_date,
          'endDate',        o.end_date,
          -- The OPERATION total, as a per-row scalar for context. It is NEVER
          -- summed here — see the header.
          'operationTotalEur', o.total_budget_eur,
          'partnerCount',   o.partner_count,
          'countries',      to_jsonb(o.countries),
          'localBudgetEur', r.local_budget,
          'localBudgetBasis', r.local_basis
        ) AS x
        FROM (
          SELECT keep_id,
                 SUM(budget_eur)::double precision AS local_budget,
                 -- Same three-way basis fold as 138's operations lists — a
                 -- group holding both a published and an unpublished row reads
                 -- as 'partial' rather than silently as 'published'.
                 CASE WHEN bool_or(budget_basis = 'unpublished')
                       AND bool_or(budget_basis <> 'unpublished') THEN 'partial'
                      WHEN bool_or(budget_basis = 'published') THEN 'published'
                      WHEN bool_or(budget_basis = 'published_zero') THEN 'published_zero'
                      ELSE 'unpublished' END AS local_basis
            FROM bg GROUP BY keep_id
        ) r
        JOIN interreg_operations o USING (keep_id)
        ORDER BY r.local_budget DESC NULLS LAST, o.keep_id
        LIMIT GREATEST(p_op_limit, 1)
      ) t), '[]'::jsonb),
  -- Top municipalities THIS PROGRAMME reaches — the place-level companion to
  -- `operations` above, so a programme page can link out to
  -- /governance/:obshtina#myarea-interreg the same way the movers tile does.
  'munis', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'budgetEur')::double precision DESC NULLS LAST,
                                x->>'obshtina')
      FROM (
        SELECT jsonb_build_object(
                 'obshtina',       r.obshtina,
                 'budgetEur',      r.budget_eur,
                 'partnerCount',   r.partner_count,
                 'operationCount', r.operation_count) AS x
        FROM (
          SELECT obshtina,
                 COALESCE(SUM(budget_eur), 0)::double precision AS budget_eur,
                 count(*)::int                                  AS partner_count,
                 count(DISTINCT keep_id)::int                   AS operation_count
            FROM bg
           WHERE obshtina IS NOT NULL
           GROUP BY obshtina
        ) r
        ORDER BY r.budget_eur DESC NULLS LAST, r.obshtina
        LIMIT GREATEST(p_muni_limit, 1)
      ) t), '[]'::jsonb)
)
FROM interreg_programmes g
WHERE g.code = p_code;
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION interreg_programme(text, int, int) TO app_readonly';
  END IF;
END $$;
