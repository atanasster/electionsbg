# PRD: Commerce-Registry connections & arbitrary-person search

Status: **design approved, verification gates passed — implementation not started.**

This PRD covers the full roadmap. It ships in four steps (see Phasing): fix
the stale TR data, build the **company → officers → people-in-power** feature
as **precomputed static JSON**, ship that to production, then migrate to a
queryable database. Steps 1–3 need no new infrastructure; the DB migration
(step 4) is staging-gated.

## Context

The connections feature today covers a *curated, bounded* set of entities —
MPs and non-MP officials (cabinet, governors, mayors, councillors) —
pre-computed offline into static JSON (`data/parliament/connections*.json`)
and cross-referenced against a partial Commerce Registry.

The goal of this phase: let a reader land on **any** company and see its
officers/shareholders and how they connect to the political class — and,
eventually, type **any** person's name and see the same. A journalist
investigating a name or a company should not be limited to entities the
pipeline already curates.

This cannot be done with the current architecture. You cannot pre-compute a
connection graph for every company/person in Bulgaria, and the full Commerce
Registry cannot be shipped as static JSON to the browser. It needs a
queryable backend.

## Verified data availability

- **The data.egov.bg TR feed is a rolling window, not a full archive.**
  `dataset-index.json` lists **1,113 daily filing resources spanning
  2022-09-03 → 2026-05-19**; data.egov.bg prunes older resources from the
  listing. The feed publishes daily *change events* (officer add/erase,
  company meta) — there is no full-snapshot resource.
- **Today's `state.sqlite` is built from a stale, broken folder.** The 517
  cached `daily/` files are 2021 (290) + 2022 (206) + 21 stray 2026 days —
  **nothing from 2023–2025**. So it holds only 243k `company_persons` rows
  and just 125k of 576k companies have any officer. This is a 3-year hole,
  not merely "partial".
- **Reconstruction is event-replay**, so coverage = every company that filed
  ≥1 event inside the window. A company whose officers were registered
  before the window and unchanged since shows **0 officers** — a permanent
  limit of this source. True 100% coverage would need the Registry Agency /
  brra.bg bulk export, which this pipeline does not use.
- **Maximum achievable window ≈ 5.4 years (2021-01 → 2026-05).** The stale
  `daily/` folder is now the *only surviving copy* of pre-2022-09 filings —
  it must be merged with a fresh bulk ZIP, not discarded.
- **No ЕГН** anywhere — TR identifies people by name only. Entity
  resolution is therefore the central, permanent problem.
- **Tier-1 power people** — `data/parliament/connections-search.json` has
  491 MPs + 1,152 officials; `data/officials/municipal/index.json` has
  6,278 municipal officials (councillors, mayors, deputy-mayors, council
  chairs, chief architects). Union ≈ **7,500 power people**.

## Verification gates (run May 2026 — inspection only)

- **Gate A — bulk coverage: partial pass.** Confirmed the rolling-window
  finding above. A full bulk ingest will lift `company_persons` from 243k to
  an estimated **~0.6–1M+** rows (exact figure unknown until ingest) — a
  large improvement, but not "complete". Companies users actually reach on
  the site (procurement winners, EU-funds beneficiaries) are active filers,
  so coverage for that relevant subset will be well above the global average.
- **Gate B — normalizer consistency: pass.** The TR `normalizePersonName`
  and the connections-graph `normalizeName` are byte-identical (uppercase +
  whitespace collapse). The officials `normalize`
  (`scripts/officials/shared.ts`) adds one rule — collapsing spaces around
  hyphens — so it differs only for hyphenated double-surnames. Low risk; the
  shared normalizer (see Schema) should be the hyphen-aware variant.
- **Gate C — join feasibility: strong pass.** Of the 1,643 curated power
  people, **1,273 (77.5%) already match a TR officer by exact name** against
  the *partial* DB — full bulk will raise this. Only 8 of those are
  namesake-prone (>25 companies); 99.9% of power people have discriminating
  3-part names. The feature will yield real, mostly-clean results; namesake
  risk is concentrated on bridge intermediaries and handled by the
  `company_count` cap.

## Competitive landscape

Surveyed before locking the design (research May 2026):

- **OpenCorporates** — largest open company DB. **Deliberately does NOT
  merge officers across companies** — each officer is a separate entity;
  merging is manual/probabilistic "to be safe." This validates our
  name-match-with-confidence stance: the market leader refuses to assert
  identity from a name alone.
- **OCCRP Aleph** — investigative cross-referencing platform; stack is
  Python/Flask + Postgres + Elasticsearch + Redis + RabbitMQ. Powerful but
  heavy to operate; the open-source core is **unmaintained after Oct 2025**.
  A cautionary tale against a multi-service backend.
