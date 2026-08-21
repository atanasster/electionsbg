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
-- AN EXACT CODE MATCH IS NOT AN EXACT ATTRIBUTION. This is the whole shape of the
-- table, and it was learned the expensive way: every row used to be stored as
-- `exact_code`, which conflated „the regex matched a complete code" with „this
-- procurement belongs to this grant". They are different claims, and 22 of 2,616
-- rows satisfied the first and not the second.
--
--   `confidence` is DERIVED, never asserted, from the two corroboration facts
--   stored beside it — and a CHECK below enforces the derivation, so a loader
--   bug cannot publish a row whose label disagrees with its own evidence.
--
--     'code_and_buyer'  the canonical code appears VERBATIM in the procurement
--                       text AND the procuring buyer IS the grant's beneficiary.
--                       Authoritative: this is the only tier a surface may cite
--                       as „this grant paid for this contract".
--                       Measured 2026-08-21: 2,594 links over 436 codes.
--
--     'code_only'       the code resolves and nothing corroborates it. A claim
--                       that a CODE APPEARS, and no more. Measured: 22 links
--                       over 15 codes, of which 12 codes have no stronger link
--                       at all.
--
--   `code_verbatim` — did the full 4-digit form appear in the source text, or did
--   `canonicalise()` pad it there? Padding a short spelling is a canonicalisation
--   only while the short spelling was a short spelling. Two live counter-examples:
--
--     · Столична община's publicity contract is TRUNCATED at 367 chars mid-code
--       („…, № BG-RRP-1.007-0207-СО1, № BG-RRP-1.007-017"). Padding `017` → `0017`
--       lands on BG-RRP-1.007-0017, a REAL project belonging to Община Добрич.
--       The loader's own header assumed a bad pad would fall outside ИСУН and stay
--       visible in `unmatchedCodes`; it does not have to.
--     · Район „Искър" writes „по проект № BG-RRP-4.023-30" in full, not truncated.
--       Padded to -0030 that is Община Свищов's project, in another town.
--
--   Measured: padded spellings are 9 of 2,616 links (0.3%) and carry 2 of the 15
--   buyer mismatches — 22% against 0.5% for verbatim ones, a 45× rate. So a padded
--   code cannot be authoritative even when the buyer happens to agree.
--
--   `buyer_basis` — WHO procured, against `fund_projects.beneficiary_eik`:
--
--     'beneficiary'  the buyer is the grant holder. 2,600 links.
--     'other_buyer'  somebody else procured against this code. 15 links, 10 codes.
--     'unknown'      no grant row, or either side has no ЕИК. 1 link — and note
--                    it is the `unmatchedCodes` row, i.e. a code ИСУН does not
--                    have cannot corroborate anything.
--
--   ⚠️ 'other_buyer' IS NOT SYNONYMOUS WITH „WRONG", AND THE TABLE MUST NOT SAY IT
--   IS. Reading all 15 texts, they are at least three different things:
--
--     · a buyer citing somebody else's code — ДКТ „Иван Радоев" Плевен procures
--       „…сградата на ДКТ „Иван Радоев"" under BG-RRP-4.020-0001, which belongs to
--       Държавен сатиричен театър. Its own grant is -0005. €1.73m across 3
--       procedures, and that grant is one of the procurements in the ACF
--       „Милиони зад кулисите" investigation — the worst possible row to get wrong.
--     · a LEGITIMATE PARTNER. BG-RRP-8.013-0015 is titled „Устойчива градска
--       мобилност в общините Шумен и Търговище"; ИСУН's beneficiary is Шумен and
--       the buyer is Търговище, which the project title NAMES. Likewise
--       BG-RRP-1.023-0001 („Национален и РЕГИОНАЛНИ STEM центрове", procured by
--       ЮЗУ „Неофит Рилски", a regional-centre host) and BG-RRP-11.001-0001 (МТСП
--       deinstitutionalisation, procured by a municipal partner).
--     · our own padding, above.
--
--   ИСУН PUBLISHES THE LEAD BENEFICIARY ONLY — there is no partner list anywhere
--   in the corpus — so nothing here can tell a typo from a partner. That is why
--   these rows are DOWNGRADED AND KEPT rather than dropped: dropping would delete
--   the Търговище link whose own project title names Търговище, and the deletion
--   would leave no trace. A `code_only` row states exactly what we know.
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
-- the live numbers any UI must cite, the way /api/db/tender-search-coverage does —
-- INCLUDING the corroborated/uncorroborated split, so a surface cannot quote the
-- spine's size without saying how much of it is authoritative.

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
  -- The two corroboration facts `confidence` is derived from. Stored rather than
  -- recomputed so the gate can re-derive the verdict from the evidence — the
  -- `held_scope` / `held_raw_*` pattern in 089. A mutation check that compares a
  -- label against itself passes on an inverted implementation.
  code_verbatim boolean NOT NULL,
  buyer_basis   text    NOT NULL,
  PRIMARY KEY (pii_code, link_kind, ref),
  CONSTRAINT grant_contract_link_kind
    CHECK (link_kind IN ('tender', 'contract')),
  CONSTRAINT grant_contract_link_basis
    CHECK (basis IN ('tender_subject', 'contract_title'))
);

