-- 209 — Council of Ministers spending decrees: „Постановление № N … за одобряване на
-- допълнителни разходи / трансфери по бюджета на …", as promulgated in Държавен вестник.
-- docs/plans/insait-gap-v1.md §4. Loaded by `db:load:budget-decrees:pg` from the
-- gitignored raw_data/budget/dv_decrees.sqlite crawl (`pnpm run budget:dv-decrees`).
--
-- This is how the government moves money that no budget line named in advance; Чл. 1
-- of each decree states the amount, the budget it goes to and what it is for.
--
-- ⚠️ APPROPRIATED ≠ TRANSFERRED ≠ SPENT. A decree AUTHORISES extra spending by a
-- budget; whether and to whom it was finally paid is a different record. `up_to` marks
-- an amount the decree gives as a ceiling („в размер до …"). A surface with no
-- transfer or execution figure says „няма данни", never 0.
--
-- ⚠️ COVERAGE IS THE CRAWLED idMat RANGE. The crawl walks DV's material ids from a
-- start id; a decree before it is absent, not non-existent. `spending_decree_coverage()`
-- returns the issue dates of the earliest and latest LOADED decree — a lower bound on the
-- crawled window, never the window itself, which lives only in the raw store.

CREATE TABLE IF NOT EXISTS budget_spending_decree (
  id_mat       integer PRIMARY KEY,               -- dv.parliament.bg material id
  decree_no    integer NOT NULL,
  decree_date  date    NOT NULL,
  kind         text    NOT NULL CHECK (kind IN ('разходи', 'трансфери', 'разходи/трансфери', 'средства', 'плащания')),
  budget_of    text,                              -- „Министерството на енергетиката"
  budget_year  integer,
  title        text    NOT NULL,
  issue_no     integer NOT NULL,                  -- ДВ брой
  issue_date   date    NOT NULL,
  body         text    NOT NULL,                  -- the decree's text, as published
  search_fold  text GENERATED ALWAYS AS (translit_bg_latin(title || ' ' || body)) STORED
);

-- A warm database keeps the CHECK it was created with; restate it so a new kind
-- reaches it (CREATE TABLE IF NOT EXISTS cannot).
ALTER TABLE budget_spending_decree DROP CONSTRAINT IF EXISTS budget_spending_decree_kind_check;
ALTER TABLE budget_spending_decree ADD CONSTRAINT budget_spending_decree_kind_check
  CHECK (kind IN ('разходи', 'трансфери', 'разходи/трансфери', 'средства', 'плащания'));

CREATE TABLE IF NOT EXISTS budget_spending_decree_clause (
  id_mat        integer NOT NULL REFERENCES budget_spending_decree (id_mat) ON DELETE CASCADE,
  seq           integer NOT NULL,
  amount_native double precision NOT NULL,        -- as printed, in `currency`
  currency      text    NOT NULL CHECK (currency IN ('BGN', 'EUR')),
  amount_eur    double precision NOT NULL,        -- лв at the locked 1.95583
  up_to         boolean NOT NULL,
  purpose       text,
  PRIMARY KEY (id_mat, seq)
);

CREATE INDEX IF NOT EXISTS idx_budget_spending_decree_fts
  ON budget_spending_decree USING gin (to_tsvector('simple', search_fold));
CREATE INDEX IF NOT EXISTS idx_budget_spending_decree_date
  ON budget_spending_decree (decree_date DESC);

-- Decrees that NAME a term as whole words (the same rule as zdoi_mentions, 207, and
-- `mentionsTerm` in ai/tools/mentions.ts). plpgsql: `fold_prefix_tsquery` lives in 035.
CREATE OR REPLACE FUNCTION spending_decree_mentions(q text, lim integer DEFAULT 20)
RETURNS TABLE (
  id_mat integer, decree_no integer, decree_date date, kind text, budget_of text,
  budget_year integer, title text, issue_no integer, issue_date date,
  amount_eur double precision, up_to boolean, clauses integer
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
  SELECT d.id_mat, d.decree_no, d.decree_date, d.kind, d.budget_of, d.budget_year,
         d.title, d.issue_no, d.issue_date,
         -- One figure only when the decree states one; several clauses are summed only
         -- when they share a currency basis, which amount_eur always does.
         (SELECT sum(c.amount_eur) FROM budget_spending_decree_clause c WHERE c.id_mat = d.id_mat),
         coalesce((SELECT bool_or(c.up_to) FROM budget_spending_decree_clause c WHERE c.id_mat = d.id_mat), false),
         (SELECT count(*)::int FROM budget_spending_decree_clause c WHERE c.id_mat = d.id_mat)
    FROM budget_spending_decree d
   WHERE to_tsvector('simple', d.search_fold) @@ fold_prefix_tsquery(q)
     AND d.search_fold ~ pat
   ORDER BY d.decree_date DESC, d.id_mat DESC
   LIMIT LEAST(GREATEST(coalesce(lim, 20), 1), 100);
END $$;

-- How many decrees are loaded and the issue dates of the earliest and latest (see the header).
CREATE OR REPLACE FUNCTION spending_decree_coverage()
RETURNS TABLE (decrees bigint, first_issue date, last_issue date)
LANGUAGE sql STABLE AS $$
  SELECT count(*), min(issue_date), max(issue_date) FROM budget_spending_decree
$$;

COMMENT ON TABLE budget_spending_decree IS
  'ПМС for additional spending / transfers, from Държавен вестник. Authorised, not paid — see 209.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON budget_spending_decree, budget_spending_decree_clause TO app_readonly;
    GRANT EXECUTE ON FUNCTION spending_decree_mentions(text, integer),
      spending_decree_coverage() TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 209 granted nothing';
  END IF;
END $$;
