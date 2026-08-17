-- 161_council_serving.sql — the serving layer over the council corpus (160).
--
-- APPLIED, NEVER LOADED. `db:load:council:pg` applies it, so a corpus reload
-- always carries it; a body fix on its own ships with:
--
--   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
--     npx tsx scripts/db/apply_functions.ts 161_council_serving.sql
--
-- Note `deploy:db` ships functions/ code, which is a different thing from a
-- Postgres function — it does NOT carry this file.
--
-- ATTENDANCE IS NOT AN ABSENCE RECORD, and every payload here says so. Bulgarian
-- protokols list ONLY the councillors who voted, so there is no per-resolution
-- roll of who was missing. Attendance is therefore
--   (resolutions this councillor appears in) / (resolutions with ANY named vote)
-- for their council — a participation SHARE, not "missed N sessions". The
-- caveat rides in the payload (`attendanceBasis`) rather than in a comment,
-- because a consumer cannot see this comment and the difference is defamatory
-- in the wrong direction.
--
-- DISSENT needs a party reference frame and this corpus has none: perCouncillor
-- is exactly {name, normKey, vote} on all 29,054 rows, and 160 deliberately
-- dropped the always-NULL party column. So dissent is measured against the
-- COUNCIL's own majority on each resolution, not a party's, and is named
-- `againstMajorityPct` rather than `dissent` so it cannot be read as the
-- parliamentary metric of the same name.

-- ---------------------------------------------------------------------------
-- The basis strings — API contract, not decoration
-- ---------------------------------------------------------------------------
-- These ship INSIDE every payload that reports a participation or dissent
-- figure, because the numbers are defamatory in the wrong direction without
-- them and a consumer cannot see a SQL comment. Defined once so two payloads
-- cannot describe the same metric differently.
CREATE OR REPLACE FUNCTION council_attendance_basis()
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Протоколите изброяват само гласувалите — няма запис кой е отсъствал. '
      || 'Затова „участие“ е дял от решенията с поименно гласуване, а не присъствие.'
$$;

CREATE OR REPLACE FUNCTION council_dissent_basis()
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Спрямо мнозинството в съвета, не спрямо партия — този корпус не съдържа '
      || 'партийна принадлежност. „Против мнозинството“ брои само изричен вот срещу '
      || 'надделяващия; въздържалите се са отделно, а решенията без мнозинство '
      || '(равен вот) не се броят.'
$$;

-- The country's total number of общински съвети. Stated once: the hub divides
-- by it, and a second copy in a component is how a coverage line goes stale in
-- both directions.
CREATE OR REPLACE FUNCTION council_total_in_country()
RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 265 $$;

