-- 138_interreg_serving.sql — the two serving functions over the Interreg corpus
-- (137): one keyed by PLACE, one keyed by EIK.
--
-- THE INVARIANT THESE FUNCTIONS EXIST TO HONOUR, and the reason they are worth
-- reading before writing a third: **no money aggregate crosses the
-- operation↔partner join.** Every € here is `SUM(interreg_partners.budget_eur)`
-- over the rows of ONE place or ONE company. `interreg_operations.total_budget_eur`
-- is the whole cross-border project — on BSB00963 it is €1,419,207.76 against
-- Малко Търново's €357,183.12 — so summing it per place would put ~4x the true
-- money on a 2,628-person municipality. It appears below ONLY as a per-operation
-- scalar in the operation list, never inside an aggregate.
-- `interreg.data.test.ts` gate 4 reads these bodies out of pg_get_functiondef
-- and fails on any `sum(... total_budget_eur ...)` alongside a place column.
--
-- SERVED LIVE, not from a precompute and NOT from fund_payloads. ~1,954
-- operations and ~12,141 partner rows is small enough that a per-place
-- aggregate is an index scan (measured below), and `fund_payloads` would be
-- silently erased by the next `db:load:funds:pg` — its stage merge runs an
-- unscoped anti-join DELETE and its parity guard would still pass.
--
-- COVERAGE IS PARTIAL BY CONSTRUCTION and every surface must be able to say so:
--   * `placedShare` — 98.4% of Bulgarian partner rows carry an EKATTE; the rest
--     are honestly unplaced rather than guessed.
--   * `unpublishedCount` — rows whose programme published no budget at all
--     (21 of 1,493). They count in operations and contribute ZERO to money.
--   * `linkedShare` on the EIK side — the 2014-2020 template carries NO national
--     id, so /company/:eik can only ever show the 2021-2027 third of the corpus.
--
-- Depends on 137. SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

-- Every Interreg euro attributed to one place, plus the operations behind it.
--
-- `p_ekatte` wins over `p_obshtina` when both are given, so the answer is always
-- about exactly one place.
CREATE OR REPLACE FUNCTION interreg_by_place(
  p_ekatte   text DEFAULT NULL,
  p_obshtina text DEFAULT NULL,
  p_limit    int  DEFAULT 20
) RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH rows AS (
  SELECT p.keep_id, p.partner_seq, p.partner_name, p.eik,
         p.budget_eur, p.budget_basis, p.is_lead, p.place_basis
    FROM interreg_partners p
   WHERE (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
     AND CASE WHEN p_ekatte IS NOT NULL THEN p.ekatte = p_ekatte
              ELSE p.obshtina = p_obshtina END
), agg AS (
  -- SUM over the PARTNER column. Never o.total_budget_eur.
  SELECT count(*)::int                                        AS partner_count,
         count(DISTINCT keep_id)::int                         AS operation_count,
         COALESCE(SUM(budget_eur), 0)::double precision       AS budget_eur,
         count(*) FILTER (WHERE budget_basis = 'unpublished')::int AS unpublished_count,
         count(*) FILTER (WHERE eik IS NOT NULL)::int         AS linked_count
    FROM rows
)
SELECT jsonb_build_object(
  'partnerCount',     (SELECT partner_count FROM agg),
  'operationCount',   (SELECT operation_count FROM agg),
  'budgetEur',        (SELECT budget_eur FROM agg),
  -- Plan §3.1: every surface must be able to say "N operations, of which M
  -- carry a published budget". This is the N minus M.
  'unpublishedCount', (SELECT unpublished_count FROM agg),
  'linkedCount',      (SELECT linked_count FROM agg),
  'operations', COALESCE((
    SELECT jsonb_agg(x ORDER BY x->>'budgetEur' IS NULL, (x->>'budgetEur')::double precision DESC NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'keepId',        o.keep_id,
          'operationId',   o.operation_id,
          'programmeCode', o.programme_code,
          'programmeBg',   g.name_bg,
          'programmeEn',   g.name_en,
          'period',        o.period,
          'titleEn',       o.title_en,
          -- keep.eu publishes titles in English only, and its language
          -- detection files two of them under mt/it. The BG side renders the
          -- English title with a marker rather than inventing a translation.
          'titleLang',     o.title_lang,
          'titleBg',       o.title_bg,
          'status',        o.status,
          'startDate',     o.start_date,
          'endDate',       o.end_date,
          -- The OPERATION total, as a per-row scalar for context. It is NEVER
          -- summed here — see the header.
          'operationTotalEur', o.total_budget_eur,
          'partnerCount',  o.partner_count,
          'countries',     to_jsonb(o.countries),
          -- What THIS place got. The number every money surface must use.
          'localBudgetEur', r.local_budget,
          'localBudgetBasis', r.local_basis,
          'localPartners', r.local_partners
        ) AS x
        FROM (
          SELECT keep_id,
                 SUM(budget_eur)::double precision AS local_budget,
                 -- 'published' if any row has money; else whichever single
                 -- basis they share. A place with one unpublished partner must
                 -- read as unpublished, not as €0.
                 CASE WHEN bool_or(budget_basis = 'published') THEN 'published'
                      WHEN bool_or(budget_basis = 'published_zero') THEN 'published_zero'
                      ELSE 'unpublished' END AS local_basis,
                 jsonb_agg(jsonb_build_object(
                   'name', partner_name, 'eik', eik, 'isLead', is_lead,
                   'budgetEur', budget_eur, 'budgetBasis', budget_basis,
                   'placeBasis', place_basis) ORDER BY budget_eur DESC NULLS LAST)
                   AS local_partners
            FROM rows GROUP BY keep_id
        ) r
        JOIN interreg_operations o USING (keep_id)
        JOIN interreg_programmes g ON g.code = o.programme_code
        ORDER BY r.local_budget DESC NULLS LAST, o.keep_id
        LIMIT GREATEST(p_limit, 1)
      ) t), '[]'::jsonb)
);
$$;
GRANT EXECUTE ON FUNCTION interreg_by_place(text, text, int) TO app_readonly;

