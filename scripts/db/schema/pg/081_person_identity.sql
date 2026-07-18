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
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
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
  place      text,            -- oblast/obshtina where relevant
  start_date date,
  end_date   date,
  -- Safe default: anything not deliberately classified stays OFF public surfaces
  -- (a wrong public link is an accusation). The resolver always sets this explicitly.
  confidence text NOT NULL DEFAULT 'review'
    CHECK (confidence IN ('exact_id', 'high', 'medium', 'review', 'manual')),
  source_row jsonb,           -- raw record for provenance
  PRIMARY KEY (person_id, source, ref, role)
);
-- Reverse lookup: which person owns a given source record (source native key -> person).
-- The leading `source` column also serves facet filtering; person-scoped lookups
-- ("everything for person N") ride the PK's leading person_id.
CREATE INDEX IF NOT EXISTS idx_person_role_source_ref ON person_role (source, ref);

-- ---------------------------------------------------------------------------
-- person_link_override — human adjudication, audited. Replaces the scattered
-- scripts/officials/_aliases.json. The resolver applies these LAST (plan §3 tier 4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_link_override (
  override_id bigserial PRIMARY KEY,
  fold_a      text NOT NULL,
  fold_b      text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('merge', 'split')),
  note        text,
  decided_by  text,
  decided_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_person_link_override_folds
  ON person_link_override (fold_a, fold_b);

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
