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
2. ~~**Verification + versioning on PG**~~ **SHIPPED (Phase 4e, `b24efe79d`).** `sql_roundtrip`→`pg_roundtrip.data.test.ts` (lossless capture + headline reconciliation on PG). `db:dump`/`db:restore` use `pg_dump -Fc`/`pg_restore` (via the container); lockfile carries contracts + TR counts; round-trip verified (dump→restore → 301,015 contracts + 1,016,585 TR companies intact). `snapshot=null` until a real (operator-triggered) GCS upload.
3. **Name search (Feature 1)** — **DB side SHIPPED (Phase 4c, `c78b9bd9d`).** `translit_bg_latin` (immutable, Streamlined System 2009, both Cyrillic cases → collation-independent) + `immutable_unaccent` in `000_search_fns.sql`; `tr_companies` + `tr_officers` (deduped, `name_fold` generated + GIN trgm) in `003_tr_search.sql`, loaded by `load_tr_pg.ts` (`db:load:tr:pg`, 1.02M + 627k rows in ~24s); `search_companies` / `search_officers` in `004_search_api.sql` (token `<%` word-match, `word_similarity` rank, function-local trgm thresholds, each hit carries its procurement summary). Proven across BG/EN, partial, fuzzy, any-order, officer→company. **Perf-tuned** (`254362f4f`): index-usable `qf <% name_fold` candidate filter before the strict `bool_and` → parallel seq scan (596ms) becomes a GIN bitmap scan; лукойл 744→18ms, avtotrans 928→120ms, all sub-250ms. **Regression test** `scripts/db/tests/search.data.test.ts` (in `test:data`, auto-skips without PG). **contractor_search** (`d5b5a3d1d`, `006_contractor_search.sql`): contract-derived index + `search_contractors(q)` so the 32% of contractor EIKs absent from TR (foreign firms, placeholders) are findable by name. **Remaining:** serving endpoint (Firebase Fn / Cloud Run → these functions) + the frontend search UI — needs a deployed PG (Cloud SQL / Neon).
4. **Last ingestion (Feature 2)** — **SHIPPED (Phase 4d, `e0d24ede5`).** `005_ingest_tracking.sql`: `ingest_batches` + `contract_first_seen` (side table, so the hot contracts load stays TRUNCATE+bulk — generators untouched) + `last_ingested_contracts(lim)`. `load_pg.ts` opens a batch and records first-seen via `INSERT … SELECT … ON CONFLICT DO NOTHING`; `rows_new` = the delta. Proven 301015→0→3. Remaining: same for TR loads if wanted; a serving endpoint (`/api/recent`).
5. **Live serving**: client → Firebase Function / Cloud Run (`/api/search`, `/api/recent`) → PG. Same path later feeds the AI-chat exact-number retrieval. Bulk data stays static JSON on the bucket.
6. ~~**Retire node:sqlite as source**~~ **SHIPPED (Phase 4e, `b24efe79d`).** Deleted `load_procurement.ts`, `migrate.ts`, `lib/open.ts`, `schema/001_procurement.sql`; `db:refresh` → `db:pg:up && db:load:pg && test:data` (`db:load` removed); the dev SQL browser no longer hard-requires `procurement.sqlite` (reads whatever `raw_data/*.sqlite` remain). **Remaining:** repoint the `update-procurement` skill's refresh hook at PG (still calls `db:refresh`, which now loads PG — verify the watcher env has Docker up); deploy Cloud SQL / Neon; wire live serving (step 5).

## Still open

- **Live serving (step 5)** — the only thing between the DB-side features and users. Needs a deployed Postgres (Cloud SQL / Neon) + `/api/search` + `/api/recent` (Firebase Fn / Cloud Run) + a frontend search UI.
- **Deferred outward triggers** (operator-run): `db:build --write` flip + `bucket:sync`; real `db:dump` GCS upload.

## Bulk loading: use `copyRows`, not multi-row INSERT

`scripts/db/lib/copy.ts` exports `copyRows(client, table, cols, rows)` — a streamed `COPY … FROM STDIN`. **Any loader whose table exceeds ~100k rows should use it**; the smaller ones (`load_funds_pg.ts`, `load_nzok_hospital_pg.ts`, `load_awarder_seats_pg.ts`) still build multi-row INSERTs and that is fine at their size.

Why: a multi-row INSERT binds every value as a parameter, caps at PG's 65535 params per statement (forcing ~6k-row chunks), and pays per-row executor overhead. The three big loaders `TRUNCATE` + re-ship their whole table every run, so cost tracks table size, not churn — and over the Cloud SQL proxy each `db:load:*:cloud` took ~30 min. Measured after the switch: TR 105.1s → 74.1s, tenders 23.1s, contracts 69.1s locally; the proxy win is larger because both round trips and bytes shrink.

Two things to know before touching it:

- **Text format, not CSV.** In CSV an unquoted empty field is indistinguishable from NULL. These tables have nullable text columns where `""` and NULL are genuinely different values, and the INSERT path preserved that; text format spells NULL as `\N`.
- **`rows` is an `Iterable`.** Pass a generator (`function* () { for (const r of src) yield toRow(r) }`) so the encoded rows never form a second copy of the corpus beside the source array. `copyRows` returns the row count the *server* confirms and throws on a mismatch.

Correctness is pinned by `scripts/db/tests/copy.data.test.ts` (under `npm run test:data`), which covers the cases that corrupt silently rather than throw: a literal `\N`, `""` vs NULL, embedded tab/newline/CR, backslash doubling, `-0`/NaN/Infinity, jsonb, and integer `0/1` into a boolean column. **When changing a loader, capture `md5(string_agg(t::text,'|' order by <pk>))` per table before and after** — that digest parity is how the COPY switch was verified across 3.5M rows.

## Done since

- **Dev SQL browser repointed to Postgres** (`42e96d9be`): `vite/sql-browser.ts` uses the pg pool (schema from `pg_catalog`, read-only tx + cursor cap); `/dev/sql` inspects the real source (contracts + tr_* + contractor_search + tracking, native cross-domain joins). Deleted the unused `procurement.sqlite` (kept `tr/state.sqlite` — it feeds `db:load:tr:pg`).
- **Multi-table query builders** (`23af52592`, `007_query_builders.sql`): `search_all(q, lim)` — one ranked feed across TR companies + officers + non-TR contractors (LIMIT-then-summarize so the procurement subqueries run only for the top rows); `recent_updates(days=1, lim)` — contracts first-seen + TR companies (`last_updated`) + TR officers (`changed_at`) changed in the last N days, newest first. TR timestamps carried into `tr_companies.last_updated` / `tr_officers.changed_at` (indexed). Browser samples added.
- **Result-cell hyperlinks** (`b5e0ee855`): `/dev/sql` eik/name cells deep-link to `/company`, `/awarder`, and the person page; the people scanner reads `?q=`.
- **DB-backed person page** (`5484c57bf`, first live consumer of the serving path): `008_connections.sql` — `company_politicians` (curated links from mp/pep_connected, loaded into PG) + `person_profile` / `person_politicians` / `connection_between` (exact `name_fold` match). Dev serving via `vite/db-api.ts` (`/__db/{person,connection,person-search}`, `apply:'serve'` — the seam a Cloud Function later fills). Screen `src/screens/dev/PersonScreen.tsx` at DEV-gated `/person/:name`: companies (+procurement), political connections, and an "add any name → shared companies" custom-connection check. Works for ANY TR officer (not just the political class the JSON scanner covers).
