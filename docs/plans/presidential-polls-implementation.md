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
| 7 | Backfill | Missing agency extractors, multiple-race output and backlog reporting | Complete | `39f72c8221` |
| 8 | Backfill | Resolve Trend historical drafts from source evidence | Complete | `89e08a8f32` |
| 9 | Backfill | Review and reconcile historical backfill, including earlier-cycle coverage | Complete | `d523e27f8c` |
| 10 | Backfill | Question/round-aware accuracy and eligibility diagnostics | Complete | `81ad176f2f` |
| 11 | Views | Agency presidential route and election campaign/result views | Complete | `99ae51fdd2` |
| 12 | Views | Historical accuracy, runoff matrix, residual/candidate trends, coverage and exports | Complete | `1dcfd1f1f0` |
| 13 | Views | Update ingestion documentation and stale comments | Complete | `aa0e08a01d` |
| 14 | Views | Route, translation, layout, accessibility and release verification | Complete | `9e0967fcbb` |

Final gate: full unit/component suite after the last step; browser checks under step 14.

## Review findings

Step 1: FINDING-001 (enum coercion) and FINDING-002 (publication date validation), both in `scripts/polls/lib/question_validation.ts`, verified and fixed. No needs-review findings. Related tests: 76 passed; changed-file lint, TypeScript and full production build passed.

Step 2: FINDING-001 (`scripts/polls/presidential/analyze_accuracy.ts`) verified and fixed: keep fixed abstention identities out of unresolved-person diagnostics. No needs-review findings. Related tests: 80 passed; changed-file lint, TypeScript and full production build passed.

Step 3: FINDING-001–004 verified and fixed in `publication_ledger.ts`, `capture.ts`, `fetch.ts`, `extract.ts` and `accept.ts`: preserve latest capture during reconciliation, retry failed rechecks, retire resolved press notices, and reserve the ledger before corpus writes. No needs-review findings. Related tests: 180 passed; changed-file lint, TypeScript and full production build passed.

Step 4: FINDING-001 (`accept.ts`) verified and fixed: validate original intended-election and fieldwork dates before cycle normalization. Malformed question metadata now reaches validation without throwing. No needs-review findings. Related tests: 130 passed; changed-file lint, TypeScript and full production build passed.

Step 5: Independent review found no issues. Source values and methodology verified against rendered PDF pages 4, 5 and 8. Related tests: 113 passed; corpus checks: 19 passed; lint and TypeScript compilation passed. Full production build passed.

Step 6: FINDING-001 (document base URLs) and FINDING-002 (full final WordPress page), both verified and fixed. Historical chart discovery also repaired from real captures. Independent re-review: no remaining findings. Related tests: 136 passed; changed-file lint, TypeScript and full production build passed.

Step 7: FINDING-001–005 verified and fixed: voting/approval table boundaries; attachment race dispatch; provisional ledger transitions; shared race suffix handling; translated duplicate signatures including runoff-only surveys. Re-review: no remaining findings. Related tests: 173 passed; changed-file lint passed. TypeScript and full production build passed.

Step 8: Independent source review found no issues. Both reviewed drafts pass the full acceptance path in a temporary corpus; 56 focused tests passed. Data/documentation-only gate; no application build required.

## Current step files

Step 9: `scripts/polls/agencies/{trend,market_links}{,.test}.ts`, `scripts/polls/{fetch,fetch.test}.ts`, `scripts/polls/lib/{capture,capture.test,text_acquisition}.ts`; accepted presidential corpus and consumed reviewed inbox drafts; publication ledger/inventory/review/reconciliation snapshots; newly captured primary sources under `raw_data/polls/{alpha_research,market_links,trend}`; `docs/polls/historical-backfill-review.md` and this tracker.

Step 9 review: FINDING-001 verified with a scratch reproduction and repaired by restricting download resource filenames to digits or a generated index. Added traversal and invalid-PDF response regression cases. Jev unavailable (DNS); independent source review and direct reproduction used. 202 related tests passed (200 focused tests plus two additional capture regressions). Changed-file lint, TypeScript and full production build passed.

## Existing work to preserve

The six news data/review files dirty at the start are outside this run. They must not be staged, modified or committed by these gates.

Step 10 review: FINDING-001–003 independently reproduced and fixed: unresolved runoff source names now suppress grades; incompatible no-candidate answers become coverage diagnostics; timestamp ties use instants. Nullable leader verdicts remain unknown in compatibility output. 139 related tests passed. Accuracy policy is documented in docs/polls/presidential-accuracy.md.