- **OpenSanctions / yente** — open-source matching API on the
  **FollowTheMoney (FtM)** schema (Person, Company, Ownership, Directorship).
  FtM is the de-facto journalist ontology — we borrow its *vocabulary* for
  role/column names without adopting its stack.
- **LittleSis** — Rails + Postgres, manually curated "who-knows-who";
  `Oligrapher` (React/Redux) for network viz.
- **Bulgarian competitors** — **Papagal.bg** (consumer company directory
  built from the same data.egov.bg open data, shows "свързани лица") and
  **Bivol.bg** (OCCRP partner; since 2015 runs a companies-register search
  cross-referenced against PEPs, procurement, EU funds, ex-agent registries).
  Our differentiator: we connect companies to the **curated political
  class** with deep links into election results, declarations, and votes —
  Papagal has no politics, Bivol is not an elections site.

## Architecture

**Two-stage delivery.** The company → people-in-power feature ships first as
**precomputed static JSON** — per-EIK files on the GCS bucket, exactly like
the existing funds/procurement sections, with no new infrastructure (steps
1–3). It is then migrated to a queryable database (step 4), which unlocks the
unbounded features — arbitrary person-name search and officer lookup for
companies outside the precomputed set.

### Stage 2 — static JSON (steps 1–3)

The offline pipeline computes the full feature (direct + one-hop bridge) for
the bounded set of companies that have a political connection, and writes one
`company-connections/{eik}.json` per connected company. The SPA fetches its
own EIK's file; a 404 means no connection. No backend, no new spend.

### Stage 4 — Turso + Firebase Function

Supabase (the earlier recommendation) is **dropped**: its free tier caps the
DB at 500 MB and pauses projects after a week idle; Pro is $25/mo; and
Postgres buys nothing a SQLite recursive CTE + FTS5 cannot do.

```
SPA  (/company/:eik page)
  │  GET /api/company/:eik/connections        (same origin — no CORS)
  ▼
Firebase Hosting CDN  ──cache hit (1-day TTL)──▶ instant
  │  cache miss
  ▼
Firebase Function v2  (onRequest, europe-west1; holds Turso token as secret)
  │  libSQL query
  ▼
Turso  (hosted SQLite / libSQL, Frankfurt region)
```

- The static SPA stays static; one new `/api/**` Hosting rewrite points at a
  Firebase Function. The Function is the only component that talks to Turso,
  so the Turso token is never exposed to the browser.
- **Same-origin** — the SPA calls `/api/...` on its own domain, so there is
  no CORS surface.
- The **CDN layer is the cost lever** — the connections JSON changes rarely,
  so most company-page hits are CDN cache hits and never reach Turso.
- **Prerequisite (met):** Firebase Functions require the **Blaze** plan to
  make outbound calls to Turso. Blaze is active.

### Turso free-tier fit

| Concern | Finding | Verdict |
|---|---|---|
| FTS5 (fuzzy name search) | Enabled by default on Turso | Available — **not needed for v1** (entry point is an EIK) |
| Import a ~1 GB DB | `turso db create --from-file` ≤ 2 GB; newer upload path 20 GB | Fine — projected DB ~0.7–1 GB |
| Storage | Free: 5 GB | ~5× headroom |
| Row reads | Free: **500 M/month** | v1 query reads ≤~3k rows; 200 searches/day ≈ 3.6% of limit |
| Writes | Free: 10 M/month | Only monthly bulk reloads |
| Recursive CTEs | libSQL is SQLite | Supported (not needed at depth 2 — see Query design) |

Turso free tier covers this **~1000× over**. Net new spend: **$0/month**.
At ~150 visitors/day skewed to elections (procurement/companies are a
minority interest), a hosted DB on a paid plan would be poor ROI.

## Data schema

### Stage 2 — precomputed static files

One `data/parliament/company-connections/{eik}.json` per politically-
connected company:

```json
{ "eik", "name", "generatedAt",
  "officers":     [{ "name", "role", "isCurrent" }],
  "directLinks":  [{ "officerName", "role", "power": {}, "confidence" }],
  "bridgedLinks": [{ "bridge": {}, "viaCompany": {}, "power": {},
                     "powerRole", "confidence" }] }
```

`bridgedLinks` is capped (~200/file, with a `truncated` flag). The connected
set is bounded; if it exceeds ~150k companies, shard by EIK prefix. The
directory is a regenerable build artifact — gitignored, GCS-only.

### Stage 4 — Turso database (4 tables)

