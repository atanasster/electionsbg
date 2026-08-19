-- declaration_employer_link — the bridge from a declarant's own stated employer
-- to a procurement BUYER, keyed by EIK.
--
-- WHY IT IS NEEDED. `declaration.institution` is the register's LISTING label and
-- is a GROUP: „Културни институти и институции" covers every culture filing,
-- „Процедури по ЗОП" covers 2,848. It cannot say WHERE a declarant works.
-- `declaration.filed_institution` — the filing's own <Personal><Work> — can:
-- 61,741 of 61,743 filings carry one, across 21,398 distinct spellings.
--
-- What it unlocks is a fact nobody publishes in Bulgaria: „who was authorised to
-- run procurement at this buyer, in this year". 41.5% of procurement-officer
-- filings name an employer that IS a buyer in the corpus.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- THIS TABLE IS A NAME MATCH, AND THE REPO'S RULE FOR THOSE IS THAT A NAME MATCH
-- IS NOT AN IDENTITY. Three consequences are built into the shape:
--
--   1. AN AMBIGUOUS FOLD IS REFUSED, NEVER GRADED. If one employer spelling folds
--      onto more than one EIK, no row is written. That is the same rule
--      `tr_name_fold_people` (148) enforces for person→company: a fold answering
--      „2 or more" refuses, because a confidence score on an ambiguous match is
--      an invitation to publish the wrong one. 517 filings hit this and get
--      nothing rather than a guess.
--   2. THE DECLARED STRING SURVIVES. `employer_sample` keeps one verbatim
--      spelling so a surface can show what the declarant actually wrote rather
--      than the registry name it was matched to.
--   3. CONFIDENCE IS STORED, and only `exact` is written today. The column exists
--      so a future trigram arm can be added WITHOUT retro-actively relabelling
--      what is already published — a consumer filters on it rather than trusting
--      the table wholesale.
--
-- ⚠️ AN UNRESOLVED EMPLOYER IS NOT AN ABSENT ONE. 43,340 filings name an employer
-- that never appears as a buyer — a school, a court, a ministry directorate —
-- and that is the ordinary case, not a failure. A surface must render „not
-- matched to a buyer", never „no employer".
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS declaration_employer_link (
  -- The folded employer string: trimmed, whitespace-collapsed, lower-cased. The
  -- fold is deliberately CONSERVATIVE — no transliteration, no punctuation
  -- stripping — because every widening of it widens the ambiguity it must then
  -- refuse, and the yield already sits at 29.8% of filings.
  employer_fold  text PRIMARY KEY,
  eik            text NOT NULL,
  -- 'exact' — the fold equals a buyer's folded name. The only value written today.
  confidence     text NOT NULL,
  -- Which corpus the EIK came from. 'awarder' today; a tr_companies arm would
  -- add its own value rather than silently joining this one.
  basis          text NOT NULL,
  -- One verbatim spelling as the declarant wrote it, for review and for display.
  employer_sample text,
  -- How many distinct raw spellings fold to this key. A high count is a sign the
  -- fold is doing real work; a count of 1 is the common case.
  spellings      integer NOT NULL DEFAULT 1,
  CONSTRAINT declaration_employer_link_confidence
    CHECK (confidence IN ('exact', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_declaration_employer_link_eik
  ON declaration_employer_link (eik);

-- The join side, on `declaration`. Every consumer joins the FOLD of
-- filed_institution, which is an expression — so without this index each lookup
-- is a full scan of 61,743 filings, and /culture/institutions fires ~40 of them
-- on one page. Measured: 9,145 buffers / 104 ms per call, against 286 / 1.2 ms
-- with it.
--
-- Legal because the expression is IMMUTABLE: btrim, replace, lower and
-- regexp_replace with a constant pattern all are. It must stay byte-identical to
-- the fold in load_employer_links_pg.ts and in the two gates, or it silently
-- stops being used and the page goes back to 104 ms a call with nothing failing.
CREATE INDEX IF NOT EXISTS idx_declaration_filed_institution_fold
  ON declaration (
    (lower(regexp_replace(btrim(replace(filed_institution, U&'\00A0', ' ')),
                          '\s+', ' ', 'g')))
  )
  WHERE filed_institution IS NOT NULL;

COMMENT ON TABLE declaration_employer_link IS
  'Declarant employer (declaration.filed_institution) → procurement buyer EIK. A NAME match, never an identity: an ambiguous fold is refused rather than graded, and an unresolved employer means "not matched to a buyer", not "no employer".';

-- Role-guarded (the 117/130 shape): roles are CLUSTER-wide, so a virgin pgdata
-- volume has no app_readonly and a bare GRANT raises 42704 — which, because
-- exec() sends a migration as ONE transaction, would roll this whole file back
-- and leave no table at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON declaration_employer_link TO app_readonly;
  END IF;
END $$;
