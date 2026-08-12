-- 104_mp_roster.sql — the parliament.bg MP roster + declared-vehicle rows, in Postgres.
--
-- The join spine Tier 0 needs before any frontend moves (persons-pg-retirement-v1.md;
-- Tier 2 migrates the hooks). Two load-source tables, nothing derived:
--
--   mp_profile  <- data/parliament/index.json   (2,122 MPs, written by parliament-scrape)
--   mp_car      <- data/parliament/mp-cars.json (624 vehicles, written by
--                                                scripts/declarations/build_car_makes.ts)
--
-- Both are COPYed by scripts/db/load_mp_roster_pg.ts. 105_mp_serving.sql builds the
-- matviews + serving fns on top.
--
-- ---------------------------------------------------------------------------
-- WHY THE CAR ROWS ARE LOADED AND NOT DERIVED IN SQL.
--
-- Every column of mp_car except `make` is a plain projection of declaration_asset
-- (category = 'vehicle'), so deriving the table here looks tempting. `make` is the
-- reason not to: it comes from BRAND_ALIASES in build_car_makes.ts — a ~100-entry
-- Cyrillic→canonical alias map ("ФОЛЦВАГЕН"/"ФОКСВАГЕН"/"VW" → Volkswagen) matched
-- longest-key-first, plus an isCarDescription() filter that excludes motorcycles,
-- trailers and utility vehicles so the column compares like for like. That map is
-- maintained by re-running the build and reading its own `unmatchedSamples` output.
-- Re-implementing it in SQL would give the site two brand vocabularies with no test
-- that they agree, and they would drift on the first alias added to one of them.
--
-- So: the TypeScript builder stays the single definition of "which vehicle rows are
-- cars and what make is each", and Postgres serves what it produced.
--
-- ---------------------------------------------------------------------------
-- WHY NEITHER TABLE STORES person_id.
--
-- The person layer is rebuilt wholesale by scripts/person/resolve_persons.ts, which
-- re-mints person_id values. A person_id column here would be correct only until the
-- next resolve and silently wrong afterwards, and an FK would make the roster load
-- order-dependent on a resolve it has no other reason to wait for.
--
-- person_role already holds the mapping — source = 'mp', ref = the mp id, covered by
-- idx_person_role_source_ref — and it is rewritten by the same resolve that moves the
-- ids, so it cannot go stale. Every person-keyed surface in 105 joins through it.

