# Presidential polling implementation progress

Plan: [audit and implementation plan](presidential-polls-audit-v1.md).
User authorized the full implementation on 2026-09-26. Each step has a scoped review, repair, validation and commit gate. The five proposed additional features are included in step 12; calibrated probabilities/ratings remain deferred as the plan specifies.

## Steps

| Step | Phase | Work | State | Commit |
| --- | --- | --- | --- | --- |
| 1 | Foundations | Question model, publication metadata and acceptance validation | Complete | `f289362bf9` |
| 2 | Foundations | Reviewed candidate aliases and unresolved coverage | In progress | |
| 3 | Foundations | Durable discovery and processing ledger | Pending | |
| 4 | Foundations | Cycle assignment, validation and complete correction snapshots | Pending | |
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

## Current step files

- `docs/plans/presidential-polls-implementation.md`
- `src/data/polls/pollsTypes.ts`
- `scripts/polls/presidential/candidate_resolver.ts`
- `scripts/polls/presidential/candidate_resolver.test.ts`
- `scripts/polls/presidential/analyze_accuracy.ts`
- `scripts/polls/presidential/analyze_accuracy.test.ts`
- `scripts/polls/presidential/rekey.ts`
- `scripts/polls/extractors/trend_presidential.ts`
- `scripts/polls/extractors/trend_presidential.test.ts`

## Existing work to preserve

The six news data/review files dirty at the start are outside this run. They must not be staged, modified or committed by these gates.
