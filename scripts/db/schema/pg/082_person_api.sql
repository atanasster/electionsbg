-- 082_person_api.sql — read-only serving functions over the resolved person tables
-- (081_person_identity.sql, populated by scripts/person/resolve_persons.ts). STABLE
-- jsonb functions, EXECUTE auto-granted to app_readonly via ALTER DEFAULT PRIVILEGES.
-- These back the future /api/db/person + personSearch AI tool (plan §4b, §4d). Idempotent.

-- One person's unified profile for /person/{slug}: identity + every role, each tagged
-- with its source facet + Bulgarian label (person_source, plan §5) so the Connections
-- component (§8) can drive its filter chips straight off `facets`. PUBLIC-SAFE: only
-- active, non-review-confidence roles are exposed (plan §3 public-surface rule).
DROP FUNCTION IF EXISTS person_by_slug(text);
CREATE OR REPLACE FUNCTION person_by_slug(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    -- §6 privacy gate: only PUBLIC figures get a public profile. A private person (e.g. a
    -- donor-only individual) is internal-only and must never be served, even by slug.
    SELECT * FROM person
     WHERE slug = p_slug AND status = 'active'
       AND (is_public_figure OR identity_confidence = 'verified') LIMIT 1
  )
  SELECT jsonb_build_object(
    'slug', pick.slug,
    'name', pick.display_name,
    'namesakeRisk', pick.namesake_risk,
    'isPublicFigure', pick.is_public_figure,
    'facets', COALESCE((
      SELECT jsonb_agg(DISTINCT s.facet)
      FROM person_role r JOIN person_source s ON s.key = r.source
      WHERE r.person_id = pick.person_id
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- The TYPED place (migration 115): `placeKind` says which namespace `placeCode` is in.
    --
    -- The LABELS ARE JOINED, not read off person_role. 115 materialised place_label /
    -- place_label_en because every code→name hook in the app is election-scoped and a
    -- person page is not — place_dim (117) is that missing dictionary, so the columns
    -- become a join and stop being a second copy that can drift from its producer.
    --
    -- The two dictionaries are MUTUALLY EXCLUSIVE by construction — pd matches only
    -- 'mir'/'obshtina', jb only 'judicial' — so COALESCE picks the one that applies and
    -- yields NULL for a placeless role, without a CASE over place_kind. name_bg is NOT
    -- NULL in place_dim, so a joined row can never coalesce past itself.
    --
    -- place_raw is the LAST arm, and is only ever set when neither dictionary resolved:
    -- 43 magistrate rows whose ИВСС free-text court is a typo or is ambiguous between two
    -- real bodies. Showing the declaration's own words beats blanking the badge, and it
    -- cannot mask a dictionary miss because a resolved place never populates it.
    --
    -- placeLabelEn is pd-only ON PURPOSE: judicial_body carries no English name, and
    -- person_role.place_label_en was already NULL for 100% of judicial roles — so this
    -- reproduces the existing contract rather than regressing it. The page falls back to
    -- the Bulgarian label (PersonProfileScreen.placeText).
    --
    -- `judicialKind` rides along for magistrate roles only — it is what retired
    -- src/lib/magistrateRole.ts, which sniffed Съдия/Прокурор/Следовател out of the
    -- institution STRING client-side.
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', r.source, 'facet', s.facet, 'sourceLabel', s.label_bg,
        'role', r.role, 'ref', r.ref, 'confidence', r.confidence,
        'placeKind', r.place_kind, 'placeCode', r.place_code,
        -- A settlement is printed WITH its type ("с. Безмер", "гр. Костинброд"): the bare
        -- name reads as an obshtina on a page that also prints obshtini, and "Безмер" alone
        -- does not say which kind of place it is. place_dim.name_bg is left alone — the
        -- procurement surfaces (119/123) join it for their own labels — so the prefix is
        -- composed here. Kept IDENTICAL in 120_person_browse.sql; the two must not print
        -- different names for one seat.
        'placeLabel', COALESCE(
          CASE WHEN pd.kind = 'settlement' AND pd.settlement_type IS NOT NULL
               THEN pd.settlement_type || ' ' || pd.name_bg END,
          pd.name_bg, jb.name, r.place_raw),
        'placeLabelEn', pd.name_en,
        'judicialKind', jb.kind,
        -- The dates, WITH the basis that says what they measure (081). Emitted together on
        -- purpose: 'term' is a real start of office, 'election' is the vote that produced the
        -- mandate (the oath follows at the constitutive session) and 'filing' is when a
        -- declaration was lodged, up to ~30 days after the fact. Rendering a bare range would
        -- state all three as the same claim. `start`/`end` are ISO date strings (to_char, not
        -- a bare ::text cast) so a consumer never has to parse a locale-dependent form.
        'start', to_char(r.start_date, 'YYYY-MM-DD'),
        'end', to_char(r.end_date, 'YYYY-MM-DD'),
        'dateBasis', r.date_basis
      -- The trailing date/ref keys are what make this order TOTAL. (facet, role) alone
      -- ties for every one of an MP's per-parliament rows, and jsonb_agg under a tie is
      -- whatever the plan emits — measured on mp-5221, nine terms came back
      -- 51,50,49,48,52,46,45,44,47. A consumer that shows the group's first row (the
      -- profile's офиси dedupe does) would name a different term between two resolves.
      -- start_date DESC NULLS LAST puts the most recent mandate first; ref breaks the
      -- remaining ties so undated rows are ordered too.
      ) ORDER BY s.facet, r.role, r.start_date DESC NULLS LAST, r.ref)
      FROM person_role r
      JOIN person_source s ON s.key = r.source
      LEFT JOIN place_dim pd
        ON pd.kind = r.place_kind AND pd.code = r.place_code
      LEFT JOIN judicial_body jb
        ON r.place_kind = 'judicial' AND jb.body_code = r.place_code
      WHERE r.person_id = pick.person_id
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- TR footprint resolved to NAMED companies (the bare EIK in `roles` is useless on a
    -- page). Each company carries every role the person holds there + its PUBLIC-CONTRACT
    -- take (Σ amount_eur WHERE tag='contract' — the current post-annex basis matching SIGMA,
    -- reference_procurement_eur_sum_basis / 078)
    -- — the money thesis on the identity page. Bridged only — Bridge A (shared company) /
    -- Bridge B (unique full name) — so it is public-safe by §3/§6. Ordered money-first.
    'companies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eik', tr.ref, 'name', c.name, 'legalForm', c.legal_form,
        'seat', c.seat, 'status', c.status, 'roles', tr.roles,
        'procuredEur', pr.eur, 'contracts', pr.n,
        -- every public-money stream this company touches, keyed on the same EIK
        -- (person-candidate-merge-v1): ЗОП contracts (above), ИСУН EU funds, ДФЗ subsidies.
        'fundsEur', fn.contracted, 'fundsPaidEur', fn.paid, 'fundProjects', fn.n,
        'subsidiesEur', ag.total
      ) ORDER BY
        COALESCE(pr.eur, 0) + COALESCE(fn.contracted, 0) + COALESCE(ag.total, 0)
          DESC NULLS LAST, c.name NULLS LAST, tr.ref)
      FROM (
        SELECT r.ref, jsonb_agg(DISTINCT r.role ORDER BY r.role) AS roles
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'tr'
          AND r.confidence IN ('exact_id', 'high', 'manual')
        GROUP BY r.ref
      ) tr
      LEFT JOIN tr_companies c ON c.uic = tr.ref
      LEFT JOIN LATERAL (
        SELECT round(sum(ct.amount_eur)::numeric, 2) AS eur, count(*) AS n
        FROM contracts ct WHERE ct.contractor_eik = tr.ref AND ct.tag = 'contract'
          -- Exclude €0 consortium member rows (migration 087) — mirrors 024.
          AND ct.consortium_role IS DISTINCT FROM 'member'
      ) pr ON pr.n > 0
      -- ИСУН beneficiary row (one per EIK) + its project count.
      LEFT JOIN LATERAL (
        SELECT round(fb.contracted_eur::numeric, 2) AS contracted,
               round(fb.paid_eur::numeric, 2) AS paid,
               (SELECT count(*) FROM fund_projects fp WHERE fp.beneficiary_eik = tr.ref) AS n
        FROM fund_beneficiaries fb WHERE fb.eik = tr.ref
      ) fn ON true
      -- ДФЗ agri subsidies (sum across CAP years) — legal entities only (individuals have no EIK).
      LEFT JOIN LATERAL (
        SELECT round(sum(a.total_eur)::numeric, 2) AS total
        FROM agri_subsidies a WHERE a.eik = tr.ref
      ) ag ON true
    ), '[]'::jsonb),
    -- NGO board seats (ЮЛНЦ — associations / foundations / читалища), the `ngo` facet.
    -- Same bridge + public-safe rules as `companies`, but a civic board seat, not a
    -- business interest, so it renders in its own section (no procurement column).
    'ngos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eik', ng.ref, 'name', c.name, 'legalForm', c.legal_form,
        'seat', c.seat, 'roles', ng.roles
      ) ORDER BY c.name NULLS LAST, ng.ref)
      FROM (
        SELECT r.ref, jsonb_agg(DISTINCT r.role ORDER BY r.role) AS roles
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'ngo'
          AND r.confidence IN ('exact_id', 'high', 'manual')
        GROUP BY r.ref
      ) ng LEFT JOIN tr_companies c ON c.uic = ng.ref
    ), '[]'::jsonb),
    -- The person's total public-contract take across ALL their companies (EIK-deduped so a
    -- manager+owner double role can't double-count).
    'procuredEur', COALESCE((
      SELECT round(sum(x.eur)::numeric, 2) FROM (
        SELECT (SELECT sum(amount_eur) FROM contracts
                 WHERE contractor_eik = r.ref AND tag = 'contract') AS eur
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'tr'
          AND r.confidence IN ('exact_id', 'high', 'manual')  -- match the companies filter
        GROUP BY r.ref
      ) x
    ), 0),
    -- Total ИСУН EU-funds contracted across the person's companies (EIK-deduped, same gate).
    'fundsEur', COALESCE((
      SELECT round(sum(x.eur)::numeric, 2) FROM (
        SELECT (SELECT fb.contracted_eur FROM fund_beneficiaries fb WHERE fb.eik = r.ref) AS eur
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'tr'
          AND r.confidence IN ('exact_id', 'high', 'manual')
        GROUP BY r.ref
      ) x
    ), 0),
    -- Total ДФЗ agri subsidies across the person's companies (EIK-deduped, same gate).
    'subsidiesEur', COALESCE((
      SELECT round(sum(x.eur)::numeric, 2) FROM (
        SELECT (SELECT sum(a.total_eur) FROM agri_subsidies a WHERE a.eik = r.ref) AS eur
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'tr'
          AND r.confidence IN ('exact_id', 'high', 'manual')
        GROUP BY r.ref
      ) x
    ), 0),
    -- Official sanctions designations (OFAC/EU), with their provenance from source_row —
    -- rendered as a prominent, CITED badge (these are government findings, not our claim).
    'sanctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'program', r.source_row->>'program',
        'authority', r.source_row->>'authority',
        'date', r.source_row->>'date',
        'url', r.source_row->>'url'
      ) ORDER BY r.source_row->>'date' DESC)
      FROM person_role r
      WHERE r.person_id = pick.person_id AND r.source = 'sanctions'
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- ДС / COMDOS affiliations (Комисия по досиетата) — official state findings, cited to
    -- their решение № + date, rendered as a prominent CITED badge (a government verdict,
    -- not our claim). Same public-safe gate as sanctions (attached only via the MP gold key).
    'ds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'decisionNo', r.source_row->>'decisionNo',
        'decisionDate', r.source_row->>'decisionDate',
        'body', r.source_row->>'bodyContext',
        'category', r.source_row->>'category',
        'pseudonyms', COALESCE(r.source_row->'pseudonyms', '[]'::jsonb),
        'url', r.source_row->>'url'
      ) ORDER BY r.source_row->>'decisionDate' DESC)
      FROM person_role r
      WHERE r.person_id = pick.person_id AND r.source = 'ds'
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- Regulator / independent-body seats (the `regulator` facet, "кой решава"). Public
    -- record — the body + seat + term + official source.
    'regulators', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'body', r.source_row->>'body',
        'seat', r.source_row->>'seat',
        'termStart', r.source_row->>'termStart',
        'url', r.source_row->>'url'
      ) ORDER BY r.source_row->>'body', r.source_row->>'seat')
      FROM person_role r
      WHERE r.person_id = pick.person_id AND r.source = 'regulator'
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- Alternate surface forms that fold to this person (spelling / transliteration
    -- variants across sources), for display + so a search hit on any of them makes sense.
    'aliases', COALESCE((
      SELECT jsonb_agg(DISTINCT a.alias_raw)
      FROM person_alias a
      WHERE a.person_id = pick.person_id AND a.alias_raw <> pick.display_name
    ), '[]'::jsonb)
  )
  FROM pick;