CREATE INDEX IF NOT EXISTS idx_grant_contract_link_ref
  ON grant_contract_link (link_kind, ref);
-- A consumer's first predicate is „give me only the authoritative links".
CREATE INDEX IF NOT EXISTS idx_grant_contract_link_confidence
  ON grant_contract_link (confidence, pii_code);

-- ─── The derivation, written ONCE ────────────────────────────────────────────
-- `confidence` is a pure function of the two corroboration facts, and that
-- function has FOUR call sites: this file's CHECK, this file's reconcile DELETE,
-- the loader's INSERT and the gate's mutation check. Four hand-copied CASE
-- expressions is the shape that produced the six-way `magistrate_current`
-- duplication where „someone missed one" fired twice in one day, so it is named
-- here and called everywhere else. The precedent is
-- `kzk_effective_suspension(suspension, status)` in 042 and `declared_label()` in
-- 089. NEVER restate the CASE at a call site.
--
-- IMMUTABLE because a CHECK constraint may only call immutable functions — which
-- is also what makes this safe: the verdict depends on nothing but its two
-- arguments, so it cannot drift with the clock or the search_path. Deliberately
-- NOT STRICT: the columns are NOT NULL, and STRICT would return NULL for a row
-- that somehow carried one, which `confidence = NULL` silently passes.
--
-- ⚠️ `CREATE OR REPLACE`, never `DROP` — the CHECK below depends on it, so a DROP
-- fails 2BP01 and a `DROP … CASCADE` would silently take the constraint with it,
-- leaving the table able to store a verdict its own evidence contradicts. That is
-- 003's CASCADE defect, one object smaller.
CREATE OR REPLACE FUNCTION grant_link_confidence(
  p_code_verbatim boolean, p_buyer_basis text
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE
           WHEN p_code_verbatim AND p_buyer_basis = 'beneficiary'
           THEN 'code_and_buyer'
           ELSE 'code_only'
         END
$fn$;

COMMENT ON FUNCTION grant_link_confidence(boolean, text) IS
  'The ONE definition of grant_contract_link.confidence. Called by 166''s CHECK, by 166''s reconcile DELETE, by load_grant_links_pg.ts and by the gate. Never restate the CASE at a call site.';

-- ─── Reconcile: what reaches a WARM database ──────────────────────────────────
-- `CREATE TABLE IF NOT EXISTS` is a no-op where the table already exists, so on
-- its own the two columns above would reach a fresh clone and nowhere else — the
-- schema drift 003's header warns about. Everything below is idempotent.
--
-- Rows that cannot satisfy the new shape are DELETED rather than backfilled, and
-- that is deliberate on two counts:
--
--   · A LEGACY row (both provenance columns NULL) was written before either
--     corroboration existed, so any value invented for it would be a fabricated
--     provenance — and relabelling the lot `code_only` would assert 2,594 links
--     are uncorroborated when they are not.
--   · An INCONSISTENT row — one whose stored verdict disagrees with its own
--     evidence — must go before the CHECK is added, or `ADD CONSTRAINT` raises
--     and `exec()` rolls the whole file back. THE LOADER IS THE REPAIR TOOL AND
--     IT APPLIES THIS FILE FIRST, so without this clause a table written by a
--     buggy loader can never be rebuilt by a fixed one: every run dies in the
--     apply phase, before it reaches its own `DELETE`. Measured while testing
--     this migration.
--
-- Deleting is safe because the table is a PURE DERIVATION with a loader in
-- `db:refresh`: the next `db:load:grant-links:pg` refills it. An empty table
-- fails this migration's gate loudly, with the loader named in the message.
ALTER TABLE grant_contract_link
  ADD COLUMN IF NOT EXISTS code_verbatim boolean,
  ADD COLUMN IF NOT EXISTS buyer_basis   text;
ALTER TABLE grant_contract_link
  DROP CONSTRAINT IF EXISTS grant_contract_link_confidence,
  DROP CONSTRAINT IF EXISTS grant_contract_link_buyer_basis,
  DROP CONSTRAINT IF EXISTS grant_contract_link_confidence_derived;
DELETE FROM grant_contract_link
 WHERE code_verbatim IS NULL
    OR buyer_basis IS NULL
    OR buyer_basis NOT IN ('beneficiary', 'other_buyer', 'unknown')
    OR confidence IS DISTINCT FROM grant_link_confidence(code_verbatim, buyer_basis);
ALTER TABLE grant_contract_link
  ALTER COLUMN code_verbatim SET NOT NULL,
  ALTER COLUMN buyer_basis   SET NOT NULL;

ALTER TABLE grant_contract_link
  ADD CONSTRAINT grant_contract_link_confidence
    CHECK (confidence IN ('code_and_buyer', 'code_only')),
  ADD CONSTRAINT grant_contract_link_buyer_basis
    CHECK (buyer_basis IN ('beneficiary', 'other_buyer', 'unknown')),
  -- ⚠️ THE DERIVATION IS ENFORCED BY THE DATABASE, not merely by the loader.
  -- „An exact code match is not an exact attribution" is the defect this table
  -- shipped; a CHECK is what makes the conflation unrepresentable rather than
  -- discouraged (§16's „model it so the inversion is unreachable"). A second
  -- extraction arm that wants a third tier must change `grant_link_confidence`,
  -- which is the point at which someone has to think about it.
  ADD CONSTRAINT grant_contract_link_confidence_derived
    CHECK (confidence = grant_link_confidence(code_verbatim, buyer_basis));

COMMENT ON TABLE grant_contract_link IS
  'ПИИ code (fund_projects.contract_number) → the tender/contract whose text names it. An extraction from free text: a row claims the CODE APPEARS, never that money flowed. Only confidence = ''code_and_buyer'' is an attribution — ''code_only'' means the code resolved and nothing corroborated it. RRF slice only — cite grant_contract_link_coverage().';
COMMENT ON COLUMN grant_contract_link.confidence IS
  'DERIVED from code_verbatim + buyer_basis and CHECK-enforced. ''code_and_buyer'' = the canonical code appears verbatim AND the buyer is the grant beneficiary (the only citable tier); ''code_only'' = neither claim survives.';
COMMENT ON COLUMN grant_contract_link.code_verbatim IS
  'The full 4-digit code appeared in the source text. FALSE means canonicalise() padded a short or truncated spelling — measured 45x more likely to reach the wrong project.';
COMMENT ON COLUMN grant_contract_link.buyer_basis IS
  'contracts.awarder_eik / tenders.buyer_eik vs fund_projects.beneficiary_eik. ''other_buyer'' is NOT a synonym for wrong: ИСУН publishes no partner list, so a project partner and a mistyped code are indistinguishable here.';

-- The numbers a spine surface must publish beside itself. Live rather than
-- stored: the denominators move with every funds and contracts reload, and a
-- frozen coverage claim is worse than none.
--
-- ⚠️ EVERY KEY NAMES ITS BASIS, and the `citable*` / `linked*` pair is the reason.
-- `linkedCodes` counts every code the extraction resolved; `citableCodes` counts
-- those with at least one corroborated link. They are 448 and 436, both true, and
-- a surface quoting the first while implying the second is the conflation this
-- table was rebuilt to end. Same rule `funds_hub_stats` follows for
-- absorptionPctOfGrant vs absorptionPctOfContracted.
CREATE OR REPLACE FUNCTION grant_contract_link_coverage()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'linkedCodes',     (SELECT count(DISTINCT pii_code) FROM grant_contract_link),
    -- EDGES and ENTITIES are different numbers and both are published, because a
    -- tender naming two codes is two edges and one procedure. Naming an edge
    -- count „linkedTenders" is exactly the basis-ambiguity `funds_hub_stats`
    -- forbids: measured, 949 edges over 947 procedures and 1,667 over 1,662
    -- contracts. Both sides of each pair are the LINKED basis — pairing an edge
    -- count with `citableTenders` (936) is the very conflation this comment
    -- exists to warn about, and it shipped that way once.
    'tenderEdges',     (SELECT count(*) FROM grant_contract_link WHERE link_kind = 'tender'),
    'contractEdges',   (SELECT count(*) FROM grant_contract_link WHERE link_kind = 'contract'),
    'linkedTenders',   (SELECT count(DISTINCT ref) FROM grant_contract_link WHERE link_kind = 'tender'),
    'linkedContracts', (SELECT count(DISTINCT ref) FROM grant_contract_link WHERE link_kind = 'contract'),
    -- ── The corroborated slice. A surface may cite ONLY these as „this grant
    -- paid for this contract"; everything else is „a procurement naming this
    -- code". Measured 2026-08-21: 2,594 of 2,616 edges, 436 of 448 codes.
    'citableEdges',    (SELECT count(*) FROM grant_contract_link WHERE confidence = 'code_and_buyer'),
    'citableCodes',    (SELECT count(DISTINCT pii_code) FROM grant_contract_link WHERE confidence = 'code_and_buyer'),
    'citableTenders',  (SELECT count(DISTINCT ref) FROM grant_contract_link WHERE confidence = 'code_and_buyer' AND link_kind = 'tender'),
    'citableContracts',(SELECT count(DISTINCT ref) FROM grant_contract_link WHERE confidence = 'code_and_buyer' AND link_kind = 'contract'),
    -- ── Why the rest are not citable, split by cause, because they are different
    -- claims: a mismatched buyer may be a partner ИСУН does not publish, while a
    -- padded code may name a project nobody meant. Both counted, neither graded.
    'codeOnlyEdges',   (SELECT count(*) FROM grant_contract_link WHERE confidence = 'code_only'),
    'buyerMismatchEdges', (SELECT count(*) FROM grant_contract_link WHERE buyer_basis = 'other_buyer'),
    'buyerMismatchCodes', (SELECT count(DISTINCT pii_code) FROM grant_contract_link WHERE buyer_basis = 'other_buyer'),
    'paddedCodeEdges',    (SELECT count(*) FROM grant_contract_link WHERE NOT code_verbatim),
    -- Codes the spine resolved and CANNOT attribute at all — no corroborated link
    -- anywhere. The number a „follow the money" surface must subtract before it
    -- claims a code's chain is complete. Measured: 12.
    'codesWithoutCitableLink', (SELECT count(*) FROM (
                          SELECT pii_code FROM grant_contract_link
                           GROUP BY pii_code
                          HAVING count(*) FILTER (WHERE confidence = 'code_and_buyer') = 0
                        ) x),
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
    GRANT EXECUTE ON FUNCTION grant_link_confidence(boolean, text) TO app_readonly;
  END IF;
END $$;
