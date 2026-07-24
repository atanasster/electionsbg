-- 097_cohort_benchmark.sql — declared wealth relative to peers in the same office (T3.9).
--
-- A raw net-worth figure means little on its own: €300k is unremarkable for one office and
-- notable in another. The comparison that carries information is against PEOPLE HOLDING THE
-- SAME KIND OF OFFICE IN THE SAME YEAR — same filing rules, same form, same reporting year.
--
-- WHAT THIS IS NOT. It is not the accumulation gap (092). It makes no claim about where
-- anything came from and no claim of impropriety: it states that a person declared more than
-- N% of their peers, both figures being self-declared. That is why it is NOT gated to the
-- senior accountability cohort (091) the way the gap is — a percentile is a description of a
-- declared number, not a derived allegation. The §6 privacy gate still applies, as on every
-- person-serving surface (082, 090, 093, 096).
--
-- THREE RULES that keep the comparison honest:
--
--   1. SAME YEAR. Peers are drawn from the same period_year, never pooled across years.
--      Pooling would rank a 2011 filing against 2024 filings and read inflation as wealth.
--   2. A MINIMUM COHORT. Below 20 peers with wealth data in that year the percentile is
--      returned as NULL — with 6 peers, "83rd percentile" is one person, and the number
--      would be published against a name.
--   3. ONE COHORT PER PERSON, by explicit precedence. Someone who was both a minister and a
--      councillor is benchmarked against ministers; a person compared against whichever of
--      their offices flatters them is not being measured, and picking arbitrarily (a bare
--      min()) would make the published percentile depend on role insertion order.
--
-- NOT DELIVERED — the per-cabinet aggregate half of T3.9. Attributing a minister's declared
-- wealth to a SPECIFIC cabinet needs per-person office tenure, and person_role.start_date /
-- end_date are NULL on all 129,883 rows. Two substitutes were built and measured out:
--   · joining cabinets.start_date/end_date by calendar year cannot separate cabinets that
--     share one — five cabinets touch 2024, and glavchev-1 (Apr–Aug 2024) then claims 72
--     people, most of whom never served in it;
--   · matching an Entry filing's filed_at into the cabinet window gives counts that do not
--     correspond to real cabinet sizes at all (denkov 38, donev 44, petkov 4, zhelyazkov 5,
--     against an actual ~20).
-- Publishing "cabinet X was the wealthiest" off either would be a false claim about a named
-- government. It needs a tenure source we do not hold; see the T3.9 note in the plan.

-- ORDER MATTERS on a re-apply: person_cohort_wealth is built by calling person_cohort_key,
-- so the matview must be dropped BEFORE the function, or the DROP FUNCTION fails with 2BP01
-- and the migration only appears to succeed (psql continues past the error).
DROP MATERIALIZED VIEW IF EXISTS person_cohort_wealth CASCADE;

-- The cohort a person is benchmarked in, by explicit precedence (lowest number wins).
-- Anything not listed has no cohort and gets no percentile.
DROP FUNCTION IF EXISTS person_cohort_key(bigint);
CREATE OR REPLACE FUNCTION person_cohort_key(p_person_id bigint)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT k FROM (
    SELECT CASE
             WHEN r.source = 'official_exec' AND r.role = 'cabinet' THEN 'cabinet'
             WHEN r.source = 'official_exec' AND r.role = 'deputy_minister' THEN 'deputy_minister'
             WHEN r.source = 'mp' THEN 'mp'
             WHEN r.source = 'official_exec' AND r.role = 'regional_governor' THEN 'regional_governor'
             WHEN r.source = 'official_exec' AND r.role = 'agency_head' THEN 'agency_head'
             WHEN r.source = 'magistrate' THEN 'magistrate'
             WHEN r.source = 'official_muni' AND r.role = 'mayor' THEN 'mayor'
             WHEN r.source = 'official_muni' AND r.role = 'councillor' THEN 'councillor'
           END AS k,
           CASE
             WHEN r.source = 'official_exec' AND r.role = 'cabinet' THEN 1
             WHEN r.source = 'official_exec' AND r.role = 'deputy_minister' THEN 2
             WHEN r.source = 'mp' THEN 3
             WHEN r.source = 'official_exec' AND r.role = 'regional_governor' THEN 4
             WHEN r.source = 'official_exec' AND r.role = 'agency_head' THEN 5
             WHEN r.source = 'magistrate' THEN 6
             WHEN r.source = 'official_muni' AND r.role = 'mayor' THEN 7
             WHEN r.source = 'official_muni' AND r.role = 'councillor' THEN 8
           END AS prec
      FROM person_role r
     WHERE r.person_id = p_person_id
  ) c
   WHERE k IS NOT NULL
   ORDER BY prec
   LIMIT 1;
$$;

-- Every person-year that has BOTH a cohort and declared wealth. Materialised because the
-- percentile needs the whole distribution, and recomputing person_cohort_key per peer per
-- request would re-scan person_role for the entire cohort on every profile view.
-- (Dropped at the top of this file, before the function it depends on.)
CREATE MATERIALIZED VIEW person_cohort_wealth AS
SELECT w.person_id,
       w.period_year,
       person_cohort_key(w.person_id) AS cohort,
       -- ROUNDED here, once, so the figure published, the median, and the rank are all the
       -- SAME number. Ranking on full precision while publishing a rounded euro means the
       -- number a reader sees is not the number they were ranked on — and with negative net
       -- worth in the corpus (debts exceeding assets is real: −€63,564 on one 2024 filing)
       -- the sub-euro tail is exactly where an off-by-one rank comes from.
       round(w.net_eur) AS net_eur
  FROM person_wealth_year w
 WHERE person_cohort_key(w.person_id) IS NOT NULL;

CREATE UNIQUE INDEX person_cohort_wealth_pkey
  ON person_cohort_wealth (person_id, period_year);
CREATE INDEX idx_cohort_wealth_slice ON person_cohort_wealth (cohort, period_year);

-- One person's standing among peers, for their most recent year with declared wealth.
DROP FUNCTION IF EXISTS person_cohort_benchmark(text);
CREATE OR REPLACE FUNCTION person_cohort_benchmark(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure
     LIMIT 1
  ),
  mine AS (
    SELECT cw.person_id, cw.cohort, cw.period_year, cw.net_eur
      FROM person_cohort_wealth cw
      JOIN pick ON pick.person_id = cw.person_id
     ORDER BY cw.period_year DESC
     LIMIT 1
  ),
  peers AS (
    SELECT p.net_eur
      FROM person_cohort_wealth p
      JOIN mine ON mine.cohort = p.cohort AND mine.period_year = p.period_year
  )
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'cohort', m.cohort,
      'year', m.period_year,
      'netEur', round(m.net_eur),
      'peers', (SELECT count(*) FROM peers),
      'medianEur', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY net_eur))
                      FROM peers),
      -- Share of peers declaring strictly LESS. NULL below 20 peers: on a handful of people
      -- a percentile is one person's filing, published against a name.
      'percentile', CASE WHEN (SELECT count(*) FROM peers) >= 20 THEN
        round(100.0 * (SELECT count(*) FROM peers WHERE net_eur < m.net_eur)
                    / NULLIF((SELECT count(*) FROM peers) - 1, 0))
      END
    )
    FROM mine m
  ), 'null'::jsonb);
$$;
