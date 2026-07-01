# Postgres migration v1 — single-engine source of truth + live search

Status: FOUNDATION SHIPPED (2026-07-01). Supersedes the SQLite-as-final-source endgame in [sql-migration-v1.md](sql-migration-v1.md) (that work was the stepping stone — its source-agnostic builders + JSON verification net port here unchanged).

## Decision (locked)

**Single ingestion into Postgres — no SQLite↔Postgres double-load.** Postgres (local Docker == deployed cloud) becomes the single source of truth for procurement: it ingests the corpus, generates the static JSON (unchanged FE contract), AND serves the live features (name search, AI-chat) at request time. `node:sqlite` was the migration stepping stone and is retired as the source once the PG path is complete.

Why: (1) **dev/prod parity** — local PG === deployed PG, no double ingestion; (2) **one engine/dialect/translit function/schema**; (3) PG natively supports the user-facing name search — `pg_trgm` (fuzzy/partial via GIN) + `unaccent` + a custom Cyrillic→Latin translit function — which `node:sqlite` cannot (it ships without FTS5, Node #56951). Verdict on local MySQL: **no** (ngram is CJK-oriented, no trigram, weakest for Cyrillic fuzzy). See the research report in the session history.

## Provisioning

Docker Compose, pinned **Postgres 16** + `pg_trgm`/`unaccent`, host port **5433** (avoids the brew PG14 on 5432). `docker-compose.yml`; `npm run db:pg:up` / `db:pg:down`. `DATABASE_URL` defaults to `postgres://postgres:postgres@localhost:5433/electionsbg`; prod points it at Cloud SQL / Neon.

## Foundation — SHIPPED + proven

- `scripts/db/lib/pg.ts` — `pg` Pool + `allRows`/`exec`/`withClient` (reads `DATABASE_URL`).
- `scripts/db/schema/pg/001_procurement.sql` — `contracts` table, **same column names as the SQLite schema**, PG types (TEXT→text, REAL→double precision, INTEGER→integer; `eu_funded` stays integer 0/1 so the shared `rowToContract` map is byte-identical), + `pg_trgm`/`unaccent`.
- `scripts/db/load_pg.ts` (`npm run db:load:pg`) — full rebuild from the month shards, batched INSERT via the **shared `contractToRow`** map. 301,015 rows in ~10 s.
- **Proof:** `buildRollupsFromRows` over PG rows reproduces on-disk contractors **26,125 / 0 diff / 34 stale** (same as SQLite); PG float8 round-trips `amountEur` exactly (`81806700.99139495`); 301k rows read from PG in 1.8 s. Confirms the builders + verification net are engine-agnostic.

## Remaining (sequenced)

1. ~~**Port the generators' row source** SQLite→PG~~ **SHIPPED (Phase 4b, `15e5fcd7e`).** Extracted the one engine-specific seam into `scripts/db/lib/rows.ts` (`readContractsFromPg`); repointed all 8 `db:gen-*` (now async); `build.ts` runs `db:pg:up` + `db:load:pg`. `npm run db:build` verify is 0-diff across every layer on Postgres (~65s). The builders + verification net were untouched.
2. **Verification + versioning on PG**: port `sql_roundtrip` to PG; snapshot = `pg_dump` → GCS + lockfile (`db:push`/`db:restore` PG variants).
3. **Name search (Feature 1)** — **DB side SHIPPED (Phase 4c, `c78b9bd9d`).** `translit_bg_latin` (immutable, Streamlined System 2009, both Cyrillic cases → collation-independent) + `immutable_unaccent` in `000_search_fns.sql`; `tr_companies` + `tr_officers` (deduped, `name_fold` generated + GIN trgm) in `003_tr_search.sql`, loaded by `load_tr_pg.ts` (`db:load:tr:pg`, 1.02M + 627k rows in ~24s); `search_companies` / `search_officers` in `004_search_api.sql` (token `<%` word-match, `word_similarity` rank, function-local trgm thresholds, each hit carries its procurement summary). Proven across BG/EN, partial, fuzzy, any-order, officer→company. **Remaining:** serving endpoint (Firebase Fn / Cloud Run → these functions); a `.data.test.ts` regression over the functions; perf tune the correlated `bool_and` (~0.6-0.9s for a full ranked query); optionally fold `contracts.contractor_name`/`awarder_name` for contractors absent from TR.
4. **Last ingestion (Feature 2)**: `first_seen_at` + an `ingest_batches(id, loaded_at)` table; loader upserts and stamps new keys with the current `batch_id`. "Last ingestion" = `WHERE batch_id = max`.
5. **Live serving**: client → Firebase Function / Cloud Run (`/api/search`, `/api/recent`) → PG. Same path later feeds the AI-chat exact-number retrieval. Bulk data stays static JSON on the bucket.
6. **Retire node:sqlite as source** once the PG path is fully verified; repoint `update-procurement` / `db:refresh` at PG. Deploy: Cloud SQL or Neon; offline ingest writes PG → generates JSON → live search/AI-chat served from PG.

## Migration hygiene

- The generators/builders are unchanged (source-agnostic) — the port only swaps the row source + serialization stays via `canonicalJson`.
- Keep the SQLite scripts until step 6 as a cross-check (run both, diff), then remove — this is a *transition* bridge, not permanent double-ingestion.