Built offline, imported into Turso. FTS tables and the canonical
person/mention layer are deferred to the person-search phase.

```sql
-- ~1.5M rows. Needed to show the bridge-company display name.
CREATE TABLE companies (
  uic    TEXT PRIMARY KEY,
  name   TEXT,
  status TEXT
);

-- The edge table — drives company->person AND person->company. ~3-4M rows.
CREATE TABLE company_persons (
  uic           TEXT NOT NULL,
  role          TEXT NOT NULL,    -- manager|partner|director|sole_owner|actual_owner|...
  name          TEXT NOT NULL,
  name_norm     TEXT NOT NULL,    -- THE join key
  share_percent REAL,
  erased_at     TEXT              -- NULL = currently active
);
CREATE INDEX idx_cp_uic  ON company_persons(uic);
CREATE INDEX idx_cp_name ON company_persons(name_norm);

-- One row per distinct name — powers the namesake guard. ~1M rows.
CREATE TABLE person_names (
  name_norm     TEXT PRIMARY KEY,
  part_count    INTEGER,          -- 2 or 3; 3-part = safer to traverse
  company_count INTEGER NOT NULL  -- high = common name = risky hop
);

-- The Tier-1 <-> Tier-2 bridge. ~7,500 rows.
CREATE TABLE power_people (
  name_norm    TEXT NOT NULL,
  kind         TEXT NOT NULL,     -- mp | official
  ref_id       TEXT NOT NULL,     -- mpId / official slug -> deep-link
  display_name TEXT NOT NULL,
  role_label   TEXT,              -- "MP · ГЕРБ-СДС" / "Кмет на Пловдив"
  tier         TEXT,              -- national | executive | municipal
  party        TEXT,
  confidence   TEXT NOT NULL      -- high (unique 3-part) | low (namesake-prone)
);
CREATE INDEX idx_power_name ON power_people(name_norm);
```

**`power_people` source — all officials, deduped by slug:**
- MPs from `data/parliament/connections-search.json` (491)
- officials from `connections-search.json` (1,152)
- the full municipal roster from `data/officials/municipal/index.json`
  (6,278: councillors, mayors, deputy-mayors, council chairs, chief
  architects) — `ref_id` = `slug`, deep-links to `/officials/:slug`.

**Critical — single normalizer.** `company_persons.name_norm`,
`person_names.name_norm`, and `power_people.name_norm` MUST be produced by
the *same* function. Gate B verified that the TR `normalizePersonName` and
the connections-graph `normalizeName` are already byte-identical; the
officials `normalize` differs only by collapsing spaces around hyphens.
`build_search_db.ts` must re-normalize every name through **one shared
helper** — the hyphen-aware variant (hyphenated double-surnames are common
for women officials) — and never trust the pre-computed `nameNormalized` /
`normalizedName` fields. A mismatch makes the join silently return nothing.

## Query design (no recursion needed)

"company → officer → other company → politician" is bounded at **depth 2 =
two JOINs**. Two flat queries — predictable row counts, easy to reason about
for the read budget. The generic recursive CTE belongs to the later
`/connections` explorer, not here. The **Stage-2 offline builder computes
exactly this logic** for every company; the **Stage-4 Function** runs the
same two queries live against Turso.

**Direct** — an officer of this company is a politician:

```sql
SELECT cp.name, cp.role, cp.erased_at,
       pp.kind, pp.ref_id, pp.display_name, pp.role_label, pp.party, pp.confidence
FROM company_persons cp
JOIN power_people pp ON pp.name_norm = cp.name_norm
WHERE cp.uic = :eik;
```

**One-hop bridge** — officer → their other company → a politician there:

```sql
SELECT o1.name AS bridge_name, o1.role AS bridge_role,
       c2.uic  AS via_eik,    c2.name AS via_company,
       o2.role AS power_role,
       pp.kind, pp.ref_id, pp.display_name, pp.role_label, pp.party, pp.confidence
FROM company_persons o1
JOIN person_names pn    ON pn.name_norm = o1.name_norm
JOIN company_persons x  ON x.name_norm  = o1.name_norm AND x.uic <> :eik
JOIN companies c2       ON c2.uic = x.uic
JOIN company_persons o2 ON o2.uic = x.uic
JOIN power_people pp    ON pp.name_norm = o2.name_norm
WHERE o1.uic = :eik
  AND pn.company_count <= :namesakeCap   -- skip bridging through common names
  AND o2.name_norm <> o1.name_norm
LIMIT 200;
```

`namesakeCap` ≈ 20–30 (tunable). The Function dedupes by power person and
assembles human-readable paths.

## Entity resolution

