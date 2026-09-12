# Procurement chat — implementation and release record

Date: 2026-09-12. Implementation is local on the current branch. No production deployment, cloud migration, external model request or publication was performed.

## Delivered behavior

The screenshot question resolves to contract records, calendar 2026 and exact-one-bid share. The deterministic answer carries its numerator, both all-record and positive-known denominators, missing/zero counts, date basis, value basis, population version and revision. It no longer falls through to an all-time overview. Month ranges, comparison periods, explicit signing/deadline dates, sectors/subjects, risk predicates and follow-up scope use the same validated query through chat and the result page.

Five corpora share the closed query contract and endpoint: contracts, amendment events, announced procedures, KZK complaints and KZK acts. All 13 contract and four tender risk identifiers have defined capabilities, availability semantics and prompt coverage. Amendment events are explicitly separated from the ambiguous question “base contracts with amendments.” Healthcare clarification distinguishes the MЗ+НЗОК buyer roster from CPV medical purchases; roads distinguish АПИ from road-work subjects. This is a current institution roster, not a census of hospitals or historical sector membership.

Thirty analytical starter templates and a healthcare clarification template have bilingual text, typed arguments, year selection and per-question metadata. Typed/copied and clicked prompts are checked for canonical parity. Structured follow-ups preserve the query; one-hop linked complaints/acts use the entire parent cohort beyond its first page. Parent and child dates remain separate. Two independent questions execute separately and retain separate statuses; larger bundles require selection.

Saved answers keep their applied query. Result links re-execute it against current data, disclose revision changes, restart pagination on revision changes and export only the displayed page with scope/revision and CSV formula escaping. Open-now queries preserve their explicit timestamp; the result page provides an explicit clock refresh. API deduplication lasts only for the in-flight request. Invalid/expired query encodings, unavailable capabilities and unsupported constraints never fall back to an unfiltered execution.

## Implementation choices and boundaries

- The wire format is a closed, flat `ToolArgs`-compatible schema, with bounded arrays and an encoded one-hop parent query. Generated CJS is deployed with Functions and checked for freshness/import independence. It is the concrete replacement for the plan's nested sketch.
- Results use record identities rather than claiming deduplicated legal contracts. Contract values are current normalized EUR; signing-value fallback and missing amount coverage are disclosed. Values do not represent cash payments.
- Risk Boolean evaluation uses three-valued truth. Parent cohort coverage is deliberately conservative: every requested risk observation must be available for complete membership coverage. An unknown parent population cannot become an authoritative empty set of complaints.
- Known KZK act types and recorded outcomes are explicit filters. Coarse upheld/partial outcomes never imply full party success or final legal status. Negated or multiple coarse outcomes, excluded or multiple act types, and nested mixed Boolean expressions require clarification. Protected raw/manual outcomes are not rewritten by queries.
- Unknown geography/name resolution, bidder identity lists, historical knowledge snapshots, full/partial party-success distinctions and payment claims require clarification or an explicit unsupported response. Their absence is not hidden by dropping a filter.
- Export is a labeled page export, not a full-corpus export. URLs rerun a definition, not an immutable historical database snapshot. There is no server-side stored-query service.

## Executed verification

Final consolidated affected suite: 31 files, 2,979 passing cases and 207 pre-existing expected failures (3,186 cases total). All 31 files passed after the final parser and reviewed-link-inventory repairs. The separate two PostgreSQL fixtures also passed without skips. The acceptance specification's 160 names are requirements and test scenarios; this report does not claim a separately enumerated 160/160 run.

- Independent arithmetic fixtures cover contract records, consortium exclusion, money, one-bid denominators, risk truth tables, comparisons and KZK linkage. Two PostgreSQL integration suites executed against isolated rollback fixtures with no skips, including timestamp edges, four tender risks, act kinds, raw-data preservation, parent rows beyond limit 1 and unknown/mixed parent-risk coverage.
- Deterministic provider parity exercises Heuristic, OpenRouter and WebLLM adapters in both languages without external model calls, asserting canonical scope and numerical narration. This does not claim a live-provider/GPU smoke test.
- Full Functions Node suite: 631 passed, one unrelated live-relation-map test skipped because that sandboxed process could not reach PostgreSQL. The separately authorized required procurement data suites ran successfully against local PostgreSQL.
- Risk parity: 2,000 seeded real contracts, zero observed component/CRI/score/SPA-decoder mismatches. `shortTenderPeriod` had no available rows in that sample, so its live-data parity is unproven there; fixture and static catalog gates cover its definitions.
- Existing contract/tender risk and result-link harnesses passed. Generated query/metadata freshness, schema validation, provider routing, prompt/history/capability integration, browser pagination/retry and CSV tests are in the collected test path.
- Both application entry builds and TypeScript checks are release checks. Vite emits the existing large-chunk warnings. Main build uses `npm run build --ignore-scripts -- --outDir /tmp/procurement-release-main-build-7f39c2b` (isolated output after a shared `dist` cleanup race) to execute `tsc -b` and Vite without unrelated data-generation pre/post hooks. Component tests use jsdom; this run does not claim a manual visual browser audit.

## Local latency evidence

The reproducible read-only script is `scripts/procurement/query_release_check.ts`; its snapshot is `ai-procurement-chat-release-metrics.json` beside this file. Ten warm samples per class measured p95 of 992 ms (one-bid contracts), 454 ms (contract risk), 167 ms (tenders), 285 ms (tender risk), 22 ms (complaints) and 27 ms (acts). Three concurrent bounded queries completed in 663 ms. All warm classes met the 2-second local target.

The first contract sample took 10,865 ms including connection startup. These are local shared-machine measurements, not production p95 or controlled cold-buffer benchmarks. Serving-equivalent cold/generic-plan performance and a live-provider smoke remain deployment checks; the warm result does not establish those targets. The backend retains timeout handling and returns unavailable without retrying an expensive live fallback.

## Rollout and rollback

Apply compatible migrations 196 and 197, grant the read-only role access, refresh the tender risk projection, and verify the projection/source revision before deploying the packaged query endpoint. Loader/refresh integrations install the compatibility objects and rebuild the projection in a single SQL snapshot. Existing served rows remain available until the rebuilt revision commits.

Deploy endpoint and capability descriptor before exposing ready catalog entries. Readiness executes all five corpora and probes relevant risk capabilities; unavailable/missing old-server support removes unsupported analytical starters and preserves explicit query errors. Verify with the actual production read-only role before enabling production. No such production verification is claimed here.

`PROCUREMENT_QUERY_DISABLED=1` disables analytical execution before database access; the rollback test verifies this and capability readiness. Keep legacy unscoped discovery available, while scoped unsupported requests remain explicit. Monitor unavailable/partial responses, rejected interpretations, revision mismatches, timeouts and latency after deployment. Do not fall back to silently ignored filters.

## Review outcome

Each implementation step passed an independent named-file review and repair gate. Across steps 0–6, 35 confirmed review findings were repaired; none remains for manual review. Final review counts are zero critical, zero warnings and zero suggestions. Stabilization additionally repaired type, generated metadata and reviewed inventory mismatches before committing.

## Commit sequence

0. Semantics/fixtures — `a437a301e3`.
1. Shared query contract — `c861c9e101`.
2. Contract/amendment analytics — `07305374b3`.
3. Tender/KZK analytics — `76c3ec3756`.
4. Query understanding — `12afa50688`.
5. Product integration — `abda20841b`.
6. Release verification and final repairs — the commit containing this record.
