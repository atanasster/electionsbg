# Retire person JSON from routes → all persons/declarations/connections/companies on Postgres (v1.1)

**Status:** design (2026-07-25, revised after deploy-model audit). Goal: **no route or AI
tool loads person/declaration/connection/company data from a static JSON file**; the only
person artifact left on the GCS bucket is **MP photo `.webp` binaries**; everything else in
Postgres. The payoff is **bucket-sync time + git-commit churn**, not the Firebase deploy
(see §0).

Builds on / does not duplicate:
- [direct-db-ingest-v1.md](direct-db-ingest-v1.md) — umbrella (retire redundant JSON).
- [connections-pg-migration-v1.md](connections-pg-migration-v1.md) — Workstream B, the
  connections graph (schema `041_connections.sql`, `load_connections_pg.ts`, 11-hook routes).
  Scheduled here as Tier 3; its design stands.
- [persons-audit-gaps-v1.md](persons-audit-gaps-v1.md) — the `/person` prerender/SEO gap.
- [person-identity-v1.md](person-identity-v1.md), [person-candidate-merge-v1.md](person-candidate-merge-v1.md).

## Decisions (locked 2026-07-25)

1. **`/officials/:slug` → 301 to `/person/:slug`.** Retire `OfficialProfileScreen`; the
   PG-backed `PersonDashboard` is the single person surface. Council-activity +
   official-connections sections graft into it.
2. **Browse/leaderboards → `functions/db_table.js` REGISTRY**; per-entity aggregates → STABLE
   jsonb functions in `db_routes.js` (mirror the `person-*` routes).
3. **Council-vote data comes INTO PG** (new tables + loader). **MP photos stay bucket-only
   `.webp`; their URL/availability comes from PG** (retire `avatars.json`).
4. **`/person` prerender is net-neutral** (§0.5) — no full `/candidate`→`/person` consolidation
   in this effort. **In-scope adjacent sweep:** `governments.json` (cabinet/ministers) +
   donors/campaign-finance ([[project_erik_campaign_financing]]). **Deferred:** `ngo/ai_summary.json`.

## 0. The real cost model (corrected after audit — READ FIRST)

