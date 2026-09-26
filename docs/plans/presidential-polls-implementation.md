# Presidential polling implementation progress

Plan: [audit and implementation plan](presidential-polls-audit-v1.md).
User authorized the full implementation on 2026-09-26. Each step has a scoped review, repair, validation and commit gate. The five proposed additional features are included in step 12; calibrated probabilities/ratings remain deferred as the plan specifies.

## Steps

| Step | Phase | Work | State | Commit |
| --- | --- | --- | --- | --- |
| 1 | Foundations | Question model, publication metadata and acceptance validation | Complete | `f289362bf9` |
| 2 | Foundations | Reviewed candidate aliases and unresolved coverage | Complete | `15818bda70` |
| 3 | Foundations | Durable discovery and processing ledger | Complete | `1a866acdf8` |
| 4 | Foundations | Cycle assignment, validation and complete correction snapshots | In progress | |
| 5 | Foundations | Correct the accepted Global Metrics survey from source evidence | Pending | |
| 6 | Backfill | Publication inventory, historical pagination and capture | Pending | |
| 7 | Backfill | Missing agency extractors, multiple-race output and backlog reporting | Pending | |
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

## Current step files

- `docs/plans/presidential-polls-implementation.md`
- `scripts/polls/lib/presidential_cycle.ts`
- `scripts/polls/lib/presidential_cycle.test.ts`
- `scripts/polls/lib/question_validation.ts`
- `scripts/polls/lib/question_validation.test.ts`
- `scripts/polls/accept.ts`
- `scripts/polls/accept.test.ts`
- `scripts/polls/restamp.ts`
- `scripts/polls/restamp.test.ts`
- `scripts/polls/extractors/trend_presidential.ts`
- `src/data/polls/pollsTypes.ts`

## Existing work to preserve

The six news data/review files dirty at the start are outside this run. They must not be staged, modified or committed by these gates.
