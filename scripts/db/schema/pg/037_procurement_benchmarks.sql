-- EU Single Market Scoreboard benchmark inputs for the procurement dashboard:
-- two competition indicators computed over the scope window [from, to),
-- classified the way the Scoreboard does (ECA SR 28/2023 methodology):
--
--   singleBidder — share of contracts with exactly one tenderer AMONG
--                  COMPETITIVE procedures with a known bid count. Procedures
--                  that are structurally single-bid (direct negotiation, no
--                  prior publication, invitations to named firms) are excluded
--                  here — they're the second indicator, not noise in the first.
--                  Green ≤10%, red >20%.
--   noCall       — share of no-call-for-bids procedures (direct negotiation /
--                  negotiated without prior publication / invitation to named
--                  firms) among contracts with a known procedure type.
--                  Green ≤5%, red ≥10%.
--
-- Coverage counters ride along so the UI can say how much of the corpus the
-- bid-count indicator actually sees (number_of_tenderers is only populated on
-- the ЦАИС-era feed — ~80% of 2024+ contracts, none of the legacy years).
-- Depends on contracts (001). EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION procurement_benchmarks(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH c AS (
  SELECT number_of_tenderers AS bids,
         NULLIF(TRIM(procurement_method), '') AS method
  FROM contracts
  WHERE tag = 'contract'
    AND (p_from IS NULL OR date >= p_from)
    AND (p_to   IS NULL OR date <  p_to)
),
m AS (
  SELECT bids, method,
         method IN (
           'Пряко договаряне',
           'Договаряне без предварително обявление',
           'Покана до определени лица',
           'direct'
         ) AS no_call
  FROM c
)
SELECT jsonb_build_object(
  'total', (SELECT count(*) FROM m),
  'singleBidder', jsonb_build_object(
    'single', (SELECT count(*) FROM m
               WHERE bids = 1 AND method IS NOT NULL AND NOT no_call),
    'known',  (SELECT count(*) FROM m
               WHERE bids IS NOT NULL AND method IS NOT NULL AND NOT no_call)
  ),
  'noCall', jsonb_build_object(
    'noCall',      (SELECT count(*) FROM m WHERE no_call),
    'methodKnown', (SELECT count(*) FROM m WHERE method IS NOT NULL)
  )
);
$$;