Step 10 final gate: independent re-review has zero findings; changed-file lint, TypeScript and full production build passed.

Step 11 in progress: dedicated agency presidential route, question-separated survey tables, election campaign scatter/table with agency/candidate/round controls, partial result comparisons and eligibility diagnostics, fetch error/retry, BG/EN route metadata and sitemap entries. Fifty related tests passed before final review.

Step 11 review: three verified issues repaired (question sample-size fallback, cross-round question leakage, missing prerender runoff answers). Re-review: zero findings. Sixty-four focused tests passed across the related suite and targeted repairs; changed-file lint and TypeScript passed. The locale reachability check moved three shared keys to core. BG/EN prerendered SH pages contain all four published runoff pairs.

Step 11 full production build passed.

Step 12: historical grades separated by round/denominator with counts; hypothetical and actual runoff rows; source participation answers (AR 2016 61% and 69%, TR 2021 53%); residual question series and same-question candidate margins; dated coverage, prior accepted answers, URL filters and provenance-rich CSV/JSON downloads. Three source-backed participation questions accepted using --replace, with complete prior snapshots retained.

Step 12 review FINDING-001–003: fixed coverage on empty pages, unassigned accepted counts, and distinct hypothetical-matchup residual identities/labels. Initial related suite: 139 passed; additional regressions running.

Step 12 final gate: 143 related tests passed across the suite and four added regressions. Re-review: zero findings. Changed-file lint, TypeScript and full production build passed.

Step 13: updated the polling skill through .agents/skills (the tracked .claude/skills mirror is the same symlink target), documented the durable ledger, built extractors, presidential assignment/rekey/scoring/coverage, source-review rules and date semantics. Removed stale source comments about missing commands, silent errors and component-only round state. Emitted JavaScript is byte-identical with comments stripped for all ten source files.

Step 13 final gate: independent review found no issues. All 128 related tests, changed-file lint, TypeScript and the full production build passed.

Step 14 review: TEST-001–003 verified and repaired (localized agency expectation, theme/chart coverage and runoff pair selector). Browser checks exposed implicit filter names including option text; explicit translated labels fix this. Theme-aware chart points/ticks and agency heading hierarchy repaired. Final re-review: zero findings across nine files. Seventeen related unit/component tests and all ten desktop/mobile browser checks passed. All 28 agency direct pages have titles, canonicals and sitemap entries. Full lint (three existing refresh warnings), TypeScript, production build, budget tests, AI regression/harness, function tests and production article guard passed. Generated unrelated sitemap/llms drift restored.

Final unit suite and production release are pending; browser screenshots and logs are in test-results/ and /tmp/presidential-*.

Final-suite regression repair (step 11): explicit row-header alignment; election-screen assertions now verify visible loading content and distinguish fetch errors/retry from unscored coverage. Independent review: zero findings. All 37 targeted tests passed. The initial full run also reports unrelated corpus/sitemap failures; classification and final confirmation are pending.

Final-suite regression repair 2 (steps 7/9/10/11): corpus ID validation accepts only the established race suffix and still enforces agency/fieldwork identity; committed-fixture assertions are explicit; all 28 bilingual agency prerender bodies have one escaped H1. Independent review: zero findings; 92 targeted tests and direct 28-body verification passed. Full-suite initial result and six independently reproduced unrelated failures are documented in docs/polls/presidential-final-test-results.md.

Final confirmation: 24,154 tests passed; six pre-existing failures (listed in docs/polls/presidential-final-test-results.md); 41 skipped. No polling failures remain. All ten browser checks passed again. Final repairs are committed as 89bf256c4b and 1cc73aae94. Full lint and production build passed. Six presidential artifacts uploaded and verified byte-equivalent after JSON parsing; application release in progress, reusing the artifact whose predeploy gates were all run explicitly.

## Published outcome

All 14 steps are complete and published on 2026-09-26. The six presidential data artifacts and the required public agency registry were uploaded. The live registry had nine agencies; the committed fourteen-agency registry adds GM and four existing registered agencies without changing prior entries. Both hosting releases and the db function refresh succeeded in the required order, using the validated artifact. The short-lived old registry cache expired and normal browser requests now return all fourteen agencies.

Live verification passed for BG/EN GM question-separated pages, SH 2021 history, and the 2016 round-two election view, with no browser runtime errors. Six presidential artifacts match the local accepted JSON. Four polling/election pages and a function-served person page have correct canonicals and the same current JavaScript entry bundle. All review findings are repaired; no needs-review findings remain. The six unrelated final-suite failures remain documented and unchanged.
