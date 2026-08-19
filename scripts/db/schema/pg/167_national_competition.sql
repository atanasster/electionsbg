-- national_competition(from, to) — the whole-corpus single-bid rate FOR A WINDOW.
--
-- It exists because a sector page shows a scoped rate and, until now, had nothing
-- but a whole-corpus baseline to put beside it. That comparison is not merely
-- imprecise — it inverts. Measured on /culture/procurement:
--
--   window        culture   true national   the page said
--   ns (default)   55.3%        47.7%       „at 40.9% nationally"  (+14.4 not +7.6)
--   2023+          42.0%        44.4%       culture WORSE, when it is BETTER
--
-- „Arithmetically right, false as a sentence" — the class the culture plan's §0
-- box was written to prevent, reintroduced by comparing across windows.
--
-- ⚠️ EVERY SECTOR DASHBOARD HAS THIS SHAPE. This function is deliberately generic
-- and un-namespaced so the next one to need a baseline does not compute its own.
--
-- Cheap by construction: `contracts` carries an index on `date`, and the whole
-- aggregate is two FILTERed counts over the window. Sargable COALESCE bounds, the
-- same convention as awarder_group_model (061).

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION national_competition(p_from text, p_to text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    -- Un-divided, deliberately: a consumer showing „42.0% vs 40.9%" must derive
    -- both sides the same way, and a pre-divided share invites one of them to be
    -- rounded differently from the other.
    'singleBid', count(*) FILTER (WHERE number_of_tenderers = 1),
    'bidKnown',  count(*) FILTER (WHERE number_of_tenderers IS NOT NULL),
    'contracts', count(*)
  )
  FROM contracts
  WHERE tag = 'contract'
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '99999999');
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION national_competition(text, text) TO app_readonly;
  END IF;
END $$;
