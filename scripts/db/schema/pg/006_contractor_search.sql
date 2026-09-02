-- Contract-name search — every contractor AS THEY APPEAR in the contract corpus,
-- so foreign / placeholder contractors absent from TR (~32% of distinct EIKs,
-- ~21.6k contracts: Elsevier, Pesa Bydgoszcz, …) are still findable by name.
-- Derived from contracts (distinct eik+name), rebuilt on each load. Self-contained
-- within the procurement load — no TR dependency. Requires 000_search_fns.sql.
-- See docs/plans/postgres-migration-v1.md (Feature 1).

CREATE TABLE IF NOT EXISTS contractor_search (
  eik       text NOT NULL,
  name      text NOT NULL,
  name_fold text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);

-- ⚠️ THE NAME COMES FROM A ROW; THE MONEY COMES FROM THE EIK. That asymmetry is what
-- these two columns exist to make visible, and it is not hypothetical: a buyer who files
-- one company's name against ANOTHER company's ЕИК mints a searchable row here whose euro
-- figure is the second company's entire history.
--
-- Measured 2026-09-02. EIK 103795327 is „БИТ И ТЕХНИКА" ООД (Варна, in tr_companies), and
-- exactly ONE of its 1,101 contract rows — €6,036, filed 2021-04-26 — carries the name
-- „Клет българия" ООД. The search therefore published БИТ И ТЕХНИКА's whole €2,214,873
-- under Клет България's name, i.e. 0.27% of the money actually bore the name shown, beside
-- the real Клет България (130878827, €22,424,885) in the same dropdown.
--
-- Corpus-wide: 2,886 (eik, name) pairs carry under 1% of their EIK's money, 5,061 under 5%.
-- 109 of those are a name that is ANOTHER EIK's dominant name — 20 cross-company (the Клет
-- class) and 89 a single-digit ЕИК typo (203283626↔203283623 Фьоникс Фарма, 831609043↔
-- 831609046 Топлофикация София, 040306507↔040336507 Томбоу). 282 folded names sit on more
-- than one EIK, which is what makes a dropdown show apparent duplicates.
--
-- ⚠️ MOST LOW-SHARE ALIASES ARE LEGITIMATE AND MUST NOT BE SUPPRESSED. „ЧЕЗ Трейд България"
-- → „Електрохолд Трейд" and „Медекс /Старо наименование/" are genuine renames on the SAME
-- EIK: finding a company by its former name and landing on its current page is the feature.
-- A similarity filter alone captures 362 pairs, most of them exactly these. What separates
-- the two is not "is this name unlike the dominant one" but "how much of this EIK's money
-- was filed under THIS name", which is why the answer is a number and not a heuristic.
--
-- ⚠️ NULL IS A THIRD ANSWER — "not computed yet" — and must never read as zero. Both
-- columns are NULLABLE with no default precisely because a database whose `db:load:pg` has
-- not re-run since this migration carries no values; a `NOT NULL DEFAULT 0` would make
-- every row look like a 0%-share alias and suppress the entire dropdown's money. Consumers
-- must treat NULL as "no opinion" and show the figure.
ALTER TABLE contractor_search ADD COLUMN IF NOT EXISTS own_eur double precision;
ALTER TABLE contractor_search ADD COLUMN IF NOT EXISTS primary_name text;
--
-- WHAT FILLS THEM: `npm run db:load:pg` (and its `:cloud` twin) — the ONLY writer. Applying
-- this migration alone creates the columns EMPTY, which is the state NULL is for. There is
-- no backfill and none is possible from SQL alone at a useful cost, since the values are a
-- per-(eik, name) partition of the corpus that the loader already computes in one pass.
CREATE INDEX IF NOT EXISTS idx_contractor_search_fold
  ON contractor_search USING gin (name_fold gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contractor_search_eik ON contractor_search (eik);

-- Same shape/behavior as search_companies but over the contract corpus, so it
-- covers contractors with no TR record. Each hit carries its procurement volume —
-- plus, since 2026-09-02, the two fields a caller needs in order to tell whether that
-- volume is about the name it is printed beside (see the ALTERs above).
--
-- `own_eur`      — the money filed under THIS (eik, name), so a caller can compare it to
--                  `contracts_eur` and refuse to attribute an EIK's total to a name that
--                  earned 0.27% of it. NULL until the next `db:load:pg`.
-- `primary_name` — the EIK's dominant name by that same measure, so a row can be shown
--                  under the name the corpus mostly calls it while still saying which
--                  alias matched. NULL until the next `db:load:pg`.
-- ⚠️ DROP, NOT `CREATE OR REPLACE`. The 2026-09-02 change ADDED two OUT parameters, and
-- Postgres refuses to alter an existing function's OUT-parameter row type in place (42P13)
-- — the same wall `144_funds_wire.sql` documents. Verified before adding this line: neither
-- search function has a single stored-query dependent (`pg_rewrite` and `pg_proc` both
-- empty), so the DROP takes nothing with it and needs no CASCADE. Every caller is ad-hoc —
-- `db_routes.js` and the data tests — and records no `pg_depend` edge.
--
-- ⚠️ NO CASCADE, EVER, on this line. A view or a LANGUAGE-sql body added later WOULD record
-- an edge, and CASCADE would then delete it silently while the migration exited 0 — the
-- 003 defect. Without CASCADE such a future dependent raises 2BP01 and the load aborts
-- loudly, which is the failure worth having.
--
-- ⚠️ UNLIKE 175's DROP+CREATE, THIS ONE CANNOT STRIP THE `app_readonly` EXECUTE GRANT —
-- the hazard CLAUDE.md documents at length for that file, and the question a reader of this
-- repo arrives with. `roles_readonly.sql` installs `ALTER DEFAULT PRIVILEGES FOR ROLE
-- postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_readonly`, so the re-created
-- function is re-granted automatically, and the PUBLIC `=X` default (never revoked there)
-- covers it independently — including if this file is ever applied by an owner other than
-- `postgres`. Verified 2026-09-02 by a DROP+CREATE inside a rolled-back transaction:
-- `proacl` came back identical.
DROP FUNCTION IF EXISTS search_contractors(text, int);
CREATE OR REPLACE FUNCTION search_contractors(q text, lim int DEFAULT 20)
RETURNS TABLE (
  eik           text,
  name          text,
  contracts     bigint,
  contracts_eur double precision,
  own_eur       double precision,
  primary_name  text,
  sim           real
)
LANGUAGE sql STABLE PARALLEL SAFE
-- 0.5, not 0.4: at 0.4 a no-real-match query surfaces garbage — "Невзоров"
-- (nevzorov) matched "невен 2000" (neven) at ws 0.44. Legit prefix/substring/
-- exact hits all score >=0.6, so 0.5 drops the noise without hurting recall.
SET pg_trgm.word_similarity_threshold = 0.5
SET pg_trgm.similarity_threshold = 0.3
AS $$
  WITH qq AS (SELECT translit_bg_latin(q) AS qf)
  SELECT s.eik, s.name,
         (SELECT count(*) FROM contracts k WHERE k.contractor_eik = s.eik),
         (SELECT coalesce(sum(k.amount_eur), 0) FROM contracts k
            WHERE k.contractor_eik = s.eik AND k.tag = 'contract'),
         s.own_eur, s.primary_name,
         word_similarity((SELECT qf FROM qq), s.name_fold)
  FROM contractor_search s, qq
  WHERE qq.qf <% s.name_fold
    AND (SELECT bool_and(tok <% s.name_fold)
         FROM unnest(string_to_array(qq.qf, ' ')) AS tok WHERE tok <> '')
  ORDER BY word_similarity((SELECT qf FROM qq), s.name_fold) DESC,
           length(s.name), s.eik
  LIMIT lim;
$$;
