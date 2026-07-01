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

1. **Port the generators' row source** SQLite→PG (each `db:gen-*` reads from PG; they become async). Run `db:build` against PG → verify 0-diff across all 8 layers (same acceptance gate as the SQLite proof).
2. **Verification + versioning on PG**: port `sql_roundtrip` to PG; snapshot = `pg_dump` → GCS + lockfile (`db:push`/`db:restore` PG variants).
3. **Name search (Feature 1)**: `translit_bg_latin` immutable SQL function (Streamlined System 2009) + `name_fold` generated columns + `GIN (… gin_trgm_ops)` on contracts; load **TR companies + officers into the same PG** (so officer/company search is one query); fold both stored + query → multi-token AND of trgm `ILIKE`/`similarity` → BG+EN + partial + first/last-any-order + typo-tolerant.
4. **Last ingestion (Feature 2)**: `first_seen_at` + an `ingest_batches(id, loaded_at)` table; loader upserts and stamps new keys with the current `batch_id`. "Last ingestion" = `WHERE batch_id = max`.
5. **Live serving**: client → Firebase Function / Cloud Run (`/api/search`, `/api/recent`) → PG. Same path later feeds the AI-chat exact-number retrieval. Bulk data stays static JSON on the bucket.
6. **Retire node:sqlite as source** once the PG path is fully verified; repoint `update-procurement` / `db:refresh` at PG. Deploy: Cloud SQL or Neon; offline ingest writes PG → generates JSON → live search/AI-chat served from PG.

## Migration hygiene

- The generators/builders are unchanged (source-agnostic) — the port only swaps the row source + serialization stays via `canonicalJson`.
- Keep the SQLite scripts until step 6 as a cross-check (run both, diff), then remove — this is a *transition* bridge, not permanent double-ingestion.
