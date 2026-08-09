-- 142_open_calls.sql — OPEN CALLS (отворени процедури / приеми): what a reader can
-- apply to right now, as opposed to every other funds table, which records what was
-- already awarded.
--
-- WHY THIS EXISTS. `fund_projects` and `interreg_*` answer "who GOT money". Measured
-- demand (docs/plans/funds-module-v2.md §1) is the opposite question: ~68% of the
-- questions in a 113K-member EU-funds group are „има ли програма за X" and not one of
-- 47 asked who received anything. ИСУН 2020's /bg/s/Procedure/Active is the canonical
-- register for ЕСИФ calls — eufunds.bg points its own "Отворени процедури" menu at it —
-- and the ДФЗ Strategic-Plan schedule carries the money/eligibility fields ИСУН omits.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- THE INVARIANT THIS TABLE IS SHAPED BY: `open` IS COMPUTED AT QUERY TIME.
--
-- Nothing stores a status. The `open_calls_table` view derives it by comparing closes_at
-- to now(), and everything else (the function, the browse table, the routes) reads that. Every other design stores "open" at crawl time, and then a crawler that dies on
-- Friday shows expired calls as open all weekend — a missed deadline is a HARM, not a
-- stale number, which is the one way this dataset differs from every other one here.
--
-- With query-time derivation the worst failure is UNDER-reporting: a dead crawler means
-- new calls are missing (visible via open_calls_crawl) and expired ones vanish on their
-- own. That asymmetry is the whole reason this feature is publishable.
--
-- Consequence for the loader: it must NEVER anti-join delete. The crawler reads /Active,
-- so a call that closes is absent BY DESIGN; deleting absent rows would erase exactly the
-- closed calls that make base rates and „затвори наскоро" possible. See
-- load_open_calls_pg.ts.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- TWO KINDS, NEVER ONE LIST (`kind`). A `consultation` row is draft guidance out for
-- public comment (ИСУН /PublicDiscussion). Its date is a COMMENT deadline, its figures are
-- draft, and it can be withdrawn. Rendering it beside a real call would be the most
-- misleading thing this feature could do, so `open_calls_list` defaults to kind='call'.
--
-- TWO DATE PRECISIONS, NEVER MIXED (`date_precision`). ИСУН publishes exact timestamps;
-- the ДФЗ indicative schedule publishes month ranges („В периода октомври-декември"). The
-- CHECKs below make the distinction structural: an 'exact' row MUST have closes_at, an
-- 'indicative' row must NOT — so a forecast can never reach a deadline-driven query, and a
-- parser that loses a deadline cannot store the row as exact.
--
-- MONEY NEEDS A PROVENANCE (`enrichment`), and the bar differs by where it came from.
--   'source'   — the SOURCE published it in a structured field. The ДФЗ Strategic-Plan XLSX
--                has real columns for budget, aid rate and per-project ceiling, so those are
--                as trustworthy as the title and need no human pass.
--   'auto'     — EXTRACTED from a document by Stage 7. May NOT populate the numeric columns:
--                an unverified number in a sortable/filterable column silently drives the
--                page's ranking and range filters. It rides in enrichment_meta with its
--                verbatim quote until a human promotes it.
--   'reviewed' — a human confirmed an extraction. May populate the numeric columns.
--   'none'     — nothing known. ИСУН's procedure page carries no budget, rate or ceiling at
--                all; those live in the „Условия за кандидатстване" documents.
-- The CHECK below encodes exactly that: money is allowed for 'source' and 'reviewed', barred
-- for 'none' and 'auto'. Collapsing 'source' into 'reviewed' would make the flag lie about
-- who vouched for the figure, and make the Stage 7 gate vacuous.

CREATE TABLE IF NOT EXISTS open_calls (
  id              serial PRIMARY KEY,
  source          text NOT NULL,           -- 'isun' | 'sp2023' | 'ahu' | 'az'
  source_key      text NOT NULL,           -- ИСУН GUID | intervention code | slug
  code            text,                    -- BG16RFPR001-1.011 | II.Д.1
  kind            text NOT NULL DEFAULT 'call'
                  CHECK (kind IN ('call', 'consultation')),
  title           text NOT NULL,
  programme_code  text,
  programme_name  text,
  objective       text,

  date_precision  text NOT NULL CHECK (date_precision IN ('exact', 'indicative')),
  opens_at        timestamptz,
  closes_at       timestamptz,
  period_label    text,                    -- "В периода октомври-декември, не по-кратък от 60 дни"

  budget_eur      numeric,
  budget_note     text,                    -- the raw source string, incl. prose budgets
  aid_rate_pct    numeric,
  grant_min_eur   numeric,
  grant_max_eur   numeric,
  beneficiaries_raw text,                  -- verbatim eligibility text, always kept
  audience        text[] NOT NULL DEFAULT '{}',
  territory       text,

  source_url      text NOT NULL,
  docs            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{label,url}]
  enrichment      text NOT NULL DEFAULT 'none'
                  CHECK (enrichment IN ('none', 'source', 'auto', 'reviewed')),
  -- {model, extracted_at, doc_url, quotes:{field: verbatim}} — a field with no quote is
  -- never stored (the grounding gate lives in scripts/opencalls/enrich_gate.ts).
  enrichment_meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  -- The last crawl that still LISTED this row. Absence is recorded here, never by deleting.
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  checked_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT open_calls_source_key UNIQUE (source, source_key),
  CONSTRAINT open_calls_exact_has_close
    CHECK (date_precision <> 'exact' OR closes_at IS NOT NULL),
  CONSTRAINT open_calls_indicative_no_close
    CHECK (date_precision <> 'indicative'
           OR (closes_at IS NULL AND period_label IS NOT NULL)),
  -- Invariant 8, scoped to EXTRACTED figures: an 'auto' (or absent) provenance may not
  -- reach a sortable/filterable column. 'source' and 'reviewed' may.
  CONSTRAINT open_calls_money_needs_provenance
    CHECK (enrichment IN ('source', 'reviewed')
           OR (budget_eur IS NULL AND aid_rate_pct IS NULL
               AND grant_min_eur IS NULL AND grant_max_eur IS NULL)),
  -- Typos here are silent: an unknown `source` never matches a loader's per-source guard,
  -- and an unknown audience value never matches the `@>` facet filter, so the row simply
  -- disappears from the view it belongs in. Both are enumerated rather than free text.
  CONSTRAINT open_calls_source_known
    CHECK (source IN ('isun', 'sp2023', 'ahu', 'az')),
  CONSTRAINT open_calls_audience_known
    CHECK (audience <@ ARRAY['business','farmer','municipality','ngo','individual',
                             'school','institution','unknown']::text[])
);