No ЕГН ⇒ deterministic dedup is impossible — a permanent pipeline concern.
v1 stance (pragmatic, matches the existing curated graph and OpenCorporates):

- **`name_norm` is the v1 person identity.** No canonical person/mention
  layer yet — that is a later phase.
- **Confidence is first-class and always surfaced.** A name-only match to a
  power person is never `high`. Rule: direct match on a unique 3-part name →
  `medium`; any namesake-prone or 2-part name, or any one-hop bridge →
  `low`. The UI shows a "name match — identity not verified" disclaimer.
- `person_names.company_count` + `part_count` let the UI dim/flag risky hops
  and let the bridge query skip ultra-common names.
- The later FtM-style canonical layer + a manual merge/split override file
  (extending the existing `update-connections` typo-override pattern) is a
  documented Phase-6 item.

## Staging gating

The Stage-2 static feature (steps 1–3) is **not** DB-backed and ships
normally to **production**. Only the Stage-4 DB migration is gated to
**staging only** until explicitly promoted.

- **Frontend gate — runtime hostname flag.** New helper
  `src/lib/featureFlags.ts`: `registryDbEnabled()` returns true for
  `*staging*` and `localhost` hostnames, false for `electionsbg.com` /
  `elections-bg.web.app`. The new route and the company-page connections
  section are wrapped in this flag; on prod the route redirects to home.
  Chosen over a build-time env flag because the Firebase predeploy hook runs
  `npm run build` unconditionally — a runtime gate needs zero build-pipeline
  changes. The inert feature code in the prod bundle is a small lazy chunk.
- **Backend gate — Function deployed to staging project only.**
  - `npm run staging` → `firebase deploy -P staging` (hosting + functions).
  - `npm run deploy` (prod) → change to `firebase deploy -P default --only hosting`
    so the Function never lands on `elections-bg`. (`:fast` variants likewise.)
  - The `/api/**` rewrite is present in `firebase.json` for both projects; on
    prod it resolves to 404 since no Function exists there — harmless, the
    prod UI never calls it.
- **Promotion to prod** (later, separate change): widen `registryDbEnabled()`
  to prod hostnames and add `functions` back to the prod deploy.

## Phasing

The feature ships in four steps. Steps 1–3 require no new infrastructure;
step 4 is the DB migration.

### Step 1 — Fix the stale TR data
- `cli.ts --index` to refresh `dataset-index.json`, then `--bulk` to fetch
  the current ~1,113-resource ZIP (2022-09 → present).
- **Code change** — `reconstruct_state.ts` must merge two sources: the stale
  `daily/` folder (2021-01 → 2022, the only surviving copy of pre-2022-09
  filings) and the fresh bulk ZIP, replayed in one chronological stream.
  Today it reads zip *or* folder. Do **not** delete `daily/`.
- Run `--reconstruct`. **Verify** `company_persons` rises from 243k to
  ~0.6–1M+ and that 2023–2025 `added_at` rows now exist (the current DB has
  none).
- No connections-graph rebuild needed — `power_people` is sourced from
  `connections-search.json` + the municipal index, which do not depend on
  the TR fix.

### Step 2 — Company → people-in-power feature (static JSON)
- **New `scripts/declarations/tr/build_company_connections.ts`** — reads the
  reconstructed `state.sqlite` + `connections-search.json` +
  `officials/municipal/index.json`. Builds the `power_people` map (~7,500,
  one shared normalizer), computes direct + one-hop-bridge links for every
  company, writes one `data/parliament/company-connections/{eik}.json` per
  connected company, emits `company-connections-stats.json`, and prints the
  connected-company count. Add `npm run tr:build-company-connections`.
- **Delivery decision** — gitignore `company-connections/` (regenerable,
  GCS-only). If the connected set exceeds ~150k companies, shard by EIK
  prefix instead of one file per EIK.
- **Frontend** — `src/data/parliament/useCompanyConnections.ts` (fetch the
  per-EIK file, 404 → no section) + `CompanyConnectionsSection.tsx` on
  `CompanyByEikScreen.tsx`: officer roster, direct links, bridged paths
  (`Company → (bridge person, role) → Via Co. → [MpAvatar] Politician`),
  confidence chips, the identity disclaimer. Reuse `MpAvatar`; deep-link
  `/candidate/mp-:id` and `/officials/:slug`. i18n EN/BG. No feature flag —
  static, prod-bound.

### Step 3 — Ship steps 1 + 2
- Regenerate data (step 1 → step 2 builder), then `npm run bucket:sync` to
  push the new files to the GCS bucket (shared by staging and prod).
