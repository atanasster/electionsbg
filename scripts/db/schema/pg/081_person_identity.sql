-- 081_person_identity.sql — the unified person-identity core.
--
-- Gives every natural person in the site a single stable person_id, so candidates,
-- MPs, mayors, councillors, officials, TR company officers/owners, magistrates, NGO
-- board members and campaign-finance donors resolve to ONE profile and can carry
-- rich person↔person edges — regardless of how each dataset was ingested. Design:
-- docs/plans/person-identity-v1.md (§2 the model, §2a name-structure matching,
-- §3 the resolver, §5 the source catalog).
--
-- This migration is DDL only: the tables, the source catalog, indexes. It sits ABOVE
-- the nine source datasets and references them; no source ingest changes. The resolver
-- (scripts/person/resolve_persons.ts) and the serving functions land in later steps.
--
-- Identity has no EGN by policy (scripts/declarations/tr/types.ts) — a person is a
-- name, folded by the ONE normalizer translit_bg_latin() (000_search_fns.sql). Because
-- a wrong merge on a public page is an accusation, the aggressive-merge policy stages
-- ambiguous merges in status='review' (never rendered) until adjudicated.

-- ---------------------------------------------------------------------------
-- Source catalog — the single registry. One row per people dataset; drives BOTH
-- the resolver (which sources to ingest) AND the Connections UI (which filter facet).
-- Adding a row here is the entire "add a data source" surface. See plan §5.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_source (
  key            text PRIMARY KEY,       -- person_role.source / person_alias.source value
  label_bg       text NOT NULL,
  facet          text NOT NULL,          -- Connections filter group (politician|executive|
                                         --   magistrate|ngo|donor|company|ds|sanctions|
                                         --   regulator|media|professional|other)
  tier           text NOT NULL,          -- 'core' (live) | 'T1' | 'T2' | 'T3' (planned)
  public_default boolean NOT NULL        -- do persons whose ONLY role is this source
                                         --   default to a public /person page? (§6 gate)
);

INSERT INTO person_source (key, label_bg, facet, tier, public_default) VALUES
  ('mp',            'Народни представители',        'politician',   'core', true),
  ('candidate',     'Кандидати',                     'politician',   'core', true),
  ('local',         'Местни кандидати и съветници',  'politician',   'core', true),
  ('official_exec', 'Изпълнителна власт',            'executive',    'core', true),
  ('public_sector', 'Публичен сектор',               'public_sector','core', true),
  ('official_muni', 'Общинска администрация',        'politician',   'core', true),
  ('tr',            'Търговски регистър',            'company',      'core', false),
  ('magistrate',    'Магистрати',                    'magistrate',   'core', true),
  ('ngo',           'Управа на ЮЛНЦ',                'ngo',          'core', false),
  ('donor',         'Дарители',                      'donor',        'core', false),
  ('ds',            'Досиета на ДС',                 'ds',           'T1',   true),
  ('sanctions',     'Санкции',                       'sanctions',    'T1',   true),
  ('regulator',     'Регулатори и независими органи','regulator',    'T1',   true),
  ('mep',           'Евродепутати',                  'politician',   'T2',   true),
  ('president',     'Президенти',                    'politician',   'T2',   true),
  ('historic_mp',   'Народни представители (архив)', 'politician',   'T2',   true),
  ('media',         'Собственост на медии',          'media',        'T2',   false),
  ('professional',  'Нотариуси, ЧСИ, синдици',       'professional', 'T2',   false),
  ('diplomat',      'Дипломати',                     'executive',    'T3',   true),
  ('academic',      'Ректори и БАН',                 'other',        'T3',   false),
  ('honours',       'Държавни отличия',              'other',        'T3',   false),
  ('concession',    'Концесионери',                  'company',      'T3',   false)
ON CONFLICT (key) DO UPDATE SET
  label_bg = EXCLUDED.label_bg, facet = EXCLUDED.facet,
  tier = EXCLUDED.tier, public_default = EXCLUDED.public_default;