CREATE TABLE IF NOT EXISTS mp_profile (
  -- parliament.bg's own MP id. Stable across scrapes and across parliaments: it keys
  -- the photo binaries (parliament/photos/<mp_id>.webp, the one person artifact that
  -- stays on the bucket) and the LEADING FIELD of person_role.ref for source = 'mp'.
  --
  -- That ref is `'<mpId>'` for an MP the roster lists no parliaments for (945 of 3,873 rows)
  -- and `'<mpId>:<ns>'` — one row per mandate — for the rest. Every consumer therefore joins
  -- through `split_part(r.ref, ':', 1)`, never on `ref` itself; 105's header carries the
  -- same note. A join written against the bare form matches only a quarter of the corpus.
  mp_id                     integer PRIMARY KEY,
  name                      text    NOT NULL,
  name_en                   text,
  -- Uppercased forms the roster search folds on. Stored rather than recomputed
  -- because normalizeMpName() in src/lib/utils.ts owns that normalisation and the
  -- client re-applies it on hydrate; a second SQL definition would drift.
  normalized_name           text,
  normalized_name_en        text,
  -- Relative ("/parliament/photos/10.webp") for the bucket-hosted default, or an
  -- absolute http(s) URL for the handful of externally-hosted portraits. The client
  -- resolves the relative form through dataUrl(); see resolvePhoto in useMpEntry.tsx.
  photo_url                 text,
  -- Current mandate only — NULL for every MP not sitting in the current NS.
  current_region_code       text,
  current_region_name       text,
  -- The МИР the MP was SEATED from, off their own parliament.bg profile record. Distinct
  -- from current_region_* above, which comes from the CURRENT-NS roster and is therefore
  -- NULL for every MP who no longer sits (240 of 2,122 populated, vs 2,122 here).
  -- mp_entry must serve it because the by-id shard carries it and the two are held to
  -- byte parity by mp_serving.data.test.ts.
  seated_region_code        text,
  seated_region_name        text,
  current_party_group       text,
  current_party_group_short text,
  -- The coalition the MP was ELECTED with, off their own profile record. The two columns
  -- above come from the CURRENT-NS roster, so they are NULL for all ~1,880 former MPs;
  -- this is populated for 1,683 of the 2,122 rows, of which 1,443 have no party anywhere
  -- else. Same shape as seated_region_*: present for the people the roster forgets.
  --
  -- ONE value per person, so it is a career badge and NOT per-parliament. Measured
  -- against the roll-call-derived group for the 72 MPs who changed group, it matches the
  -- last NS 12 times, the first 4, both 17, and neither endpoint 27. Render it as
  -- "elected with"; never as the group they sat with in a given NS, and never write it
  -- into person_role.party (whose contract is the group ENTERED per parliament).
  elected_with              text,
  position_title            text,
  birth_date                date,
  -- Which parliaments this MP sat in ("39" … "52"). The scope dimension every
  -- per-NS rollup fans out on in 105.
  ns_folders                text[] NOT NULL DEFAULT '{}',
  is_current                boolean NOT NULL DEFAULT false,
  scraped_at                timestamptz
);

-- The current-roster read ("who sits today") is the one hot filter; everything else
-- goes through the 105 matviews, which carry their own indexes.
CREATE INDEX IF NOT EXISTS idx_mp_profile_current ON mp_profile (mp_id) WHERE is_current;
-- The mp_profile side of the person_role join key is indexed: idx_person_role_source_ref
-- covers (source, ref); this covers the text cast used to meet it.
CREATE INDEX IF NOT EXISTS idx_mp_profile_ref ON mp_profile ((mp_id::text));

CREATE TABLE IF NOT EXISTS mp_car (
  -- Surrogate key: a declaration can list two indistinguishable vehicles (same make,
  -- year and value), so no natural key exists. Assigned by the load order, which is
  -- the builder's output order — deterministic for a given input file.
  car_id            bigserial PRIMARY KEY,
  mp_id             integer NOT NULL,
  -- Canonical brand from BRAND_ALIASES, or NULL when the declared text matched no
  -- alias. NULL is a real and reportable state ("unknown make"), not a gap to hide:
  -- the builder reports those rows as `unmatchedSamples` so the map can be extended.
  make              text,
  detail            text,
  description       text,
  acquired_year     integer,
  value_eur         numeric,
  -- The declarant's own figure in their own currency, kept so the UI can footnote
  -- the original alongside the pegged euro value.
  amount            numeric,
  currency          text,
  is_spouse         boolean NOT NULL DEFAULT false,
  share             text,
  -- How many source rows the builder folded into this one (a vehicle re-declared
  -- across filings). 1 for an unmerged row.
  merged_from_count integer NOT NULL DEFAULT 1,
  declaration_year  integer,
  source_url        text
);

CREATE INDEX IF NOT EXISTS idx_mp_car_mp ON mp_car (mp_id);

-- Self-healing for a database created before these columns existed. `CREATE TABLE IF NOT
-- EXISTS` above is a no-op on a warm database, so every new column needs a line here or it
-- reaches a fresh clone and nothing else — the drift 003 documents.
ALTER TABLE mp_profile ADD COLUMN IF NOT EXISTS seated_region_code text;
ALTER TABLE mp_profile ADD COLUMN IF NOT EXISTS seated_region_name text;
ALTER TABLE mp_profile ADD COLUMN IF NOT EXISTS elected_with text;