$$;

-- A fuzzy index over the alternate name forms so name-resolution + search can match a
-- variant spelling (marriage / transliteration) that only appears in person_alias.
CREATE INDEX IF NOT EXISTS idx_person_alias_fold_trgm
  ON person_alias USING gin (alias_fold gin_trgm_ops);

-- Resolve a bare NAME to its profile — but only when the folded name maps to exactly ONE
-- active person (no namesake ambiguity). Lets the legacy /person/{name} links (magistrate
-- holdings, associates, connection checks) land on the unified profile; a 0- or >1-match
-- name returns NULL so the caller falls back to the legacy portfolio / a chooser.
--
-- THIS IS A POINT LOOKUP AND MUST PLAN AS ONE. It used to cost 318 ms and read 3,912
-- buffers (~31 MB), because of two defects that compounded — see
-- docs/plans/db-route-timeouts-v1.md §1.1.
--
-- It matters more than the shape suggests: /api/db/person-profile calls person_by_slug
-- FIRST and only lands here when that misses. A real /person/{slug} link therefore never
-- reaches this function — every crawler hit, stale link and hand-typed URL does. Prod
-- measured 10.034 s and 10.051 s on `?slug=ОБЩИНА КИРКОВО` (an institution name, so both
-- lookups miss), which is the 10 s statement_timeout at functions/index.js, and returned 500.
--
--   1. UNION, NOT OR — this is the fix. `name_fold = fold OR EXISTS (alias …)` cannot use an
--      index on either side, so Postgres read ALL 58,152 person rows and filtered them. Split
--      into two branches and each rides its own btree: idx_person_name_fold /
--      idx_person_alias_fold. Both indexes already existed — the OR was the only thing
--      stopping them being used, which is why no amount of indexing would have fixed this.
--   2. The per-row fold, which the UNION fixes as a side effect. A SQL function's parameter
--      plans GENERICALLY, so in the old body the filter read
--      `name_fold = translit_bg_latin($1)` rather than a constant and the fold was evaluated
--      ONCE PER SCANNED ROW — 261 ms of the 331 ms (measured by adding MATERIALIZED to the
--      OLD body: 331 ms → 69 ms). It is invisible to a psql spot check, because planned with
--      a LITERAL the old body was 12 ms: a literal lets the planner constant-fold what a
--      parameter cannot. Once the scan is gone there are ~1 rows to fold, so this cost
--      disappears with defect 1 rather than needing its own fix.
--
-- `AS MATERIALIZED` is therefore INSURANCE, NOT THE FIX — measured at 0 ms today (2.11 ms
-- without it, 2.36 ms with, identical plan), because Postgres only inlines a CTE referenced
-- exactly once and `f` is now referenced twice, once per UNION branch. It is kept so that a
-- future edit collapsing this back to a single reference cannot silently reintroduce a
-- per-row fold. Do not remove it as dead weight; do not cite it as load-bearing either.
--
-- Measured after (force_generic_plan, i.e. how it actually runs here): 2.4 ms, 18 buffers.
--
-- SEMANTICS ARE UNCHANGED. UNION (not UNION ALL) keeps the DISTINCT the old form got from
-- SELECT DISTINCT; the §6 privacy gate is repeated on BOTH branches, since an alias hit must
-- not leak a review-status or non-public person; and the count(*) = 1 wrapper still returns
-- NULL for a 0- or >1-match name. Verified against the old body over 553 + 808 real names
-- (active, review-status, aliases, aliases owned by non-public persons, ambiguous folds, plus
-- the failing input): 0 mismatches. The standing gate is person_search.data.test.ts.
--
-- REACHES PROD ONLY VIA `apply_functions.ts 082_person_api.sql` or `db:resolve:persons:cloud`
-- (which re-applies this file). Nothing on the cloud side is automatic, and — unlike
-- migration 123's psp:not-built warning — a stale copy on Cloud SQL logs nothing and fails
-- nothing. It just keeps returning 500. See docs/plans/db-route-timeouts-v1.md §6.
--
-- LIMIT 2 moves from inside the scan to after the UNION and costs nothing: the UNION dedups
-- into a HashAggregate before the limit, and the widest fold group in the corpus is 36
-- persons / 38 alias rows — a hash of tens of rows. It is NOT an early-exit optimisation; it
-- exists to bound the count(*) wrapper.
DROP FUNCTION IF EXISTS person_by_name(text);
CREATE OR REPLACE FUNCTION person_by_name(p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH f AS MATERIALIZED (SELECT translit_bg_latin(p_name) AS fold),
  m AS (
    -- Match the display name OR any alias fold, so a person known under a variant spelling
    -- still resolves. Two index-driven branches, never an OR — see the header.
    SELECT u.slug FROM (
      SELECT p.slug FROM person p CROSS JOIN f
       WHERE p.name_fold = f.fold
         AND p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
      UNION
      SELECT p.slug FROM f
       JOIN person_alias a ON a.alias_fold = f.fold
       JOIN person p ON p.person_id = a.person_id
       WHERE p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
    ) u
     LIMIT 2
  )
  SELECT CASE WHEN (SELECT count(*) FROM m) = 1
    THEN person_by_slug((SELECT slug FROM m LIMIT 1)) END;
$$;

-- Name search for personSearch / the arbitrary-person lookup. Folds the query with the
-- ONE normalizer and ranks by trigram similarity over name_fold (GIN gin_trgm_ops index,
-- 081). Returns the namesake_risk so the caller can show the "name match — identity not
-- verified" weighting. Only active persons; review-status persons stay internal.
DROP FUNCTION IF EXISTS person_search(text, int);
CREATE OR REPLACE FUNCTION person_search(p_q text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT translit_bg_latin(p_q) AS f),
  -- Candidate persons: a trigram/substring hit on the display name OR any ALIAS (variant
  -- spelling). Both sides ride a GIN trigram index (name_fold + idx_person_alias_fold_trgm),
  -- so this stays fast even on a common surname.
  -- Min length 3: a trigram is 3 chars, so a 1-2 char query CAN'T use the GIN index and
  -- degrades to a full seq scan over every person (~46k rows, ~150ms) — and a 2-char person
  -- match is noise anyway. Gating here keeps the seq scan off the hot path; the client mirrors
  -- the gate so a 2-char keystroke never round-trips.
  cand AS (
    SELECT DISTINCT p.person_id
    FROM person p, q
    WHERE p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
      AND length(q.f) >= 3
      AND (p.name_fold % q.f OR p.name_fold LIKE '%' || q.f || '%')
    UNION
    SELECT DISTINCT a.person_id
    FROM person_alias a
    JOIN person p2 ON p2.person_id = a.person_id
    CROSS JOIN q
    WHERE p2.status = 'active' AND p2.is_public_figure
      AND length(q.f) >= 3 AND a.alias_fold % q.f
  ),
  scored AS (
    -- Ranking sums TWO trigram metrics because each alone mis-ranks a real query pattern:
    --   • full-string similarity() ranked a shorter namesake that shares the leading tokens
    --     ("Мария Димитрова Димитрова") above the real prefix match ("…Балъкчиева") — the
    --     recall bug — because the longer real surname diverges more over the whole string.
    --   • word_similarity() (best word-aligned extent) fixes that, BUT for a First+Last query
    --     that SKIPS the middle name ("Божидар Божанов" → "Божидар ПЛАМЕНОВ Божанов") the gap
    --     drops the real person below an unrelated "…Божанов…" whose two words sit adjacent.
    -- A wrong match is only ever high on ONE metric, so their SUM is self-correcting: the real
    -- person is the one that scores well on both. A small prefix boost rewards typing the start
    -- of the name; ties break toward the more-connected namesake (role count), then lower
    -- namesake_risk, then name — so the notable person of a homonym set surfaces first.
    -- Aliased persons still SURFACE (via `cand`); an alias-only hit scores low but appears.
    SELECT p.person_id, p.slug, p.display_name, p.namesake_risk,
           similarity(p.name_fold, q.f)
             + word_similarity(q.f, p.name_fold)
             + (p.name_fold LIKE q.f || '%')::int * 0.15                 AS score,
           (SELECT count(*) FROM person_role r WHERE r.person_id = p.person_id) AS n_roles
    FROM cand JOIN person p USING (person_id), q
    ORDER BY score DESC, n_roles DESC, p.namesake_risk ASC, p.display_name, p.slug
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'name', s.display_name, 'namesakeRisk', s.namesake_risk,
    'roles', s.n_roles,
    -- Party badge = the person's MOST RECENT candidacy party (nick + colour baked into
    -- person_election_stats at load). Lets a politician who ran in ANY cycle — not just the
    -- currently-selected one — carry their party in the header search, the person-basis
    -- replacement for the old CIK-JSON candidate index.
    'party', pty.party_nick, 'partyColor', pty.party_color,
    -- mpId (latest mp role) → the MpAvatar photo in the dropdown; NULL for non-MPs.
    -- T3: ref is '<mpId>' or '<mpId>:<ns>'; split_part returns the whole
    -- string when there is no colon. The old bare guard matched neither the
    -- widened form nor anything else, so this returned NULL and every MP lost
    -- their avatar in header search.
    'mpId', (SELECT split_part(r.ref, ':', 1)::bigint FROM person_role r
             WHERE r.person_id = s.person_id AND r.source = 'mp'
               AND split_part(r.ref, ':', 1) ~ '^[0-9]+$'
             ORDER BY split_part(r.ref, ':', 1)::bigint DESC LIMIT 1),
    'score', round(s.score::numeric, 3)
  ) ORDER BY s.score DESC, s.n_roles DESC, s.display_name), '[]'::jsonb)
  FROM scored s
  LEFT JOIN LATERAL (
    SELECT pes.party_nick, pes.party_color
    FROM person_election_stats pes
    WHERE pes.person_id = s.person_id AND pes.party_nick IS NOT NULL
    ORDER BY pes.election_date DESC LIMIT 1
  ) pty ON true;