-- ---------------------------------------------------------------------------
-- person — the canonical natural person (the new stable id).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person (
  person_id        bigserial PRIMARY KEY,
  display_name     text NOT NULL,        -- best-quality Cyrillic name
  -- The ONE normalizer, generated so it can never drift from display_name.
  name_fold        text GENERATED ALWAYS AS (translit_bg_latin(display_name)) STORED,
  -- Structured name parts (plan §2a). The resolver fills these — parsing 2-part vs
  -- 3-part Bulgarian names (given + patronymic + family) is resolver logic, not a
  -- simple fold. The BLOCKING KEY is (given_fold, family_fold); the patronymic is a
  -- corroborant, never the block key, and is NULL for a 2-part source name.
  given_fold       text NOT NULL,
  patronymic_fold  text,
  family_fold      text NOT NULL,
  name_parts       smallint NOT NULL DEFAULT 3 CHECK (name_parts IN (2, 3)),
  slug             text UNIQUE NOT NULL, -- stable public slug -> /person/{slug}
  birth_date       date,                 -- corroborant when present; never required
  -- Privacy gate (plan §6): default OFF. A public /person page is minted only when
  -- the resolver opts a person in (holds public office, or bridges to public money).
  is_public_figure boolean NOT NULL DEFAULT false,
  -- Distinct-COMPANY count for the name. DEPRECATED as a namesake guard — it counts
  -- companies, not people, and the profile ignores it entirely
  -- (tr-attribution-basis-v1 §0.3). `fold_people_n` below is what this was reaching for;
  -- new consumers read that one. Retiring this column has consumers beyond that plan
  -- (§8), so both exist for now.
  namesake_risk    integer NOT NULL DEFAULT 0,
  -- 'review' = aggressive-merge holding area; NEVER rendered publicly until promoted.
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'review')),
  -- How this person's IDENTITY was established (S4). 'resolved' = the normal cross-source
  -- resolution (office-holders, candidates, bridged public figures). 'verified' = a Tier-V
  -- private owner minted from the Commerce Registry by name-fold — a globally person-shaped,
  -- ≤5-firm, money-linked owner (is_public_figure stays FALSE; the name is a strong but
  -- name-only identity). Consumers gate/serve on it: 082 serves a 'verified' private on /person,
  -- and 120 places it in the частен-сектор (tier V) slice, never the public default.
  --
  -- 'shared_name' is the SAME Tier-V mint on a fold the registry itself says is two or more
  -- people (fold_people_n > 1) — tr-attribution-basis-v1 §2.6. It is served exactly like
  -- 'verified' and labelled differently: excluding these people instead would delete the
  -- person row (this table is rebuilt from scratch every resolve), orphaning ~4.5k /person
  -- URLs with no valid redirect target — the magistrate-roster 404 class. So they stay, and
  -- the page says the registry shows N people under this name rather than the weaker "we
  -- could not verify". EVERY consumer that serves 'verified' must serve this too.
  identity_confidence text NOT NULL DEFAULT 'resolved'
                        CHECK (identity_confidence IN ('resolved', 'verified', 'shared_name')),
  -- Distinct registry PEOPLE under this person's name fold, copied from tr_name_fold_people
  -- at resolve time so every consumer inherits one number instead of re-deriving it.
  -- NULL means UNMEASURED — the fold was never observed in the TR daily feed's window — and
  -- must never be rendered as 1. This is what namesake_risk above was reaching for and could
  -- not express: that column counts a name's COMPANIES, not its PEOPLE.
  fold_people_n    integer CHECK (fold_people_n IS NULL OR fold_people_n >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- CREATE TABLE IF NOT EXISTS won't add identity_confidence to an already-built person table, so
-- ALTER it in (S4). Idempotent.
ALTER TABLE person ADD COLUMN IF NOT EXISTS identity_confidence text NOT NULL DEFAULT 'resolved';
ALTER TABLE person ADD COLUMN IF NOT EXISTS fold_people_n integer;
-- Guarded on the constraint's DEFINITION, not on its existence. Both halves matter:
--
--   • Guarding on EXISTENCE (what this file did before 'shared_name') leaves a warm database
--     on the two-value form for ever, and the resolver then raises 23514 the first time it
--     labels a Tier-V person 'shared_name' — mid-rebuild, on a machine where every migration
--     reported success.
--   • Guarding on NOTHING (an unconditional DROP + ADD) takes an AccessExclusiveLock on
--     `person` on EVERY apply, including the steady-state no-op — and `exec()` sends a
--     migration as one transaction, so it is held to COMMIT, across everything below. That is
--     the hazard measured for person_role 70 lines down ("eight readers stacked behind one
--     ALTER"), on the table person_by_slug reads for every /person, /persons and /connections
--     request, in a file `add_override.ts` runs against a live database by hand.
--
-- So: skip in the steady state, fail fast rather than head a lock queue, and add NOT VALID so
-- the row scan does not happen under the lock. Widening cannot be violated by rows that
-- satisfied the narrower list, so validating separately is sound.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'person'::regclass
                AND conname  = 'person_identity_confidence_check'
                AND pg_get_constraintdef(oid) LIKE '%shared_name%')
  THEN RETURN; END IF;

  SET LOCAL lock_timeout = '3s';
  ALTER TABLE person DROP CONSTRAINT IF EXISTS person_identity_confidence_check;
  ALTER TABLE person ADD CONSTRAINT person_identity_confidence_check
    CHECK (identity_confidence IN ('resolved', 'verified', 'shared_name')) NOT VALID;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'person'::regclass
                AND conname  = 'person_fold_people_n_check')
  THEN RETURN; END IF;

  SET LOCAL lock_timeout = '3s';
  ALTER TABLE person ADD CONSTRAINT person_fold_people_n_check
    CHECK (fold_people_n IS NULL OR fold_people_n >= 1) NOT VALID;
