-- 160_council_corpus.sql — municipal-council (общински съвет) resolutions and
-- named votes, the corpus behind /council, the My-Area council tile, the
-- My-Area alerts feed and the AI chat's councilResolutions tool.
--
-- WHY THIS EXISTS. The corpus was JSON-only and served from the bucket, and
-- that shape cost it data twice over:
--
--   1. `data/council/index.json` is CAPPED at 200 resolutions per município
--      (PER_MUNI_LIMIT) and STRIPPED of `tally.perCouncillor`. Six of sixteen
--      municipalities have more history than the cap, so the served index has
--      never been able to describe them.
--   2. The per-município votes shard was rebuilt from that stripped index, so
--      530 resolutions and 10,754 per-councillor rows sat in the durable tree
--      unserved from 2026-05 until 2026-08-16. See the header of
--      scripts/council/lib/index_writer.ts.
--
-- The loader therefore reads the DURABLE per-resolution shard tree
-- (data/council/<code>/<YYYY>/<id>.json) — unstripped and uncapped — and NOT
-- index.json or votes/*.json. Those two remain as the legacy serving path
-- until the consumers move; they are derivatives, not sources.
--
-- COVERAGE IS THE POINT AND IT IS SMALL: 16 of 265 общински съвета (6.4%), and
-- only 5 of those publish named votes (BGS01, PER32, SOF, SZR12, VTR01). Any
-- surface reading this must state that. `has_named_votes` exists on both
-- grains so a page can say "this council does not publish named votes" rather
-- than rendering an empty list, which reads as "nobody voted".
--
-- No `ekatte` and no party column: an obshtina is not a settlement, so
-- place_dim carries no ekatte at this grain, and the corpus has no party
-- information at all (perCouncillor is exactly {name, normKey, vote} on all
-- 29,054 rows). Both were here as always-NULL columns, which is worse than
-- absent — the loader nulls them on every run, so anything filling them out of
-- band would be silently wiped. The reconcile block can add either at no cost
-- the day a source exists.
--
-- `returned` (чл.45 ЗМСМА governor veto) is IN the result domain even though
-- the corpus has none today: it is a legal outcome, and folding it into
-- `unknown` would hide it inside a bucket that already means "unparseable".
--
-- `result` is 'unknown' on 43% of the corpus (2,034 of 4,676) — the plurality
-- case for one município. A page rendering adopted/rejected as a binary
-- misreports nearly half of it; that is the same absence-vs-no-data
-- distinction `has_named_votes` exists for.
--
-- Applied by scripts/db/load_council_pg.ts (npm run db:load:council:pg), which
-- must run AFTER db:resolve:persons (the person_id bridge), after
-- db:load:place-dim:pg (ekatte) and after db:load:official-candidate-links:pg
-- (the party label). Plan: docs/plans/council-hub-v1.md §4.
--
-- ⚠️ `db:resolve:persons` runs `DELETE FROM person` and re-COPYs with
-- person_id as a POSITIONAL ordinal, so `council_vote.person_id` is nulled
-- table-wide on every re-resolve (ON DELETE SET NULL, the 089 shape) and this
-- loader is what re-attaches it. Running the resolve without re-running this
-- loader leaves every named vote unattributed — the declarations `--resolve`
-- trap, one table over.

-- ---------------------------------------------------------------------------
-- Municipality dimension
-- ---------------------------------------------------------------------------
-- ⚠️ `roster_code` is NOT `obshtina_code`, and conflating them attaches votes
-- to the WRONG council. The three code spaces do not agree:
--
--   council key   BGS01  = Община Бургас        (this table's PK)
--   frontend code BGS04  = Община Бургас        (council_muni_code below)
--   roster code   BGS04  = Община Бургас        (official_roster.obshtina)
--
-- and `official_roster` ALSO contains a row set under `BGS01` — a DIFFERENT
-- município (28 councillors, disjoint names). So joining the council's own key
-- to the roster silently resolves Burgas's votes against another council's
-- members: mostly NULL, and a coincidental name match is a real vote credited
-- to the wrong person. Sofia is the other shape — council `SOF`, roster
-- `SFO_CITY`. The loader derives this via rosterShardForObshtina() so the rule
-- has one definition (src/data/council/councilObshtinaMap.ts).
CREATE TABLE IF NOT EXISTS council_muni (
  obshtina_code    text PRIMARY KEY,
  roster_code      text,
  name             text NOT NULL,
  last_ingest      timestamptz,
  resolution_count int  NOT NULL DEFAULT 0,
  named_vote_count int  NOT NULL DEFAULT 0,
  has_named_votes  boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------
-- Frontend-code bridge — the mapping is MANY-to-one, not 1:1
-- ---------------------------------------------------------------------------
-- The two code spaces genuinely differ (BGS01<->BGS04, VTR01<->VTR04), and
-- that mismatch has already silently rendered nothing once — see
-- src/data/council/councilObshtinaMap.ts.
--
-- A scalar column on council_muni CANNOT express it. Sofia's Столичен общински
-- съвет legislates for the whole city, so 27 frontend codes resolve to the one
-- 'SOF' council: the 24 S2*** district codes plus SFO_CITY, SOF00 and SOF. A
-- scalar holds one of them, and Sofia is the worst possible município to lose
-- — the largest in the country and one of only five publishing named votes.
-- The loader expands the S2* prefix rule into rows (a closed set from
-- data/municipalities.json).
--
-- frontend_code is the PRIMARY KEY because that is the uniqueness that
-- matters: one frontend code must never resolve to two councils.
CREATE TABLE IF NOT EXISTS council_muni_code (
  frontend_code text PRIMARY KEY,
  obshtina_code text NOT NULL
                  REFERENCES council_muni(obshtina_code) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- Resolutions
-- ---------------------------------------------------------------------------
-- `last_seen_at` rather than an anti-join delete: a council resolution is a
-- permanent public record, so a scrape that misses a protocol — or a parser
-- regression on one município — must never erase history. The loader is
-- upsert-only for the same reason. This is the one place where the repo's
-- standard stage-merge shape is wrong for the corpus.
CREATE TABLE IF NOT EXISTS council_resolution (
  id              text PRIMARY KEY,
  -- RESTRICT, deliberately asymmetric with council_vote below. council_muni is
  -- a DIMENSION carrying derived counters, so it is the table most likely to be
  -- rebuilt wholesale by a future loader — and under CASCADE a single
  -- `DELETE FROM council_muni` would erase the permanent record this file
  -- exists to protect, silently and in one statement. The vote->resolution
  -- CASCADE below IS correct: a vote has no meaning without its resolution and
  -- both are written by the same upsert. Do not "tidy" the two into agreement.
  obshtina_code   text NOT NULL
                    REFERENCES council_muni(obshtina_code) ON DELETE RESTRICT,
  decided_on      date NOT NULL,
  session         text,
  number          text,
  title           text NOT NULL,
  -- Bulgarian only. The НФЦ-style summaries are optional and produced by a
  -- later Gemini pass; there is no title_en anywhere in the corpus and this
  -- table deliberately does not invent one (see the /en policy in
  -- docs/plans/council-hub-v1.md §7).
  summary_bg      text,
  summary_en      text,
  result          text CHECK (result IN ('adopted', 'rejected', 'returned', 'unknown')),
  tally_for       int,
  tally_against   int,
  tally_abstain   int,
  tally_method    text CHECK (tally_method IN ('open', 'named', 'secret', 'none')),
  has_named_votes boolean NOT NULL DEFAULT false,
  source_url      text,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- The loader MUST set this explicitly in its ON CONFLICT DO UPDATE arm.
  -- DEFAULT now() fires on INSERT only, so a frozen value silently turns
  -- "last seen" into "first seen" and inverts the absence-tracking this table
  -- uses in place of an anti-join delete.
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Named votes
-- ---------------------------------------------------------------------------
-- `person_id` is NULLable, municipality-scoped and NEVER guessed. The parser
-- emits `norm_key` — a lowercased Cyrillic name handle of VARIABLE arity, not
-- first+last: measured over all 29,054 rows it is 2 tokens 20,599 times, 3
-- tokens 8,305 times and 4 tokens 150 times. Mixed arity is a real hazard for
-- the roster bridge, since one councillor recorded two ways becomes two
-- identities — the loader folds on it and the data test gates it. The loader resolves it against the officials roster FOR THAT
-- MUNICÍPIO and refuses a name held by more than one person there, matching
-- mp_tr_roles / place_mp_companies. Scoping is the whole safety margin: a
-- two-token Bulgarian name matched nationally across ~4,700 councillors would
-- be weaker than the client-side join this replaces, not stronger.
--
-- `councillor` keeps the protocol's own spelling and is what any UI displays;
-- attributing it to a person is a separate, gated claim.
CREATE TABLE IF NOT EXISTS council_vote (
  resolution_id  text NOT NULL
                   REFERENCES council_resolution(id) ON DELETE CASCADE,
  norm_key       text NOT NULL,
  councillor     text NOT NULL,
  vote           text NOT NULL CHECK (vote IN ('for', 'against', 'abstain')),
  person_id      bigint REFERENCES person (person_id) ON DELETE SET NULL,
  PRIMARY KEY (resolution_id, norm_key)
);

-- ---------------------------------------------------------------------------
-- Reconcile block — what actually reaches a WARM database
-- ---------------------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS is a no-op where the table already exists, so
-- without these a new column reaches a fresh clone and nowhere else. Keep this
-- list in lockstep with the definitions above (the 003 lesson).
--
-- A column WITH a DEFAULT may carry NOT NULL — PG11+ applies it as a fast
-- default with no table rewrite. A column WITHOUT one may not: ADD COLUMN
-- NOT NULL and no default fails on a non-empty table and, exec() sending the
-- file as one transaction, would abort the whole migration on a warm database.
-- That is the only reason the nullable columns below are added bare.
--
-- All four tables are INTRODUCED by this file, so today every database takes
-- the CREATE path and these ALTERs are inert. They start mattering at the
-- first later edit that adds a column. Note what they cannot restore: a
-- column acquired through ADD COLUMN gets no FK, CHECK or PK — those need a
-- hand-written guarded ALTER, and the CHECK below is the worked example.
ALTER TABLE council_muni ADD COLUMN IF NOT EXISTS roster_code      text;
ALTER TABLE council_muni ADD COLUMN IF NOT EXISTS name             text;
ALTER TABLE council_muni ADD COLUMN IF NOT EXISTS last_ingest      timestamptz;
ALTER TABLE council_muni ADD COLUMN IF NOT EXISTS resolution_count int NOT NULL DEFAULT 0;
ALTER TABLE council_muni ADD COLUMN IF NOT EXISTS named_vote_count int NOT NULL DEFAULT 0;
ALTER TABLE council_muni ADD COLUMN IF NOT EXISTS has_named_votes  boolean NOT NULL DEFAULT false;

ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS obshtina_code   text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS decided_on      date;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS session         text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS number          text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS title           text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS summary_bg      text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS summary_en      text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS result          text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS tally_for       int;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS tally_against   int;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS tally_abstain   int;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS tally_method    text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS has_named_votes boolean NOT NULL DEFAULT false;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS source_url      text;
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS first_seen_at   timestamptz NOT NULL DEFAULT now();
ALTER TABLE council_resolution ADD COLUMN IF NOT EXISTS last_seen_at    timestamptz NOT NULL DEFAULT now();

-- Guarded, NOT VALID so it costs nothing on a populated table: a warm database
-- that acquired `vote` via ADD COLUMN would otherwise carry no CHECK at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'council_vote_vote_check'
  ) THEN
    ALTER TABLE council_vote ADD CONSTRAINT council_vote_vote_check
      CHECK (vote IN ('for', 'against', 'abstain')) NOT VALID;
  END IF;
END $$;

ALTER TABLE council_vote ADD COLUMN IF NOT EXISTS councillor text;
ALTER TABLE council_vote ADD COLUMN IF NOT EXISTS vote       text;
ALTER TABLE council_vote ADD COLUMN IF NOT EXISTS person_id  bigint;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Neither serving function is plannable without these: the município page is a
-- date-ordered range scan per council, the councillor page a point lookup per
-- person, and the loader's roster bridge probes by norm_key.
CREATE INDEX IF NOT EXISTS idx_council_res_muni_date
  ON council_resolution (obshtina_code, decided_on DESC);
CREATE INDEX IF NOT EXISTS idx_council_res_named
  ON council_resolution (obshtina_code, decided_on DESC)
  WHERE has_named_votes;
CREATE INDEX IF NOT EXISTS idx_council_vote_person
  ON council_vote (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_council_vote_norm_key
  ON council_vote (norm_key);
-- The reverse lookup "which frontend codes belong to this council".
-- frontend_code itself is served by council_muni_code's PRIMARY KEY.
CREATE INDEX IF NOT EXISTS idx_council_muni_code_obshtina
  ON council_muni_code (obshtina_code);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Role-guarded (the 117/130 shape): roles are CLUSTER-wide, so a virgin pgdata
-- volume has no app_readonly and a bare GRANT would raise 42704 and — exec()
-- sending the file as one transaction — roll the whole migration back. The
-- guard is load-bearing on Cloud SQL, where roles_readonly.sql is a hand-run
-- step. Note the inverted failure it buys: the load now SUCCEEDS with no ACL,
-- and /api/db 42501s against a corpus whose row counts all reconcile.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON council_muni       TO app_readonly;
    GRANT SELECT ON council_muni_code  TO app_readonly;
    GRANT SELECT ON council_resolution TO app_readonly;
    GRANT SELECT ON council_vote       TO app_readonly;
  ELSE
    RAISE WARNING '[160] app_readonly absent — council_* tables carry no ACL. Run roles_readonly.sql, then re-apply.';
  END IF;
END $$;
