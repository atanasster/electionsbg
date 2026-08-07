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
--   * `unpublishedPartnerCount` — PARTNER ROWS whose programme published no
--     budget at all (21 of 1,493). They count in operations and contribute ZERO
--     to money. The name says "partner" because it is not an operation count and
--     a caption built from it as one is a wrong sentence.
--   * `linkedCount` on the place side — how many of `partnerCount` carry an EIK.
--   * `periods` on the EIK side — the 2014-2020 template carries NO national id
--     (0 of 1,080 rows, against 336 of 413), so an EIK answer is at best the
--     2021-2027 third of that organisation's Interreg money. `periods` names
--     which period the returned € actually covers, so a caller can never render
--     a Tier-L partial as a complete total.
--
-- Depends on 137. SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

-- GRANTS ARE ROLE-GUARDED, and that became load-bearing the moment this file
-- joined load_interreg_pg.ts's SCHEMA_FILES: roles_readonly.sql is a one-time
-- manual step, and a bare GRANT on a database without the role raises 42704 —
-- which, because exec() sends a migration as one implicit transaction, rolls the
-- whole file back and aborts the loader. Same shape as 117/130/137.

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
         count(*) FILTER (WHERE budget_basis = 'unpublished')::int AS unpublished_partner_count,
         count(*) FILTER (WHERE eik IS NOT NULL)::int         AS linked_count
    FROM rows
)
SELECT jsonb_build_object(
  'partnerCount',     (SELECT partner_count FROM agg),
  'operationCount',   (SELECT operation_count FROM agg),
  'budgetEur',        (SELECT budget_eur FROM agg),
  -- PARTNER rows whose programme published no budget, NOT operations — the
  -- name says which, because a caption reading "8 unpublished operations" off a
  -- row count is a wrong sentence built from a right number.
  'unpublishedPartnerCount', (SELECT unpublished_partner_count FROM agg),
  'linkedCount',      (SELECT linked_count FROM agg),
  'operations', COALESCE((
    -- ORDER BY the key the object ACTUALLY has. The first draft sorted on
    -- `budgetEur`, which this object does not carry (it is `localBudgetEur`),
    -- so both sort expressions were constant NULL and the whole outer ordering
    -- was inert — output stayed descending only because tuplesort short-circuits
    -- on already-sorted input. The keepId tiebreak is not optional: Sofia's tail
    -- is full of round €200,000 values that would otherwise tie arbitrarily.
    SELECT jsonb_agg(x ORDER BY (x->>'localBudgetEur')::double precision DESC NULLS LAST,
                                (x->>'keepId')::int)
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
                 -- 'partial' FIRST: a group holding both a published row and
                 -- an unpublished one has money we can see and money we cannot,
                 -- and reporting 'published' would assert the figure is complete
                 -- when a sibling's budget is simply unknown. Not reachable in
                 -- today's corpus at this grain, but budget_basis is not a
                 -- programme-level property — INTERREG-BSB-1420 already mixes
                 -- published and unpublished across its 46 Bulgarian rows.
                 CASE WHEN bool_or(budget_basis = 'unpublished')
                       AND bool_or(budget_basis <> 'unpublished') THEN 'partial'
                      WHEN bool_or(budget_basis = 'published') THEN 'published'
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
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION interreg_by_place(text, text, int) TO app_readonly;';
  END IF;
END $$;

-- Every Interreg euro attributed to one company or institution, by EIK.
--
-- TIER L ONLY, and the caller must say so. keep.eu's national-id field exists
-- only in the 2021-2027 template — 0 of 1,080 Bulgarian 2014-2020 partner rows
-- carry one, against 336 of 413 — so this answers for roughly a third of the
-- corpus and returns nothing for the rest. That is not an absence of money.
CREATE OR REPLACE FUNCTION interreg_by_eik(p_eik text, p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH rows AS (
  SELECT p.keep_id, p.partner_name, p.budget_eur, p.budget_basis,
         p.is_lead, p.ekatte, p.obshtina
    FROM interreg_partners p
    JOIN interreg_operations o USING (keep_id)
   WHERE p.eik = p_eik
     -- SCOPED TO BULGARIA, exactly as interreg_by_place is. `eik` holds whatever
     -- national id keep.eu published, for every country — 196 distinct foreign
     -- ids, 321 of which are 9 digits and so indistinguishable from an EIK by
     -- shape. Two collide EXACTLY with a live `tr_companies.uic`: 204426451 and
     -- 204911337 are Georgian bodies whose budgets would otherwise publish on a
     -- Bulgarian company's page under that company's name. That is
     -- `feedback_name_match_not_identity` reached through a shared id namespace
     -- instead of a shared name, and the fix is the same: scope, do not guess.
     AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
)
SELECT jsonb_build_object(
  'partnerCount',   (SELECT count(*)::int FROM rows),
  'operationCount', (SELECT count(DISTINCT keep_id)::int FROM rows),
  -- Again: SUM over the partner's OWN budget.
  'budgetEur',      (SELECT COALESCE(SUM(budget_eur), 0)::double precision FROM rows),
  'unpublishedPartnerCount',
    (SELECT count(*) FILTER (WHERE budget_basis = 'unpublished')::int FROM rows),
  -- THE TIER-L DISCRIMINATOR, and the reason this is not just a caption problem.
  -- An organisation active in both periods gets only its 2021-2027 half back —
  -- Община Гоце Делчев (000024745) has 7 further 2014-2020 rows worth
  -- €1,665,237.72 under the identical partner_name with a NULL eik. Serving
  -- `budgetEur` alone would understate it by that much and call it a total. A
  -- caller that sees {"2021-2027": …} and no "2014-2020" key knows the answer is
  -- period-limited by the SOURCE, not by the organisation.
  'periods', COALESCE((
    SELECT jsonb_object_agg(period, jsonb_build_object(
             'operationCount', op_count, 'budgetEur', budget))
      FROM (
        SELECT o.period,
               count(DISTINCT r.keep_id)::int                  AS op_count,
               COALESCE(SUM(r.budget_eur), 0)::double precision AS budget
          FROM rows r JOIN interreg_operations o USING (keep_id)
         GROUP BY o.period
      ) z), '{}'::jsonb),
  'operations', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'budgetEur')::double precision DESC NULLS LAST,
                                (x->>'keepId')::int)
      FROM (
        SELECT jsonb_build_object(
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
           ) AS x
        FROM rows r
        JOIN interreg_operations o USING (keep_id)
        JOIN interreg_programmes g ON g.code = o.programme_code
        -- Bounded like the place side. 13 is today's worst case, so this is a
        -- ceiling against a future re-import rather than a live truncation.
        ORDER BY r.budget_eur DESC NULLS LAST, o.keep_id
        LIMIT GREATEST(p_limit, 1)
      ) t), '[]'::jsonb)
);
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION interreg_by_eik(text, int) TO app_readonly;';
  END IF;