END $$;

-- Outside the guards, so a run that timed out mid-way still converges. VALIDATE takes only a
-- ShareUpdateExclusiveLock, which readers do not contend with, and both are no-ops once valid.
DO $$ BEGIN
  ALTER TABLE person VALIDATE CONSTRAINT person_identity_confidence_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE person VALIDATE CONSTRAINT person_fold_people_n_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_person_name_fold ON person (name_fold);
-- The blocking key: candidates to merge/search share (given_fold, family_fold).
CREATE INDEX IF NOT EXISTS idx_person_block ON person (given_fold, family_fold);
-- Free-text person search (personSearch tool / arbitrary-person lookup).
CREATE INDEX IF NOT EXISTS idx_person_name_trgm
  ON person USING gin (name_fold gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- person_alias — every surface form that maps to this person (across sources).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_alias (
  person_id  bigint NOT NULL REFERENCES person (person_id) ON DELETE CASCADE,
  alias_raw  text NOT NULL,
  alias_fold text GENERATED ALWAYS AS (translit_bg_latin(alias_raw)) STORED,
  source     text NOT NULL REFERENCES person_source (key),
  PRIMARY KEY (person_id, alias_fold, source)
);
CREATE INDEX IF NOT EXISTS idx_person_alias_fold ON person_alias (alias_fold);

-- ---------------------------------------------------------------------------
-- person_role — typed, dated links from a person to a source record. The join key
-- the site never had: "everything for person N" is one indexed seek here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_role (
  person_id  bigint NOT NULL REFERENCES person (person_id) ON DELETE CASCADE,
  source     text NOT NULL REFERENCES person_source (key),
  ref        text NOT NULL,   -- source native key: mp id, official slug, uic, obshtina+listpos …
  role       text NOT NULL,   -- 'mp'|'mayor'|'councillor'|'cabinet_min'|'tr_manager'|'ngo_board'|…
  party      text,            -- references the site's party canonicalId where applicable
  -- The TYPED place (place_kind / place_code / place_raw) is added
  -- by 115_person_role_place.sql, which also drops the untyped `place` this used to
  -- declare. Kept out of the CREATE so a fresh database never mints the old column.
  start_date date,
  end_date   date,
  -- Safe default: anything not deliberately classified stays OFF public surfaces
  -- (a wrong public link is an accusation). The resolver always sets this explicitly.
  confidence text NOT NULL DEFAULT 'review'
    CHECK (confidence IN ('exact_id', 'high', 'medium', 'review', 'manual')),
  -- WHAT the two dates above MEAN, because the sources that fill them measure different
  -- events and a bare date range would present them as one kind of fact:
  --   'term'     the PARLIAMENT's term, bounded by the election that seated it and the one
  --              that seated its successor (MP roles). Not the oath: a chamber convenes days
  --              to weeks after its election — the 39th on 2001-07-05, 18 days after — so a
  --              'term' row overstates each end of an individual mandate by that much.
  --              The election bound is deliberate and is the only one that distinguishes a
  --              SHORT parliament from a partially-ingested one: the 45th sat 17 days and we
  --              hold all of them, the 44th sat four years and we hold five months, and the
  --              sittings alone cannot tell those apart. See NS_TERM_BOUNDS in
  --              scripts/person/resolve_persons.ts, which is the only writer.
  --   'election' the election that PRODUCED the mandate, parsed off the cycle in
  --              person_role.ref — a CANDIDACY, where no term is implied at all. Distinct
  --              from 'term' above, which also starts on an election date but names a period
  --              of office rather than the event.
  --   'filing'   the date a встъпителна / при напускане declaration was FILED with the
  --              Сметна палата. ЗПКОНПИ gives a one-month window, so it trails the real
  --              date by up to ~30 days and is an upper bound, never the appointment.
  -- NULL when both dates are NULL. The UI renders a different phrasing per basis; a
  -- consumer that ignores it will state a filing date as a start of office.
  date_basis text
    CHECK (date_basis IS NULL OR date_basis IN ('term', 'election', 'filing')),
  source_row jsonb,           -- raw record for provenance
  PRIMARY KEY (person_id, source, ref, role)
);
-- `CREATE TABLE IF NOT EXISTS` above is a no-op on a warm database, so date_basis reaches
-- one only through this ALTER. Idempotent, and it must stay: every path that applies 081
-- (apply_functions.ts, db:resolve:persons, scripts/person/add_override.ts) runs the file as
-- one implicit transaction, so a later statement referencing a missing column would roll the
-- whole file back — the 042/131 lesson in CLAUDE.md.
--
-- ⚠️ The whole block is SKIPPED once the column exists, and that guard is about LOCKS, not
-- speed. person_role is on the serving path (082's person_by_slug, 084's person_connections)
-- and this file is documented as safe to apply at any time, against a live database. But
-- `ALTER TABLE` takes an AccessExclusiveLock, and a lock request that cannot be granted
-- QUEUES — and every reader arriving after it queues behind it, even though they would not
-- have conflicted with each other. So one 40-minute analytic query turns a "no-op" re-apply
-- into a total outage on /person, /persons and /connections for as long as that query runs.
-- Measured 2026-08-10 while building this: eight readers stacked behind one ALTER.
--
-- Hence three defences: skip entirely in the steady state; fail FAST rather than queue when
-- there is work to do (lock_timeout — being unable to add the column is recoverable, heading
-- a lock queue is not); and add the CHECK as NOT VALID so it does not also scan the table
-- while holding that lock. VALIDATE afterwards takes only a ShareUpdateExclusiveLock, which
-- readers do not contend with.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'person_role' AND column_name = 'date_basis')
  THEN RETURN; END IF;

  SET LOCAL lock_timeout = '3s';
  ALTER TABLE person_role ADD COLUMN date_basis text;
  ALTER TABLE person_role ADD CONSTRAINT person_role_date_basis_check
    CHECK (date_basis IS NULL OR date_basis IN ('term', 'election', 'filing')) NOT VALID;

  -- Backfill the one basis that predates the column. Scoped to source='mp' rather than to
  -- "has a date": that IS the pre-existing populated set (1,522 start / 1,283 end, measured
  -- 2026-08-10), and scoping it there means a later writer that fills a date and forgets its
  -- basis is left visibly NULL instead of being silently relabelled a mandate.
  UPDATE person_role SET date_basis = 'term'
   WHERE source = 'mp' AND (start_date IS NOT NULL OR end_date IS NOT NULL);
