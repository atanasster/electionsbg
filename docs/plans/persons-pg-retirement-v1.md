# Retire person JSON from routes → all persons/declarations/connections/companies on Postgres (v1.2)

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

1. **`/officials/:slug` → 301 to `/person/:slug`, served by the `db` Cloud Function**
   (not a `firebase.json` rule — the slug spaces don't map; see Tier 1). Retire
   `OfficialProfileScreen`; the PG-backed `PersonDashboard` is the single person surface.
   Council-activity + official-connections sections graft into it.
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
| `data/officials/` (declarations 14,496 · municipal 6,681 · derived 4 · top 4 · contacts 1) | **21,186** | served surfaces → PG; declaration shards **move out of `data/`** (load-source-only) |
| `data/{election}/candidates/**` (per-election shards) | ~388k (bucket-only, **not** git-tracked) | serve from PG; **delete** from disk + bucket (`candidates.json` moves out of `data/` as a load source) |

**Success metric:** after migration `data/parliament/**` holds **only the 1,651 photos**,
`data/officials/**` is gone from `data/`, and the candidate shards are gone from both disk and
bucket — the person domain drops ~40k git-tracked files and ~430k bucket objects, and the local
`data/` walk shrinks by ~430k entries (the thing that actually shortens `bucket:sync`).
**Verify, before/after:** `git ls-files data/parliament data/officials | wc -l`; `find data -type f
| wc -l` (the enumeration driver); `gsutil du gs://data-electionsbg-com/parliament` +
`/officials` (proves the objects were *deleted*, not merely unreferenced); and a timed
`npm run bucket:sync`.

**Mechanism — CORRECTED (this is the part that is easy to get wrong):**

> **Excluding a tree from `bucket:sync` does NOT make the sync faster.** Per the measured note
> in `scripts/bucket_sync_paths.ts:5-14`, `gsutil rsync` builds **both full listings before it
> diffs anything** (1,033,739 local files, ~761k bucket objects) and **`-x` filters only AFTER
> enumeration** — which is why the already-excluded `procurement/` (80,876) and `funds/`
> (182,377) are still walked on every run. With `parallel_process_count=1` (the macOS
> workaround) that enumeration is single-process and **dominates: ~30 min regardless of churn**.

Three consequences the plan must honour:

1. **Only files that leave `data/` on disk reduce sync time.** Retiring a served family →
   **delete it from `data/`**, don't merely exclude it.
2. **Load sources that stay on disk keep costing enumeration time.** So `candidates.json`,
   `companies-index.json`, `company_links.json` and the officials declaration shards should
   **move out of `data/`** into a non-synced top-level tree (e.g. `raw_data/` or a new
   `local_data/`) with the loaders repointed — otherwise Tier 4's ~388k candidate shards still
   cost the full walk even after nothing serves them.
3. **Retired objects linger in the bucket and are served forever.** `bucket:sync` **never
   passes `-d`** (`bucket_sync_paths.ts:30-38`) — documented precedent: `data/prices/settlement/*`
   dropped out of the corpus on 2026-07-10 and was still being served. Deleting locally does
   **not** remove the bucket object. Each family therefore needs an explicit teardown:
   `npm run bucket:sync:paths -- --dry-run --delete <subtree>` (read the "Would remove" lines)
   then the real run. **Stale-serving hazard:** until that teardown runs, a regressed hook or a
   cached client silently reads retired person JSON forever.

**Two-place edit:** the exclusion list is duplicated — the `-x` regex in `package.json`'s
`bucket:sync` **and** the `isExcluded()` refuse-list in `scripts/bucket_sync_paths.ts:52-76`
("Keep in sync with bucket:sync's -x regex allow-list in package.json"). Retiring a family
means editing **both**, plus checking `bucket:gz` ordering (`scripts/bucket_gzip.ts`).

Per-family teardown order: migrate every reader (frontend **and** `ai/tools/*`) → parity-check →
delete from `data/` (or move to the non-synced tree if a load source) → update both exclusion
lists → `bucket:sync:paths --delete` the subtree → git-untrack.

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

**RESOLVED (was an open item):** no build-time DB read is needed, and none is allowed.
`scripts/person/emit_prerender_slugs.ts` already exists and is explicitly "the person slug +
content-floor manifest that **/person prerender + sitemap read**" — prerender/sitemap "never open
a DB (they read JSON off disk, and the maintainer's local PG is stale vs Cloud SQL)", so the
person layer writes the manifest, exactly as `scripts/prices/export_slugs.ts` does for products.
An enumeration manifest is the sanctioned PG→prerender shape ([[feedback_no_json_from_pg]] forbids
*serving* generated JSON, not enumerating from it). It runs after `db:resolve:persons` and is
wired into `db:refresh`. **Tier 1 wires the existing manifest in; it does not invent a mechanism.**
(`prerender_slugs.json` is a build input, never served — it belongs in the non-synced tree per §0.)

**⚠ CONFLICT with a prior documented decision — resolve before Tier 1.** That manifest encodes
the **G6 decision** ([persons-declarations-audit-v1.md](persons-declarations-audit-v1.md)): *every*
public person above a content floor gets a prerendered file + sitemap `<loc>`; only the thin tail
(bare candidacy, 18,601) stays SPA/noindex. That means **38,353 indexable pages** — and Decision 4
(net-neutral, ~5,000) **overrides G6**. The arithmetic that motivates the override: deployed today
≈116k files; G6's set adds ~38k (BG) or ~77k (BG+EN) → ~154k–193k. Known-good is ~116k; known-bad
is 369k (candidate sub-tabs, reverted) and 453k. **~154k–193k is unmeasured territory.** So:
net-neutral is the safe default for this migration, but it is a *deliberate deviation* from G6 and
must be recorded as such — a future implementer reading only `emit_prerender_slugs.ts` will
otherwise ship the full indexable set and risk the deploy. If the full G6 set is wanted, measure
the ceiling with a staging deploy **first**, and note that `/person` largely duplicates the
existing 26,386 `/candidate` pages — which argues for *consolidation* (Decision 4's rejected
option), not addition.

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

> **✅ RESOLVED in T0.1b (2026-07-25) — was: 106 officials lose their published net worth.**
> Root cause was not a resolver bug but a blinded input. `declaration.source_url` is UNIQUE
> and one filing is written under two officials slugs when an official holds two posts, so
> the loader drops the second copy — correctly. But `registerIdByRef()` derives the Сметна
> палата per-person GUID (the second gold key, whose stated purpose is binding "a register
> person to every slug the officials ingest minted for them") by reading `declaration`, so a
> slug whose only filing was dropped got NO gold key and the aliasing never fired. Fix:
> migration 101 `declaration_subject_alias` keeps the dropped (subject_ref, source_url) pairs
> as identity evidence and `registerIdByRef` UNIONs them, leaving its
> `HAVING count(DISTINCT guid) = 1` guard untouched — so it can only add a union the register
> itself asserts. Result: 154 duplicate person rows merged, **0 slugs changed for surviving
> persons**, and the officials parity tail went 106 true losses → **0**. Taskov now shows his
> €2.79M. The remaining 205-row tail is year/representative-filing differences, not loss.
> It also resolved the LAST unresolved filing (47,983/47,983 now attach to a person, via a
> phase-2 alias pass) and restored Галя Стоянова Василева's wealth series to 2024.
>
> **Two side effects it did NOT handle — both land on T1.4:**
> 1. **154 retired `/person` slugs now 404.** The merge collapsed them into their canonical
>    twin and nothing redirects the old URL — the exact breakage migration 099 (slugLock)
>    exists to prevent, though 099 only pins slugs for surviving mentions. Harmless *today*
>    (`/person` is neither prerendered nor sitemapped, so none were indexed) and T1.4
>    regenerates the manifest from the current person table, so they never publish. But if
>    `/person` is ever prerendered BEFORE a slug-retirement redirect exists, a later merge
>    will 404 indexed URLs. Build the redirect with T1.4, not after.
> 2. **Bridge-B roles grew 31,504 → 31,655 (+151).** Collapsing duplicate person rows makes
>    those name folds people-unique, so name-matched company footprints now attach. Correct
>    in principle and bounded by the same ≤5-company rule, but it is the defamation-sensitive
>    surface ([[reference_person_fold_and_bridgeb]]) and nothing currently bounds the growth.
>    Worth a spot-check before Tier 3 leans on the connections graph.
>
> Historical detail follows.
>
> **(historical) T1.2 BLOCKER found in T0.1 — 106 officials lose their published net worth.**
> Reconciling `officials_rankings_table` against `assets-rankings.json` (13,346 people,
> membership parity exact): 11,415 figures match exactly; 1,296 are JSON-`0` vs PG-`NULL`
> (same meaning — filed, no valued assets); 326 differ because PG uses a *newer* filing from
> another tier (PG is more current); 20 use an older year and 183 differ within the same year
> (both unexplained, worth a look); and **106 are a real loss** — the person layer minted
> **two officials slugs for one human** (`dimitr-georgiev-taskov-39b7b6` holds the role,
> `-14e4c2` owns all four declarations; `grudi-ivanov-angelov-71ef1f` and `-aeb36f` both carry
> €518,958). The role attaches to one person row, the wealth to the other, so the leaderboard
> renders blank. This is a pre-existing person-resolution defect that `/person` already shows
> today — the migration exposes it rather than causing it — but it becomes user-visible the
> moment T1.2 repoints `/officials/assets` at PG. **Decide before T1.2:** merge the duplicate
> officials slugs in the resolver (touches slugLock'd, indexed `/person` URLs) or ship with the
> 106 documented. Do not let T1.2 land unnoticed on top of it.

### Tier 1 — officials cutover + net-neutral prerender (SEO-gated)
- **The 301 must be Cloud-Function-served, NOT a `firebase.json` rule** (corrected — the
  original plan was not implementable). The two slug spaces do **not** line up: an officials slug
  is minted by `officialSlug(name, institution)` with an **institution disambiguator**
  (`scripts/officials/shared.ts`, see `official_slug.test.ts`), while a person slug is a separate
  space with its own uniqueness guarantee (`resolve_persons.ts:1089`). So `/officials/ivan-petrov-mvr`
  → `/person/ivan-petrov` is **not expressible as a glob/capture rewrite**, and enumerating all
  ~5,001 mappings in `firebase.json`'s `redirects` array exceeds Firebase's per-site redirect
  limit (1,000).
  **MEASURED 2026-07-25 (T0.1), and it is worse than the structural argument above:** the two
  spaces are *mostly* aligned after the officials re-slug — 18,508 of 20,658 officials refs
  (89.6%) already equal their person slug. A glob rewrite would therefore *appear* to work
  while silently 301-ing the remaining **2,150 (10.4%)** to a wrong-or-nonexistent `/person`
  URL. Partial alignment is the trap, not the fix.
  **Do:** add an `/officials/**` rewrite to the existing `db` Cloud Function and issue a real
  301 from a PG lookup. `person_role.ref` holds the **bare** officials slug
  (`sevinch-daudova-karaoglan-bd62ed`) for sources `official_exec` / `official_muni` /
  `public_sector` / `president` / `mep` / `diplomat` — **not** `/officials/<slug>` as earlier
  drafts of this plan claimed. 0 refs map to more than one person, so the lookup is
  unambiguous. Keep `/officials/assets` (a real page) routed ahead of the wildcard.
- Delete `OfficialProfileScreen`, `useOfficial`, `useOfficialConnections`. Migrate
  `people.ts:officialsAssetsTop` to `fetchDb`.
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
- Retire `data/officials/**` per the §0 teardown (move the declaration shards to the non-synced
  load-source tree, update **both** exclusion lists, then `bucket:sync:paths --dry-run --delete
  officials` before the real delete). ~21k files off the bucket. Give
  `useMunicipalContacts` (`officials/municipal_contacts/index.json`, 1 file) an explicit
  disposition — it is contact data, not declarations: either fold into `municipal_officials` or
  keep as a single bucket-served file.

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
  `candidates.json` as the prerender/sitemap load source but **move it out of `data/`** (§0.2) —
  and **delete** the per-candidate shard tree from disk *and* from the bucket
  (`bucket:sync:paths --delete`). This is the single biggest sync-time win: ~388k entries out of
  the enumeration walk.
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
- **Deploy ceiling + G6 conflict (§0.5)** — net-neutral `/person` prerender deliberately
  deviates from the documented G6 full-indexable decision; don't let an implementer silently
  follow `emit_prerender_slugs.ts` to +38k pages without a staging measurement.
- **Stale serving after retirement (§0.3)** — a retired JSON left in the bucket is served
  forever; the `--delete` teardown is mandatory, not optional cleanup.
- **Exclusion ≠ speed (§0.1)** — excluding a tree does not shorten `bucket:sync`; only removing
  it from `data/` does. Easy to "finish" the migration and see no time win.
- **SEO** — the 301 must come from the `db` Cloud Function (glob rewrites can't map the slug
  spaces; the redirects array can't hold 5,001 entries), with prerender + sitemap moving in the
  same commit or 5,001 soft-404s ([[feedback_static_seo]], [[project_seo_discovery_gap]]).
- **Parity drift** — JSON-vs-PG parity check per family before untrack; determinism per
  [[reference_pg_payload_determinism]].
- **DB perf** — EXPLAIN ANALYZE every new fn/resource on worst-case entity, index both join
  sides ([[feedback_db_query_perf]], [[reference_pg_query_performance]]).
- **Pre-existing breakage** — `company-connections` (rsync-excluded yet still fetched) may
  already 404 in prod; verify before Tier 3.
- **PG changelog** — each new PG dataset wires into `recent_updates` ([[reference_two_changelogs]]).
