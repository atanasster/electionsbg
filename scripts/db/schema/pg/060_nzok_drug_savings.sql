-- НЗОК drug-savings leaderboard — the "how much could НЗОК save if every hospital
-- paid the peer-median unit price for the same pack?" view on the health pack
-- (/awarder/121858220). It reads the FULL above-median aggregates the drug-price
-- loader already fills (nzok_drug_overpay_by_hospital / _by_inn, migration 054 —
-- both computed over the ENTIRE above-median corpus before the 100-row cap the
-- overview payload applies), and surfaces them as one national headline + a
-- per-hospital ranking. It adds NO new data: it is a second reading of the
-- overpay tables, framed as recoverable euros rather than a per-molecule risk row
-- (that framing lives in nzok_drug_risk_by_inn).
--
-- The cardinal rules of the drug-price corpus still hold (see migration 052):
-- comparison is at PACK identity, a volume floor of 5 packs applies upstream, and
-- a price gap is a SIGNPOST, not an irregularity — it can reflect volume, delivery
-- period or contract terms. The headline is therefore "avoidable overpay", the
-- gap between what was paid and the peer median, NOT a fraud figure.
--
-- Determinism (see reference_pg_payload_determinism): sums ROUND-ed, every
-- ORDER BY rounds its sort key and carries an explicit COLLATE "C" + eik/inn
-- tiebreak so local == cloud, and an empty corpus returns NULL (not an object of
-- nulls).

CREATE OR REPLACE FUNCTION nzok_drug_savings_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- ONE year drives the whole payload — the latest in the hospital table. The
  -- by-inn table is filled by the same loader in the same year, so keying the INN
  -- context off this same `y` (rather than its own max) guarantees the headline
  -- never blends two years if a partial re-load leaves the tables on different
  -- max years; the INN context simply returns empty for a mismatched year.
  WITH yh AS (SELECT max(year) AS y FROM nzok_drug_overpay_by_hospital)
  SELECT CASE WHEN (SELECT y FROM yh) IS NULL THEN NULL ELSE jsonb_build_object(
    'year',           (SELECT y FROM yh),
    -- National avoidable-overpay headline: Σ over every hospital's above-median
    -- euros in the latest full year. This is the €-recoverable number.
    'totalOverpayEur', (
      SELECT ROUND(SUM(overpay_eur))::bigint
      FROM nzok_drug_overpay_by_hospital WHERE year = (SELECT y FROM yh)),
    'hospitalCount',  (
      SELECT COUNT(*)::int
      FROM nzok_drug_overpay_by_hospital WHERE year = (SELECT y FROM yh)),
    'innCount',       (
      SELECT COUNT(*)::int
      FROM nzok_drug_overpay_by_inn WHERE year = (SELECT y FROM yh)),
    -- Per-hospital leaderboard, biggest recoverable euros first.
    'hospitals', (
      SELECT jsonb_agg(jsonb_build_object(
               'eik',        eik,
               'facility',   facility,
               'overpayEur', ROUND(overpay_eur)::bigint,
               'packCount',  pack_count,
               'innCount',   inn_count,
               'maxRatio',   max_ratio)
             ORDER BY overpay_eur DESC, eik COLLATE "C")
      FROM nzok_drug_overpay_by_hospital
      WHERE year = (SELECT y FROM yh)),
    -- The biggest-leak molecules, for context beside the hospital ranking.
    'topInns', (
      SELECT jsonb_agg(jsonb_build_object(
               'inn',           inn,
               'overpayEur',    ROUND(overpay_eur)::bigint,
               'facilityCount', facility_count,
               'packCount',     pack_count,
               'maxRatio',      max_ratio)
             ORDER BY overpay_eur DESC, inn COLLATE "C")
      FROM (
        SELECT * FROM nzok_drug_overpay_by_inn
        WHERE year = (SELECT y FROM yh)
        ORDER BY overpay_eur DESC, inn COLLATE "C"
        LIMIT 10
      ) t)
  ) END;
$$;