END $$;

-- Outside the guard, so a run that added the column under a NOT VALID constraint (or an
-- earlier one that timed out mid-way) still converges. Both statements are no-ops once the
-- constraint is valid, and neither blocks a reader.
DO $$ BEGIN
  ALTER TABLE person_role VALIDATE CONSTRAINT person_role_date_basis_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- WHICH LICENCE a tr/ngo role was attached under, and the footprint the cap was measured
-- against WHEN IT WAS ATTACHED. Plan: docs/plans/person-role-unlicensed-bridge-v1.md.
--
-- ⚠️ THE POINT IS THE TENSE. A tr/ngo role attributes a COMPANY to a NAMED INDIVIDUAL, and
-- three bridges exist so that attribution is never made on a name alone (see
-- person_resolve.data.test.ts for what each licenses). Until now the licence was never
-- recorded — the gate RE-DERIVED it at test time from `tr_officers`, `tr_person_roles`,
-- `contracts`, `agri_subsidies`, `fund_beneficiaries`, `company_politicians` and
-- `magistrate_company`, every one of which is reloaded on its own schedule, independently of
-- `person_role`. So the gate was not asserting an invariant; it was asserting that two
-- corpora were the same vintage, which is false on any machine that has run
-- `tr:daily-refresh` since its last resolve.
--
-- Measured 2026-08-25: `person_role` was written 2026-08-22 18:56, `db:load:tr:pg` reloaded
-- the TR corpus 2026-08-24 22:20 (1,885 new companies), and 443 roles across 63 people —
-- every one of them attached under a footprint of 2..5, i.e. inside the cap — came back
-- "unlicensed" because their folds had since grown to 6..11. The resolver was blameless:
-- across the whole non-Bridge-A tr/ngo layer (82,247 people) NO person holds more than 5
-- distinct EIKs, so the cap has never once been exceeded at attach time.
--
--   'A'  curated company link — magistrate_company (NOT eik_ambiguous) ∪ company_politicians
--   'B'  people-unique public 3-part fold, ≤ FOOTPRINT_CAP companies, exact entity match
--   'V'  money-linked private owner (Tier V), name-only identity, ≤ FOOTPRINT_CAP companies
--
-- `bridge_footprint` is the distinct-company count the resolver measured for that person's
-- fold in the run that attached the row. It is what turns "how stale is this?" into a
-- subtraction against the CURRENT count rather than a recomputation — and it is NULL for
-- 'A', which is not capped on a footprint at all.
--
-- ⚠️ IT IS ONE COLUMN OVER TWO DIFFERENT BASE TABLES, and a consumer that re-derives it must
-- use the same one the resolver did. Bridge B counts `tr_person_roles` (bridgeB.ts's `hits`
-- CTE, the full-history officer/owner table); Tier V counts `tr_officers` (its mint's
-- `count(DISTINCT o.uic) <= 5`). The two agree on all 68,662 Tier-V folds today (measured
-- 2026-08-25, 0 where `tr_person_roles` exceeds `tr_officers`), which is exactly why a
-- divergence would be invisible — nothing fails while they match.
--
-- ⚠️ NO UPPER BOUND ON PURPOSE. The cap is `FOOTPRINT_CAP`, which lives once — in
-- scripts/person/bridgeB.ts, imported by both the resolver and the gate. A literal 5 here
-- would be a SECOND definition of a calibrated threshold, the class CLAUDE.md records
-- COMMON_NAME_TR_ROWS = 11 being deleted rather than ported for. The cap is asserted by the
-- gate, not by the schema. The LOWER bound is not arbitrary either: Bridge B's `footprint`
-- CTE is implicitly >= 1 (a person with no match never reaches `hits`) and Tier V's HAVING
-- group cannot be empty, so 0 is unreachable by construction and a stored 0 means a bug.
--
-- ⚠️ NULL IS "ATTACHED BEFORE THIS COLUMN EXISTED", NEVER "UNLICENSED". There is deliberately
-- NO BACKFILL: the licence is a fact about the corpus the resolver SAW, and that vintage is
-- not recoverable — `tr_officers` is TRUNCATE-and-reload with no history, and
-- `ingest_first_seen` records new COMPANIES so it is blind to a fold gaining an officer row
-- at a company that already existed (the ordinary way a footprint grows). Reconstructing the
-- value from today's tables would store a number nobody observed and then let a gate assert
-- it as an observation. So the column stays NULL until the next `db:resolve:persons`.
--
-- What reads it, and when: `person_resolve.data.test.ts` checks the stored licence and SKIPS
-- on an all-NULL corpus with its own distinct reason (step 4, landed 2026-08-25). The
-- freshness gate that measures how far the corpus has moved UNDER those licences —
-- `person_role_bridge_freshness.data.test.ts`, step 5 — is NOT YET WRITTEN, so until it lands
-- nothing reports the drift this plan diagnosed. Flip this sentence when it does; a schema
-- comment asserting a gate nobody built is the defect class this repo calls "rules written
-- here that were never turned into gates".
--
-- ⚠️ AND IT MUST BE IN resolve_persons.ts's `copyRows` LIST. `person` and `person_role` are
-- DELETEd and rebuilt every run, so a column dropped from that list comes back NULL for every
-- row with nothing failing — the `date_basis` failure class this file documents above, and
-- the reason the gate asserts `bridge IS NOT NULL` over the WHOLE tr/ngo set rather than a
-- sample.
--
-- Same three lock defences as the date_basis block: skip in the steady state, fail fast
-- rather than head a lock queue, and add the CHECK NOT VALID so it does not scan while
-- holding an AccessExclusiveLock.
--
-- ⚠️ `SET LOCAL` IS TRANSACTION-SCOPED, NOT BLOCK-SCOPED, and on a warm database this is the
-- FIRST statement in the file to set it — the date_basis block above RETURNs before its own
-- `SET LOCAL` once its column exists. So on that one upgrade run everything below inherits
-- the 3 s timeout: both VALIDATE blocks, the CREATE INDEXes, and the person_link_override
-- ALTERs at the foot of the file. That is the desirable direction (fail fast, and `exec()`
-- rolls the whole file back atomically) and it is left set deliberately — but an operator
-- debugging a 55P03 raised near the end of 081 needs to know it was armed up here.
--
-- ⚠️ THE GUARD TESTS BOTH COLUMNS, AND THE STATEMENTS ARE IDEMPOTENT. No applier can
-- currently produce a half-added state — all four send 081 through `exec()` as one
-- transaction, and a DO block is atomic even under `execEach` — but two quiet routes into it
-- exist: someone "completing" the date_basis convention by declaring `bridge` in the CREATE
-- TABLE above and stopping there (a FRESH database then mints one column, this block RETURNs,
-- and the other is never created), or a hand-run ALTER while debugging against Cloud SQL.
-- With a plain `ADD COLUMN`, the re-run that should repair it instead raises 42701 and rolls
-- back the whole file — aborting db:resolve:persons, add_override.ts and agri:ingest, all of
-- which apply 081. The outer guard still earns its place: a no-op `ADD COLUMN IF NOT EXISTS`
-- takes an AccessExclusiveLock anyway, so IF NOT EXISTS is not a substitute for skipping.
-- ⚠️ THE GUARD ALSO TESTS THE CONSTRAINT'S DEFINITION, not just the columns, and that is what
-- lets a TIGHTENING converge. A columns-only guard returns early on every warm database, so
-- the `IS TRUE` fix below would have reached fresh clones and nothing else — the change would
-- look landed, and the databases that already had the loose constraint would keep it for ever.
-- Matching on `pg_get_constraintdef` text is coarse (it can only tell "not yet tightened" from
-- "tightened"), so it is a convergence aid, not the assertion: the SEMANTICS are pinned by
-- inserting each row shape in scripts/db/tests/person_role_bridge.data.test.ts, which is what
-- would catch a guard that false-passes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'person_role'
                AND column_name = 'bridge')
 AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'person_role'
                AND column_name = 'bridge_footprint')
 AND EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.person_role'::regclass
                AND conname = 'person_role_bridge_footprint_check'
                AND pg_get_constraintdef(oid) LIKE '%IS TRUE%')
  THEN RETURN; END IF;

  SET LOCAL lock_timeout = '3s';
  ALTER TABLE person_role ADD COLUMN IF NOT EXISTS bridge text;
  ALTER TABLE person_role ADD COLUMN IF NOT EXISTS bridge_footprint int;
  -- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so DROP+ADD — the pattern this file already
  -- uses for person_identity_confidence_check. It is also what makes a TIGHTENING of either
  -- expression reach a warm database at all: a plain ADD is skipped for ever once the
  -- constraint exists, so the fix below would have landed only on fresh clones.
  ALTER TABLE person_role DROP CONSTRAINT IF EXISTS person_role_bridge_check;
  ALTER TABLE person_role ADD  CONSTRAINT person_role_bridge_check
    CHECK (bridge IS NULL OR bridge IN ('A', 'B', 'V')) NOT VALID;
  -- A footprint only means something beside a cap, and only B and V are capped. Storing one
  -- on an 'A' row would invite a consumer to compare it against FOOTPRINT_CAP and call a
  -- curated link over-sized; storing one with NO bridge at all asserts a measurement against
  -- a licence nobody recorded.
  --
  -- ⚠️ `IS TRUE` IS LOAD-BEARING — without it this constraint FAILS OPEN on exactly the row
  -- shape the header calls out. `bridge IN ('B','V')` is NULL when bridge is NULL, so
  -- `FALSE OR (NULL AND TRUE)` is NULL, and a CHECK accepts NULL: (bridge NULL, footprint 5)
  -- was admitted, verified by insert. `IS TRUE` forces two-valued logic. That shape is not
  -- hypothetical: the resolver has THREE writers of this pair (the roleRows COPY for 'A',
  -- the Bridge-B INSERT, the Tier-V INSERT), each supplying both columns independently, so
  -- any one of them setting a footprint without its licence produces exactly this shape.
  ALTER TABLE person_role DROP CONSTRAINT IF EXISTS person_role_bridge_footprint_check;
  ALTER TABLE person_role ADD  CONSTRAINT person_role_bridge_footprint_check
    CHECK (bridge_footprint IS NULL
           OR (bridge IN ('B', 'V') IS TRUE AND bridge_footprint >= 1))
    NOT VALID;