- `npx eslint . --fix` (predeploy lint hook), then `npm run staging` →
  verify on `electionsbg-staging.web.app` → `npm run deploy` → prod.

### Step 4 — DB migration (Turso + Firebase Function)
Staging-gated (see Staging gating). For the company→politician feature this
is a delivery swap; its real payoff is the unbounded features below.
- New `scripts/declarations/tr/build_search_db.ts` — emits
  `raw_data/tr/registry.sqlite` (the Stage-4 4-table schema; one shared
  normalizer). Add `npm run tr:build-search-db`. **Gitignore the artifact.**
- Turso: `turso db create electionsbg-registry --from-file … --location fra`,
  a read-only token, and a `tr:publish` rebuild + re-import script (monthly
  cadence; wire into `process-watch-report` later).
- New `functions/` dir — own `package.json` + `tsconfig.json`; deps
  `firebase-functions` v2 + `@libsql/client`. `onRequest` handler,
  `europe-west1`, route `GET /api/company/:eik/connections`: validates `:eik`,
  runs the 2 queries, dedupes, returns JSON; unknown EIK → empty, never 500.
  libSQL client at module scope; secrets via `defineSecret`
  (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`); response `Cache-Control:
  public, max-age=86400, stale-while-revalidate=604800`.
- `firebase.json`: add a `functions` block + a `/api/**` rewrite **before**
  the `**` catch-all; `npm run deploy` (prod) → `--only hosting` so the
  Function lands on the staging project only.
- `useCompanyConnections` becomes dual-path — `registryDbEnabled()`
  (staging/localhost) → the `/api` endpoint; prod → the Stage-2 static JSON.
  The same component renders both. Verify on staging; promote to prod as a
  separate change.

### Later phases (after step 4)
- **Arbitrary-person search** — add `companies_fts` / `persons_fts` (FTS5
  trigram) + a `/api/search?q=` route and a person-search surface. This is
  the feature the DB chiefly exists for.
- **Entity resolution** — canonical person/mention layer, co-occurrence
  resolution, a manual merge/split override file.
- **Recursive explorer** — generalised recursive-CTE traversal for the
  `/connections` graph, arbitrary depth.
- **Donors** — still blocked on data quality (financing register has only
  2-part donor names; needs a 3-part name or EIK source). Unchanged.

## Cost

**$0/month net new.** Turso free tier, Firebase Functions free quota
(~10k invocations/mo against a 2M free allowance), negligible CDN egress.
The $20–30/mo budget stays unspent; the only marginal cost is a few cents of
GCS-equivalent storage. Bonus: the same `registry.sqlite` can be opened in
**Datasette** locally as an internal investigative tool.

## Risks & open questions

- **Coverage ceiling (verified)** — the TR feed is a rolling ~5.4-year
  window; companies dormant since before 2021 will never show officers from
  this source. The UI must not imply a company with no officer rows has no
  officers — phrase the empty state as "no Commerce-Registry filings in the
  indexed period", not "no officers".
- **Namesake explosion** — mitigated by the `company_count` cap, confidence
  dimming, and 3-part names. Gate C found this is mild on the power-people
  side (8 of 1,273 matched names are namesake-prone); the risk is mostly on
  bridge intermediaries, where the cap applies.
- **Normalizer drift** — Gate B found the three pipelines' normalizers are
  near-identical (the officials one differs only on hyphens); low risk now,
  but the single-shared-helper rule still prevents future drift (see Schema).
- **SEO** — the connections section is client-fetched (static JSON in steps
  1–3, the Function in step 4) → not in prerendered HTML. Consistent with the
  existing client-fetched funds/procurement sections; acceptable.
- **Cold starts** — ~1–2 s on a cold Function; fine at this traffic, and the
  CDN absorbs most hits.
- **Legal / editorial** — a searchable person-connection graph built from
  public registers is more powerful than any single source; the disclaimer
  and the staging-first rollout give room for an editorial review before
  prod promotion.

## Decisions locked

- Rollout: **four steps** — fix data → static-JSON feature → ship to prod →
  DB migration. Steps 1–3 need no new infrastructure.
- Bulk TR ingest: **in scope** (step 1), incl. the `reconstruct_state.ts`
  two-source merge.
- Stage-2 delivery: **precomputed per-EIK static JSON** on the GCS bucket;
  ships to **production** (not gated).
- Stage-4 backend: **Turso free tier + a Firebase Function** (Supabase
  dropped); **staging-gated** until promoted.
- Blaze plan: **active**.
- `power_people`: **all officials** — MPs + executive + the full municipal
  tier (~7,500 rows).
- First slice: **company → officers → people-in-power**.
