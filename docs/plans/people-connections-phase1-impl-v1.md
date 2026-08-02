# Phase 1 (+2b/2) implementation spec — people/connections consolidation

Status: **DRAFT (2026-07-30), implementation-ready.** Decomposes the strategy plan
[people-connections-consolidation-v1.md](people-connections-consolidation-v1.md) Phases 1/2/2b
into concrete, independently-committable steps for `/implement-plan` to drive under the
review→repair→commit gate. Ordered **safest → riskiest** so findability (the user's priority)
lands first, fully isolated from the resolver rewrite.

Grounded in the current tree (2026-07-30): highest migration = **125**, next free = **126**.
Templates: `contractor_search` (006) + `contractor_rank`/`contractor_rankings` registry (122);
`person_browse_table` (120) + `load_persons_browse_pg.ts`; `resolve_persons.ts` (1793 lines).

## Key architectural finding (drives the ordering)

Both the search index (S1) **and** the private browse slice (S3) read **only existing tables** —
`person` (Tier P, resolved) + `tr_officers` + money tables (Tiers V/N, name-fold-keyed). Neither
needs the Tier-V resolver pass. So **S1–S3 deliver the full "private owners are searchable AND
browseable" experience with zero risk to the identity layer**, and the resolver rewrite (S4) is
deferred, isolated, and demoted to a **quality upgrade**: it mints real `/person` profiles for
the *verified* subset. Because both the search V/N arm and the browse name-fold arm **anti-join
against the set of folds that are already a person**, S4's newly-minted verified persons drop out
of the name-fold arms automatically and reappear as real-slug rows — search and browse stay
stable and self-consistent across the resolver change (this is exactly the symmetry the "verified
+ name-fold view" decision asked for).

## Money basis (LOCKED: broad)

The **money-link** determination (tier V vs N) and the money figure shown on `person_search`
cards + name-fold browse rows use the **broad basis** — `contracts ∪ agri_subsidies ∪
fund_beneficiaries` (the ~73k-owner money-linked set, S0). So an owner reachable only through a farm subsidy
or EU fund still counts as money-linked, and a "linked to public money" card never shows €0.

This deliberately **diverges by row type**: `person_browse.public_money_eur` for **public (P)
persons** stays **contracts-only** (`tag='contract' AND consortium_role IS DISTINCT FROM
'member'`, migration 078 basis) — an existing, separately-labelled procurement-exposure metric,
unchanged so its tests/behaviour hold. The **name-fold V** browse rows and all `person_search`
rows carry **broad** public money. These are two different questions (a public figure's
procurement exposure vs. a private owner's total public money), labelled distinctly in the UI, so
the divergence is honest rather than a mismatch. A shared SQL helper
`money_linked_eik()` / `broad_public_money(eik)` (defined once in migration 126) is reused by both
`person_search` (S1) and the name-fold browse arm (S3).

---

## Step 0 — measurement (DONE 2026-07-30)

Probe: [`scripts/db/probes/person_tier_v_sizing.sql`](../../scripts/db/probes/person_tier_v_sizing.sql).
Measured against local PG (2.6s):

| metric | count | meaning |
|---|---|---|
| money-linked folds (broad) | 72,993 | all money-linked folds (incl. those already a person) |
| **name-fold browse V** (money-linked, anti-joined) | **66,542** | **the S3 частен-сектор browse arm** |
| verified candidates (exactly 3 tokens, ≤5 firms) | 59,809 | before anti-join |
| **verified after anti-join** | **54,816** | **the count S4 mints as real `/person` profiles** |

`verified` uses `parts = 3` (not `>= 3`) to mirror Bridge B's `name_parts = 3`, so 54,816 is an
honest S4 mint ceiling. So: S3 частен-сектор browse ≈ **66,542** name-fold rows; S4 promotes
**54,816** to real profiles, the remaining **11,726** stay name-fold. Browse total (P+V) ≈
56,869 + 66,542 = **~123k**, matching the locked ~125k figure.

**Deferred to their natural steps** (both need artifacts that don't exist yet):
- Worst-case surname EXPLAIN → an assertion in S1's `person_search.data.test.ts` (needs the table).
- Prerender €-threshold page counts → read off `person_search.public_money_eur` in S5 (needs the
  index); the S4 mint ceiling is 54,816, so S5's threshold must keep prerendered P+V under the
  [project_firebase_deploy_ceiling] 453k-file dist.

**Gate/commit:** probe script + this results block only.

---

## Step 1 — `person_search` index + ranked serving route (findability backbone)

**Goal:** one ranked, foldable index across P+V+N behind a single route, replacing the ad-hoc
`tr_officers` scan. No resolver, no browser change. Delivers ranked/grouped search immediately.

**Files:**
- **New** `scripts/db/schema/pg/126_person_search.sql` — plain TABLE (contractor_search shape):
  ```sql
  CREATE TABLE IF NOT EXISTS person_search (
    key            text PRIMARY KEY,          -- 'slug:<slug>' (P) | 'fold:<name_fold>' (V/N)
    name           text NOT NULL,
    name_fold      text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED,
    tier           char(1) NOT NULL,          -- 'P' | 'V' | 'N'
    position_type  text,                      -- CODE: politician/executive/public_sector/magistrate/regulator (P) | private_sector (V/N); UI maps code→BG label
    primary_role   text,                      -- P only
    party          text,                      -- P only
    place_label    text,                      -- P only
    top_eik        text,                      -- V/N: highest-money company
    firms_count    int  NOT NULL DEFAULT 0,
    public_money_eur double precision NOT NULL DEFAULT 0,
    has_photo      boolean NOT NULL DEFAULT false,
    identity_confidence text NOT NULL,        -- 'resolved' (P) | 'verified' | 'name_fold'
    href           text NOT NULL,             -- '/person/<slug>' (P) | '/person/<name>' (V/N)
    rank_static    double precision NOT NULL  -- precomputed relevance (see loader)
  );
  CREATE INDEX idx_person_search_fold  ON person_search USING gin (name_fold gin_trgm_ops);
  CREATE INDEX idx_person_search_prefix ON person_search (name_fold text_pattern_ops);
  CREATE INDEX idx_person_search_rank  ON person_search (rank_static DESC, key);
  ```
- **New** `scripts/db/load_person_search_pg.ts` — `TRUNCATE person_search` then two INSERT arms.
  Define the P-arm fold set once (`p_folds` = folds present in the P arm) and anti-join the V/N
  arm against THAT set, not the whole `person` table (a fold matching a non-public existing
  person must not vanish from both arms):
  - **P arm** from `person_browse_table` (name/slug/primary_role/party/place/photo/prominence +
    `primary_facet`): `tier='P'`, `identity_confidence='resolved'`, `href='/person/'||slug`,
    `position_type` derived **inline** from `primary_facet` via a `CASE` (politician/executive/
    public_sector/magistrate/regulator; company→private_sector) — no cross-migration function
    dependency on S3. `public_money_eur` = the P person's existing contracts-only figure.
    `rank_static = 1000 + prominence + log(1 + public_money_eur)`.
  - **V/N arm** from `tr_officers` grouped by `name_fold`, LEFT JOIN `broad_public_money` (126
    helper: contracts ∪ agri_subsidies ∪ fund_beneficiaries) for `public_money_eur` (broad) /
    `top_eik` / `firms_count`, **anti-joined against `p_folds`**. `tier = CASE WHEN broad_money>0
    THEN 'V' ELSE 'N'`, `position_type='private_sector'`, `identity_confidence='name_fold'`
    (S4 promotes the verified subset), `href='/person/'||name`, `rank_static = tier_weight
    (V=500,N=100) + log(1 + broad_money)`. **Match-quality is applied at query time** (below),
    not baked into `rank_static`.
  - `ANALYZE person_search` after. (`rank_static` is computed in SQL; the data test asserts the
    ranking end-to-end rather than a separate TS unit — simpler, no formula drift.)
  - **Built:** 533,159 rows (P 63,910 / V 61,761 / N 407,488), ~19 s. Money clamped `greatest(0,…)`
    before `ln` (contracts/subsidy sums can be negative — refunds — and `ln(≤0)` errors).
- **package.json**: `db:load:person-search:pg` + `:cloud`; wired into `db:refresh` **after**
  `db:load:persons-browse:pg` (its P arm reads that matview). It is a derived search index like
  `contractor_search`, NOT a user-facing dataset, so no `recent_updates`/changelog entry.
- **`functions/db_routes.js`**: **replaced** the `person-search` route (the old `tr_officers` scan)
  with a **per-tier ranked query**. The drafted single blended `ORDER BY (exact·1e9 + prefix·1e6 +
  word_similarity·1e4 + rank_static)` over all `%>` matches measured **231 ms** on the most common
  name ("Иван Иванов" ≈ 45k matches) — the cost is the bitmap heap scan of the whole match set,
  not the ranking (rank_static-only was still 213 ms). Final design instead runs **one small query
  per tier** — `WHERE tier=$1 AND name_fold %> q ORDER BY rank_static DESC LIMIT k` — which uses
  `idx_person_search_rank (tier, rank_static DESC)` and **early-stops** (P 1.5 ms, V 2.7 ms, N 4 ms;
  ~10 ms total worst-case), plus a cheap **exact-fold prepend** (`name_fold = q`, 0.3 ms) floated to
  the front of its tier — **PER TIER** (a single cross-tier exact query is starved by high-rank P
  rows on common names, so the V/N float would never fire). **No total N count** — an exact count
  over 45k matches is the slow part (163 ms), and the "виж всички" → `/persons?q` link carries the
  user to where pagination lives. Response: `{power:P[], money:V[], others:N[], people:[…]}`;
  `people` spans **all tiers** (P+V+N, `{name,companies}`) so a public figure absent from the client
  roster is never dropped pre-S2. Each read `.catch(missingMigrationRows)` → an **absent**
  `person_search` degrades to empty tiers (never a first-deploy 500); a **stale** table still 200s,
  so the cloud reload triggers are documented in the loader header + CLAUDE.md. V/N money excludes
  consortium members (120's basis).

**Tests:** `scripts/db/schema/pg/person_search.data.test.ts` (auto-skips if PG down) —
(a) all three tiers present; (b) a known colliding name returns the P person above any V/N
namesake (ranking); (c) Cyrillic and Latin queries return the same top row (fold); (d) no
`person.name_fold` appears as a V/N row (anti-join); (e) EXPLAIN uses the trgm index + fence.
Plus a unit test on the exported `rankStatic`.

**Gate/commit:** `tier1 step 1: person_search index + ranked person-search route`. Local-only;
the `:cloud` loader + `deploy:db` are operator actions noted for later, not run here.
**Risk:** low — new table + one route swap; existing `/person` profiles untouched.

---

## Step 2 — grouped typeahead + unify the entry points (Phase 2b UI)

**Goal:** every search box reads the S1 route; results are grouped, disambiguated, ranked.

**Files:**
- The nav-bar search (`src/layout/search/Search.tsx` / `src/data/search/useSearchItems.tsx`),
  the procurement search (`src/screens/components/procurement/ProcurementSearchTile.tsx` +
  `src/ux/search/EntitySearchTile.tsx`), and the `/persons` `?q` box all consume the new route.
- **Retire** the client rosters (`useCorpusPersonIndex`, `useMagistrateSearchRoster`) from the
  procurement search — `person_search` now covers MPs/officials/magistrates + TR owners in one.
- Grouped result UI: **Хора във властта** (P) / **Свързани с обществени пари** (V) / **Други
  собственици** (N, collapsed "+N", expandable) / Фирми / Договори. Per-tier card per the
  mockup: avatar+role+party+place (P); top company+firms+money (V/N); `name_fold` badge.
  **Only the person groups change** — the Фирми/Договори/Тръжни процедури/Фондове groups keep
  coming from the existing `procurement-search` route unchanged; S2 swaps the person source and
  adds the tiered grouping around it.
- "виж всички" → `/persons?q=` (existing seed).

**SHIPPED (2026-08-01):** the **combined procurement search** (`ProcurementSearchTile`) — the
primary entry point — now consumes the grouped `{power,money,others}` route, retires both client
rosters (`useCorpusPersonIndex`, `useMagistrateSearchRoster`), and renders the three tiers with the
`name_fold` "съвпадение по име" label inline in the secondary line (no `EntitySearchTile` shell
change), position_type→label mapping, broad money, and a "Виж всички хора" → `/persons?q&sector=all`
link. Verified in the dev browser end-to-end (P public figures with money on top, V/N owners below,
no console errors). `party_primary` is a raw canonicalId so it is NOT displayed (position + place
only) — party-name mapping is a later polish.

**DEFERRED (follow-up within Phase 2b):** wiring the **nav-bar** search
(`Search.tsx`/`useSearchItems`) and a dedicated `/persons ?q` grouped view onto `person_search` —
a separate curated-search integration; `/persons?q` already seeds the browse today. Tracked as the
remaining S2 tail.

**Tests:** the person-group building is extracted to a pure `buildPersonGroups` helper
(`personSearchGroups.ts`) with `personSearchGroups.test.ts` (6 cases: encoding split, name-match
label, position label fallback, empty-tier guard, tier order); `ProcurementSearchTile.test.tsx`
(the `fundSearchGroup` helper) still passes; the route's JS grouping is covered by
`functions/db_routes.person_search.test.js` (S1). The retired rosters left `usePersonProcurementIndex.ts`
and the `useMagistrateSearchRoster`/`MagistrateSearchRow` export orphaned — both removed.

**Gate/commit:** `tier1 step 2: grouped ranked typeahead in the combined procurement search`.
**Risk:** low-medium — pure UI + data-source swap; the route already returns ranked data.

---

## Step 3 — `position_type` dimension + name-fold private browse arm (Phase 2)

**Goal:** the browser slices by position_type, default view is public, and — per the locked
"verified + name-fold view" decision — the частен-сектор slice is **populated here, resolver-
free**, by a name-fold union arm. All ~67k money-linked owners become browseable **and** the six
governance position_types partition the public default.

**`person_browse_table` (120) becomes a `UNION ALL` of two arms:**
- **Person arm** (the existing per-person query, unchanged output for P; later also the verified V
  persons from S4): add `key = 'slug:'||slug`, `identity_confidence` (`'resolved'` for now), and
  `primary_position_type` derived via a new IMMUTABLE helper `position_type(p_source, p_facet)`
  (mirrors `role_prominence()` shape; codes `politician/executive/public_sector/magistrate/
  regulator`, `company`→`private_sector`; note `official_muni`→`politician` per the catalog).
- **Name-fold V arm** (NEW): money-linked `tr_officers` folds (broad basis, 126 helper),
  **anti-joined against the person arm's fold set** (a fold already a person is served by the
  person arm, never duplicated): `key = 'fold:'||name_fold`, `slug = NULL`, `name`,
  `position_type = 'private_sector'`, `identity_confidence = 'name_fold'`,
  `public_money_eur` = broad, `companies_n`/`top_eik`; every governance-only column
  (`party_*`/`place_*`/`net_worth_eur`/`has_declaration`/`role_codes`/…) is `NULL`. GIN trigram on
  `name_fold` already required for `search:true` covers this arm too.

**Serving + client:**
- `functions/db_table.js` `persons` resource: key the resource on the new **`key`** column
  (name-fold rows have NULL slug); add `position_type` (`type:"text", sort:true, filter:"in"`) +
  `identity_confidence` + `key` to `columns` and `select`. The `?sector=public` **default**
  filters `position_type <> 'private_sector'`, so the union's name-fold rows are hidden until the
  user opts in — the public default is preserved.
- `src/data/persons/personBrowseTypes.ts`: add `key`, `positionType`, `identityConfidence`
  (lockstep with `select`); most existing fields are already nullable, which the name-fold rows
  rely on.
- `src/data/persons/useUrlPersonFilters.ts`: add `?sector` (default `public`) + `?position` to
  `PARAMS` + reader/writer/`hasActiveFilters`, validated via `readCode`. `all` drops the sector
  filter; `private` keeps only `private_sector`.
- Row rendering: href = `slug ? '/person/'+slug : '/person/'+name`; name-fold rows show the
  `name_fold` "непроверена самоличност" badge and only name/money/firms columns.
- `src/screens/persons/PersonsAnalysisStrip.tsx`: add `position_type` as a mix-bar partition
  (default stays the public facet partition); частен-сектор hue. Title stays "Хора във властта";
  the private slice relabels.

**Tests:** extend `person_browse.data.test.ts` — `primary_position_type` correctness (the six
mappings); the name-fold arm is present and **anti-joined** (no fold appears in both arms);
`?sector=public` excludes every `private_sector` row; a money-linked private owner is browseable
under `?sector=private`. `useUrlPersonFilters.test` for `?sector` default-public + validation.

**SHIPPED — S3a (data model, 2026-08-01):** 120 now `UNION ALL`s the name-fold private arm
(money-linked `tr_officers` folds, broad basis, anti-joined against the public folds, **person-shape
gated to EXACTLY 3 folded tokens** — which drops the "Заличено обстоятелство." redaction placeholder
and the "…ЕООД, представлявано в УС от…" officer strings that would otherwise lead the money sort).
118,502 rows (63,910 P + 54,592 V). New columns `key`/`tier`/`position_type`/`identity_confidence`;
`key` ('slug:…'|'fold:…') is the unique paging identity (name-fold rows have NULL slug), and the
`persons` registry keys on it + carries `defaultFilters: tier=P` so **the public population is the
floor for any caller**. Cross-dependency handled: the S1 `person_search` P-arm now reads
`WHERE tier='P'` (else the V rows would double into search). `person_browse.data.test.ts` re-scoped
its per-person invariants to the public arm + a new name-fold-arm block (shape, 3-token gate,
anti-join, public-default). Verified via `/api/db/table`: default 63,910; `tier=["V"]` 54,592;
`tier=["P","V"]` 118,502; `position_type=magistrate` 3,065. All data tests green (27), functions 175.

**SHIPPED — S3b (the UI control, 2026-08-01):** `?sector` (public default → omit; private →
`tier:["V"]`; all → `tier:["P","V"]`) + `?position` in `useUrlPersonFilters`, validated on read;
`key`/`tier`/`positionType`/`identityConfidence` on `PersonBrowseRow`; a shared-Radix `Select`
scope control in the browser toolbar; name-fold rows (NULL slug) route to `/person/:name` with a
"по име" name-match badge; `scopeF` threads the tier/position filter through the table **and** the
mix-bar + KPI facets. `PersonsAnalysisStrip` needed no change — it already maps the `company` facet
to "Бизнес". Verified live: `?sector=private` → Лица **53,438**, С декларация 0%, С фирми в ТР 100%,
mix bar "Бизнес 100%", real person names lead (Борис Анчев Борисов €2.4bn), name-match badges, name
routing. **Gate strengthened during S3b:** the UI surfaced that 3-token COMPANY names (`„17
Инвестмънтс" ЕООД`, `Х Y ЕООД`) were leaking, so the person-shape gate tightened from
`array_length=3` to `name_fold ~ '^[a-z]+ [a-z]+ [a-z]+$'` + a company-legal-form exclusion (−1,150
rows), pinned by the data test.

**Risk:** medium-high — 120 is a matview DROP+CREATE re-applied by the declarations loader
([column-type cloud-reload rule]); `:cloud` reload is an operator step. `person_search` must be
reloaded whenever 120 is (its P-arm reads it) — already documented in its header + CLAUDE.md.

---

## Step 4 — Tier-V resolver pass (promote verified privates to real persons) — HEAVY

**Goal (a quality UPGRADE, not the thing that makes privates appear).** After S3 every
money-linked owner is already browseable + searchable as a name-fold row. S4 promotes the
*verified* subset (unique 3-part name, ≤5 firms) to real `person` rows so they get a durable
`/person/:slug` profile with a stable identity. The anti-join in both name-fold arms (S1 search,
S3 browse) means a promoted fold **automatically leaves** the name-fold arm and reappears as a
real-slug row — no double-count, no gap. **This is the risky, operator-run step** — it needs the
multi-hour `db:resolve:persons` rebuild + data-quality validation the automated build/test gate
cannot perform, which is why it is deferred to last and does not block the findability value.

**Files:**
- `scripts/db/schema/pg/081_person_identity.sql`: add `identity_confidence text NOT NULL
  DEFAULT 'resolved'` to `person`.
- `scripts/person/resolve_persons.ts`: a **new additive Tier-V pass**, inserted **after Bridge B
  (after line ~1691) and after the `setval`** (agent-confirmed insertion point), that:
  1. materializes the money-linked EIK set fresh (`contracts ∪ agri_subsidies ∪
     fund_beneficiaries` — none referenced today);
  2. joins `tr_person_roles ON uic` to enumerate candidate owners;
  3. keeps only **verified** identities: 3-part `name_fold`, unique in the TR corpus,
     ≤`FOOTPRINT_CAP` (=5) firms, **and** `NOT EXISTS` any existing `person.name_fold`
     (reusing Bridge B's guard, extended to skip a fold matching ANY person — prevents minting a
     private duplicate of a public figure and prevents merging a namesake);
  4. `INSERT INTO person(... is_public_figure=false, status='active',
     identity_confidence='verified')` letting the sequence assign ids (placed after setval), with
     `person_role(source='tr', ref=uic, confidence='verified')`, slug via the name-hash pattern +
     `person_slug_lock`.
  - **Must-preserve properties:** public `personRows`/COPY byte-identical (do NOT touch the
    drop-filter at 1304-1309 or `built[]`); Tier-V purely additive; separate tally in the
    reconciliation summary.
- Widen the gates to include Tier-V (`is_public_figure=false` + `identity_confidence='verified'`):
  the `person_browse_table` **person-arm** `pub` CTE gate (so verified privates join the person
  arm and drop out of the name-fold arm via its anti-join), and the `person_by_slug`/
  `person_by_name` functions (082) so a verified private renders on `/person` with a private
  badge. **082 is applied-not-loaded** — ship via `apply_functions.ts`, not a loader.
- Set `identity_confidence='verified'` on the promoted rows in 120's person arm and in
  `person_search` (their `href` becomes the real slug automatically via the LEFT JOIN).

**Tests:** a resolver `.data.test.ts` asserting (a) public person count unchanged vs a baseline;
(b) every Tier-V row has `is_public_figure=false` + `identity_confidence='verified'` + exactly
one `tr` role; (c) no Tier-V `name_fold` collides with a public person; (d) ≤5 firms per Tier-V
person.

**DRAFTED — S4 code, PENDING OPERATOR REBUILD (2026-08-01).** The mint + all ripple gates are
written and **syntax-validated as forward-compatible no-ops** (they change nothing until the
resolver mints): `081` adds `identity_confidence` (`resolved`|`verified`, ALTER for existing DBs);
`resolve_persons.ts` gains the Tier-V pass (a `tmp_tierv` SELECT of money-linked ∩ 3-all-letter-
token ∩ no-company-form ∩ ≤5-TOTAL-firm ∩ not-already-a-person folds — validated at **53,203**
against live data — then INSERT `person` (is_public_figure=false, identity_confidence='verified')
+ INSERT `person_role` (source='tr', 'high') joined back through the shared fold, after the public
COPY+setval so the public set is byte-identical); `120`'s `pub` gate admits verified privates and
derives `tier = CASE is_public_figure` (so a verified private is tier V — excluded from
`?sector=public` — with a REAL slug + `identity_confidence='verified'`, no "по име" badge); `082`
`person_by_slug`/`person_by_name` serve them; the privacy data-test exempts verified from "leak".
Rebuilt `120` locally → unchanged 117,348 (no verified yet), all data tests green (19). The
resolver itself is **NOT run** (multi-hour; DELETEs `person`).

**REBUILT + VALIDATED (2026-08-01, S4b).** Operator ran `db:resolve:persons` → **+53,203 tier-V
private owners minted, public count unchanged, 0 slug retired (no collision/abort)**; then
declarations `--resolve` (47,983 person_id re-attached) + the browse/search loaders. Verified:
browse P=63,910 (unchanged) / V-verified=53,203 (real slug) / V-name_fold=3,448; a verified
private's `/person/:slug` serves via 082 (name + companies + money); public floor holds. Both
completion refinements are now **CODED + validated**:
1. **`person_search` V-arm** — a new arm sources verified privates from `person_browse` tier=V by
   REAL slug (identity='verified'), and the `tr_officers` arm now anti-joins against ALL persons,
   so a verified private appears in search by slug, not as a name-fold row. (V now 53,203 verified
   + 11,769 name-fold.)
2. **Money basis** — `120` computes BROAD money (contracts∪subsidies∪funds) for
   `is_public_figure=false` verified privates while keeping contracts-only for public figures, so a
   subsidy/fund-only owner no longer shows €0. Browse "with money" recovered 19,949 → 57,977.
The data-test suite was updated to the post-mint reality (V's two shapes; the mint's live output;
the verified exemption in the privacy checks) — 29 green.

**OPERATOR REBUILD + VALIDATION CHECKLIST** (do not `:cloud` until every box is green locally):
- `npm run db:resolve:persons` (~hours) → summary must show `+~53k tier-V private owners minted`
  AND the public `personRows` count UNCHANGED from the prior run.
- `db:load:declarations:pg -- --resolve` → then `db:load:persons-browse:pg` + `db:load:person-search:pg`.
- Validate: `SELECT tier, identity_confidence, count(*) FROM person_browse_table GROUP BY 1,2` shows
  a `V/verified` bucket (~53k) + a smaller `V/name_fold` remainder; public P count unchanged;
  `person.identity_confidence='verified'` rows all `is_public_figure=false`; spot-check 5 verified
  `/person/:slug` profiles render; confirm no slug collision (the INSERT's UNIQUE would have thrown).
- Then settle the two refinements above and re-run the affected loaders.

**Risk:** high (identity layer, ~53k verified mint, multi-hour rebuild). Do not mark "done" as if
the data were live.

---

## Step 5 — prerender/sitemap gate + namesake disambiguation — SHIPPED (2026-08-01)

**The €-threshold prerender was the WRONG call and was NOT built.** `emit_prerender_slugs.ts` is
already at the Firebase deploy ceiling (a ~5,000 net-neutral cap, with an explicit "widening blows
the deploy" guard) and cannot absorb even a threshold slice of the 53,203 verified privates without
a cloud staging measurement; and 53k thin, name-only-identity owner pages are weak SEO regardless.
So the ceiling-honest gate is: **verified privates are servable but NOINDEX, never prerendered.**

**SHIPPED:**
- The manifest already excludes them — it queries `WHERE is_public_figure` (verified privates are
  `is_public_figure=false`), so no `<loc>`, no static file, ceiling untouched. Added a guard comment
  in `computePersonSlugs` so a future implementer doesn't widen it and blow the deploy.
- Runtime `noindex`: `PersonDashboard` calls `useNoindex(!p.isPublicFigure)` (verified privates +
  any served non-public person); the legacy name-keyed portfolio `PersonScreen` calls `useNoindex()`
  (a name match is never canonical). Verified on a live verified-private page: `robots="noindex, follow"`.
- **Namesake "chooser":** with no owner-cluster data (the resolver punts on it by design), a true
  chooser cannot be built — the honest disambiguation is the NAME-MATCH WARNING, which already
  exists: `person_namesake_disclosure` on the portfolio page + the "по име / name match" badge on
  every name-fold row in search (S2) and browse (S3b). No silent merge remains.

**Risk:** low — no SEO manifest change (the gate is exclusion-by-construction + runtime noindex).
The person prerender manifest itself is still minted from the SERVING DB (`person:slugs:cloud`,
operator step) when the person layer is pushed to cloud — unchanged by S5.

---

## Summary — what `/implement-plan` drives vs. what needs an operator

| Step | Auto-drivable (code + unit/data tests + commit) | Needs operator / cloud |
|---|---|---|
| S0 measurement | probe script | run + record numbers |
| S1 person_search | ✅ full (local PG test) | `:cloud` loader + `deploy:db` |
| S2 grouped typeahead | ✅ full (component tests) | — |
| S3 position_type + name-fold browse arm | ✅ code; local matview reload to verify | `:cloud` reload |
| **S4 Tier-V resolver** | code + unit tests only | **multi-hour resolver rebuild + data validation** (blocks "done") |
| S5 prerender/chooser | ✅ code | manifest mint from serving DB |

**Recommended drive scope now:** S0–S3 are fully auto-drivable and, together, deliver the WHOLE
user-visible goal — private owners are **searchable** (S1–S2, ranked/grouped/disambiguated) **and
browseable** (S3, name-fold arm) with the public-first default, all with zero identity-layer risk.
**S4 is a deferred quality upgrade** (real profiles for the verified subset) that **pauses for the
operator** at its data-validation gate rather than committing an unvalidated identity-layer
rebuild — surface it, don't fake-green it. S5 follows S4.