END $$;

DO $$ BEGIN
  ALTER TABLE person_role VALIDATE CONSTRAINT person_role_bridge_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE person_role VALIDATE CONSTRAINT person_role_bridge_footprint_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Reverse lookup: which person owns a given source record (source native key -> person).
-- The leading `source` column also serves facet filtering; person-scoped lookups
-- ("everything for person N") ride the PK's leading person_id.
CREATE INDEX IF NOT EXISTS idx_person_role_source_ref ON person_role (source, ref);
-- …and `ref` ALONE, because a great many callers do not know the source. `(source, ref)` cannot
-- serve `WHERE ref = $1`: with no leading-column predicate Postgres falls back to scanning the
-- whole index per probe. Measured 2026-08-04 on `officials_person_slug()`'s retired-slug
-- anti-join — 23,916 probes × 3.1 ms = **74 s and 62.1M buffers** for one query, which is what
-- kept officials_redirect.data.test.ts pressed against its 120 s timeout. With this index the
-- same query is ~1 s.
--
-- This is the "index BOTH sides of the join key" rule (docs: the PG query-performance playbook).
-- `person_role.ref` is a join target from several directions — the officials redirect, the
-- slug-retirement collapse, the declarations resolver — and only some of them can name a source.
CREATE INDEX IF NOT EXISTS idx_person_role_ref ON person_role (ref);