END $$;
DROP FUNCTION IF EXISTS interreg_by_eik(text);

-- The national Interreg picture: totals, the programme breakdown, and the
-- period split that governs what can be linked to a legal entity.
--
-- BULGARIAN PARTNER BUDGETS ONLY. The corpus holds all ~12,141 partner rows so
-- an operation reads as cross-border on its page, but every € here is a row that
-- is Bulgarian — summing the foreign partners would state a number about other
-- countries' money under a Bulgarian heading.
CREATE OR REPLACE FUNCTION interreg_overview(p_limit int DEFAULT 12)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH bg AS (
  SELECT p.keep_id, p.budget_eur, p.budget_basis, p.eik, p.ekatte,
         o.period, o.programme_code
    FROM interreg_partners p
    JOIN interreg_operations o USING (keep_id)
   WHERE p.country = 'Bulgaria' OR p.country_department = 'Bulgaria'
)
SELECT jsonb_build_object(
  'budgetEur',      (SELECT COALESCE(SUM(budget_eur), 0)::double precision FROM bg),
  'partnerCount',   (SELECT count(*)::int FROM bg),
  'operationCount', (SELECT count(DISTINCT keep_id)::int FROM bg),
  'programmeCount', (SELECT count(DISTINCT programme_code)::int FROM bg),
  'placedCount',    (SELECT count(*) FILTER (WHERE ekatte IS NOT NULL)::int FROM bg),
  'unpublishedPartnerCount',
    (SELECT count(*) FILTER (WHERE budget_basis = 'unpublished')::int FROM bg),
  -- THE PERIOD SPLIT IS THE HEADLINE CAVEAT, not a detail. keep.eu's national-id
  -- field exists only in the 2021-2027 template, so `linkedCount` is ~0 for
  -- 2014-2020 by construction — roughly two thirds of this money can be
  -- attributed to a PLACE but never to a company. Any surface that offers an
  -- entity view must read this before implying coverage it cannot have.
  'periods', COALESCE((
    SELECT jsonb_object_agg(period, jsonb_build_object(
             'budgetEur', eur, 'partnerCount', n,
             'operationCount', ops, 'linkedCount', linked))
      FROM (
        SELECT period,
               COALESCE(SUM(budget_eur), 0)::double precision AS eur,
               count(*)::int                                  AS n,
               count(DISTINCT keep_id)::int                   AS ops,
               count(*) FILTER (WHERE eik IS NOT NULL)::int    AS linked
          FROM bg GROUP BY period
      ) z), '{}'::jsonb),
  -- Per-OBLAST, for the regional per-capita answers. Those rank oblasts on
  -- ИСУН money alone, and ИСУН holds no Interreg at all — so the border oblasts
  -- (Видин, Монтана, Добрич, Кюстендил, Хасково) were being ranked on a corpus
  -- that structurally excludes the one instrument aimed at them. Keyed by the
  -- 3-letter oblast code the funds muni-map aggregates on.
  'oblasts', COALESCE((
    SELECT jsonb_object_agg(oblast, jsonb_build_object(
             'budgetEur', eur, 'partnerCount', n, 'operationCount', ops))
      FROM (
        SELECT p.oblast,
               COALESCE(SUM(p.budget_eur), 0)::double precision AS eur,
               count(*)::int                                    AS n,
               count(DISTINCT p.keep_id)::int                   AS ops
          FROM interreg_partners p
         WHERE p.oblast IS NOT NULL
           AND (p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')
         GROUP BY p.oblast
      ) y), '{}'::jsonb),
  'programmes', COALESCE((
    SELECT jsonb_agg(x ORDER BY (x->>'budgetEur')::double precision DESC NULLS LAST,
                                x->>'code')
      FROM (
        SELECT jsonb_build_object(
                 'code',           b.programme_code,
                 'nameBg',         g.name_bg,
                 'nameEn',         g.name_en,
                 'period',         g.period,
                 'budgetEur',      COALESCE(SUM(b.budget_eur), 0)::double precision,
                 'partnerCount',   count(*)::int,
                 'operationCount', count(DISTINCT b.keep_id)::int) AS x
          FROM bg b
          JOIN interreg_programmes g ON g.code = b.programme_code
         GROUP BY b.programme_code, g.name_bg, g.name_en, g.period
         ORDER BY COALESCE(SUM(b.budget_eur), 0) DESC NULLS LAST, b.programme_code
         LIMIT GREATEST(p_limit, 1)
      ) t), '[]'::jsonb)
);
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION interreg_overview(int) TO app_readonly';
  END IF;
END $$;
