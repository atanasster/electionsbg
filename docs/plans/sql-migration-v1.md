# SQL migration v1 — large datasets → source-of-truth SQLite

Status: PLAN (not started). Owner: atanasster.
Decisions locked (2026-06-30): engine = **`node:sqlite`** (Node 22 built-in, one engine across domains); versioning = **manifest + GCS snapshot** (treat the `.sqlite` as a regenerable cache, not a git binary).

## Goal & non-goals

Move the large datasets to a structured SQL database that becomes the **source of truth**, and **generate the existing JSON shared files from SQL**. The frontend contract does not change — JSON in, JSON out — only the generation backend moves from in-memory JS Maps to SQL queries. That invariant is what makes the migration safe and testable.

- **In scope:** procurement (contracts, tenders, contractors, awarders). Formalize the already-SQL TR pipeline (versioning + shared helper).
- **Out of scope (v1):** changing FE data hooks; DuckDB/Parquet; the AI-chat numeric escape hatch; election/section data.

## Reframe

TR (companies + people) **already is** this architecture: `raw → state.sqlite → generate JSON`, via `node:sqlite`. Procurement is the only large dataset still doing JSON→JSON in-memory. So v1 = **extend the proven TR pattern to procurement** + add the two things TR never got: a regression net and DB versioning.

Current procurement scale: **297,528 contracts · 26,126 contractors · 4,391 awarders · ~80–100k tenders · €74bn · 2.6 GB JSON** (TR is 4× the rows, so SQLite handles this trivially).

---

## Phase 0 — foundations ✅ SHIPPED (2026-07-01)