-- ---------------------------------------------------------------------------
-- person_link_override — human adjudication, audited. Replaces the scattered
-- scripts/officials/_aliases.json. The resolver applies these LAST, after every automatic
-- tier, so an override always wins (plan §3 tier 4; scripts/person/overrides.ts is the
-- applier, scripts/person/add_override.ts the operator writer). THREE operations:
--
--   merge (fold_a + fold_b)      union the two NAME FOLDS into one person (a marriage rename,
--                                a translit variant that scattered one person across blocks).
--   split (fold_a + fold_b)      forbid two DIFFERENT folds from auto-merging (peel fold_b off
--                                fold_a) — undoes a wrong cross-block gold/merge union.
--   split (ref_a)                ISOLATE ONE mention by its source-native ref
--                                (`{election}:{slug}`, `mp:{id}`, an officials slug, …). This
--                                vetoes even a Tier-0 GOLD union — the case a name fold is too
--                                coarse for: a CIK candidacy `matchMp()` bound to the WRONG
--                                same-name MP shares BOTH the fold and the mp-id hardId with
--                                the real MP, so only a mention-specific veto can split them.
--
-- fold_a/fold_b are NULLABLE (a ref-split targets a ref, not a fold); ref_a/ref_b are added
-- idempotently below so an already-migrated DB gains them without a data reset. The columns
-- hold translit_bg_latin() folds (the ONE normalizer) — add_override.ts folds the raw name.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_link_override (
  override_id bigserial PRIMARY KEY,
  fold_a      text,
  fold_b      text,
  ref_a       text,   -- ref-split target: a mention's source-native ref / id
  ref_b       text,   -- optional second ref to isolate in the same audited decision
  kind        text NOT NULL CHECK (kind IN ('merge', 'split')),
  note        text,
  decided_by  text,
  decided_at  timestamptz NOT NULL DEFAULT now()
);
-- Self-healing for a DB created before ref-level targeting existed: add the ref columns and
-- relax the historical NOT NULL on the fold columns (both idempotent — the resolver re-applies
-- this file every run).
ALTER TABLE person_link_override ADD COLUMN IF NOT EXISTS ref_a text;
ALTER TABLE person_link_override ADD COLUMN IF NOT EXISTS ref_b text;
ALTER TABLE person_link_override ALTER COLUMN fold_a DROP NOT NULL;
ALTER TABLE person_link_override ALTER COLUMN fold_b DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_person_link_override_folds
  ON person_link_override (fold_a, fold_b);
