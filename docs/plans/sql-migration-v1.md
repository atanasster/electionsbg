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

## Phase 0 — foundations (no migration yet)

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
| 0 | `scripts/db/{open,migrate,schema}`, meta convention | tsc + lint green |
| 1 | ✅ manifest + goldens + invariants, `test:data` local gate | `test:data` / `db:verify` green on current `main` |
| 2 | procurement SQL loader + generators | `test:data` diffs = 0 (or explained); tenders.harness + ai:test:all still green |
| 3 | snapshot/restore + lockfile | restore on a clean checkout reproduces a verifying DB |

Existing gates that must stay green throughout: `npm run lint`, `npm run build`, `npm run data:map`, `tenders:test`, `ai:test:all`, `npm test` (Playwright).

## Follow-ups (deferred)
- Fold TR generation onto the shared `openDb` helper + lockfile/snapshot (same Phase 3 machinery).
- Unified read layer via `ATTACH` for cross-domain joins.
- DuckDB/Parquet read replica for the AI-chat numeric escape hatch (separate plan).
- Per-EIK file-count pressure (Firebase 453k ceiling, GCS sync cost) is unchanged by v1 — revisit if FE ever queries Parquet directly.