-- ---------------------------------------------------------------------------
-- council_overview() — the hub's stat tiles
-- ---------------------------------------------------------------------------
-- Coverage first, and as MEASURED values rather than prose: the hub's opening
-- claim is "16 of 265 councils, 5 publishing named votes", and a hard-coded
-- fraction goes stale in both directions (the /funds/calls "2 от 6" lesson).
CREATE OR REPLACE FUNCTION council_overview()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'councilsCovered',   (SELECT count(*) FROM council_muni),
    'councilsTotal',     council_total_in_country(),
    'councilsWithNamedVotes',
                         (SELECT count(*) FROM council_muni WHERE has_named_votes),
    'resolutions',       (SELECT count(*) FROM council_resolution),
    'namedVotes',        (SELECT count(*) FROM council_vote),
    'attributedVotes',   (SELECT count(*) FROM council_vote WHERE person_id IS NOT NULL),
    'newestDecidedOn',   (SELECT max(decided_on)::text FROM council_resolution),
    -- The result split, so no consumer has to hard-code a share. 'unknown' is
    -- 43% corpus-wide but ranges 0%-100% PER COUNCIL with nothing in between
    -- 17.5% and 68.8% — a corpus figure rendered on a council page is wrong for
    -- every one of the sixteen.
    'resultSplit', (
      SELECT coalesce(jsonb_object_agg(coalesce(result, 'unknown'), n), '{}'::jsonb)
        FROM (SELECT result, count(*) AS n FROM council_resolution GROUP BY 1) s
    ),
    'councils', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'code',           m.obshtina_code,
                 -- The code a LINK must use. council_muni_detail resolves through
                 -- council_muni_code only (an internal key is another
                 -- municipality's frontend code for three councils), so the hub
                 -- would otherwise need its own copy of the mapping — the fifth.
                 -- Prefer a non-S2 code so Sofia links as SFO_CITY rather than
                 -- an arbitrary район.
                 'frontendCode', (
                   SELECT c.frontend_code FROM council_muni_code c
                    WHERE c.obshtina_code = m.obshtina_code
                    ORDER BY (c.frontend_code LIKE 'S2%'), c.frontend_code
                    LIMIT 1
                 ),
                 'name',           m.name,
                 'hasNamedVotes',  m.has_named_votes,
                 'resolutions',    m.resolution_count,
                 'namedVotes',     m.named_vote_count,
                 'newestDecidedOn', max(r.decided_on)::text,
                 -- The named-vote watermark, so a stale council is visible ON
                 -- the page rather than only in a data test.
                 'newestNamedOn',  max(r.decided_on) FILTER (WHERE r.has_named_votes)::text
               ) AS x
          FROM council_muni m
          LEFT JOIN council_resolution r ON r.obshtina_code = m.obshtina_code
         GROUP BY m.obshtina_code, m.name, m.has_named_votes,
                  m.resolution_count, m.named_vote_count
      ) s
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- council_muni_detail(code, limit, offset) — one council
-- ---------------------------------------------------------------------------
-- Takes the FRONTEND code and resolves it through council_muni_code, so no
-- caller re-implements the obshtina→council mapping. That bridge is many-to-one
-- (Sofia is 27 codes → SOF); a scalar column could not express it, and four
-- separate copies of the rule existed before it.
--
-- Replaces a 1,542 KB whole-index fetch on every governance dashboard.
CREATE OR REPLACE FUNCTION council_muni_detail(
  p_code text,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH muni AS (
    -- THROUGH THE BRIDGE ONLY. An earlier draft added a second arm matching
    -- p_code against council_muni.obshtina_code directly, "so an internal
    -- caller that already has the key need not round-trip". That arm served the
    -- WRONG COUNCIL: three council keys are also OTHER municipalities' frontend
    -- codes — BGS01 is Бургас's council key and Айтос's obshtina code, PDV01
    -- likewise Асеновград, VAR01 Аврен. All three are uncovered, so the bridge
    -- correctly missed and the fallback answered with Бургас's 374 resolutions
    -- to a reader in Айтос. It was also redundant: every one of the 16 council
    -- keys is reachable through at least one frontend code.
    SELECT m.*
      FROM council_muni m
      JOIN council_muni_code c ON c.obshtina_code = m.obshtina_code
     WHERE c.frontend_code = p_code
  ),
  page AS (
    SELECT r.*
      FROM council_resolution r
     WHERE r.obshtina_code = (SELECT obshtina_code FROM muni)
     ORDER BY r.decided_on DESC, r.id
     -- coalesce, not greatest: a NULL p_limit means "the default", never zero
     -- resolutions on a council that has hundreds.
     LIMIT greatest(coalesce(p_limit, 20), 0)
     OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM muni) THEN NULL ELSE jsonb_build_object(
    'code',            (SELECT obshtina_code FROM muni),
    'name',            (SELECT name FROM muni),
    'hasNamedVotes',   (SELECT has_named_votes FROM muni),
    'resolutionCount', (SELECT resolution_count FROM muni),
    'namedVoteCount',  (SELECT named_vote_count FROM muni),
    -- ::text like every other date here. node-postgres converts a bare
    -- timestamptz using the SERVER PROCESS's timezone, so under TZ=Europe/Sofia
    -- it would render the day before (the 144_funds_wire lesson).
    'lastIngest',      (SELECT last_ingest::text FROM muni),
    'resolutions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id',            id,
               'decidedOn',     decided_on::text,
               'session',       session,
               'number',        number,
               'title',         title,
               'result',        result,
               'tallyFor',      tally_for,
               'tallyAgainst',  tally_against,
               'tallyAbstain',  tally_abstain,
               'hasNamedVotes', has_named_votes,
               'sourceUrl',     source_url
             ) ORDER BY decided_on DESC, id), '[]'::jsonb)
        FROM page
    ),
    'councillors', (
      SELECT coalesce(jsonb_agg(x ORDER BY (x->>'votes')::int DESC, x->>'name'), '[]'::jsonb)
      FROM (
        -- Grouped on norm_key ALONE. Grouping on (norm_key, person_id) would
        -- split one councillor into two rows the moment a re-resolve leaves
        -- some of their votes attributed and some not — 0 such cases today,
        -- and the fix costs nothing.
        SELECT jsonb_build_object(
                 'name',     min(v.councillor),
                 'personId', max(v.person_id),
                 'votes',    count(*),
                 'for',      count(*) FILTER (WHERE v.vote = 'for'),
                 'against',  count(*) FILTER (WHERE v.vote = 'against'),
                 'abstain',  count(*) FILTER (WHERE v.vote = 'abstain')
               ) AS x
          FROM council_vote v
          JOIN council_resolution r ON r.id = v.resolution_id
         WHERE r.obshtina_code = (SELECT obshtina_code FROM muni)
         GROUP BY v.norm_key
      ) s
    ),
    'namedVoteResolutions', (
      SELECT count(*) FROM council_resolution r
       WHERE r.obshtina_code = (SELECT obshtina_code FROM muni)
         AND r.has_named_votes
    ),
    -- THIS council's split, never the corpus's. Бургас is 367 unclear of 374
    -- (98.1%) and Русе 0 of 211 — one number cannot describe both.
    'resultSplit', (
      SELECT coalesce(jsonb_object_agg(coalesce(result, 'unknown'), n), '{}'::jsonb)
        FROM (
          SELECT result, count(*) AS n FROM council_resolution
           WHERE obshtina_code = (SELECT obshtina_code FROM muni)
           GROUP BY 1
        ) s
    ),
    -- The UI renders its own translated wording (this one is Bulgarian, and the
    -- English page would otherwise show a Bulgarian sentence). This stays in the
    -- payload as the contract for NON-UI consumers — the AI chat and any API
    -- reader — so a participation figure can never travel without it.
    'attendanceBasis', council_attendance_basis()
  ) END