CREATE INDEX IF NOT EXISTS idx_person_link_override_ref
  ON person_link_override (ref_a);

-- ---------------------------------------------------------------------------
-- person_link_evidence — external corroboration for a person↔company/person link,
-- produced by the reconcile-person-link skill (plan §5a). Articles are a LEAD, not
-- proof: a human sets `verdict`; the LLM never sets confidence/status. Confirmed
-- rows surface as CITED SOURCES on the person page, never as an accusation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_link_evidence (
  evidence_id  bigserial PRIMARY KEY,
  person_id    bigint NOT NULL REFERENCES person (person_id) ON DELETE CASCADE,
  subject      text NOT NULL,   -- 'company:{eik}' | 'person:{id}' | 'contract:{unp}' | 'role:{…}'
  claim        text,            -- one-line extracted claim
  url          text NOT NULL,   -- the article/source URL
  outlet       text,            -- publication name/domain
  excerpt      text,            -- short verbatim quote (<= 25 words, copyright rule)
  found_by     text NOT NULL DEFAULT 'manual'
    CHECK (found_by IN ('llm-research', 'manual')),
  retrieved_at timestamptz,
  verdict      text NOT NULL DEFAULT 'unreviewed'
    CHECK (verdict IN ('unreviewed', 'confirms', 'refutes', 'irrelevant')),
  decided_by   text,
  decided_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_person_link_evidence_person
  ON person_link_evidence (person_id);
