-- 143 — „финансирано ли е нещо като моето": the fit resolver.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- THE QUESTION THIS ANSWERS, and why it needed its own object. Measured on a 113K-member
-- EU-funds group (docs/plans/funds-module-v2.md §1 and Appendix A), ~68% of what people ask is
-- „има ли програма за X" — a guest house, photovoltaics, a young farmer, digitalising a
-- construction firm. Not one of 47 posts asked who received money, which is what every other
-- surface in this module answers. The nearest thing to a reply we can give from data we hold is
-- the base rate: has anything like this been funded, how often, for how much, by what kind of
-- organisation, and where. That is category A, and the same rollup answers E („някой
-- кандидатствал ли е и одобрен ли е?") and F („има ли въобще списък какви програми се предлагат").
--
-- WHY A MATVIEW AND NOT A `fund_payloads` KIND. The plan (§4.4) says „precompute into one
-- fund_payloads kind", and the INTENT — one PK seek per request, degrade to empty, follow
-- 123/124 — is what matters and is honoured here. But `fund_payloads` is loaded FROM COMMITTED
-- JSON by `db:load:funds:pg`; writing a Postgres-derived rollup into it would mean generating
-- JSON from Postgres, which `feedback_no_json_from_pg` forbids and which would put the artifact
-- one reload out of date the moment the corpus moved. `procurement_payloads` (124) is the
-- precedent §4.4 actually names, and this follows it.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BOTH CORPORA, AND THE BASIS IS DECLARED IN THE PAYLOAD — not only in the UI.
--
-- ИСУН holds ZERO Interreg projects: Interreg runs on Jems, so no query over `fund_projects`
-- would ever return one. Because Interreg is cross-border by definition, its money lands almost
-- entirely on BORDER municipalities — exactly the places whose answer would otherwise be „no,
-- nothing like that has been funded near you" while their neighbours hold Interreg grants. That
-- is worse than not answering, and it is the bias §2.3 measured.
--
-- The two arms are served SEPARATELY rather than summed, for the same reason `fundsOverview`
-- states the Interreg figure beside the ИСУН one instead of adding it: they are different bases.
-- An ИСУН figure is a contract's own value; an Interreg figure is one partner's published budget
-- at one address. `funds_fit_basis()` returns the declaration, so no consumer can render a
-- combined figure as ИСУН-only or the reverse.
--
-- ONLY THE ИСУН ARM IS PRECOMPUTED, and that is a measurement rather than an omission: 82,011
-- contracts over 2,206 procedures is the aggregate that needs materialising; the Interreg side is
-- 1,954 operations and 1,469 placed Bulgarian partners, which any index scan answers live.
-- `interreg_fit()` below is therefore a function, not a matview.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- The oblast namespace, in SQL. `oblastToCanon` in src/lib/regionalOblast.ts is the original and
-- this must track it: the picker, `place_dim` and `interreg_partners` all speak the folded form,
-- and a matview storing the raw shards answers „nothing near you" to a fifth of the country.
-- IMMUTABLE so it can be used inside the matview's aggregate.
CREATE OR REPLACE FUNCTION canon_oblast(code text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
           WHEN code IN ('S22', 'S23', 'S24', 'S25') THEN 'SOFIA_CITY'
           WHEN code = 'PDV-00'                      THEN 'PDV'
           ELSE code
         END;
$$;

-- ── The ИСУН rollup, at PROCEDURE grain ────────────────────────────────────────────────────
--
-- Procedure and not contract, because „нещо като моето" is a question about the SCHEME. One
-- contract tells you a single company got money; the procedure tells you 340 did, that the
-- median grant was €48k, and that 61% of them were ЕООД — which is the answer someone deciding
-- whether to spend three months on an application actually needs.
--
-- The code is derived by stripping the trailing project ordinal from `contract_number`
-- (`BG-RRP-1.001-0002` → `BG-RRP-1.001`). That is the same derivation
-- `scripts/funds/procedures.ts` uses for the committed by-procedure shards, so the codes here
-- join to `fund_payloads(kind='procedure')` and to `/funds/procedure/:code`.
DROP MATERIALIZED VIEW IF EXISTS fund_fit CASCADE;
CREATE MATERIALIZED VIEW fund_fit AS
WITH proj AS (
  SELECT regexp_replace(f.contract_number, '-[0-9]+$', '') AS procedure_code,
         f.*
    FROM fund_projects f
),
agg AS (
  SELECT p.procedure_code,
         -- The programme is a property of the procedure, so mode() rather than an arbitrary pick.
         mode() WITHIN GROUP (ORDER BY p.program_code) AS program_code,
         mode() WITHIN GROUP (ORDER BY p.program_name) AS program_name,
         count(*)::int                                  AS project_count,
         count(DISTINCT p.beneficiary_eik)::int         AS beneficiary_count,
         COALESCE(sum(p.total_eur), 0)                  AS total_eur,
         COALESCE(sum(p.grant_eur), 0)                  AS grant_eur,
         COALESCE(sum(p.paid_eur), 0)                   AS paid_eur,
         -- QUARTILES, not just a mean. „Колко дават" has a long tail — a mean over a procedure
         -- with one €40m infrastructure contract and 300 small ones describes neither. The median
         -- is the number a reader can plan against and the one Stage 6's reference price
         -- („5% от медианния грант тук = €X") is computed from.
         percentile_cont(0.25) WITHIN GROUP (ORDER BY p.grant_eur)
           FILTER (WHERE p.grant_eur > 0)                AS grant_p25,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY p.grant_eur)
           FILTER (WHERE p.grant_eur > 0)                AS grant_median,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY p.grant_eur)
           FILTER (WHERE p.grant_eur > 0)                AS grant_p75,
         -- DISBURSEMENT, not approval. The corpus holds only SIGNED contracts, so it cannot say
         -- what share of APPLICANTS were approved — the denominator (rejected applications) is
         -- not published by ИСУН at all. What it can say is how many of the signed ones actually
         -- got paid, which is the nearest honest thing to category E's „одобрен ли е бил". The
         -- column is named for what it measures so no consumer can relabel it.
         count(*) FILTER (WHERE COALESCE(p.paid_eur, 0) > 0)::int AS paid_project_count,
         -- The example project a reader recognises: the largest by value, which is also the one
         -- most likely to be findable elsewhere.
         (ARRAY_AGG(p.title ORDER BY p.total_eur DESC NULLS LAST)
            FILTER (WHERE p.title IS NOT NULL AND p.title <> ''))[1] AS sample_title
    FROM proj p
   GROUP BY p.procedure_code
),
forms AS (
  SELECT procedure_code,
         jsonb_agg(jsonb_build_object('label', form, 'n', n, 'eur', eur)
                   ORDER BY n DESC) AS org_forms
    FROM (SELECT p.procedure_code,
                 COALESCE(p.org_form, 'неуточнена') AS form,
                 count(*)::int AS n,
                 COALESCE(sum(p.total_eur), 0) AS eur
            FROM proj p GROUP BY 1, 2) t
   GROUP BY procedure_code
),
kinds AS (
  -- The GRANULARITY that answers the question. „Частно правна" (77% of the corpus) tells a reader
  -- nothing; „Физическо лице", „ЕООД", „Общинска администрация", „Училище" tells them whether
  -- somebody in their situation has ever won this. Capped at 6 — the tail is a long list of
  -- one-off legal forms and shipping it would triple the payload.
  SELECT procedure_code,
         jsonb_agg(jsonb_build_object('label', kind, 'n', n) ORDER BY n DESC) AS org_kinds
    FROM (SELECT p.procedure_code,
                 COALESCE(p.org_kind, 'неуточнен') AS kind,
                 count(*)::int AS n,
                 row_number() OVER (PARTITION BY p.procedure_code ORDER BY count(*) DESC) AS rn
            FROM proj p GROUP BY 1, 2) t
   WHERE rn <= 6
   GROUP BY procedure_code
),
places AS (
  -- Oblast rather than obshtina: the resolver's place question is „near me", and an oblast is the
  -- grain at which a reader recognises „yes, people like me around here have had this".
  --
  -- Stored as a jsonb OBJECT (`{"SFO": 107, "BGS": 31}`) and not an array of pairs, because the
  -- serving function's hottest operation is „how many in the asker's oblast" — an O(1) key probe on
  -- an object, but a full `jsonb_array_elements` expansion on an array, run once for the count and
  -- again for the ORDER BY. Measured on „иновации" (296 matching procedures): the trigram scan is
  -- 563 buffers and the two array expansions took the whole call to 2,181. The consumer sorts by
  -- value for display, which is where ordering belongs anyway.
  --
  -- ALL oblasti, not a top-8: an object of ≤28 short keys is smaller than the array of 8 objects it
  -- replaces, and truncating would make `local_count` silently zero for a reader in the 9th oblast
  -- — „nothing near you" when there are twelve.
  -- FOLDED TO THE CANONICAL NAMESPACE, mirroring `oblastToCanon` (src/lib/regionalOblast.ts).
  -- `fund_projects.oblast` keys the capital as the four RAW shards S22/S23/S24/S25, because
  -- `normalOblast` in the funds resolver folds only PDV-00. But the UI picker is built from
  -- OBLAST_NAME, and `place_dim` and `interreg_partners` both store the folded form — so storing
  -- the raw shards made `oblasti ->> 'SOFIA_CITY'` permanently NULL and `oblasti ? 'SOFIA_CITY'`
  -- permanently false. Measured: 15,748 projects, 19.2% of the corpus and roughly double the
  -- next-largest oblast, invisible to „near me" — while the Interreg arm's local chip kept
  -- working on the same input, so a reader in Sofia saw one arm answer and the other not.
  SELECT procedure_code, jsonb_object_agg(oblast, n) AS oblasti
    FROM (SELECT p.procedure_code, canon_oblast(p.oblast) AS oblast, count(*)::int AS n
            FROM proj p WHERE p.oblast IS NOT NULL GROUP BY 1, 2) t
   GROUP BY procedure_code
)
SELECT a.procedure_code,
       a.program_code,
       a.program_name,
       -- The procedure's own name is published for only 41% of them (880 of 2,139), so the
       -- largest project's title stands in. Kept as a SEPARATE column rather than coalesced into
       -- one, so a consumer can tell „this is the scheme's name" from „this is an example of what
       -- it funded" — presenting the second as the first would misdescribe the scheme.
       pn.procedure_name,
       a.sample_title,
       a.project_count, a.beneficiary_count, a.paid_project_count,
       a.total_eur, a.grant_eur, a.paid_eur,
       a.grant_p25, a.grant_median, a.grant_p75,
       COALESCE(f.org_forms, '[]'::jsonb) AS org_forms,
       COALESCE(k.org_kinds, '[]'::jsonb) AS org_kinds,
       COALESCE(pl.oblasti,  '{}'::jsonb) AS oblasti,
       -- ARM 1's haystack: the scheme's own name and its programme. Project titles are
       -- deliberately NOT folded in — see the serving function's header for the two folds that
       -- were built and measured against the corpus, and why searching `fund_projects` directly
       -- beats both.
       trim(BOTH ' ' FROM COALESCE(pn.procedure_name, '') || ' ' || COALESCE(a.program_name, ''))
         AS search_text
  FROM agg a
  LEFT JOIN forms  f  USING (procedure_code)
  LEFT JOIN kinds  k  USING (procedure_code)
  LEFT JOIN places pl USING (procedure_code)
  -- The names live in the committed by-procedure shards rather than on `fund_projects` (ИСУН's
  -- export carries no procedure-name column). LEFT, because 59% of procedures have none.
  LEFT JOIN LATERAL (
    SELECT NULLIF(fp.payload->>'procedureName', '') AS procedure_name
      FROM fund_payloads fp
     WHERE fp.kind = 'procedure' AND fp.key = a.procedure_code
  ) pn ON true
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fund_fit_code ON fund_fit (procedure_code);
CREATE INDEX IF NOT EXISTS idx_fund_fit_search_trgm
  ON fund_fit USING gin (search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fund_fit_total ON fund_fit (total_eur DESC NULLS LAST);

-- ── Serving: the ИСУН arm ──────────────────────────────────────────────────────────────────
--
-- TWO ARMS, UNIONED — the scheme's own name, and the procedure reached through one of its PROJECT
-- titles. Both are needed: only 41% of procedures publish a name, and a scheme whose name says
-- „енергийна ефективност" may have no project repeating the phrase.
--
-- ARM 2 SEARCHES `fund_projects` DIRECTLY, and that is the measured choice rather than the obvious
-- one. Folding the titles into the matview looks cheaper — one relation, one index — and two folds
-- were built and rejected against the full corpus:
--   * a bag of distinct WORDS per procedure (1,016 kB) covers every project but shreds phrases, and
--     `<%` scores the query against a CONTIGUOUS EXTENT of the target's words — so „къща за гости"
--     stops matching;
--   * every distinct TITLE per procedure (3,157 kB, up to 2,215 titles on one row) keeps phrases and
--     is CORRECT, but the rows TOAST and the trigram recheck has to read them: 418–616 ms per query
--     against 19–162 ms for the direct arm, i.e. 4x slower for no gain;
--   * the 25 largest titles by value (992 kB) is fast but biases to big projects and loses exactly
--     the small ones this resolver's readers ask about — measured, it dropped „къща за гости" →
--     „Подкрепа за семейно предприятие" (1,869 projects), the best answer the corpus holds for it.
-- Arm 2 costs ~1,144 buffers, irreducibly (the trigram scan scores every candidate before any LIMIT
-- applies — confirmed at caps of 400, 200 and 120). Whole-call worst case is 2,822 buffers at
-- 162 ms, on the shortest common query („иновации"); `funds_fit.data.test.ts` holds that ceiling.
--
-- `p_place` RANKS, IT NEVER FILTERS. „Нищо подобно не е финансирано" is a far worse answer than
-- „в твоята област няма, но в страната има 340" — and for a resolver whose entire purpose is to
-- tell someone whether to bother applying, a false negative is the expensive error. The oblast
-- count travels as its own field so the caller can say both.
CREATE OR REPLACE FUNCTION funds_fit_isun(
  p_q      text,
  p_oblast text DEFAULT NULL,
  p_limit  int  DEFAULT 6
) RETURNS TABLE (
  procedure_code   text,
  procedure_name   text,
  sample_title     text,
  program_name     text,
  project_count    int,
  beneficiary_count int,
  paid_project_count int,
  total_eur        double precision,
  grant_median     double precision,
  grant_p25        double precision,
  grant_p75        double precision,
  org_kinds        jsonb,
  oblasti          jsonb,
  local_count      int,
  score            real
)
LANGUAGE sql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.45
AS $$
  WITH hits AS (
    -- Arm 1: the scheme's own name / programme.
    SELECT ff.procedure_code, word_similarity(p_q, ff.search_text) AS s
      FROM fund_fit ff
     WHERE ff.search_text <> '' AND p_q <% ff.search_text
    UNION ALL
    -- Arm 2: reached through a PROJECT title.
    --
    -- `DISTINCT ON` the PROCEDURE, not a LIMIT on project rows. A row cap looks equivalent and is
    -- not: measured on „енергийна ефективност", 185 distinct procedures match the trigram
    -- predicate but only 41 survived a 400-ROW cap — 78% dropped, and the survivors chosen partly
    -- by `total_eur`, which is the exact big-project bias the header rejects the „25 largest
    -- titles" fold for, reintroduced one layer down. Worse, the cut ran BEFORE the place ranking,
    -- so a procedure whose only matches were small local projects could be evicted before „near
    -- me" ever saw it. The scan cost is unchanged either way (the trigram scan scores every
    -- candidate before any cut — confirmed at caps of 400, 200 and 120), so this is recall for
    -- free. `DISTINCT ON` needs the procedure first in ORDER BY; the score decides which row of a
    -- procedure survives, and `contract_number` makes that choice deterministic.
    SELECT procedure_code, s
      FROM (SELECT DISTINCT ON (regexp_replace(f.contract_number, '-[0-9]+$', ''))
                   regexp_replace(f.contract_number, '-[0-9]+$', '') AS procedure_code,
                   word_similarity(p_q, f.title) AS s
              FROM fund_projects f
             WHERE f.title IS NOT NULL AND f.title <> '' AND p_q <% f.title
             ORDER BY 1, 2 DESC, f.contract_number) t
  ),
  best AS (
    SELECT procedure_code, max(s) AS score FROM hits GROUP BY procedure_code
  )
  SELECT ff.procedure_code, ff.procedure_name, ff.sample_title, ff.program_name,
         ff.project_count, ff.beneficiary_count, ff.paid_project_count,
         ff.total_eur, ff.grant_median, ff.grant_p25, ff.grant_p75,
         ff.org_kinds, ff.oblasti,
         -- How many of them are in the asker's oblast. Read out of the stored breakdown rather
         -- than re-queried, so this stays a PK seek.
         CASE WHEN p_oblast IS NULL THEN 0
              ELSE COALESCE((ff.oblasti ->> p_oblast)::int, 0) END AS local_count,
         b.score
    FROM best b
    JOIN fund_fit ff USING (procedure_code)
   -- Place RANKS: a procedure with local projects sorts first, but one without them is still
   -- returned. Then the relevance of the match, then size as the tie-break.
   ORDER BY (CASE WHEN p_oblast IS NOT NULL AND ff.oblasti ? p_oblast THEN 0 ELSE 1 END),
            b.score DESC,
            ff.total_eur DESC NULLS LAST,
            ff.procedure_code
   LIMIT GREATEST(1, LEAST(p_limit, 50));
$$;

-- ── Serving: the Interreg arm ──────────────────────────────────────────────────────────────
--
-- Live, not precomputed — 1,954 operations against 82,011 contracts. Returns the BULGARIAN
-- partner's own budget summed per operation, never `o.total_budget_eur`: that is the whole
-- cross-border project (€1,419,208 on BSB00963 against Малко Търново's €357,183), so a resolver
-- quoting it would overstate what a Bulgarian applicant actually received fourfold.
--
-- `title_en` travels with `title_is_english` beside it. keep.eu publishes these in English only
-- and we do not machine-translate them (§2.3(c)) — a mistranslated operation name is unfindable
-- in the register a reader would have to go to. The flag is what lets the UI mark them rather
-- than let an English row sit unexplained in a Bulgarian list.
CREATE OR REPLACE FUNCTION funds_fit_interreg(
  p_q      text,
  p_oblast text DEFAULT NULL,
  p_limit  int  DEFAULT 4
) RETURNS TABLE (
  keep_id          int,
  title            text,
  title_is_english boolean,
  programme_name   text,
  period           text,
  bg_budget_eur    double precision,
  partner_count    int,
  oblast           text,
  obshtina         text,
  is_local         boolean,
  score            real
)
LANGUAGE sql STABLE PARALLEL SAFE
SET pg_trgm.word_similarity_threshold = 0.45
AS $$
  WITH bg AS (
    -- BULGARIAN, by 137's own canonical predicate — not „has a place". Place resolution is a
    -- best-effort cascade, so filtering on it silently drops the operations whose Bulgarian
    -- partner could not be geocoded: measured, 13 operations and €4.6m. They have no local chip
    -- (nothing to show) but they are still answers to „has anything like mine been funded".
    SELECT p.keep_id,
           SUM(p.budget_eur)                          AS bg_budget_eur,
           count(*)::int                              AS partner_count,
           -- The place fields are the mode over the PLACED partners only; an operation with none
           -- yields NULL here, which the UI renders as no chip rather than as a wrong place.
           mode() WITHIN GROUP (ORDER BY p.oblast)     FILTER (WHERE p.obshtina IS NOT NULL) AS oblast,
           mode() WITHIN GROUP (ORDER BY p.obshtina)   FILTER (WHERE p.obshtina IS NOT NULL) AS obshtina,
           -- ANY partner in the asker's oblast, not the mode one. An operation with partners in
           -- two oblasti is local to both, and testing the mode would deny it to the smaller.
           bool_or(p_oblast IS NOT NULL AND p.oblast = p_oblast) AS is_local
      FROM interreg_partners p
     WHERE p.country = 'Bulgaria' OR p.country_department = 'Bulgaria'
     GROUP BY p.keep_id
  )
  SELECT o.keep_id,
         COALESCE(o.title_bg, o.title_en)     AS title,
         (o.title_bg IS NULL)                 AS title_is_english,
         g.name_bg                            AS programme_name,
         o.period,
         bg.bg_budget_eur, bg.partner_count, bg.oblast, bg.obshtina,
         COALESCE(bg.is_local, false)         AS is_local,
         GREATEST(word_similarity(p_q, o.title_en),
                  word_similarity(p_q, COALESCE(o.title_bg, ''))) AS score
    FROM interreg_operations o
    JOIN bg USING (keep_id)
    LEFT JOIN interreg_programmes g ON g.code = o.programme_code
   WHERE p_q <% o.title_en OR (o.title_bg IS NOT NULL AND p_q <% o.title_bg)
   ORDER BY COALESCE(bg.is_local, false) DESC,
            GREATEST(word_similarity(p_q, o.title_en),
                     word_similarity(p_q, COALESCE(o.title_bg, ''))) DESC,
            bg.bg_budget_eur DESC NULLS LAST,
            o.keep_id
   LIMIT GREATEST(1, LEAST(p_limit, 20));
$$;

-- ── The declared basis ─────────────────────────────────────────────────────────────────────
--
-- Returned IN THE PAYLOAD, not written only in the UI copy. A consumer that renders one arm and
-- omits the other must not be able to present the result as „the EU-funds corpus" — and the
-- Interreg org caveat is a property of the data, not of any one page.
CREATE OR REPLACE FUNCTION funds_fit_basis()
RETURNS TABLE (
  isun_projects       int,
  isun_procedures     int,
  interreg_operations int,
  interreg_partners   int,
  interreg_with_eik   int
)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*)::int FROM fund_projects),
         (SELECT count(*)::int FROM fund_fit),
         -- SEARCHABLE, not total. `funds_fit_interreg` inner-joins the Bulgarian-partner CTE, so
         -- an operation with no Bulgarian partner can never be returned — and the caption renders
         -- this number as „the basis". Reporting all 1,954 declared a corpus far larger than the
         -- one the resolver can answer from, on the very arm whose point is that „nothing found"
         -- can be trusted.
         (SELECT count(DISTINCT keep_id)::int FROM interreg_partners
           WHERE country = 'Bulgaria' OR country_department = 'Bulgaria'),
         (SELECT count(*)::int FROM interreg_partners WHERE obshtina IS NOT NULL),
         -- The Tier-L caveat, as a NUMBER. 2014-2020 Interreg carries no EIK, so an org-form
         -- breakdown over that arm is partial — 330 of 1,469 placed partners as of 2026-08.
         -- Shipping the ratio rather than a sentence means the caption can state the real share
         -- and cannot drift from it.
         (SELECT count(*)::int FROM interreg_partners
           WHERE obshtina IS NOT NULL AND eik IS NOT NULL);
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON fund_fit TO app_readonly;
    GRANT EXECUTE ON FUNCTION funds_fit_isun(text, text, int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION funds_fit_interreg(text, text, int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION funds_fit_basis() TO app_readonly;
  END IF;
END $$;
