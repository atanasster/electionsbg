# Deployed chat verification — 2026-09-12

Production: https://naiasno.bg/chat. The main hosting release and `db(europe-west3)` deployment completed successfully. Additive migrations 196–198 and the procurement/funding projections were installed first. All nine required serving relations were verified readable by `app_readonly`; public API queries exercised the deployed application role. Funding catalog version: `1.0.0`; revision: `eed1de1831d6f7ba8544155a931c4a5b`.

## Release gates and repairs

- Repository lint, budget tests, AI harness, main/AI type checks, and the full production build passed before hosting deployment.
- AI evaluation: 743 passed plus 207 existing expected failures; regression: 2,056/2,056 checks passed. Deployment backend gates: 644 Node tests and 17 Vitest tests passed.
- `a2313353ef`: preserved exact legacy discovery prompts, corrected scoped evaluation expectations, and registered the new owned query projections in the data map.
- `d17d4ce1f6`: disabled browser/CDN caching for six revision-bound query/capability/catalog/entity routes. Public capability endpoints now return HTTP 200 with `Cache-Control: no-store`.
- `80a030f201`: repaired a production DFZ timeout found during UI testing. Annual cohorts were repeatedly materialized and spilled to temporary storage. Cheap intermediate filters are now inlined for DFZ while shared source evaluation remains materialized. The ten-second production timeout was retained.
- Complete production JSON responses matched exactly before/after optimization for annual totals and scheme ranking. Measured optimized SQL: 3,201 ms for totals, 4,881 ms for schemes; original comparison runs: 5,443 and 9,498 ms respectively. These are individual samples, not p95 guarantees.
- DFZ transactional and populated-role tests passed (2 tests), including added full-cohort pagination and scheme arithmetic assertions; 7 compiler unit tests passed. The deployment then reran the full backend gates.
- Deployment order completed: database migrations → database function → hosting → database function refresh → hosting purge. After the DFZ repair, the database function and hosting purge completed again.

## Live UI checks

Performed in the actual deployed browser UI, using visible controls, typed prompts, rendered answers and canonical result links. Counts below reflect the published snapshot at verification time.

| Check | Observed result |
|---|---|
| Original Bulgarian question: percentage of 2026 procurement contracts with one participant | 48.54%: 12,177 / 25,089, with the 2026 date window retained |
| ISUN project count, programming period 2021–2027 | 11,436; explicit programming period retained |
| Click “А само за здравеопазването?” | Theme versus institutional-register clarification appeared |
| Choose healthcare project theme | 76 projects; both theme and programme period retained |
| Click matching-records follow-up | Same 76-record cohort and canonical list query |
| Open the exact result link | Funding result page showed the same scope and 76 records |
| Next result page | Different first row; offset 20 and expected revision retained; total stayed 76 |
| Click page CSV export | Control executed without a visible error; downloaded file contents were not independently inspected |
| Interreg operations, 2021–2027 | 708 operations |
| Click Bulgarian-partners follow-up | 418 partnerships from the full parent cohort; 412/418 known amounts, explicitly partial |
| Select Interreg starter through topic menu and submit programme period | 708, matching the typed prompt; keyboard selection and parameter form verified |
| English DFZ financial-year-2025 payment prompt, after repair | €1,586,940,416.44; 230,214 records; UI time 4.7 seconds |
| Bulgarian DFZ financial-year-2025 payment prompt, after repair | Same total and population; UI time 3.8 seconds |
| Click DFZ “А по схеми?” | Same annual total; canonical query retained financial year 2025 and added scheme grouping |
| DFZ financial year 2019 | Unavailable, with requested year retained; no misleading zero or broad fallback |
| Interreg active from 04/2025 to 01/2026 | 686; overlap scope 2025-04-01 through exclusive 2026-02-01, partial coverage disclosed |
| 2025 guardrail tenders | 2 procedures; announcement-date window and guardrail topic retained |
| KZK complaints during 2025 | 1,371; complaint-date window retained |
| ISUN contracts signed during 2026 | Unsupported; did not silently drop the unsupported date scope |
| AI mode selected: ISUN 2021–2027 count | Same 11,436 through the structured deterministic path |
| AI mode: click programme-grouping follow-up | Same total and period; programme grouping added |

No browser error entries were returned in the final sampled error log. Public API spot checks also verified ISUN, DFZ, Interreg operations/partners, one-participant contracts, guardrail tenders and KZK complaints.

## Limits and remaining presentation issues

This is representative deployed UI smoke coverage, not an execution of all 100 acceptance cases in a real browser. Automated acceptance evidence remains in the separate ledger. No screen-reader audit, mobile-device matrix, concurrent production load test, or live model-generation/connectivity test is claimed. Selecting AI mode for these supported scopes correctly uses the deterministic data path.

Unavailable-data answers remain safe but their presentation needs refinement: the unsupported ISUN signing-date prompt asks generically for parameters, and missing DFZ years display `financial_year_unavailable` instead of a localized explanation. Funding starters are currently collected under “Финансирани проекти”, including DFZ and Interreg questions, rather than distributed among their dedicated subtopics. These do not change query scope or arithmetic, but remain discoverability/copy improvements.