-- Every Interreg euro attributed to one company or institution, by EIK.
--
-- TIER L ONLY, and the caller must say so. keep.eu's national-id field exists
-- only in the 2021-2027 template — 0 of 1,080 Bulgarian 2014-2020 partner rows
-- carry one, against 336 of 413 — so this answers for roughly a third of the
-- corpus and returns nothing for the rest. That is not an absence of money.
CREATE OR REPLACE FUNCTION interreg_by_eik(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH rows AS (
  SELECT p.keep_id, p.partner_name, p.budget_eur, p.budget_basis,
         p.is_lead, p.ekatte, p.obshtina
    FROM interreg_partners p
   WHERE p.eik = p_eik
)
SELECT jsonb_build_object(
  'partnerCount',   (SELECT count(*)::int FROM rows),
  'operationCount', (SELECT count(DISTINCT keep_id)::int FROM rows),
  -- Again: SUM over the partner's OWN budget.
  'budgetEur',      (SELECT COALESCE(SUM(budget_eur), 0)::double precision FROM rows),
  'unpublishedCount',
    (SELECT count(*) FILTER (WHERE budget_basis = 'unpublished')::int FROM rows),
  'operations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'keepId',        o.keep_id,
             'operationId',   o.operation_id,
             'programmeCode', o.programme_code,
             'programmeBg',   g.name_bg,
             'period',        o.period,
             'titleEn',       o.title_en,
             'titleLang',     o.title_lang,
             'status',        o.status,
             'startDate',     o.start_date,
             'endDate',       o.end_date,
             'isLead',        r.is_lead,
             'budgetEur',     r.budget_eur,
             'budgetBasis',   r.budget_basis
           ) ORDER BY r.budget_eur DESC NULLS LAST, o.keep_id)
      FROM rows r
      JOIN interreg_operations o USING (keep_id)
      JOIN interreg_programmes g ON g.code = o.programme_code), '[]'::jsonb)
);
$$;
GRANT EXECUTE ON FUNCTION interreg_by_eik(text) TO app_readonly;
