-- TED — Tenders Electronic Daily (plan P10). The EU publication of record for
-- above-threshold procurement, used here as a COMPLETENESS CROSS-CHECK on the
-- national corpus: a notice here with no national counterpart is either a gap in
-- our ingest or a procedure that never reached the Bulgarian register, and
-- neither is visible from inside our own data.
--
-- ⚠️ `buyer_eik` IS WHAT MAKES THIS JOINABLE, and it is unusually clean:
-- measured 100% of Bulgarian notices carry one, matching `contracts.awarder_eik`
-- exactly. Comparing by buyer NAME instead would reintroduce the matching
-- problem the rest of this repo exists to avoid.
--
-- ⚠️ EARLY YEARS ARE AN INDEX RAMP, NOT A TREND. TED's v3 index returns 0
-- notices for 2015 and 4,687 for 2016 against ~17,000 for 2019 — the API's
-- coverage deepening, not Bulgarian procurement growing fourfold. `ted_coverage`
-- exists so no surface can plot a year-over-year series off this table without
-- being able to see where the data actually begins.

CREATE TABLE IF NOT EXISTS ted_notice (
  publication_number text PRIMARY KEY,
  publication_date   date,
  -- The buyer's ЕИК, join key to contracts.awarder_eik.
  buyer_eik          text,
  buyer_name         text,
  notice_type        text,
  contract_nature    text,
  procedure_type     text,
  cpv                text,
  total_value        double precision,
  loaded_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ted_notice_buyer ON ted_notice (buyer_eik);
CREATE INDEX IF NOT EXISTS idx_ted_notice_date  ON ted_notice (publication_date);

/* Per-year counts, so the index ramp is legible rather than inferred. */
CREATE TABLE IF NOT EXISTS ted_coverage (
  year     int PRIMARY KEY,
  notices  int NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON ted_notice, ted_coverage TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — ted_notice/ted_coverage ship with no ACL.';
  END IF;
END $$;

-- Which buyers appear in TED and how they compare to the national corpus.
--
-- ⚠️ SCOPED TO A YEAR RANGE BY THE CALLER, never defaulted to „all". The ramp
-- above means an all-time comparison silently mixes years TED barely indexed
-- with years it fully did, and the resulting „missing from our corpus" figure
-- would be dominated by the API's own history.
/* A 13-digit ЕИК is a 9-digit parent plus a 4-digit BRANCH suffix. The same rule
   `scripts/funds/eik.ts` applies to the ИСУН export.

   ⚠️ THIS IS NOT COSMETIC — without it the reconciliation manufactures exactly
   the finding it exists to detect. TED files ЕСО's regional districts under
   their branch numbers (1752013040134 = 175201304 + 0134) while our corpus
   awards them all under the parent 175201304. Measured on 2024: of 318 TED
   buyers with „no contract in our corpus", **252 were branches whose parent
   awards 920 contracts that year**. Reported raw, that is 252 false claims that
   a public buyer's procurement is missing from the national register. */
CREATE OR REPLACE FUNCTION ted_eik_parent(p_eik text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN p_eik ~ '^[0-9]{13}$' THEN left(p_eik, 9) ELSE p_eik END;
$$;

-- Which buyers appear in TED and how they compare to the national corpus.
--
-- ⚠️ SCOPED TO A YEAR RANGE BY THE CALLER, never defaulted to „all". TED's index
-- ramp (see the header) means an all-time comparison silently mixes years it
-- barely indexed with years it fully did, and the „missing from our corpus"
-- figure would be dominated by the API's own history rather than by procurement.
CREATE OR REPLACE FUNCTION ted_buyer_reconciliation(p_from date, p_to date)
RETURNS TABLE (
  buyer_eik text,
  buyer_name text,
  ted_notices bigint,
  our_contracts bigint
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  -- Fold to the parent FIRST, then group. Referencing the un-grouped
  -- `t.buyer_eik` inside the correlated subquery raises „subquery uses ungrouped
  -- column"; a CTE keeps the fold in one place and the aggregate honest.
  WITH folded AS (
    SELECT ted_eik_parent(t.buyer_eik) AS eik, t.buyer_name
      FROM ted_notice t
     WHERE t.buyer_eik IS NOT NULL
       AND t.publication_date >= p_from AND t.publication_date <= p_to
  )
  SELECT f.eik,
         min(f.buyer_name),
         count(*)::bigint,
         (SELECT count(*)::bigint FROM contracts c
           WHERE c.tag = 'contract'
             AND c.awarder_eik = f.eik
             -- ⚠️ `contracts.date` is TEXT, not date — the same shape as
             -- `tenders.publication_date`. Comparing it to a date parameter
             -- raises „operator does not exist: text >= date", so the cast is
             -- on the COLUMN; the ISO ordering makes it exact.
             AND c.date::date >= p_from AND c.date::date <= p_to)
    FROM folded f
   GROUP BY f.eik
   ORDER BY count(*) DESC;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION ted_buyer_reconciliation(date, date) TO app_readonly;
    GRANT EXECUTE ON FUNCTION ted_eik_parent(text) TO app_readonly;
  END IF;
END $$;
