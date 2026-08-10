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
  -- Distinct-company count for the name = the defamation guard, carried onto the
  -- person so every consumer inherits one <= N gate instead of re-deriving it.
  namesake_risk    integer NOT NULL DEFAULT 0,
  -- 'review' = aggressive-merge holding area; NEVER rendered publicly until promoted.
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'review')),
  -- How this person's IDENTITY was established (S4). 'resolved' = the normal cross-source
  -- resolution (office-holders, candidates, bridged public figures). 'verified' = a Tier-V
  -- private owner minted from the Commerce Registry by name-fold — a globally person-shaped,
  -- ≤5-firm, money-linked owner (is_public_figure stays FALSE; the name is a strong but
  -- name-only identity). Consumers gate/serve on it: 082 serves a 'verified' private on /person,
  -- and 120 places it in the частен-сектор (tier V) slice, never the public default.
  identity_confidence text NOT NULL DEFAULT 'resolved'
                        CHECK (identity_confidence IN ('resolved', 'verified')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- CREATE TABLE IF NOT EXISTS won't add identity_confidence to an already-built person table, so
-- ALTER it in (S4). Idempotent.
ALTER TABLE person ADD COLUMN IF NOT EXISTS identity_confidence text NOT NULL DEFAULT 'resolved';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'person_identity_confidence_check') THEN
    ALTER TABLE person ADD CONSTRAINT person_identity_confidence_check
      CHECK (identity_confidence IN ('resolved', 'verified'));
  END IF;
END $$;
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
  --   'term'     the mandate itself (MP terms — the only basis populated before
  --              person-enrichment-v1; an actual start and end of office).
  --   'election' the election that PRODUCED the mandate, parsed off the cycle in
  --              person_role.ref. The mandate legally starts at the constitutive session,
  --              days to weeks later, so this is the event and not the oath.
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
