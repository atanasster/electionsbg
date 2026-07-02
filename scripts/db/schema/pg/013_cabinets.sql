-- Cabinet timeline (data/governments.json → PG) so the DB company page can
-- answer "did this company benefit more under a specific government" entirely
-- from Postgres (the /db/* pages source ALL data from PG, never JSON).
--
-- company_by_cabinet(eik) buckets the company's awarded contracts by the cabinet
-- whose tenure window [start_date, end_date) contains the award date. Award date
-- is a proxy for "who governed" (a contract may have been tendered under the
-- previous cabinet) — the UI frames it descriptively ("awarded during"), and
-- normalises by tenure length (€/month) since caretaker cabinets are short.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS cabinets (
  id          text PRIMARY KEY,
  pm_bg       text,
  pm_en       text,
  start_date  text NOT NULL,       -- YYYY-MM-DD (ISO text sorts chronologically)
  end_date    text,               -- NULL = current cabinet
  type        text,               -- regular / caretaker
  parties     text[],
  parties_en  text[]
);

DROP FUNCTION IF EXISTS company_by_cabinet(text);
CREATE OR REPLACE FUNCTION company_by_cabinet(p_eik text)
RETURNS TABLE(
  id         text,
  pm         text,
  parties    text[],
  start_date text,
  end_date   text,
  type       text,
  contracts  integer,
  eur        double precision
) LANGUAGE sql STABLE AS $$
  SELECT
    cab.id, cab.pm_bg AS pm, cab.parties, cab.start_date, cab.end_date, cab.type,
    (count(ct.key) FILTER (WHERE ct.tag = 'contract'))::int AS contracts,
    coalesce(sum(ct.amount_eur) FILTER (WHERE ct.tag = 'contract'), 0) AS eur
  FROM cabinets cab
  LEFT JOIN contracts ct
    ON ct.contractor_eik = p_eik
   AND ct.date >= cab.start_date
   AND (cab.end_date IS NULL OR ct.date < cab.end_date)
  GROUP BY cab.id, cab.pm_bg, cab.parties, cab.start_date, cab.end_date, cab.type
  ORDER BY cab.start_date;
$$;
