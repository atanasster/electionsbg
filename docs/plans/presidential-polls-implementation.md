# Presidential polling implementation progress

Plan: [audit and implementation plan](presidential-polls-audit-v1.md).
User authorized the full implementation on 2026-09-26. Each step has a scoped review, repair, validation and commit gate. The five proposed additional features are included in step 12; calibrated probabilities/ratings remain deferred as the plan specifies.

## Steps

| Step | Phase | Work | State | Commit |
| --- | --- | --- | --- | --- |
| 1 | Foundations | Question model, publication metadata and acceptance validation | Complete | `f289362bf9` |
| 2 | Foundations | Reviewed candidate aliases and unresolved coverage | Complete | `15818bda70` |
| 3 | Foundations | Durable discovery and processing ledger | Complete | `1a866acdf8` |
| 4 | Foundations | Cycle assignment, validation and complete correction snapshots | Complete | `e425fd3c34` |
| 5 | Foundations | Correct the accepted Global Metrics survey from source evidence | Complete | `03680f0540` |
| 6 | Backfill | Publication inventory, historical pagination and capture | Complete | `28abdf0e0d` |
| 7 | Backfill | Missing agency extractors, multiple-race output and backlog reporting | Complete | See step commit |
| 8 | Backfill | Resolve Trend historical drafts from source evidence | Pending | |
| 9 | Backfill | Review and reconcile historical backfill, including earlier-cycle coverage | Pending | |
| 10 | Backfill | Question/round-aware accuracy and eligibility diagnostics | Pending | |
| 11 | Views | Agency presidential route and election campaign/result views | Pending | |
| 12 | Views | Historical accuracy, runoff matrix, residual/candidate trends, coverage and exports | Pending | |
| 13 | Views | Update ingestion documentation and stale comments | Pending | |
| 14 | Views | Route, translation, layout, accessibility and release verification | Pending | |

Final gate: full unit/component suite after the last step; browser checks under step 14.

## Review findings

Step 1: FINDING-001 (enum coercion) and FINDING-002 (publication date validation), both in `scripts/polls/lib/question_validation.ts`, verified and fixed. No needs-review findings. Related tests: 76 passed; changed-file lint, TypeScript and full production build passed.

Step 2: FINDING-001 (`scripts/polls/presidential/analyze_accuracy.ts`) verified and fixed: keep fixed abstention identities out of unresolved-person diagnostics. No needs-review findings. Related tests: 80 passed; changed-file lint, TypeScript and full production build passed.

Step 3: FINDING-001–004 verified and fixed in `publication_ledger.ts`, `capture.ts`, `fetch.ts`, `extract.ts` and `accept.ts`: preserve latest capture during reconciliation, retry failed rechecks, retire resolved press notices, and reserve the ledger before corpus writes. No needs-review findings. Related tests: 180 passed; changed-file lint, TypeScript and full production build passed.

Step 4: FINDING-001 (`accept.ts`) verified and fixed: validate original intended-election and fieldwork dates before cycle normalization. Malformed question metadata now reaches validation without throwing. No needs-review findings. Related tests: 130 passed; changed-file lint, TypeScript and full production build passed.

Step 5: Independent review found no issues. Source values and methodology verified against rendered PDF pages 4, 5 and 8. Related tests: 113 passed; corpus checks: 19 passed; lint and TypeScript compilation passed. Full production build passed.

Step 6: FINDING-001 (document base URLs) and FINDING-002 (full final WordPress page), both verified and fixed. Historical chart discovery also repaired from real captures. Independent re-review: no remaining findings. Related tests: 136 passed; changed-file lint, TypeScript and full production build passed.

Step 7: FINDING-001–005 verified and fixed: voting/approval table boundaries; attachment race dispatch; provisional ledger transitions; shared race suffix handling; translated duplicate signatures including runoff-only surveys. Re-review: no remaining findings. Related tests: 173 passed; changed-file lint passed. TypeScript and full production build passed.

## Current step files

