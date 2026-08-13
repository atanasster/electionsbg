-- 133_tr_company_place.sql — where each Commerce-Registry company is SEATED,
-- as an EKATTE code, plus the place-grain company list behind the "фирми,
-- регистрирани тук" tile on the settlement / municipality governance pages.
--
-- WHY THIS EXISTS. That tile used to be fed exclusively by the STATIC
-- MP-linked index (data/parliament/companies-by-{ekatte,obshtina}/), so a
-- company appeared on a place page only if an MP was matched to it by NAME.
-- With the name-frequency guard fixed (scripts/declarations/tr/integrate.ts —
-- one corroborated company no longer certifies every namesake behind it), most
-- of those rows are correctly gone, and with them the only reason a small
-- place had any company list at all. This table answers the honest question
-- instead — which companies are registered HERE — from the registry itself,
-- and flags the political links rather than requiring one.
--
-- tr_company_place is a crosswalk, not a fact table: uic → ekatte, resolved
-- OFFLINE by scripts/db/load_tr_company_place_pg.ts from the free-text
-- `tr_companies.seat` ("БЪЛГАРИЯ, с. Динково, 3921") through the same
-- EkatteResolver the procurement buyer-HQ pipeline uses (postal first, then
-- name+province, then a globally-unique name — ambiguous names stay
-- unresolved rather than guessing). Measured 2026-08-04: 323,165 of 324,369
-- seated companies placed (99.6%).
--
-- COVERAGE IS PARTIAL BY CONSTRUCTION and the UI must say so: ~68% of
-- tr_companies rows carry no seat at all in the feed, so a place's count is
-- "companies we can place here", never "all companies registered here".
--
-- money_eur / political_n are DENORMALIZED from company_public_money (127) and
-- company_politicians (008) — see the ranking note below for why. That makes
-- this table stale whenever EITHER of those moves, so the loader must re-run
-- after `db:load:tr:pg` (rebuilds both tr_companies and company_politicians)
-- and after any contracts / agri / funds reload (127's money basis).
--
-- Depends on tr_companies (008). SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS tr_company_place (
  uic          text PRIMARY KEY,
  ekatte       text NOT NULL,
  settlement   text,
  obshtina     text,   -- code, e.g. VID33 (matches data/municipalities.json)
  municipality text,   -- display name, e.g. Ружинци
  oblast       text,   -- display name, e.g. Видин
  is_village   boolean,
  confidence   text,   -- EkatteResolver band: postal_only | postal+name | …
  name         text,   -- tr_companies.name, copied for the ranking tiebreak
  money_eur    double precision NOT NULL DEFAULT 0,
  political_n  int              NOT NULL DEFAULT 0,
  -- How many PUBLIC FIGURES hold a gated registry role at this company. A third
  -- denormalized ranking column, and NOT a synonym for political_n beside it:
  --   political_n     ← company_politicians (008), which is MONEY-restricted — it is built
  --                     from mp_connected/pep_connected, i.e. politicians linked to a
  --                     CONTRACTOR. 113 companies at 43 places carry one.
  --   person_link_n   ← person_role(tr,ngo) ⨝ person(active, is_public_figure), the whole
  --                     gated identity layer. 13,567 companies at 1,548 places.
  -- The second is what „MP-linked companies at this place" actually means; the first
  -- answers the much narrower „…and they won public contracts". Keeping both is deliberate
  -- — place_companies() ranks on political_n, place_mp_companies() filters on this.
  person_link_n int             NOT NULL DEFAULT 0
);

-- RECONCILE — what actually reaches a warm database. `CREATE TABLE IF NOT EXISTS` above is
-- a no-op once the table exists, and this file is applied by load_tr_company_place_pg.ts on
-- every run, so without this line the column would land on a fresh clone and on nothing
-- else. Same rule 003's header states at length; 142 has the worked example for a TYPE
-- change, which IF NOT EXISTS cannot do.
ALTER TABLE tr_company_place
  ADD COLUMN IF NOT EXISTS person_link_n int NOT NULL DEFAULT 0;

-- RANKING INDEXES. The tile's order is politically-linked first, then public
-- money, then name — so the top-N is an index scan of exactly N rows instead of
-- a sort over the whole place. That is the entire reason money_eur,
-- political_n and name are stored here rather than joined live: measured on
-- Sofia (110,474 companies at ekatte 68134), the live-join form of
-- place_companies() ran 979 ms / 668k buffers, most of it 110k index lookups
-- into the 1M-row tr_companies plus an 81k-row hash build of
-- company_public_money on EVERY request. Sofia is a tile on the
-- homepage-grade dashboards, and prod is a db-g1-small.
--
-- The `name` leg matters for the long tail: in a village nothing has public
-- money or a politician, so without it the "top 5" would be five rows in UIC
-- order — i.e. by registration number, which reads as meaningless. `uic` still
-- closes the sort so the payload is byte-deterministic
-- (reference_pg_payload_determinism).
CREATE INDEX IF NOT EXISTS idx_tr_company_place_ekatte_rank
  ON tr_company_place (ekatte, political_n DESC, money_eur DESC, name, uic);
CREATE INDEX IF NOT EXISTS idx_tr_company_place_obshtina_rank
  ON tr_company_place (obshtina, political_n DESC, money_eur DESC, name, uic);
-- Partial indexes for the two headline counts, so they cost the size of the
-- ANSWER rather than the size of the place.
CREATE INDEX IF NOT EXISTS idx_tr_company_place_ekatte_money
  ON tr_company_place (ekatte) WHERE money_eur > 0;
CREATE INDEX IF NOT EXISTS idx_tr_company_place_obshtina_money
  ON tr_company_place (obshtina) WHERE money_eur > 0;
CREATE INDEX IF NOT EXISTS idx_tr_company_place_ekatte_pol
  ON tr_company_place (ekatte) WHERE political_n > 0;
CREATE INDEX IF NOT EXISTS idx_tr_company_place_obshtina_pol
  ON tr_company_place (obshtina) WHERE political_n > 0;
-- Same partial shape for the person-link arm, and it is what makes place_mp_companies()
-- servable at all. Measured WITHOUT it, on Sofia (110,474 rows at ekatte 68134): the planner
-- sorts the whole place before the semi-join into person_role — 121 ms / 13,459 buffers for
-- one page. With it the scan is the size of the ANSWER (~800 rows in Sofia, single digits in
-- a village). `name, uic` ride along so the page ordering is served by the index too rather
-- than re-sorted, and so the payload stays byte-deterministic.
CREATE INDEX IF NOT EXISTS idx_tr_company_place_ekatte_person
  ON tr_company_place (ekatte, money_eur DESC, name, uic) WHERE person_link_n > 0;
CREATE INDEX IF NOT EXISTS idx_tr_company_place_obshtina_person
  ON tr_company_place (obshtina, money_eur DESC, name, uic) WHERE person_link_n > 0;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON tr_company_place TO app_readonly;
  END IF;
END $$;

-- One place's companies: the total we can place there, the two counts the tile
-- leads with, and the top `p_limit` rows.
--
-- OFFICERS are read from tr_officers, the SAME rows /company/:eik lists, and
-- are NOT identity-resolved: they are names on a registry filing. The tile
-- shows them as such — no person link, no MP avatar — precisely because the
-- namesake collapse that produced this migration came from treating a name as
-- an identity. `politicians` is the one attributed arm, and it comes from
-- company_politicians (008), which is EIK-keyed, not name-keyed.
DROP FUNCTION IF EXISTS place_companies(text, text, int);
CREATE OR REPLACE FUNCTION place_companies(
  p_ekatte   text DEFAULT NULL,
  p_obshtina text DEFAULT NULL,
  p_limit    int  DEFAULT 5
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH top AS (
  SELECT p.uic, p.money_eur, p.political_n, p.name
    FROM tr_company_place p
   WHERE (p_ekatte   IS NOT NULL AND p.ekatte   = p_ekatte)
      OR (p_obshtina IS NOT NULL AND p.obshtina = p_obshtina)
   ORDER BY p.political_n DESC, p.money_eur DESC, p.name, p.uic
   LIMIT GREATEST(LEAST(p_limit, 50), 0)
)
SELECT jsonb_build_object(
  'count', (SELECT count(*)::int FROM tr_company_place p
             WHERE (p_ekatte IS NOT NULL AND p.ekatte = p_ekatte)
                OR (p_obshtina IS NOT NULL AND p.obshtina = p_obshtina)),
  'moneyCount', (SELECT count(*)::int FROM tr_company_place p
                  WHERE p.money_eur > 0
                    AND ((p_ekatte IS NOT NULL AND p.ekatte = p_ekatte)
                      OR (p_obshtina IS NOT NULL AND p.obshtina = p_obshtina))),
  'politicalCount', (SELECT count(*)::int FROM tr_company_place p
                      WHERE p.political_n > 0
                        AND ((p_ekatte IS NOT NULL AND p.ekatte = p_ekatte)
                          OR (p_obshtina IS NOT NULL AND p.obshtina = p_obshtina))),
  'companies', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'uic',       t.uic,
      'name',      t.name,
      'legalForm', c.legal_form,
      'status',    c.status,
      'moneyEur',  ROUND(t.money_eur)::double precision,
      'officers',  COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', o.name, 'roles', o.roles)
                         ORDER BY o.name)
          FROM tr_officers o
         WHERE o.uic = t.uic AND o.active = 1), '[]'::jsonb),
      'politicians', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', cp.politician, 'ref', cp.ref,
                                            'kind', cp.kind, 'role', cp.role)
                         ORDER BY cp.politician, cp.ref)
          FROM company_politicians cp
         WHERE cp.eik = t.uic), '[]'::jsonb)
    ) ORDER BY t.political_n DESC, t.money_eur DESC, t.name, t.uic)
    FROM top t
    JOIN tr_companies c ON c.uic = t.uic), '[]'::jsonb)
);
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION place_companies(text, text, int) TO app_readonly;
  END IF;
END $$;
