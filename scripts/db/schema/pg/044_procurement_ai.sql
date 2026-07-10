-- Postgres serving functions for the AI chat's remaining procurement tools —
-- the last three that still fetched static bucket JSON (tenders/index.json,
-- derived/kzk_appeals_summary.json). Moving them onto Cloud SQL closes the
-- "tenders/index.json → 404" gap that appeared once the tenders corpus migrated
-- to the `tenders` table and its slim index JSON stopped being generated.
--
-- Two functions, both read-only, both over already-loaded tables:
--   * tender_corpus_search — the openTenders corpus path (topic/keyword/year),
--     with the SAME topic-match semantics as @/lib/tenderTopics.tenderMatchesTopic
--     (subject/CPV-description regex OR exact-CPV membership) that the year-shard
--     JSON drove, plus full-set aggregates (count, Σ estimate, cancelled, biggest)
--     the client can't get from the capped `table` route.
--   * kzk_appeals_summary — the corpus rollup behind procurementAppeals, a 1:1
--     port of scripts/procurement/build_kzk_summary.ts (totals + per-year +
--     top-25 most-appealed buyers with the modal buyer name).
--
-- Applied by scripts/db/load_tenders_pg.ts (after 042_kzk_appeals.sql — both
-- read `tenders`, and the summary reads `kzk_appeals`). EXECUTE auto-grants to
-- app_readonly. Apply to Cloud SQL (db:load:tenders:pg:cloud, or apply_functions.ts)
-- BEFORE functions:db — NOT db:dump, which only dumps outward to GCS
-- (functions/db_routes.js adds the tender-corpus-search / kzk-appeals-summary
-- routes that call these).

SET check_function_bodies = off;

-- openTenders corpus search. Every arg is nullable so one function serves the
-- topic path (p_cpv + p_pattern), the free-keyword path (p_keyword), and the
-- bare-year path (all three null → every procedure that year).
--
-- p_year_requested  the year the user asked for (nullable). Effective year =
--                   that year if it has any procedure, else the latest year in
--                   the corpus; both are returned so the caller can flag a miss.
-- p_cpv             topic CPV codes (exact match) — the discriminating set.
-- p_pattern         topic subject/CPV-description regex (POSIX ~*). Curated,
--                   server-controlled (from TENDER_TOPICS); a bound VALUE, never
--                   spliced as SQL. ReDoS is bounded by the route's statement
--                   timeout + READ ONLY tx, same posture as the trigram searches.
-- p_keyword         free substring (ILIKE) over subject / CPV description / buyer
--                   name — used only when no topic is supplied.
-- p_buyer_tokens    extra buyer-name tokens that must ALL appear (the org filter
--                   the corpus path layers on top of a topic/keyword).
DROP FUNCTION IF EXISTS tender_corpus_search(int, text[], text, text, text[], int);
CREATE OR REPLACE FUNCTION tender_corpus_search(
  p_year_requested int,
  p_cpv            text[],
  p_pattern        text,
  p_keyword        text,
  p_buyer_tokens   text[],
  p_limit          int DEFAULT 12
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_max_year int;
  v_year     int;
  v_result   jsonb;
BEGIN
  SELECT max(left(publication_date, 4)::int) INTO v_max_year FROM tenders;
  IF v_max_year IS NULL THEN
    RETURN jsonb_build_object(
      'year', NULL, 'yearRequested', p_year_requested, 'yearMissing', false,
      'matches', 0, 'totalEur', 0, 'cancelled', 0,
      'biggest', NULL, 'rows', '[]'::jsonb);
  END IF;
  -- Effective year: the requested year if it holds any procedure, else latest.
  IF p_year_requested IS NOT NULL
     AND EXISTS (SELECT 1 FROM tenders
                 WHERE left(publication_date, 4)::int = p_year_requested) THEN
    v_year := p_year_requested;
  ELSE
    v_year := v_max_year;
  END IF;

  WITH matched AS (
    SELECT unp, ocid, publication_date, buyer_name, subject,
           estimated_value_eur, lots_count, is_cancelled
    FROM tenders
    WHERE left(publication_date, 4)::int = v_year
      AND (
        -- topic branch: subject/CPV-description regex OR exact-CPV membership.
        (
          (p_pattern IS NOT NULL OR cardinality(p_cpv) > 0)
          AND (
            (p_pattern IS NOT NULL
             AND (subject ~* p_pattern OR coalesce(cpv_desc, '') ~* p_pattern))
            OR (cardinality(p_cpv) > 0 AND cpv = ANY (p_cpv))
          )
        )
        -- free-keyword branch (only when no topic).
        OR (
          p_pattern IS NULL AND cardinality(p_cpv) = 0 AND p_keyword IS NOT NULL
          AND (subject ILIKE '%' || p_keyword || '%'
               OR coalesce(cpv_desc, '') ILIKE '%' || p_keyword || '%'
               OR buyer_name ILIKE '%' || p_keyword || '%')
        )
        -- neither topic nor keyword → every procedure that year.
        OR (p_pattern IS NULL AND cardinality(p_cpv) = 0 AND p_keyword IS NULL)
      )
      AND (
        cardinality(p_buyer_tokens) = 0
        OR (SELECT bool_and(buyer_name ILIKE '%' || tok || '%')
            FROM unnest(p_buyer_tokens) tok)
      )
  ),
  ranked AS (
    SELECT * FROM matched ORDER BY estimated_value_eur DESC NULLS LAST, unp LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'year', v_year,
    'yearRequested', p_year_requested,
    'yearMissing', p_year_requested IS NOT NULL AND p_year_requested <> v_year,
    'matches', (SELECT count(*) FROM matched),
    'totalEur', (SELECT COALESCE(ROUND(SUM(estimated_value_eur)), 0) FROM matched),
    'cancelled', (SELECT count(*) FROM matched WHERE is_cancelled),
    'biggest', (
      SELECT jsonb_build_object('subject', subject, 'estimatedValueEur', estimated_value_eur)
      FROM matched ORDER BY estimated_value_eur DESC NULLS LAST, unp LIMIT 1
    ),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'unp', unp, 'ocid', ocid, 'publicationDate', publication_date,
        'buyerName', buyer_name, 'subject', subject,
        'estimatedValueEur', estimated_value_eur,
        'lotsCount', lots_count, 'isCancelled', is_cancelled
      )) FROM ranked), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- Corpus rollup for procurementAppeals — a 1:1 port of build_kzk_summary.ts.