**Person JSON is NOT in the Firebase deploy.** `data/` is not copied into `dist/`
(`vite.config.ts` has no `publicDir` override; the per-domain folders were moved out of
`public/` precisely so they don't ship with hosting). Person pages are already **PG-served via
the `db` Cloud Function** (`/api/db/person-profile`, `/api/db/candidate-person`); the remaining
static person JSON is **git-tracked under `data/` and pushed to `gs://data-electionsbg-com` by
`npm run bucket:sync`**. So "the JSON takes a long time to deploy" = the **bucket rsync** (and
the huge git commits every ingest), not Firebase hosting.

Measured retirement surface (git-tracked = bucket-synced):

| Tree | Tracked files | Disposition after migration |
|---|---|---|
| `data/parliament/` (by-id 2,123 · profiles 4,284 · official-connections 4,465 · mp-connections 939 · mp-management 846 · mp-assets 769 · declarations 782 · top-level 16) | **19,551** | serve from PG; drop from git + bucket |
| `data/parliament/photos/` (`.webp`) | 1,651 | **KEEP on bucket** (the only survivor) |
| `data/parliament/avatars.json` | 1 | metadata → PG; retire |
| `data/officials/` (declarations 14,496 · municipal 6,681 · derived 4 · top 4 · contacts 1) | **21,186** | declarations become load-source-only; served surfaces → PG |
| `data/{election}/candidates/**` (per-election shards) | ~388k (bucket-only, **not** git-tracked) | serve from PG; drop from bucket (keep `candidates.json` as load source) |

**Success metric:** after migration, `data/parliament/**` + `data/officials/**` contain **only
photos (1,651) + non-served load-source JSON**; candidate shards gone from the bucket; the
person domain drops ~40k git-tracked files and ~430k bucket objects. **Verify:** `bucket:sync`
scope + `git ls-files data/parliament data/officials | wc -l` before/after.

**Mechanism (the operational rule):** a file's cost disappears when it stops being *served*.
For each family: migrate every reader (frontend hook **and** `ai/tools/*`) to PG → then either
(a) git-untrack + delete if it's purely derived-served, or (b) if it's a **load source** for a
PG loader (`candidates.json`, `companies-index.json`, `company_links.json`, the officials
declaration shards), **add it to the `bucket_sync_paths.ts` exclude list** so it stays local
for the loader but never ships. Both paths kill the bucket/git cost.

## 0.5 The prerender/deploy-ceiling tension (the one hard tradeoff)

This is the opposite constraint and must not be conflated with §0. The **Firebase deploy**
file count is driven by **prerendered `dist/**/index.html`** (~105k today, `data/` JSON is not
in it). That deploy has **already hit Firebase's per-site file ceiling** — hence officials is
capped at 5,000 (`officialCategoryLabels.ts:393`) and candidate sub-tabs were disabled.

`/person` is **not** prerendered today; `/candidate/{name}` **is** (26,386, and it already
renders `PersonDashboard`). `data/person/prerender_slugs.json` already exists (56,954 persons /
**38,353 indexable**) but nothing reads it. Naively prerendering all indexable persons (×2 for
EN ≈ 77k files) would blow the ceiling.

**Therefore the officials→person redirect is net-neutral on prerender** (locked, Decision 4),
not additive: **replace the officials prerender group with a `/person` group scoped to the same
set** — the ex-officials (~5,000) plus any indexable non-candidate persons, capped to hold total
HTML flat. Candidates keep their existing `/candidate` prerender (already the person body). A
full `/candidate` → `/person` 301 consolidation is **explicitly out of scope here** to avoid a
26k-page SEO churn on top of this migration.

**Open build-architecture item:** prerender injects a crawlable `<!-- BODY -->` from committed
JSON. Person data is PG-only, so the `/person` prerender body must come from either a build-time
DB read or an SEO body baked into `prerender_slugs.json`. Establish this in Tier 1 (it's the one
genuinely new build mechanism).

## Current state (audited 2026-07-25)

**Already PG** (`/api/db/*`): full person/candidate spine — `person-profile`,
`candidate-person`, `person-elections`, `person-connections`, `person-declarations`,
`declaration-detail`, `person-declaration-events`, `person-wealth`, `person-accumulation-gap`,
`person-cohort-benchmark`, `person-stake-procurement`, `person-money`, `new-filings`,
`magistrate-*`, `mp-scorecard`, `ref-procurement`. `ai/tools/person.ts` is fully on `fetchDb`.

**Still static JSON — retirement targets** (frontend hook + AI blocker):

| Domain | Frontend hooks | AI blockers (`fetchData`) | Data in PG today? |
|---|---|---|---|
| Officials profile | `useOfficial`, `useOfficialConnections` | — | Yes (`declaration` exec/muni) |
| Officials rankings | `useOfficialsRankings` | `people.ts:officialsAssetsTop` | Yes (`person_wealth_year`) |
| Municipal roster | `useMunicipalOfficials`, `useMunicipalOfficialsByName` | — | Yes (`person_role` muni) |
| Council activity | `useCouncillorProfile`, `useCouncillorConflicts` | — | **NO** — Tier 4 |
| MP roster/decl/assets | `useMpEntry`, `useMpDeclarations`, `useMpAssets`, `useMps` (index.json ~970KB), `useAssetsRankings`, `useMpCars`, `useCarMakes` | `parliament.ts:partyMps` (index.json), `people.ts` (`mpAssetsTop/ByParty`) | Yes (mp role + decl) |
| MP bio / avatars | `useMpProfile` (bio + photo), `useMpAvatars` | — | metadata → PG; **photos stay** |
| Connections graph | 11 hooks (Workstream B) | `people.ts:mpConnectionsTop/ByParty`, `companyConnections` | Workstream B |
| Companies/TR | `useCompanyIndex`, `useCompanyConnections`, `useMpManagement`, `useCompaniesAtSettlement` | `people.ts:companyConnections` | Workstream B / `tr_*` |
| Candidate shards | `useResolvedCandidate`, `useCandidateElectionFallback` | `candidate.ts:candidateResult` (`candidates.json`, `preferences_stats.json`) | partial (`candidate_person`, `person_election_stats`) |
| Judiciary decl list | `useDeclarations` | `judiciary.ts:judiciaryDeclarations` | partial (`magistrate-*`) |

**Adjacent — IN SCOPE (Decision 4):** `ai/tools/govpeople.ts` → `/governments.json` (cabinet/
ministers) and donors/campaign-finance ([[project_erik_campaign_financing]],
donors-connections.md) — both already `person_source`. **DEFERRED:** `ai/tools/ngo.ts` →
`/ngo/ai_summary.json` (person.ts already surfaces NGO board seats via PG; separate follow-up).

## Tiered plan

Per-family sequence: schema → loader (if new data) → SQL fn / REGISTRY entry → `/api/db` route →
migrate frontend hook **and** the `ai/tools` `fetchData→fetchDb` call → **parity-check vs the
JSON** (procurement-migration recipe; node harness swaps both fetchers) → git-untrack **or**
add to `bucket_sync_paths.ts` exclude (load sources). Untrack blocked until BOTH consumers move.

### Tier 0 — serving foundation (no frontend change)
REGISTRY: `officials_rankings`, `municipal_officials`, `mp_assets_rankings`, `mp_cars`.
Routes: `mp-entry`, `mp-declarations`, `mp-assets` (person_id-keyed; the `useOfficial.tsx:76`
TODO). Parity-check each against its JSON.

### Tier 1 — officials cutover + net-neutral prerender (SEO-gated)
- `firebase.json` **301** `/officials/:slug` → `/person/:slug`; delete `OfficialProfileScreen`,
  `useOfficial`, `useOfficialConnections`. Migrate `people.ts:officialsAssetsTop` to `fetchDb`.
- **Replace** the officials prerender + sitemap group with a scoped `/person` group (§0.5) —
  wire `emit_prerender_slugs.json`, cap to hold total HTML flat, establish the PG/baked SEO body.
  Prerender + sitemap + 301 move in one commit (avoid soft-404s).
- Repoint `/officials/assets` (`OfficialsAssetsScreen`) + `/governance` `OfficialsAssetsTile`
  onto `officials_rankings`; settlement roster onto `municipal_officials`.
- Graft into `PersonDashboard`, role-gated: person↔person connections use the **existing** PG
  `person-connections` route (ships in Tier 1); the officials **business-interest** graph
  (declarations↔companies, today's `official-connections.json`) lands with Workstream B
  `ref_connections` in **Tier 3**; council-activity lands in **Tier 4**. Tier 1 ships the
  redirect with the sections it can, the rest fill in as their tiers complete.
- Exclude `data/officials/declarations` + `municipal/declarations` from `bucket:sync` once
  they're load-source-only (~21k files off the bucket).

### Tier 2 — MP roster/declarations/avatars on PersonDashboard
Replace `useMpEntry`/`useMpDeclarations`/`useMpAssets` with person_id routes; `assets-rankings`
/ `mp-cars` / `car-makes` → REGISTRY. Migrate `parliament.ts:partyMps` + `people.ts` MP tools to
`fetchDb`. **Photos:** person-profile route returns photo availability + id **and any non-default/external
photo URL** (`resolvePhoto` passes `http…` through today); frontend builds the default
`${VITE_DATA_BASE_URL}/parliament/photos/{id}.webp` otherwise; retire `avatars.json` +
`index.json`'s photo/roster role (keep the 1,651 `.webp` on the bucket). Fold judiciary `useDeclarations` +
`judiciary.ts:judiciaryDeclarations` into a PG route.

### Tier 3 — connections + companies (Workstream B)
Execute `connections-pg-migration-v1.md` (`041_connections.sql`, `load_connections_pg.ts`, the
11-hook route table + `decl_companies` REGISTRY). Also satisfies officials/MP `ref_connections`.
**Verify the company-connections serving path first:** `data/parliament/company-connections/` is
gitignored **and** excluded from `bucket:sync`, yet `useCompanyConnections` +
`people.ts:companyConnections` still fetch it — confirm whether it already 404s in prod (it
likely must go straight to a PG route). `companies-index.json` + `company_links.json`
stay as **load sources** (rsync-excluded), not retired.

### Tier 4 — candidate shards + council-vote data (biggest bucket win + new ingest)
- **Candidate shards (~388k bucket files):** migrate `useResolvedCandidate`,
  `useCandidateElectionFallback`, `candidate.ts:candidateResult` to PG
  (`candidate_person` + `person_election_stats`, extend for `preferences_stats`). Keep
  `candidates.json` as prerender/sitemap load source (rsync-excluded); drop the per-candidate
  shard tree from the bucket.
- **Council data → PG:** new `099_council_signals.sql` (`councillor_signals`,
  `councillor_conflicts` keyed by person_id), loader `db:load:council-signals:pg` after the
  resolver; surface via `person_by_slug` / a `council-activity` route for the grafted section.

### Tier 5 — adjacent sweep + cleanup
- **Adjacent sweep (in scope):** migrate `govpeople.ts` (`governments.json`) and the
  donors/campaign-finance serving path onto PG (both are already `person_source`; audit the
  serving layer per donors-connections.md). `ngo/ai_summary.json` is **deferred**.
- **Cleanup:** delete retired hooks + tests (`useOfficial.test.ts` …); remove JSON-emit steps
  from generators; git-untrack dead served JSON; finalize `bucket_sync_paths.ts` excludes.
  Confirm the §0 success metric (bucket + git file-count before/after).

## Load-order & prod
G13 holds: declarations (person_id NULL) → `db:resolve:persons` → `db:load:declarations:pg
--resolve` → `db:load:person-elections:pg`; new Tier 3/4 loaders slot **after** the resolver.
Prod via Cloud SQL proxy + `db:load:*:cloud` + `functions:db` redeploy (never `db:dump`),
per Workstream B §7. Note: `gsutil -m` rsync hangs on macOS ([[reference_gsutil_macos_multiprocessing]])
— fewer bucket files also derisks the sync itself.

## Risks
- **Deploy ceiling (§0.5)** — `/person` prerender must be net-neutral, not +38k pages.
- **SEO** — 301s (not SPA redirects) + lockstep prerender/sitemap or 5,001 soft-404s
  ([[feedback_static_seo]], [[project_seo_discovery_gap]]).
- **Parity drift** — JSON-vs-PG parity check per family before untrack; determinism per
  [[reference_pg_payload_determinism]].
- **DB perf** — EXPLAIN ANALYZE every new fn/resource on worst-case entity, index both join
  sides ([[feedback_db_query_perf]], [[reference_pg_query_performance]]).
- **Pre-existing breakage** — `company-connections` (rsync-excluded yet still fetched) may
  already 404 in prod; verify before Tier 3.
- **PG changelog** — each new PG dataset wires into `recent_updates` ([[reference_two_changelogs]]).