`scripts/db/lib/open.ts` (`openDb`/`checkpointAndClose` — WAL pragmas, read-only + fresh-rebuild modes), `scripts/db/migrate.ts` (`applyMigrations`/`schemaVersion` over `scripts/db/schema/*.sql`, tracked in `schema_migrations`), `meta` table convention. Separate DB per domain: `raw_data/procurement/procurement.sqlite` (gitignored, next to TR's `state.sqlite`). Details below were the original plan; what shipped matches it.

## Phase 0 (original notes) — foundations

Goal: shared DB plumbing + conventions, reused by TR and procurement.

1. **`scripts/db/open.ts`** — shared `openDb(path, {readOnly})` wrapping `node:sqlite` `DatabaseSync` with standard pragmas (`journal_mode=WAL`, `synchronous=NORMAL` for builds, `foreign_keys=ON`). Today every script (`sqlite_writer.ts`, `integrate.ts`, `build_company_connections.ts`, `cross_reference.ts`, `build_connections_graph.ts`, `build_officials_company_links.ts`) opens its own handle — consolidate onto this.
2. **`scripts/db/schema/`** — numbered DDL migrations (`001_procurement.sql`, …). Plain `.sql`, applied in order by a tiny `scripts/db/migrate.ts`. Schema lives in git; the `.sqlite` does not.
3. **`meta` table convention** (extend TR's existing one) — `schema_version`, `code_git_sha`, `generated_at`, `coverage`, `row_counts` (JSON). Single source for the manifest/lockfile.
4. **DB file layout** — one file per domain: `raw_data/procurement/procurement.sqlite`, existing `raw_data/tr/state.sqlite`. Cross-domain joins via `ATTACH DATABASE` (procurement contractor EIK → TR officers — what `cross_reference.ts` already needs), never a merged file.

Deliverable: `scripts/db/{open,migrate}.ts`, `scripts/db/schema/`, both gitignored DBs still build via existing scripts.

---

## Phase 1 — regression safety net over CURRENT JSON output ✅ SHIPPED (2026-06-30)

This is the user's explicit step 1: lock down the *current* generated output so any change after migration is caught. Golden-master / characterization testing, viable because output is already deterministic (`validate.ts:canonicalJson` + `ingest.ts:rowSort`). **Nothing migrates in this phase.**

Runner: **`node:test` + `tsx`** (as `scripts/declarations/parse_registered_office.test.ts`). Built under `scripts/db/`:

- `lib/canonical.ts` — volatile-insensitive hashing/compare. Strips run-stamps (`generatedAt` in 61k files, `lastIngest`) so a plain regeneration is a no-op; bare-array shards hash as raw bytes (fast path → 2.57 GB in ~18 s).
- `lib/contracts_aggregate.ts` — one streaming pass over the 301,015 month-shard rows (retains only counters/sets/maps, not rows).
- `manifest.ts` + `data/db/procurement.manifest.json` (committed) — Tier 1 per-category digests + headline totals; full per-file map → `scripts/db/.cache/` (gitignored).
- `golden_targets.ts` + `snapshot_goldens.ts` + `scripts/db/__golden__/procurement/` (22 committed fixtures) — Tier 2.
- `tests/{invariants,goldens,manifest}.data.test.ts` — Tier 3 invariants (always on) + Tier 1/2 byte-checks (gated on `DB_VERIFY=1`).

npm scripts: `test:data` (invariants), `db:verify` (`DB_VERIFY=1`, full byte-level), `db:manifest`, `db:goldens`, `db:snapshot`.

**Invariants pinned against the live corpus** (all green; verified the detectors fire on injected drift):
`totals.contracts`==count(contract)=297,528; `totals.amendments`==count(amend)=3,487; `totals.totalEur`==Σ amountEur(non-amend), cents-exact; keys globally unique (301,015); zero `-x` twin survivors; EUR peg holds; per-entity rollup `totalEur` is contract-only. Quirk characterized: **18 rows carry a blank EIK** — the index counts it as a party but writes no rollup file (file counts exclude the blank, index counts include it).

**CI note:** GitHub CI has no corpus (data is gitignored, ships via GCS), so `test:data` auto-skips there. It is a **local gate** — run before `bucket:sync` / after a procurement ingest. The Tier 1/2 baselines are refreshed with `npm run db:snapshot` after an intentional data change.

### Tier 1 — checksum manifest (catches any drift)
- **`scripts/db/manifest.ts`** — walk `data/procurement/**`, emit `data/db/procurement.manifest.json` = `{ generatedAt, totals (contracts/€/entity counts from index.json), files: { <relpath>: { sha256, bytes } } }`. Tiny, git-committed.
- Test `procurement.manifest.data.test.ts`: regenerate manifest from whatever is on disk, diff file-by-file against the committed manifest; report the changed-file list. Byte-identical = zero regression.

### Tier 2 — committed golden fixtures (human-readable diffs)
- **`scripts/db/__golden__/procurement/`** — full JSON for ~40–60 hand-picked entities, committed (~hundreds of KB): top contractors (Софарма, Аркад), the `-x` legacy-twin dedup cases, namesake-collision companies, an awarder with resolved geo, first N rows of the largest month shard, a `by_settlement` bundle, a `by_ns` bundle, a `by-id` shard.
- Test asserts the live file equals the golden (deep-equal). When Tier 1 flags a diff, these say *what* changed in readable form. A `--update-goldens` flag re-snapshots after an intentional, reviewed change.

### Tier 3 — invariant / property tests (encode the integrity rules)
- `Σ contractor.totalEur == Σ contract.amountEur` (and per-awarder).
- Contract keys globally unique (the `disambiguateContractKeys` guarantee).
- Every contract's contractor/awarder EIK resolves to a rollup; no orphans.
- No `-x` synthetic legacy survivor where a real twin exists (`dropSyntheticLegacyTwins`).
- EUR peg exactly `1.95583`; money fields round to 2 dp.
- Flow graph has no orphan nodes (`assertFlowIntegrity`).
- Counts in `index.json` match actual file/row counts.

Deliverable: `test:data` passes green on current `main`; manifest + goldens committed; CI runs it.

---

## Phase 2 — procurement → SQL

Goal: SQL becomes the generation backend; outputs stay byte-identical (proven by Phase 1).

### Status: 2a + 2b ✅ SHIPPED (2026-07-01)

- **2a schema** — `scripts/db/schema/001_procurement.sql`: `contracts` table, 31 typed columns covering the full `Contract` shape; money as REAL (full precision, no SQL rounding); indexes on `(contractor_eik)`, `(awarder_eik)`, `(date, ocid, key)`, `(tag)`. Contractors/awarders stay GROUP BY queries.
- **2b loader** — `scripts/db/lib/procurement_schema.ts` (single column⇄field map + `contractToRow`/`rowToContract`), `scripts/db/load_procurement.ts` (`npm run db:load`): month shards → 301,015 rows in ~5s / 331 MB; stamps `meta` (schema_version, git sha, coverage, count).
- **verification** — `scripts/db/tests/sql_roundtrip.data.test.ts`: **lossless** capture proven — all 301,015 rows rebuild from SQL and `deepStrictEqual` the on-disk rows (key-order-independent); `SUM(amount_eur)` reconciles cents-exact against the index, straight from SQL.

### 2c rollups ✅ SHIPPED (2026-07-01)

The per-contractor + per-awarder rollup generators run from SQL and reproduce the on-disk JSON **byte-for-byte**.

- **Refactor (behavior-preserving, verified):** `rowSort` moved to `validate.ts` (single canonical-order authority); `rollups.ts` split into `buildRollupsFromRows(rows, procurementDir)` (source-agnostic accumulator) + `buildRollups(contractsDir)` (delegates via a shard generator). `ingest.ts` imports `rowSort`.
- **Generator** — `scripts/db/gen_procurement/rollups.ts` (`npm run db:gen-rollups`): `SELECT * FROM contracts` → `rowToContract` → `.sort(rowSort)` → `buildRollupsFromRows` → compare each rollup (run-stamps stripped) to the live file. Same accumulator as JS; only the row SOURCE changes. `--write` to emit.
- **Result:** contractors **26,125 match / 0 diff**, awarders **4,391 match / 0 diff**, in ~9s. `tsc -b` + `db:verify` (10/10) confirm the refactor changed nothing.
- **Finding — 34 stale "extra-live" files:** exactly the amendment-only contractors (e.g. `177531370`: live `totalEur` = its single amendment's value, zero contract-tag rows). Created before amendment-exclusion; current JS `buildRollups` wouldn't produce them either, and the rollup writer doesn't purge orphans. **2c `--write` flip must clear the dir first** (and a one-off purge + bucket re-sync drops the 34 from the live corpus).

### 2c row-derived layer ✅ SHIPPED (2026-07-01)

Extended the same recipe to every output that's a pure function of the contract rows. All embed full `Contract` rows (113 field orderings), so verification is order-independent deep-equal (same rows, same per-entity/rowSort order, counts, names), not byte-identity.

- **Refactors (source-agnostic builders, writers delegate via a shard generator):** `contractor_contracts.ts` → `buildContractorContractsFiles`, `awarder_contracts.ts` → `buildAwarderContractsFiles` (shared `byDateDescKeyAsc`), `by_id_shards.ts` → `buildByIdBuckets`.
- **Generators:** `gen_procurement/contract_lists.ts` (`db:gen-lists`) and `gen_procurement/month_shards.ts` (`db:gen-shards`).
- **Results (0 diff / 0 missing / 0 extra):** contractor_contracts **26,160**, awarder_contracts **4,391**, by-id **4,096**, month shards **174**.
- Month shards keep FULL precision on `--write` (`rawJson`) per the decision below; contract lists are cents-rounded (`canonicalJson`); by-id stays full-precision compact.

**Row-derived layer complete** — every per-row output (shards, rollups, contract lists, by-id) regenerates from SQL.

### 2c derived/ analytics ✅ SHIPPED (2026-07-01)

- **Refactors (source-agnostic `*From` variants; dir-based fns delegate via `readRollupDir`):** `cpv_competition.ts` → `buildCpvCompetitionFromRows`; `derived.ts` → `buildTopContractorsFrom` / `buildAwarderConcentrationFrom` / `buildFlowFrom`.
- **Generator** — `gen_procurement/derived.ts` (`npm run db:gen-derived`): SQL rollups (+ existing `mp_connected`/`pep_connected` inputs, which the JS builders also consume) → the derived files.
- **Results:** `cpv_competition`, `awarder_concentration` **byte-identical**; `flow`/`flow_full` **content-equal** (their node/link order follows the awarder `readdirSync` walk — FS-dependent, non-deterministic even for the JS builder); `top_contractors` matches **current code** — its only diff is the known stale amendment-only artifact (the on-disk file predates amendment exclusion, so 2 amendment-only contractors crack the top-1000).
- **Gotcha:** the JS derived builders read the **serialized (cents-rounded) rollup files**, so the generator round-trips the in-memory rollups through `canonicalJson` before feeding them — otherwise `sharePct = full/full` diverges from `rounded/rounded` at 1e-6.

**Baseline refresh:** the watcher's `a11a46758` (ЦАИС ЕОП refresh + awarder geo-enrichment) legitimately changed the corpus after Phase 1; `db:verify` correctly flagged the drift (contracts unchanged; awarders/by_ns/by_settlement/derived/tenders/index moved). Reloaded the DB, re-verified all generators (0 diff), refreshed the Tier 1/2 baseline via `db:snapshot`.

### 2c by_settlement ✅ SHIPPED (2026-07-01)

- **Refactor:** `by_settlement.ts` → pure `buildBySettlementData(awarders, getAwarderContracts, ekIndex, now)` core returning `{settlements, national, index, keptEkattes, …}`; `buildBySettlement()` now a thin writer wrapper (reads awarder rollups + awarder_contracts + EKATTE registry, calls the core, writes + prunes). Behavior-preserving.
- **Generator** — `gen_procurement/by_settlement.ts` (`npm run db:gen-settlement`): SQL awarder rollups + SQL-built awarder_contracts (both round-tripped through canonicalJson to match the serialized files the JS builder reads) + EKATTE registry → per-settlement + `_national` + `index`.
- **Result:** 492 settlements + `_national` + `index` — **byte-identical, 0 diff**.

Remaining 2c = the cross-domain layer (`by_ns`, `mp_connected`, `pep_connected`, `risk_feed`, `index.json` crossReference) — these join contracts to the MP/officials/TR domains.

**Two findings that reshape 2c (the generators):**
1. **Month shards carry 113 source-dependent field orderings** (legacy/OCDS/EOP × which optional fields present; e.g. `amountEur` after `sourceUrl` in OCDS but right after `currency` in EOP). So byte-identical *shard* regeneration from typed columns is not a goal — the generated shards will have ONE canonical field order (a one-time, reviewable format normalization). The derived layer (rollups/by-id/etc., built by `rollups.ts` with a fixed object shape) IS byte-reproducible.
2. **On-disk month shards are stale w.r.t. cents-rounding.** `b5074b144` added `*Eur` rounding to `canonicalJson` and regenerated the rollups (rounded on disk) but NOT the shards (still full precision). The next JS ingest would round shard `amountEur` too. **Decision for 2c:** either round shard `amountEur` (matches current code, churns every shard + a full bucket re-sync) or keep shards full-precision (matches long-standing on-disk format; don't apply `*Eur` rounding to shard rows). Rollups round either way, so they're unaffected.

### 2a. Schema (`scripts/db/schema/001_procurement.sql`)
```
contracts(
  key TEXT PRIMARY KEY,            -- disambiguated contract key (URL slug)
  ocid TEXT, contract_id TEXT,
  tag TEXT,                        -- award | contract | contractAmendment
  awarder_eik TEXT, awarder_name TEXT,
  contractor_eik TEXT, contractor_name TEXT,
  date TEXT, year INT, month TEXT,
  amount REAL, currency TEXT, amount_eur REAL,
  cpv TEXT, procedure TEXT, num_tenderers INT, eu_funded INT,
  title TEXT,
  source TEXT,                     -- ocds | eop
  bundle_uuid TEXT,
  is_synthetic_legacy INT          -- "-x" twin marker, resolved at generate
)
-- indexes: (contractor_eik), (awarder_eik), (date, ocid, key), (year, month), (tag)
tenders(...)                       -- separate table, keyed by tender id/ocid
awarder_geo(eik, ekatte, oblast, ...) -- the geo overrides / EKATTE resolution
meta(key, value)
```
Contractors/awarders are **GROUP-BY queries**, not stored tables (materialize later only if perf needs it).

### 2b. Loader (`scripts/db/load_procurement.ts`)
`normalize.ts` / `normalize_eop.ts` output → SQL `INSERT … ON CONFLICT(key) DO UPDATE` (replaces the in-memory month-shard merge). EIK canonicalization (`eik.ts`) and EUR conversion (`src/lib/currency.ts`) happen at load. The `-x` dedup (`validate.ts:dropSyntheticLegacyTwins`) becomes a marker pass: a CTE flags `-x` rows that have a real twin (same date/awarder/contractor/amount/title) → `is_synthetic_legacy=1`; generation filters them.

### 2c. Generators (`scripts/db/gen_procurement/*.ts`) — replace the JS writers, identical output
- `contracts/<YYYY>/<YYYY-MM>.json` ← `SELECT … WHERE is_synthetic_legacy=0 ORDER BY date, ocid, key` (was `ingest.ts:writeMonthShards`).
- `contractors/<eik>.json` + `awarders/<eik>.json` ← GROUP BY rollups (was `rollups.ts`).
- `contractor_contracts/<eik>.json` + `awarder_contracts/<eik>.json` ← `WHERE eik=? ORDER BY …`.
- `contracts/by-id/shard/<prefix>.json` ← 4,096 prefix buckets (`by_id_shards.ts`).
- `by_ns/<date>.json`, `by_settlement/<ekatte>.json`, `derived/*` (flow, concentration, top_contractors, pep, mp_connected), `derived/contractors_search.json`, `index.json`.
- **Reuse `validate.ts:canonicalJson` as the single serializer** for every output (one rounding authority).

### 2d. Wire-up
- New `db:build:procurement` npm script (load + generate). Keep `procurement:ingest` as the raw-fetch front end feeding the loader.
- Update `rebuild_derived.ts` / `rebuild_from_cache.ts` to drive the SQL path.
- Iterate: run generators → `test:data` → chase diffs to **zero** (or explained + goldens updated) before switching the watcher/skill over.

### Determinism gotchas (the diff sources to pre-empt)
- **`GROUP BY` has no implicit order** — every generator query needs explicit `ORDER BY` matching the current JS sort. This is the #1 cause of false diffs.
- **Rounding** stays in `canonicalJson` (JS), *not* SQL — `REAL` vs JS-number rounding diverge otherwise.
- **`ON CONFLICT` upsert** must mirror the JS "later bundle overwrites same key" merge precedence.
- **NULL vs absent keys** — match the current JSON's omit-vs-null behavior per field.

---

## Phase 3 — DB versioning (manifest + GCS snapshot)

Treat the `.sqlite` as a regenerable cache; version the *recipe + inputs*, distribute the *binary* like `data/` already ships.

1. **Schema-as-code** — migrations in git (Phase 0). `meta` carries `schema_version`, `code_git_sha`, `coverage`, `row_counts`, `generated_at`.
2. **Lockfile** — `data/db/<name>.lock.json` (`{ db, schema_version, sha256, row_counts, coverage, generated_at }`), git-committed = the pointer.
3. **`scripts/db/snapshot.ts`** (`db:snapshot`) — gzip the `.sqlite` (~3–4×) → `gs://data-electionsbg-com/db/<name>-<YYYY-MM-DD>-<sha8>.sqlite.gz`, update a `latest` pointer, write the lockfile. Mirrors `bucket:gz`.
4. **`scripts/db/restore.ts`** (`db:restore`) — pull from GCS, verify sha256 against the lockfile, decompress to `raw_data/`. For fresh clones / CI / a second machine.

Explicitly **not** doing: git-LFS the binary (400 MB churn, low-value history), Dolt (heavy unfamiliar format; unnecessary when the DB reconstructs deterministically from raw).

---

## Sequencing & gates

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | ✅ `scripts/db/{open,migrate,schema}`, meta convention | tsc + lint green |
| 1 | ✅ manifest + goldens + invariants, `test:data` local gate | `test:data` / `db:verify` green on current `main` |
| 2 | ✅ 2a schema + 2b loader; ✅ 2c row-derived + derived/ analytics + by_settlement — all reproduce; ⬜ 2c cross-domain (by_ns, mp/pep_connected, risk_feed, index.json) | `db:gen-*` reproduce ✅; cross-domain layer next |
| 3 | snapshot/restore + lockfile | restore on a clean checkout reproduces a verifying DB |

Existing gates that must stay green throughout: `npm run lint`, `npm run build`, `npm run data:map`, `tenders:test`, `ai:test:all`, `npm test` (Playwright).

## Dev SQL browser (tooling) ✅ SHIPPED (2026-07-01, extended to "full")

A dev-only, in-app SQL console for manually inspecting the database + joins.

- **Backend:** `vite/sql-browser.ts` — a Vite plugin (`apply: "serve"`, so absent from prod builds + `vite preview`) mounting `/__sql/*`. Opens `procurement.sqlite` **read-only** via `node:sqlite` and **auto-discovers + ATTACHes every other `raw_data/*.sqlite`** (depth ≤ 2; alias from path — `tr/state.sqlite` → `tr`; per-attach try/catch), so cross-domain joins work (contracts.contractor_eik = tr.companies.uic / tr.company_persons.uic). `PRAGMA query_only = ON` (hard read-only — verified: DELETE/UPDATE/DROP rejected, SELECT works). `GET /__sql/schema` (attached DBs + tables + columns + **indexes** + row counts; marks indexed columns), `POST /__sql/query` (`{sql, limit}` → rows, capped 5k, `iterate()` early-stop). The DB never reaches the browser.
- **UI:** `src/screens/dev/SqlBrowserScreen.tsx` at `/dev/sql`, full-screen (no site chrome), route registered only under `import.meta.env.DEV` (chunk + CodeMirror deps DCE'd from prod). Features: **CodeMirror editor** (SQL syntax highlighting + schema-aware autocomplete, dark-mode aware), **Run** (runs selection if any) + **Explain** (EXPLAIN QUERY PLAN — shows index usage) via ⌘/Ctrl+Enter, filterable **schema explorer** (collapsible tables, row counts, pk/idx flags, click column → insert), **query history + saved queries** (localStorage), sortable + row-expand (full JSON) + CSV/JSON export results grid, sample join queries.
- **Deps (devDependencies, dev-only):** `@uiw/react-codemirror`, `@codemirror/lang-sql`, `@codemirror/theme-one-dark`.
- **Verified in-browser:** schema shows `main.contracts` (301,015) + `tr.companies` (1.0M) + `tr.company_persons` (1.0M) + `tr.meta`; contracts × `tr.company_persons` join returns rows; sort/expand/export/history work; EXPLAIN shows `SEARCH contracts USING INDEX idx_contracts_tag`; read-only enforced; no console errors.
- Note: doesn't depend on the aggregate generators — `GROUP BY` gives aggregations live.

## Follow-ups (deferred)
- Fold TR generation onto the shared `openDb` helper + lockfile/snapshot (same Phase 3 machinery).
- Unified read layer via `ATTACH` for cross-domain joins.
- DuckDB/Parquet read replica for the AI-chat numeric escape hatch (separate plan).
- Per-EIK file-count pressure (Firebase 453k ceiling, GCS sync cost) is unchanged by v1 — revisit if FE ever queries Parquet directly.
