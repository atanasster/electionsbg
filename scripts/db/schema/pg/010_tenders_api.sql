-- Tenders live-serving API — the PG functions the /api/db tenders routes call
-- (dev Vite plugin + the `db` Cloud Function). These complete the procurement
-- lifecycle in one query: a procedure (tender) LEFT-joined to the signed
-- contract(s) it produced (tenders.ocid = contracts.ocid), so the awarder page
-- can show forecast (прогнозна стойност) vs actual awarded spend, "was it
-- competitively tendered / did it get awarded", cancelled procedures, and the
-- per-buyer pipeline that is NOT statically served anywhere.
--
-- QUARANTINE: estimated_value_eur is a FORECAST — surfaced as such, never summed
-- into awarded totals (awarded_eur comes from the contracts side). Awarded value
-- uses the contract-only rule (tag='contract'), matching the company summary.
--
-- Depends on both `tenders` (009) and `contracts` (001). EXECUTE is granted to
-- app_readonly via ALTER DEFAULT PRIVILEGES (roles_readonly.sql).

-- Defer body validation to call time so these create even if `contracts` isn't
-- loaded yet (tenders serving is meaningless without it, but the load shouldn't
-- hard-fail on ordering). Real usage always has contracts loaded first.
SET check_function_bodies = off;

-- Dropped first so a signature/return-type change re-creates cleanly on reload.
DROP FUNCTION IF EXISTS tenders_buyer_summary(text);
DROP FUNCTION IF EXISTS tenders_by_buyer(text, int);
DROP FUNCTION IF EXISTS tenders_by_buyer(text, int, text);
DROP FUNCTION IF EXISTS tender_awards(text);

-- One-row aggregate pipeline summary for a buyer (contracting authority).
CREATE OR REPLACE FUNCTION tenders_buyer_summary(p_eik text)
RETURNS TABLE(
  procedures         integer,
  cancelled          integer,
  with_estimate      integer,
  forecast_eur       double precision,
  awarded_procedures integer,
  awarded_eur        double precision,
  first_day          text,
  last_day           text
) LANGUAGE sql STABLE AS $$
  SELECT
    count(*)::int                                             AS procedures,
    (count(*) FILTER (WHERE t.is_cancelled))::int             AS cancelled,
    (count(*) FILTER (WHERE t.estimated_value_eur IS NOT NULL))::int AS with_estimate,
    coalesce(sum(t.estimated_value_eur), 0)              AS forecast_eur,
    (count(*) FILTER (WHERE a.awarded_eur IS NOT NULL))::int  AS awarded_procedures,
    coalesce(sum(a.awarded_eur), 0)                      AS awarded_eur,
    min(t.publication_date)                              AS first_day,
    max(t.publication_date)                              AS last_day
  FROM tenders t
  LEFT JOIN LATERAL (
    SELECT sum(c.amount_eur) FILTER (WHERE c.tag = 'contract') AS awarded_eur
    FROM contracts c
    WHERE t.ocid IS NOT NULL AND c.ocid = t.ocid
  ) a ON true
  WHERE t.buyer_eik = p_eik;
$$;

-- Procedures for a buyer, each with the awarded value (if a contract has been
-- signed) so the FE can render forecast → actual per row. p_sort='date'
-- (default) is newest-first, for the recent-activity views; 'value' is
-- forecast-value-descending, for a buyer's biggest-ticket pipeline (e.g. the
-- roads dashboard's "planned procurements" tile). Row set is pre-filtered to
-- one buyer_eik (idx_tenders_buyer), so an in-memory sort is cheap even for
-- the busiest buyers — no composite index needed.
CREATE OR REPLACE FUNCTION tenders_by_buyer(p_eik text, p_limit int, p_sort text DEFAULT 'date')
RETURNS TABLE(
  unp             text,
  ocid            text,
  publication_date text,
  subject         text,
  procedure_type  text,
  cpv             text,
  cpv_desc        text,
  forecast_eur    double precision,
  currency        text,
  lots_count      integer,
  is_cancelled    boolean,
  awarded_eur     double precision,
  award_contracts integer
) LANGUAGE sql STABLE AS $$
  SELECT
    t.unp, t.ocid, t.publication_date, t.subject, t.procedure_type,
    t.cpv, t.cpv_desc, t.estimated_value_eur AS forecast_eur, t.currency,
    t.lots_count, t.is_cancelled,
    a.awarded_eur, a.award_contracts
  FROM tenders t
  LEFT JOIN LATERAL (
    SELECT sum(c.amount_eur) FILTER (WHERE c.tag = 'contract') AS awarded_eur,
           (count(*) FILTER (WHERE c.tag = 'contract'))::int   AS award_contracts
    FROM contracts c
    WHERE t.ocid IS NOT NULL AND c.ocid = t.ocid
  ) a ON true
  WHERE t.buyer_eik = p_eik
  ORDER BY
    CASE WHEN p_sort = 'value' THEN t.estimated_value_eur END DESC NULLS LAST,
    t.publication_date DESC, t.unp DESC
  LIMIT p_limit;
$$;

-- The signed contract(s) that came out of a single procedure (by ocid) — the
-- award side of the lineage for a tender / contract detail view.
CREATE OR REPLACE FUNCTION tender_awards(p_ocid text)
RETURNS TABLE(
  key             text,
  contractor_eik  text,
  contractor_name text,
  amount_eur      double precision,
  date_signed     text,
  tag             text,
  title           text
) LANGUAGE sql STABLE AS $$
  SELECT c.key, c.contractor_eik, c.contractor_name, c.amount_eur,
         c.date_signed, c.tag, c.title
  FROM contracts c
  WHERE c.ocid = p_ocid
  ORDER BY c.tag, c.date_signed NULLS LAST, c.key;
$$;