$$;

-- ---------------------------------------------------------------------------
-- council_resolution_detail(id) — one resolution and its named votes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION council_resolution_detail(p_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'id',            r.id,
    'councilCode',   r.obshtina_code,
    'councilName',   m.name,
    'decidedOn',     r.decided_on::text,
    'session',       r.session,
    'number',        r.number,
    'title',         r.title,
    'summaryBg',     r.summary_bg,
    'summaryEn',     r.summary_en,
    'result',        r.result,
    -- TWO SOURCES, NAMED. `protocolTally` is the aggregate the protokol itself
    -- prints; `namedVoteTally` is what the per-councillor block adds up to.
    -- They disagree on 62% of named-vote resolutions (PER32: 100%) — a councillor
    -- list can be partial, OCR can drop rows, and the protokol's own arithmetic
    -- is sometimes simply different. Publishing both unlabelled shows a reader
    -- two numbers for one vote and lets them assume one is wrong.
    'protocolTally', jsonb_build_object(
      'for', r.tally_for, 'against', r.tally_against, 'abstain', r.tally_abstain,
      'method', r.tally_method
    ),
    'namedVoteTally', (
      SELECT jsonb_build_object(
               'for',     count(*) FILTER (WHERE v.vote = 'for'),
               'against', count(*) FILTER (WHERE v.vote = 'against'),
               'abstain', count(*) FILTER (WHERE v.vote = 'abstain')
             )
        FROM council_vote v WHERE v.resolution_id = r.id
    ),
    'tallyBasis',
      'Двата броя идват от различни места в протокола: „по протокол“ е '
      || 'обобщението, което самият протокол отпечатва, а „по имена“ е сборът '
      || 'от поименния списък. Разминаване не значи, че единият е грешен — '
      || 'поименният списък може да е непълен.',
    'hasNamedVotes', r.has_named_votes,
    'sourceUrl',     r.source_url,
    'votes', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'name',     v.councillor,
               'personId', v.person_id,
               'vote',     v.vote
             ) ORDER BY v.councillor), '[]'::jsonb)
        FROM council_vote v WHERE v.resolution_id = r.id
    )
  )
  FROM council_resolution r
  JOIN council_muni m ON m.obshtina_code = r.obshtina_code
  WHERE r.id = p_id
$$;

