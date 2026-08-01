-- person_search — one ranked, foldable index across ALL findable people, behind the single
-- combined-search route (functions/db_routes.js "person-search"). Three tiers in one table:
--   P — public/resolved persons (from person_browse_table): key 'slug:<slug>', real /person page
--   V — money-linked private (a tr_officers officer/owner whose company took public money, broad)
--   N — every other tr_officers officer/owner (long-tail private)
-- V/N are name-fold-keyed ('fold:<name_fold>'), route to the name-keyed /person/<name> portfolio,
-- and are ANTI-JOINED against the P-arm fold set (a fold already a public person is served by P,
-- never duplicated). Built by scripts/db/load_person_search_pg.ts — see it for the arms.
--
-- Replaces the ad-hoc tr_officers scan the old person-search route did. Ranking = a precomputed
-- query-INDEPENDENT rank_static (tier + office prominence + log public money); the route reads the
-- top-K PER TIER ordered by rank_static (early-stop) and floats exact-fold hits to the front — it
-- does NOT compute a blended per-row match score (that was 231 ms on the most common name). Same
-- contractor_search shape (006): a plain rebuilt-on-load TABLE, translit_bg_latin STORED fold,
-- gin_trgm index. Requires 000_search_fns.sql. See docs/plans/people-connections-phase1-impl-v1.md §S1.
--
-- NAME NOTE: this TABLE person_search coexists with a same-named FUNCTION person_search(text,int)
-- (082, backs the person-lookup route). Legal in PostgreSQL — relations and functions are separate
-- catalogs, so `FROM person_search` is the table and `person_search($1,$2)` the function.

CREATE TABLE IF NOT EXISTS person_search (
  key                 text PRIMARY KEY,       -- 'slug:<slug>' (P) | 'fold:<name_fold>' (V/N)
  name                text NOT NULL,
  name_fold           text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED,
  tier                char(1) NOT NULL,       -- 'P' | 'V' | 'N'
  position_type       text,                   -- code: politician/executive/public_sector/magistrate/regulator/private_sector/… (UI maps to BG label)
  primary_role        text,                   -- P only
  party               text,                   -- P only
  place_label         text,                   -- P only
  top_eik             text,                   -- V/N: the fold's highest-money company
  firms_count         int NOT NULL DEFAULT 0,
  public_money_eur    double precision NOT NULL DEFAULT 0,  -- P: contracts-only; V/N: BROAD (contracts∪subsidies∪funds)
  has_photo           boolean NOT NULL DEFAULT false,
  identity_confidence text NOT NULL,          -- 'resolved' (P) | 'name_fold' (V/N; S4 promotes verified→a real P row)
  href                text NOT NULL,          -- '/person/<slug>' (P) | '/person/<raw name>' (V/N — consumers MUST encodeURIComponent the name segment)
  rank_static         double precision NOT NULL  -- query-independent relevance; route adds match score
);

-- Fuzzy/substring (the %> word-similarity filter the route uses).
CREATE INDEX IF NOT EXISTS idx_person_search_fold
  ON person_search USING gin (name_fold gin_trgm_ops);
-- Exact-name override (name_fold = translit_bg_latin($q)).
CREATE INDEX IF NOT EXISTS idx_person_search_fold_eq ON person_search (name_fold);
-- No-query "top people" ordering + the per-tier ranked pages.
CREATE INDEX IF NOT EXISTS idx_person_search_rank ON person_search (tier, rank_static DESC, key);
