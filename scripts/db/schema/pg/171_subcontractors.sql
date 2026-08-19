-- Subcontractor declarations from the rendered ЗОП обявление (plan P8).
--
-- „The money on a contract is not the money that reaches the work." Whether a
-- contract is performed by its winner or handed on is declared on the award
-- notice, and was previously readable only by opening one.
--
-- ⚠️ A PROJECTION over `tender_notice`, not an ingest. Its whole content comes
-- from the ЦАИС dossier capture already loaded, so its staleness trigger is
-- `db:load:tender-dossier:pg` — not a crawl of its own.
--
-- ⚠️ NULL IS A THIRD ANSWER AND MUST SURVIVE TO THE READER. `has_subcontractors`
-- IS NULL means the form does not carry the question — 159,103 of 212,961
-- notices. Rendering that as „no subcontractors" would state, on a named
-- contract, that the winner performed it alone when nobody said so. Only 53,858
-- notices answer at all.

CREATE TABLE IF NOT EXISTS tender_subcontracting (
  publication_id       bigint PRIMARY KEY,
  unp                  text NOT NULL,
  -- Да / Не exactly as declared; NULL = the form does not ask.
  has_subcontractors   boolean,
  -- Printed only when the answer is Да, so NULL here beside `true` is the
  -- buyer omitting it, not zero subcontractors.
  subcontractor_count  int,
  -- From the same block, free: pairs with procurement_annexes, which counts
  -- amendments from an independent source.
  was_amended          boolean,
  amendment_count      int,
  loaded_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tender_subcontracting_unp
  ON tender_subcontracting (unp);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON tender_subcontracting TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — tender_subcontracting ships with no ACL.';
  END IF;
END $$;

-- Per-procedure answer, folded across a procedure's notices.
--
-- ⚠️ THE FOLD IS „ANY NOTICE SAID ДА", not „the latest notice said Да". A
-- procedure with lots publishes one award notice per lot, and subcontracting on
-- one lot is subcontracting on the procedure. Taking the latest would let a
-- later lot's Не erase an earlier lot's Да.
CREATE OR REPLACE FUNCTION tender_subcontracting_for(p_unp text)
RETURNS TABLE (
  answered boolean,
  has_subcontractors boolean,
  max_declared int,
  notices int
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT true,
         bool_or(s.has_subcontractors),
         -- ⚠️ ACROSS LOTS: the LARGEST count any lot declared, not a sum. The
         -- notices are per-lot and a supplier may appear on several, so summing
         -- would double-count; „at least this many" is the only claim the
         -- corpus supports.
         max(s.subcontractor_count),
         count(*)::int
    FROM tender_subcontracting s
   WHERE s.unp = p_unp
  -- ⚠️ GROUP BY, NOT A BARE AGGREGATE. An ungrouped aggregate returns ONE ROW
  -- over an empty set, so a УНП nobody ever asked about came back with
  -- has_subcontractors = NULL and answered = NULL — reintroducing at the
  -- serving boundary exactly the „never asked looks like an answer" confusion
  -- the absence-of-a-row model exists to prevent. With the GROUP BY the
  -- function returns NO ROWS for an unknown УНП, and `answered` is then
  -- trivially true for every row it does return.
   GROUP BY s.unp;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION tender_subcontracting_for(text) TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — tender_subcontracting_for ships with no ACL.';
  END IF;
END $$;
