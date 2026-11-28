-- 207 — ЗДОИ requests filed through pitay.government.bg („Платформа за достъп до
-- обществена информация"): the obliged body, the subject as the requester wrote it,
-- the status, the body's decision, decision attachments, the processing history and
-- forwarding „по компетентност".
-- Loaded by `db:load:zdoi:pg` from the gitignored raw_data/zdoi/pitay.sqlite crawl
-- (`pnpm run zdoi:fetch`).
--
-- ⚠️ WHAT THIS CORPUS IS — and the rules every consumer keeps:
--
--   1. ONLY REQUESTS FILED THROUGH THE PLATFORM. Bodies also take requests by
--      e-mail, post and in person; none of those are here. Every surface says
--      „заявления, подадени през ПДОИ", never „all ЗДОИ requests", and never
--      reads an absence here as „nobody asked".
--   2. A DECISION IS THE BODY'S OWN STATEMENT. A figure in `decision_text` is what
--      the institution answered, not data we have verified; nothing extracts it
--      into a number, and a surface quotes it as the body's answer.
--   3. THE REQUESTER IS A TYPE, NEVER A PERSON. `applicant_type` holds only the two
--      values the platform prints (the CHECK below), or NULL where an early page
--      printed the requester's name, phone and e-mail instead — the crawler redacts
--      those before anything is stored. `subject` and `decision_text` are stored as the
--      platform publishes them, except that e-mail addresses and phone numbers are
--      replaced with „[контакт]"; they can still contain names, so surfaces show an
--      EXCERPT and link out to the platform rather than republishing whole texts.
--
-- ⚠️ UPSERT-ONLY. A request is a public record: a crawl that misses a page leaves
-- the request standing (`last_seen_at` records the absence). Events and forwards
-- are replaced only for requests re-parsed in the same run — a re-parsed page's
-- history is authoritative.

CREATE TABLE IF NOT EXISTS zdoi_request (
  app_id          integer PRIMARY KEY,           -- the platform's application id
  reg_no          text NOT NULL,                 -- „1702480122-13.12.2023"
  body            text NOT NULL,                 -- the obliged body, as the platform names it
  status          text NOT NULL,
  -- NULL: the page printed the requester's NAME instead of a type (early 2019
  -- pages). The crawler redacts the name before storing; it is never recovered.
  applicant_type  text
    CHECK (applicant_type IN ('Физическо лице', 'Юридическо лице')),
  submitted_on    date,
  deadline        date,
  subject         text NOT NULL,
  decision_date   date,
  decision_text   text,
  attachment_ids  integer[] NOT NULL DEFAULT '{}', -- /download/<id> on the platform
  views           integer,
  -- One fold over both texts, so a search matches what was ASKED and what was
  -- ANSWERED with one index.
  search_fold     text GENERATED ALWAYS AS (
                    translit_bg_latin(subject || ' ' || coalesce(decision_text, ''))
                  ) STORED,
  fetched_at      timestamptz NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now()
);

-- Warm databases: the first cut declared applicant_type NOT NULL.
ALTER TABLE zdoi_request ALTER COLUMN applicant_type DROP NOT NULL;

CREATE TABLE IF NOT EXISTS zdoi_event (
  app_id  integer NOT NULL REFERENCES zdoi_request(app_id) ON DELETE CASCADE,
  seq     integer NOT NULL,
  at      timestamp NOT NULL,                    -- Sofia wall clock, as printed
  process text NOT NULL,
  PRIMARY KEY (app_id, seq)
);

