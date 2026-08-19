-- grant_contract_link — the money spine: an EU grant to the procurement it paid for.
--
-- ⚠️ `check_function_bodies = off` is LOAD-BEARING, not tidiness. The coverage
-- function below is `LANGUAGE sql`, whose body Postgres validates at CREATE time,
-- and it reads `fund_projects`. Without this, applying the file to a database
-- that has no funds corpus raises 42P01 — and because exec() sends a migration as
-- ONE transaction, the failure rolls the whole file back and the target ends up
-- with NO TABLE AT ALL. The loader's skip-and-warn cannot save it: exec() runs
-- before the preflight. This is the 081→082 trap, and migration 149's header
-- describes the same thing happening for the same reason.
SET check_function_bodies = false;
--
-- `fund_projects.contract_number` IS the ПИИ code, and the same code is written
-- into the procurement's own text. So the join exists in the corpus already; it
-- has simply never been extracted. Measured: 262 of 264 codes found in tender
-- subjects match a fund_projects row (99.2%).
--
-- What it makes answerable, end to end and for the first time:
--     ЕU grant  →  institution  →  procedure  →  contract  →  contractor
-- e.g. BG-RRP-4.020-0003, €1,167,391 to Драматичен театър Ловеч, procured as
-- 06257-2024-0002/3, won by Нитов инженеринг (СМР, €824,801) and Крипто енерджи
-- (авторски надзор, €35,279).
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- IT IS AN EXTRACTION FROM FREE TEXT, AND THE SHAPE SAYS SO.
--
--   `confidence` is stored and only 'exact_code' is written: the regex matched a
--   complete ПИИ code, not a prefix or a fuzzy neighbour. The column exists so a
--   looser arm could be added later WITHOUT retro-actively relabelling what is
--   already published — a consumer filters on it rather than trusting the table.
--
--   `basis` names WHERE the code was found. A code in a tender's subject and a
--   code in a contract's title are different evidence with different failure
--   modes, and a surface that cites the link should be able to say which it has.
--
--   A row is a CLAIM THAT A CODE APPEARS, never that the money flowed. The grant
--   and the contract are separate corpora with separate amounts; nothing here
--   licenses summing or netting them.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ COVERAGE IS THE POINT, AND IT IS PARTIAL BY CONSTRUCTION. This finds the RRF
-- slice only — `BG-RRP-*` — because that is the programme whose codes are written
-- into procurement text. ЕФРР and ЕСФ contracts exist and carry no such code, so
-- a spine surface that does not publish its coverage reads as „this grant bought
-- nothing" for every non-RRF project. `grant_contract_link_coverage()` returns
-- the live numbers any UI must cite, the way /api/db/tender-search-coverage does.

CREATE TABLE IF NOT EXISTS grant_contract_link (
  -- The ПИИ code as written, e.g. BG-RRP-4.020-0003.
  pii_code    text NOT NULL,
  -- Which side of procurement the code was found on.
  link_kind   text NOT NULL,
  -- `tenders.unp` for a tender link, `contracts.key` for a contract link. One
  -- column rather than two nullable ones: a row means „this code appears on this
  -- thing", and a NULL-keyed variant would let a half-populated row exist.
  ref         text NOT NULL,
  confidence  text NOT NULL,
  basis       text NOT NULL,
  PRIMARY KEY (pii_code, link_kind, ref),
  CONSTRAINT grant_contract_link_kind
    CHECK (link_kind IN ('tender', 'contract')),
  CONSTRAINT grant_contract_link_confidence
    CHECK (confidence IN ('exact_code')),
  CONSTRAINT grant_contract_link_basis
    CHECK (basis IN ('tender_subject', 'contract_title'))
);

CREATE INDEX IF NOT EXISTS idx_grant_contract_link_ref
  ON grant_contract_link (link_kind, ref);

COMMENT ON TABLE grant_contract_link IS
  'ПИИ code (fund_projects.contract_number) → the tender/contract whose text names it. An extraction from free text: a row claims the CODE APPEARS, never that money flowed. RRF slice only — cite grant_contract_link_coverage().';

-- The numbers a spine surface must publish beside itself. Live rather than
-- stored: the denominators move with every funds and contracts reload, and a
-- frozen coverage claim is worse than none.
CREATE OR REPLACE FUNCTION grant_contract_link_coverage()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'linkedCodes',     (SELECT count(DISTINCT pii_code) FROM grant_contract_link),
    -- EDGES and ENTITIES are different numbers and both are published, because a
    -- tender naming two codes is two edges and one procedure. Naming an edge
    -- count „linkedTenders" is exactly the basis-ambiguity `funds_hub_stats`
    -- forbids: measured, 949 edges over 947 procedures and 1,666 over 1,661
    -- contracts.
    'tenderEdges',     (SELECT count(*) FROM grant_contract_link WHERE link_kind = 'tender'),
    'contractEdges',   (SELECT count(*) FROM grant_contract_link WHERE link_kind = 'contract'),
    'linkedTenders',   (SELECT count(DISTINCT ref) FROM grant_contract_link WHERE link_kind = 'tender'),
    'linkedContracts', (SELECT count(DISTINCT ref) FROM grant_contract_link WHERE link_kind = 'contract'),
    -- The denominator that matters: RRF projects in ИСУН. A linked-code count
    -- without it reads as full coverage of the funds corpus.
    'rrfProjects',     (SELECT count(*) FROM fund_projects WHERE contract_number ~ 'BG-RRP'),
    'fundProjects',    (SELECT count(*) FROM fund_projects),
    -- Codes named in procurement text that ИСУН does not know. Small and
    -- non-zero; a spike means the extraction started matching something else.
    'unmatchedCodes',  (SELECT count(*) FROM (
                          SELECT DISTINCT l.pii_code FROM grant_contract_link l
                           WHERE NOT EXISTS (
                             SELECT 1 FROM fund_projects f
                              WHERE f.contract_number = l.pii_code)
                        ) x)
  );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON grant_contract_link TO app_readonly;
    GRANT EXECUTE ON FUNCTION grant_contract_link_coverage() TO app_readonly;
  END IF;
END $$;