- `docs/plans/presidential-polls-implementation.md`
- `scripts/polls/accept.test.ts`
- `scripts/polls/accept.ts`
- `scripts/polls/extract.test.ts`
- `scripts/polls/extract.ts`
- `scripts/polls/extractors/alpha_research.ts`
- `scripts/polls/extractors/trend.ts`
- `scripts/polls/extractors/trend_presidential.ts`
- `scripts/polls/lib/classify_race.ts`
- `scripts/polls/lib/publication_ledger.test.ts`
- `scripts/polls/lib/publication_ledger.ts`
- `scripts/polls/lib/text_acquisition.ts`
- `state/polls/AR.json`
- `state/polls/ML.json`
- `state/polls/SH.json`
- `state/polls/TR.json`
- `.gitattributes`
- `scripts/polls/backlog.ts`
- `scripts/polls/backlog.test.ts`
- `scripts/polls/extractors/agency_presidential.ts`
- `scripts/polls/extractors/agency_presidential.test.ts`
- `scripts/polls/extractors/market_links_presidential.ts`
- `scripts/polls/extractors/market_links_presidential.test.ts`
- `scripts/polls/extractors/fixtures/market_links_2021_11_presidential.txt`
- `scripts/polls/lib/draft_identity.ts`
- `scripts/polls/lib/survey_identity.ts`
- `scripts/polls/lib/survey_identity.test.ts`
- `data/polls/_inbox/ar-2016-02-25-presidential.json`
- `data/polls/_inbox/ar-2016-10-13-presidential.json`
- `data/polls/_inbox/ar-2016-10-24-presidential.json`
- `data/polls/_inbox/ar-2016-11-10-presidential.json`
- `data/polls/_inbox/ar-2020-12-21.v2.json`
- `data/polls/_inbox/ar-2021-02-15.json`
- `data/polls/_inbox/ar-2021-03-30.v2.json`
- `data/polls/_inbox/ar-2021-06-07.json`
- `data/polls/_inbox/ar-2021-07-07.v2.json`
- `data/polls/_inbox/ar-2021-09-15-presidential.v2.json`
- `data/polls/_inbox/ar-2021-09-15.v2.json`
- `data/polls/_inbox/ar-2021-10-10-presidential.v2.json`
- `data/polls/_inbox/ar-2021-10-10.v2.json`
- `data/polls/_inbox/ar-2021-11-09-presidential.v2.json`
- `data/polls/_inbox/ar-2021-11-09.v2.json`
- `data/polls/_inbox/ar-pub-903.json`
- `data/polls/_inbox/ar-pub-904.json`
- `data/polls/_inbox/ar-pub-905-presidential.json`
- `data/polls/_inbox/ar-pub-905.json`
- `data/polls/_inbox/ar-pub-906-presidential.json`
- `data/polls/_inbox/ar-pub-906.json`
- `data/polls/_inbox/ar-pub-908.json`
- `data/polls/_inbox/ar-pub-909-presidential.json`
- `data/polls/_inbox/ar-pub-910-presidential.json`
- `data/polls/_inbox/ar-pub-912-presidential.json`
- `data/polls/_inbox/ar-pub-913.json`
- `data/polls/_inbox/ar-pub-914-presidential.json`
- `data/polls/_inbox/ar-pub-977.v2.json`
- `data/polls/_inbox/ar-pub-979.json`
- `data/polls/_inbox/ar-pub-982.json`
- `data/polls/_inbox/ar-pub-986-presidential.json`
- `data/polls/_inbox/ar-pub-986.json`
- `data/polls/_inbox/ar-pub-987-presidential.json`
- `data/polls/_inbox/ml-2021-01-31-presidential.v2.json`
- `data/polls/_inbox/ml-2021-03-25-presidential.v2.json`
- `data/polls/_inbox/ml-2021-04-23-presidential.v2.json`
- `data/polls/_inbox/ml-2021-06-25-presidential.v2.json`
- `data/polls/_inbox/ml-2021-08-22-presidential.v2.json`
- `data/polls/_inbox/ml-2021-11-07-presidential.v2.json`
- `data/polls/_inbox/ml-pub-38-presidential.json`
- `data/polls/_inbox/ml-pub-42-presidential.json`
- `data/polls/_inbox/ml-pub-43-presidential.json`
- `data/polls/_inbox/ml-pub-44-presidential.json`
- `data/polls/_inbox/ml-pub-45-presidential.json`
- `data/polls/_inbox/sh-2021-06-15-presidential.v2.json`
- `data/polls/_inbox/sh-2021-07-06-presidential.v2.json`
- `data/polls/_inbox/sh-2021-10-12-presidential.v2.json`
- `data/polls/_inbox/sh-pub-3311-presidential.json`
- `data/polls/_inbox/sh-pub-3323-presidential.json`
- `data/polls/_inbox/sh-pub-3550-presidential.v2.json`
- `data/polls/_inbox/sh-pub-3760-presidential.v2.json`
- `data/polls/_inbox/sh-pub-3772-presidential.v2.json`
- `data/polls/_inbox/sh-pub-3880-presidential.v2.json`
- `data/polls/_inbox/tr-2021-01-19.json`
- `data/polls/_inbox/tr-2021-02-19.v2.json`
- `data/polls/_inbox/tr-2021-03-14.json`
- `data/polls/_inbox/tr-2021-03-30.v2.json`
- `data/polls/_inbox/tr-2021-06-18.json`
- `data/polls/_inbox/tr-2021-07-07.json`
- `docs/polls/extraction-coverage.md`
- `state/polls/backlog.json`
- Byte-preservation correction for step 6 source captures (`.gitattributes` disables Git newline normalization).

## Existing work to preserve

The six news data/review files dirty at the start are outside this run. They must not be staged, modified or committed by these gates.