-- RECONCILE THE CHECKS ON EVERY APPLY.
--
-- `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already has the table, so a
-- constraint edited in this file would silently never reach it — the table would keep
-- whatever it was created with while the file claims otherwise. (Caught exactly that way:
-- adding the source/audience enums here left them unenforced on an already-created table,
-- and `INSERT … source='nope'` still succeeded.)
--
-- DROP-then-ADD rather than `ADD CONSTRAINT IF NOT EXISTS`, which Postgres does not support
-- for CHECKs. Idempotent, and it converges a warm database onto the same shape a cold one
-- gets from the CREATE TABLE above.
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'open_calls_enrichment_check', 'open_calls_kind_check',
    'open_calls_date_precision_check', 'open_calls_exact_has_close',
    'open_calls_indicative_no_close', 'open_calls_money_needs_review',
    'open_calls_money_needs_provenance', 'open_calls_source_known',
    'open_calls_audience_known'
  ] LOOP
    EXECUTE format('ALTER TABLE open_calls DROP CONSTRAINT IF EXISTS %I', c);
  END LOOP;
END $$;

ALTER TABLE open_calls
  ADD CONSTRAINT open_calls_kind_check
    CHECK (kind IN ('call', 'consultation')),
  ADD CONSTRAINT open_calls_date_precision_check
    CHECK (date_precision IN ('exact', 'indicative')),
  ADD CONSTRAINT open_calls_enrichment_check
    CHECK (enrichment IN ('none', 'source', 'auto', 'reviewed')),
  ADD CONSTRAINT open_calls_exact_has_close
    CHECK (date_precision <> 'exact' OR closes_at IS NOT NULL),
  ADD CONSTRAINT open_calls_indicative_no_close
    CHECK (date_precision <> 'indicative'
           OR (closes_at IS NULL AND period_label IS NOT NULL)),
  ADD CONSTRAINT open_calls_money_needs_provenance
    CHECK (enrichment IN ('source', 'reviewed')
           OR (budget_eur IS NULL AND aid_rate_pct IS NULL
               AND grant_min_eur IS NULL AND grant_max_eur IS NULL)),
  ADD CONSTRAINT open_calls_source_known
    CHECK (source IN ('isun', 'sp2023', 'ahu', 'az')),
  ADD CONSTRAINT open_calls_audience_known
    CHECK (audience <@ ARRAY['business','farmer','municipality','ngo','individual',
                             'school','institution','unknown']::text[]);

-- Soonest-deadline-first is the useful order and the browse table's default sort.
CREATE INDEX IF NOT EXISTS idx_open_calls_close ON open_calls (closes_at);
-- Not used by open_calls_list. It serves the LOADER's per-source shrink guard and the data
-- gate's per-source counts, both of which scan one source at a time.
CREATE INDEX IF NOT EXISTS idx_open_calls_source ON open_calls (source, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_calls_audience ON open_calls USING gin (audience);
CREATE INDEX IF NOT EXISTS idx_open_calls_title_trgm
  ON open_calls USING gin (title gin_trgm_ops);

-- Per-source crawl stamp — what the freshness banner reads. SEPARATE from the rows so
-- "this source returned zero" stays distinguishable from "this source was never crawled";
-- collapsing the two is how a dead crawler reads as an empty register.
CREATE TABLE IF NOT EXISTS open_calls_crawl (
  source      text PRIMARY KEY,
  crawled_at  timestamptz NOT NULL,
  rows_seen   int NOT NULL,
  ok          boolean NOT NULL,
  note        text
);

-- THE ONE PLACE STATUS IS DECIDED — and it lives in the VIEW, not the function, so the
-- function and the DbDataTable base cannot drift apart. `open_calls_list` is a thin filter
-- over this view; anything that needs the whole relation (counts, facets, range filters)
-- reads the view directly.
--
-- The view carries NO LIMIT on purpose. A DbDataTable `base` must be the full relation: the
-- engine composes WHERE / ORDER BY / LIMIT on top and runs its counts and facets over the
-- same relation, so an internal LIMIT is an optimisation fence that corrupts totals. With
-- `ORDER BY closes_at ASC` it would also be actively perverse once this never-deleted
-- archive passes the cap: the rows kept would be the OLDEST EXPIRED calls and the ones
-- dropped would be the currently open ones.
DROP VIEW IF EXISTS open_calls_table;
CREATE VIEW open_calls_table AS
  SELECT c.*,
    CASE
      -- Closed FIRST, before the kind and precision branches. A consultation carries a
      -- „коментари до" deadline too, and with no-delete every past draft would otherwise
      -- accumulate as apparently-current — the harm Invariant 1 exists to prevent, just
      -- one `kind` over.
      WHEN c.closes_at IS NOT NULL AND c.closes_at < now()  THEN 'closed'
      WHEN c.kind = 'consultation'                          THEN 'consultation'
      WHEN c.date_precision = 'indicative'                  THEN 'indicative'
      WHEN c.opens_at IS NOT NULL AND c.opens_at > now()    THEN 'upcoming'
      ELSE 'open'
    END AS status,
    -- NULL once the deadline has passed, NOT 0. Clamping an expired call to zero makes it
    -- indistinguishable from one closing today, so a „closes within 30 days" range filter
    -- returns the whole expired archive: measured `days_left <= 30` → 13 rows, 10 of them
    -- already closed. A closed call has no days left; it has none, which is NULL.
    CASE
      WHEN c.closes_at IS NULL OR c.closes_at < now() THEN NULL
      ELSE (c.closes_at::date - now()::date)::int
    END AS days_left
  FROM open_calls c;

-- p_kind defaults to 'call': drafts are published (funds-module-v2 §8.3.6) but never in
-- the same list as real calls.
--
-- DROP before CREATE: `CREATE OR REPLACE FUNCTION` raises 42P13 on a return-type change, and
-- apply_functions.ts sends the file as one transaction, so that would roll back everything
-- above it. 56 other migrations carry the same guard (see 010_tenders_api.sql).
DROP FUNCTION IF EXISTS open_calls_list(text, text, text, text, int);
CREATE FUNCTION open_calls_list(
  p_status   text DEFAULT 'open',
  p_kind     text DEFAULT 'call',
  p_audience text DEFAULT NULL,
  p_q        text DEFAULT NULL,
  p_limit    int  DEFAULT 100
) RETURNS TABLE (
  id int, source text, source_key text, code text, kind text, title text,
  programme_code text, programme_name text, objective text,
  status text, date_precision text, opens_at timestamptz, closes_at timestamptz,
  period_label text, days_left int,
  budget_eur numeric, budget_note text, aid_rate_pct numeric,
  grant_min_eur numeric, grant_max_eur numeric,
  beneficiaries_raw text, audience text[], territory text,
  source_url text, docs jsonb, enrichment text,
  first_seen_at timestamptz, last_seen_at timestamptz, checked_at timestamptz
) LANGUAGE sql STABLE AS $$
  SELECT id, source, source_key, code, kind, title,
         programme_code, programme_name, objective,
         status, date_precision, opens_at, closes_at,
         period_label, days_left,
         budget_eur, budget_note, aid_rate_pct, grant_min_eur, grant_max_eur,
         beneficiaries_raw, audience, territory,
         source_url, docs, enrichment,
         first_seen_at, last_seen_at, checked_at
  FROM open_calls_table
  WHERE (p_kind = 'all' OR kind = p_kind)
    AND (p_status = 'all' OR status = p_status)
    AND (p_audience IS NULL OR audience @> ARRAY[p_audience])
    AND (p_q IS NULL OR p_q = '' OR title ILIKE '%' || p_q || '%'
         OR code ILIKE '%' || p_q || '%')
  -- Soonest deadline first; rows without one (indicative, consultation) after them.
  ORDER BY closes_at ASC NULLS LAST, id ASC
  LIMIT GREATEST(1, LEAST(p_limit, 2000));
$$;

-- Role-guarded: roles_readonly.sql is a one-time manual step, and an unguarded GRANT
-- raises 42704 on a cold bootstrap, rolling back this whole file (117/130 shape).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON open_calls TO app_readonly;
    GRANT SELECT ON open_calls_crawl TO app_readonly;
    GRANT SELECT ON open_calls_table TO app_readonly;
    GRANT EXECUTE ON FUNCTION open_calls_list(text, text, text, text, int) TO app_readonly;
  END IF;
END $$;