CREATE TABLE IF NOT EXISTS zdoi_forward (
  app_id     integer NOT NULL REFERENCES zdoi_request(app_id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  to_app_id  integer,                            -- the forwarded copy's own id, when linked
  reg_no     text NOT NULL,
  body       text NOT NULL,
  created_at timestamp,
  status     text,
  PRIMARY KEY (app_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_zdoi_request_fts
  ON zdoi_request USING gin (to_tsvector('simple', search_fold));
CREATE INDEX IF NOT EXISTS idx_zdoi_request_body
  ON zdoi_request (body, submitted_on DESC);
CREATE INDEX IF NOT EXISTS idx_zdoi_forward_to ON zdoi_forward (to_app_id);

-- Free-text search over subject + decision, newest first. plpgsql so the body is not
-- validated at CREATE: `fold_prefix_tsquery` lives in 035, applied by the contracts
-- loader, and a LANGUAGE sql body would 42883 on a database where 207 lands first.
-- Excerpts only (rule 3) — the full texts stay on the platform's own page.
CREATE OR REPLACE FUNCTION zdoi_search(q text, lim integer DEFAULT 20)
RETURNS TABLE (
  app_id integer, reg_no text, body text, status text, submitted_on date,
  decision_date date, subject_excerpt text, decision_excerpt text,
  attachment_count integer
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT r.app_id, r.reg_no, r.body, r.status, r.submitted_on, r.decision_date,
         left(r.subject, 300), left(r.decision_text, 300),
         cardinality(r.attachment_ids)
    FROM zdoi_request r
   WHERE to_tsvector('simple', r.search_fold) @@ fold_prefix_tsquery(q)
   ORDER BY r.submitted_on DESC NULLS LAST, r.app_id DESC
   LIMIT LEAST(GREATEST(coalesce(lim, 20), 1), 100);
END $$;

-- Requests that NAME a term, as whole words — the mentions tool's arm. The FTS prefix
-- match alone is too loose for a name („insait" also matches „insaitkonsult"), so the
-- fold is checked again with the same rule `mentionsTerm` (ai/tools/mentions.ts)
-- applies: the term's words in a row, a word of 5+ letters allowed up to 3 trailing
-- letters (Bulgarian inflection). plpgsql for the same reason as zdoi_search.
-- The excerpt (rule 3) is a window of `len` characters cut AROUND the words that
-- matched, so an answer can show why a request is there; `left(t, len)` hides a
-- match that sits later in the text. Windows overlap by half, so a match up to
-- len/2 long always falls whole inside one. A cut start is marked „…".
CREATE OR REPLACE FUNCTION zdoi_match_excerpt(t text, pat text, len integer DEFAULT 300)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  i integer := 1;
  n integer;
BEGIN
  IF t IS NULL THEN
    RETURN NULL;
  END IF;
  n := length(t);
  IF n <= len OR translit_bg_latin(left(t, len)) ~ pat
     OR translit_bg_latin(t) !~ pat THEN
    RETURN left(t, len);
  END IF;
  WHILE i <= n LOOP
    IF translit_bg_latin(substr(t, i, len)) ~ pat THEN
      RETURN '…' || substr(t, i, len);
    END IF;
    i := i + len / 2;
  END LOOP;
  RETURN left(t, len);
END $$;

-- The money an ANSWER names, quoted — never parsed into a figure. Up to `lim` amounts in the
-- body's own words („100 млн. лв.") with ~200 characters around each, so a reader sees
-- whether the sum is what was disclosed or what the requester asked about: the INSAIT
-- answer (8905) names „100 млн. лв." only while restating the question. A number column
-- would assert the first reading on every row; a quote leaves it to the text (rule 3).
-- The currency must end at a non-letter, or „евро" matches „европейски"; the number must
-- not start right after a decimal separator, and „5850, 00 лв." (a typed space after the
-- comma, common in these answers) is one number, not „00 лв.".
CREATE OR REPLACE FUNCTION zdoi_money_mentions(t text, lim integer DEFAULT 2)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  re  constant text :=
    '(?<![0-9A-Za-zА-Яа-я])(?<![0-9][.,])'
    '(?:[0-9]{1,3}(?:[  .][0-9]{3})+|[0-9]+)(?:[.,][0-9]+|, [0-9]{2})?'
    '(?:\s*(?:млрд|млн|милиона|милион|хил|хиляди)\.?)?'
    '\s*(?:лв|лева|евро|EUR|BGN|€)(?![A-Za-zА-Яа-я])\.?';
  s   text;
  n   integer;
  pos integer;
  m   text;
  a   integer;
  b   integer;
  nxt integer := 1;
  k   integer := 0;
  out jsonb := '[]'::jsonb;
BEGIN
  IF t IS NULL THEN
    RETURN out;
  END IF;
  s := btrim(regexp_replace(t, '\s+', ' ', 'g'));
  n := length(s);
  WHILE jsonb_array_length(out) < lim LOOP
    -- by occurrence over the WHOLE text: a search started mid-text cannot see behind its
    -- start, so „500 000 лв." cut by the previous window would be found as „000 лв.".
    k := k + 1;
    pos := regexp_instr(s, re, 1, k, 0, 'i');
    EXIT WHEN pos = 0;
    CONTINUE WHEN pos < nxt;  -- already inside the previous excerpt
    m := regexp_substr(s, re, 1, k, 'i');
    a := greatest(nxt, pos - 140);  -- never re-quote the previous window
    b := least(n, pos + length(m) + 60);
    -- widen to whole words, never past the text
    WHILE a > nxt AND substr(s, a - 1, 1) <> ' ' AND pos - a < 160 LOOP a := a - 1; END LOOP;
    WHILE b < n AND substr(s, b + 1, 1) <> ' ' AND b - pos < 120 LOOP b := b + 1; END LOOP;
    out := out || jsonb_build_object(
      'amount', btrim(m),
      'excerpt', CASE WHEN a > 1 THEN '…' ELSE '' END
                 || btrim(substr(s, a, b - a + 1))
                 || CASE WHEN b < n THEN '…' ELSE '' END);
    nxt := b + 1;
  END LOOP;
  RETURN out;
END $$;

-- Return type gained money_mentions; CREATE OR REPLACE cannot change OUT columns.
DROP FUNCTION IF EXISTS zdoi_mentions(text, integer);
CREATE OR REPLACE FUNCTION zdoi_mentions(q text, lim integer DEFAULT 20)
RETURNS TABLE (
  app_id integer, reg_no text, body text, status text, submitted_on date,
  decision_date date, subject_excerpt text, decision_excerpt text,
  attachment_count integer, money_mentions jsonb
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  pat text;
BEGIN
  SELECT string_agg(
           CASE WHEN length(tok) >= 5 THEN tok || '[a-z0-9]{0,3}' ELSE tok END,
           '[^a-z0-9]+' ORDER BY ord)
    INTO pat
    FROM regexp_split_to_table(translit_bg_latin(q), '[^a-z0-9]+')
         WITH ORDINALITY AS t(tok, ord)
   WHERE tok <> '';
  IF pat IS NULL THEN
    RETURN;
  END IF;
  pat := '(^|[^a-z0-9])' || pat || '([^a-z0-9]|$)';
  RETURN QUERY
  SELECT r.app_id, r.reg_no, r.body, r.status, r.submitted_on, r.decision_date,
         zdoi_match_excerpt(r.subject, pat), zdoi_match_excerpt(r.decision_text, pat),
         cardinality(r.attachment_ids), zdoi_money_mentions(r.decision_text)
    FROM zdoi_request r
   WHERE to_tsvector('simple', r.search_fold) @@ fold_prefix_tsquery(q)
     AND r.search_fold ~ pat
   ORDER BY r.submitted_on DESC NULLS LAST, r.app_id DESC
   LIMIT LEAST(GREATEST(coalesce(lim, 20), 1), 100);
END $$;

-- What the corpus covers, so a surface can state it (rule 1) instead of implying it.
CREATE OR REPLACE FUNCTION zdoi_coverage()
RETURNS TABLE (
  requests bigint, bodies bigint, first_submitted date, last_submitted date,
  newest_app_id integer, crawled_through timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT count(*), count(DISTINCT body), min(submitted_on), max(submitted_on),
         max(app_id), max(fetched_at)
    FROM zdoi_request
$$;

COMMENT ON TABLE zdoi_request IS
  'ЗДОИ requests filed THROUGH pitay.government.bg only. A decision is the body''s own '
  'statement. Requester stored as a type, never a person — see 207''s header.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON zdoi_request, zdoi_event, zdoi_forward TO app_readonly;
    GRANT EXECUTE ON FUNCTION zdoi_search(text, integer), zdoi_mentions(text, integer),
      zdoi_match_excerpt(text, text, integer), zdoi_money_mentions(text, integer),
      zdoi_coverage() TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 207 granted nothing';
  END IF;
END $$;
