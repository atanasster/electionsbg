-- Institution identity for the DB company page (/db/company/:eik). ~3,649 award-
-- ing bodies (ministries, agencies like АПИ) and ~5,925 fund beneficiaries carry
-- an EIK and appear in our data as BUYERS / grant recipients, but are NOT in the
-- commercial register (tr_companies) — so the page used to show "няма фирма" and
-- hid the funds/procurement we do have for them. This synthesises an identity
-- from what we know: name + seat from the awarder columns on contracts (or the
-- fund beneficiary name), role flags, and a buy-side headline (as awarder).
--
-- Depends on contracts (001) + fund_beneficiaries (015). awarder_eik is indexed.
-- SELECT/EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS institution_identity(text);

CREATE OR REPLACE FUNCTION institution_identity(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH aw AS (
  -- mode() = the most common awarder_name/seat variant for this EIK (one EIK can
  -- carry many regional-office name spellings; MAX would pick an arbitrary one).
  SELECT mode() WITHIN GROUP (ORDER BY awarder_name)              AS name,
         mode() WITHIN GROUP (ORDER BY awarder_region)            AS region,
         mode() WITHIN GROUP (ORDER BY awarder_locality)          AS locality,
         (COUNT(*) FILTER (WHERE tag = 'contract'))::int          AS buy_count,
         COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0) AS buy_eur,
         (COUNT(DISTINCT contractor_eik) FILTER (WHERE tag = 'contract'))::int AS buy_contractors
  FROM contracts WHERE awarder_eik = p_eik
),
fb AS (
  SELECT name, org_type FROM fund_beneficiaries WHERE eik = p_eik LIMIT 1
),
ct AS (
  SELECT (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS n
  FROM contracts WHERE contractor_eik = p_eik
)
SELECT CASE
  WHEN COALESCE(aw.buy_count, 0) = 0 AND fb.name IS NULL THEN NULL
  ELSE jsonb_build_object(
    -- prefer the canonical ИСУН beneficiary name when present (the awarder name
    -- is the noisier regional-office spelling); fall back to the awarder mode.
    'name',               COALESCE(fb.name, aw.name),
    'region',             aw.region,
    'locality',           aw.locality,
    'orgType',            fb.org_type,
    'isAwarder',          COALESCE(aw.buy_count, 0) > 0,
    'isBeneficiary',      fb.name IS NOT NULL,
    'isContractor',       COALESCE(ct.n, 0) > 0,
    'buyContractCount',   COALESCE(aw.buy_count, 0),
    'buyTotalEur',        ROUND(COALESCE(aw.buy_eur, 0)),
    'buyContractorCount', COALESCE(aw.buy_contractors, 0)
  )
END
FROM aw LEFT JOIN fb ON true CROSS JOIN ct;
$$;