-- ---------------------------------------------------------------------------
-- council_councillor(person_id) — one councillor's record
-- ---------------------------------------------------------------------------
-- What CouncilActivitySection was meant to be, keyed on person_id rather than
-- an officials slug so it survives a re-slug. Reachable from /person and from
-- the council's own page — deliberately NOT a cross-municipal ranking: 091's
-- published policy computes named behavioural metrics for a senior cohort only
-- and explicitly not for the ~4,700 municipal councillors.
CREATE OR REPLACE FUNCTION council_councillor(p_person_id bigint)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH mine AS (
    SELECT v.vote, r.obshtina_code, r.decided_on, r.title, r.id AS rid
      FROM council_vote v
      JOIN council_resolution r ON r.id = v.resolution_id
     WHERE v.person_id = p_person_id
  ),
  council AS (
    SELECT obshtina_code, count(*) AS votes FROM mine
     GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1
  ),
  -- The majority per resolution, computed ONCE. As a correlated subquery this
  -- ran per vote — 93% of the function's cost, 3,591 buffers on the busiest
  -- councillor against a 2,500 ceiling.
  tallies AS (
    SELECT v.resolution_id, v.vote, count(*) AS n
      FROM council_vote v
     WHERE v.resolution_id IN (SELECT rid FROM mine)
     GROUP BY 1, 2
  ),
  ranked AS (
    SELECT resolution_id, vote, n,
           row_number() OVER (PARTITION BY resolution_id ORDER BY n DESC) AS rn,
           count(*)     OVER (PARTITION BY resolution_id, n)              AS at_this_n,
           max(n)       OVER (PARTITION BY resolution_id)                 AS top_n
      FROM tallies
  ),
  majority AS (
    -- A TIE HAS NO MAJORITY, so it yields no row here and scores nothing.
    -- Ordering by vote alphabetically instead made `abstain` the winner on 59
    -- of 61 tied resolutions and flagged 686 councillor-votes as dissent on
    -- resolutions where no majority existed.
    SELECT resolution_id, vote AS majority_vote
      FROM ranked
     WHERE rn = 1 AND n = top_n AND at_this_n = 1
  ),
  scored AS (
    SELECT m.*, j.majority_vote
      FROM mine m
      LEFT JOIN majority j ON j.resolution_id = m.rid
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM mine) THEN NULL ELSE jsonb_build_object(
    'personId',    p_person_id,
    'councilCode', (SELECT obshtina_code FROM council),
    'councilName', (SELECT m.name FROM council_muni m
                     WHERE m.obshtina_code = (SELECT obshtina_code FROM council)),
    'name',        (SELECT min(v.councillor) FROM council_vote v
                     WHERE v.person_id = p_person_id),
    'votes',       (SELECT count(*) FROM mine),
    'for',         (SELECT count(*) FROM mine WHERE vote = 'for'),
    'against',     (SELECT count(*) FROM mine WHERE vote = 'against'),
    'abstain',     (SELECT count(*) FROM mine WHERE vote = 'abstain'),
    'ofNamedVoteResolutions', (
      SELECT count(*) FROM council_resolution r
       WHERE r.obshtina_code = (SELECT obshtina_code FROM council)
         AND r.has_named_votes
    ),
    -- An EXPLICIT vote against the prevailing one. Abstention is the refusal to
    -- take a side, so it is reported separately rather than folded in — it was
    -- 48.6% of this figure before the split, on a per-person metric.
    'againstMajority', (
      SELECT count(*) FROM scored
       WHERE majority_vote IS NOT NULL
         AND vote <> majority_vote
         AND vote <> 'abstain'
    ),
    'abstainedFromMajority', (
      SELECT count(*) FROM scored
       WHERE majority_vote IS NOT NULL
         AND vote = 'abstain'
         AND majority_vote <> 'abstain'
    ),
    -- The denominator the two figures above are shares OF: this councillor's
    -- own votes on resolutions that HAD a majority.
    'ofScoredVotes', (
      SELECT count(*) FROM scored WHERE majority_vote IS NOT NULL
    ),
    'noMajorityResolutions', (
      SELECT count(*) FROM scored WHERE majority_vote IS NULL
    ),
    'recent', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', rid, 'decidedOn', decided_on::text,
               'title', title, 'vote', vote
             ) ORDER BY decided_on DESC, rid), '[]'::jsonb)
        FROM (SELECT * FROM mine ORDER BY decided_on DESC, rid LIMIT 20) t
    ),
    'attendanceBasis', council_attendance_basis(),
    'dissentBasis',    council_dissent_basis()
  ) END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION council_attendance_basis()               TO app_readonly;
    GRANT EXECUTE ON FUNCTION council_dissent_basis()                  TO app_readonly;
    GRANT EXECUTE ON FUNCTION council_total_in_country()               TO app_readonly;
    GRANT EXECUTE ON FUNCTION council_overview()                       TO app_readonly;
    GRANT EXECUTE ON FUNCTION council_muni_detail(text, int, int)      TO app_readonly;
    GRANT EXECUTE ON FUNCTION council_resolution_detail(text)          TO app_readonly;
    GRANT EXECUTE ON FUNCTION council_councillor(bigint)               TO app_readonly;
  ELSE
    RAISE WARNING '[161] app_readonly absent — council serving functions carry no ACL.';
  END IF;
END $$;
