-- 195_election_national_results.sql — normalized national election results.
-- Reconciled to granular CIK-derived rows. Local elections are absent because
-- their real grains are municipality, mayoral round, council and settlement.

CREATE TABLE IF NOT EXISTS election_contest (
  contest_id             text PRIMARY KEY,
  contest_key            text NOT NULL,
  election_type          text NOT NULL CHECK (election_type IN ('parliamentary', 'presidential')),
  result_grain           text NOT NULL CHECK (result_grain = 'national'),
  election_date          date NOT NULL,
  cycle_year             integer NOT NULL,
  round                  smallint,
  registered_voters      bigint,
  actual_voters          bigint,
  pct_denominator_votes  bigint NOT NULL CHECK (pct_denominator_votes > 0),
  none_of_above_votes    bigint,
  invalid_votes          bigint,
  percentage_basis       text NOT NULL,
  source_path            text NOT NULL,
  source_sha256          text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  granular_source_path   text NOT NULL,
  granular_sha256        text NOT NULL CHECK (granular_sha256 ~ '^[a-f0-9]{64}$'),
  granular_reconciled    boolean NOT NULL,
  CHECK ((election_type = 'presidential') = (round IS NOT NULL)),
  CHECK (round IS NULL OR round BETWEEN 1 AND 2),
  CHECK (none_of_above_votes IS NULL OR none_of_above_votes >= 0),
  CHECK (invalid_votes IS NULL OR invalid_votes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_election_contest_identity
  ON election_contest (election_type, contest_key, COALESCE(round, 0));

CREATE TABLE IF NOT EXISTS election_national_result (
  contest_id          text NOT NULL REFERENCES election_contest(contest_id) ON DELETE CASCADE,
  result_grain        text NOT NULL CHECK (result_grain = 'national'),
  choice_key          text NOT NULL,
  choice_kind         text NOT NULL CHECK (choice_kind IN ('party', 'independent', 'presidential_ticket')),
  choice_number       integer NOT NULL,
  canonical_party_id  text,
  president_name      text,
  vice_president_name text,
  choice_name         text NOT NULL,
  choice_short        text,
  votes               bigint NOT NULL CHECK (votes >= 0),
  pct                 double precision NOT NULL CHECK (pct >= 0 AND pct <= 100),
  seats               integer,
  passed_threshold    boolean,
  PRIMARY KEY (contest_id, choice_key),
  UNIQUE (contest_id, choice_number),
  CHECK (
    (choice_kind = 'party' AND canonical_party_id IS NOT NULL AND president_name IS NULL AND vice_president_name IS NULL)
    OR (choice_kind = 'independent' AND canonical_party_id IS NULL AND president_name IS NULL AND vice_president_name IS NULL)
    OR (choice_kind = 'presidential_ticket' AND canonical_party_id IS NULL AND president_name IS NOT NULL AND vice_president_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_election_national_result_party
  ON election_national_result (canonical_party_id, contest_id)
  WHERE canonical_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_election_national_result_votes
  ON election_national_result (contest_id, votes DESC, choice_number);

DROP FUNCTION IF EXISTS election_national_results(text, integer, integer);
DROP FUNCTION IF EXISTS election_national_results(text, text, integer);
CREATE OR REPLACE FUNCTION election_national_results(
  p_election_type text,
  p_contest_key text,
  p_round integer DEFAULT NULL
)
RETURNS TABLE (
  election_id text,
  contest_key text,
  election_type text,
  result_grain text,
  election_date date,
  round smallint,
  registered_voters bigint,
  actual_voters bigint,
  pct_denominator_votes bigint,
  none_of_above_votes bigint,
  invalid_votes bigint,
  percentage_basis text,
  choice_key text,
  choice_kind text,
  choice_number integer,
  canonical_party_id text,
  president_name text,
  vice_president_name text,
  choice_name text,
  choice_short text,
  votes bigint,
  pct double precision,
  seats integer,
  passed_threshold boolean,
  source_path text,
  source_sha256 text,
  granular_source_path text,
  granular_sha256 text
)
LANGUAGE sql STABLE AS $$
SELECT c.contest_id, c.contest_key, c.election_type, c.result_grain,
       c.election_date, c.round, c.registered_voters, c.actual_voters,
       c.pct_denominator_votes, c.none_of_above_votes, c.invalid_votes,
       c.percentage_basis, r.choice_key, r.choice_kind, r.choice_number,
       r.canonical_party_id, r.president_name, r.vice_president_name,
       r.choice_name, r.choice_short, r.votes, r.pct, r.seats,
       r.passed_threshold, c.source_path, c.source_sha256,
       c.granular_source_path, c.granular_sha256
FROM election_contest c
JOIN election_national_result r USING (contest_id)
WHERE c.election_type = p_election_type
  AND c.contest_key = p_contest_key
  AND (p_round IS NULL OR c.round = p_round)
  AND c.granular_reconciled
ORDER BY r.votes DESC, r.choice_number;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON election_contest, election_national_result TO app_readonly;
    GRANT EXECUTE ON FUNCTION election_national_results(text, text, integer) TO app_readonly;
  END IF;
END $$;