$$;

-- The person's public-contract take bucketed by CABINET tenure (the "money vs power"
-- timeline on the merged dashboard, person-candidate-merge-v1). EIK-EXACT — driven from the
-- person's resolved `tr` company set, not a name fold (person_by_cabinet(text) is the legacy
-- name-keyed twin). Served lazily via /api/db/person-money, NOT folded into person_by_slug:
-- the contracts range-join over a hub person's EIKs is heavier than the profile's point
-- lookups, so it stays off the hot path (plan: split to person-money if over budget). Only
-- cabinets under which the person's companies actually won anything are returned.
DROP FUNCTION IF EXISTS person_money(text);
CREATE OR REPLACE FUNCTION person_money(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active'
       AND (is_public_figure OR identity_confidence = 'verified') LIMIT 1
  ),
  eiks AS (
    SELECT DISTINCT r.ref AS uic
    FROM person_role r, pick
    WHERE r.person_id = pick.person_id AND r.source = 'tr'
      AND r.confidence IN ('exact_id', 'high', 'manual')
  ),
  -- MATERIALIZED + indexed JOIN (contractor_eik) so the range-join below probes contracts
  -- instead of seq-scanning. amount_eur = the current post-annex basis matching SIGMA and
  -- the profile's procuredEur (reference_procurement_eur_sum_basis / 078).
  mine AS MATERIALIZED (
    SELECT ct.date, ct.amount_eur
    FROM eiks co JOIN contracts ct ON ct.contractor_eik = co.uic
    WHERE ct.tag = 'contract'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', cab.id, 'pm', cab.pm_bg, 'parties', cab.parties,
    -- Emitted bare, and correctly so: cabinets.start_date / end_date are `text` already
    -- (ISO strings from the governments artifact), not `date`. The to_char the role dates
    -- above use is for a real `date` column, whose jsonb form goes through DateStyle; a
    -- text column has no such hazard and to_char(text, …) does not even typecheck.
    'start', cab.start_date, 'end', cab.end_date, 'type', cab.type,
    'contracts', c.n, 'eur', c.eur
  ) ORDER BY cab.start_date), '[]'::jsonb)
  FROM cabinets cab
  JOIN LATERAL (
    SELECT count(*) AS n, round(coalesce(sum(mc.amount_eur), 0)::numeric, 2) AS eur
    FROM mine mc
    WHERE mc.date >= cab.start_date
      AND (cab.end_date IS NULL OR mc.date < cab.end_date)
  ) c ON c.n > 0;
$$;