-- totals (complaints / resolvedToTender = exact matches / withOutcome / upheld /
-- rejected / suspended), per-year complaint counts, and the top-25 most-appealed
-- buyers (resolved to a tender buyer only), each labelled by its MODAL buyer name
-- (highest-frequency spelling, ties broken by the longer string).
DROP FUNCTION IF EXISTS kzk_appeals_summary();
CREATE OR REPLACE FUNCTION kzk_appeals_summary()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT a.complaint_date, a.match, a.outcome,
           COALESCE(a.suspension, a.status ~* 'спрян') AS suspended,
           a.buyer_eik,
           -- canonical buyer name preferred (tenders corpus), else КЗК respondent.
           COALESCE(t.buyer_name, a.respondent, a.buyer_eik) AS bname
    FROM kzk_appeals a
    LEFT JOIN tenders t ON t.unp = a.unp
  ),
  totals AS (
    SELECT count(*)                                           AS complaints,
           count(*) FILTER (WHERE match = 'exact')            AS resolved,
           count(*) FILTER (WHERE outcome IS NOT NULL)        AS with_outcome,
           count(*) FILTER (WHERE outcome = 'уважена')        AS upheld,
           count(*) FILTER (WHERE outcome = 'отхвърлена')     AS rejected,
           count(*) FILTER (WHERE suspended)                  AS suspended
    FROM base
  ),
  by_year AS (
    SELECT jsonb_object_agg(y, c) AS obj FROM (
      SELECT left(complaint_date, 4) AS y, count(*) AS c
      FROM base WHERE complaint_date ~ '^[0-9]{4}'
      GROUP BY 1
    ) q
  ),
  name_counts AS (
    SELECT buyer_eik, bname, count(*) AS n
    FROM base WHERE buyer_eik IS NOT NULL AND buyer_eik <> ''
    GROUP BY buyer_eik, bname
  ),
  modal AS (
    SELECT DISTINCT ON (buyer_eik) buyer_eik, bname
    FROM name_counts ORDER BY buyer_eik, n DESC, length(bname) DESC
  ),
  buyers AS (
    SELECT b.buyer_eik AS eik, m.bname AS name,
           count(*)::int AS cnt,
           count(*) FILTER (WHERE b.outcome = 'уважена')::int AS upheld
    FROM base b JOIN modal m ON m.buyer_eik = b.buyer_eik
    WHERE b.buyer_eik IS NOT NULL AND b.buyer_eik <> ''
    GROUP BY b.buyer_eik, m.bname
    ORDER BY cnt DESC, upheld DESC, b.buyer_eik
    LIMIT 25
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'complaints',        (SELECT complaints   FROM totals),
      'resolvedToTender',  (SELECT resolved     FROM totals),
      'withOutcome',       (SELECT with_outcome FROM totals),
      'upheld',            (SELECT upheld       FROM totals),
      'rejected',          (SELECT rejected     FROM totals),
      'suspended',         (SELECT suspended    FROM totals)
    ),
    'byYear', COALESCE((SELECT obj FROM by_year), '{}'::jsonb),
    'topBuyers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eik', eik, 'name', name, 'count', cnt, 'upheld', upheld))
      FROM buyers), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION tender_corpus_search(int, text[], text, text, text[], int) TO app_readonly;
GRANT EXECUTE ON FUNCTION kzk_appeals_summary() TO app_readonly;
