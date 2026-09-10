# Chat launch evidence and execution record

Checked 2026-09-10. This records observations, not promises about untested behavior.

## Execution checklist

- [x] T0 inventory and baseline
- [ ] T1 integrated screens
- [ ] T2 hosted AI access and limits
- [ ] T3 homepage invitation
- [ ] T4 tested examples, research and screenshots
- [ ] T5 bilingual article
- [ ] T6 release validation and rollout
- [ ] T7 subsequent rebranding handoff

Review report for this run: `CODE_REVIEW_REPORT_20260910-122538-chat-launch.md` (transient, never committed).

## Integration contracts

The three standalone entry screens live in `ai/main.tsx`: chat `/`, tools `/tools`, evaluation `/evals`. Main destinations are `/chat`, `/chat/tools`, `/chat/evals`, with `/en` mirrors. The main router owns language; normalize legacy `lang` parameters once and preserve question/tool parameters. The chat's initial-load effect must also handle SPA changes to `q` without re-running a question on ordinary re-renders.

Use the existing endpoint `https://ai.electionsbg.com/api/llm` for the integrated frontend. A public OPTIONS request from the old origin returned HTTP 204 with the expected CORS headers on 2026-09-10. Keep this API path outside all page redirects. This retains the AI project's secrets and single Firestore allowance ledger. The main origin still needs an additive CORS allowlist change. No cross-project Hosting rewrite is required.

`functions/index.js` excludes `llm` from exports for elections-bg. Do not change this for a screen migration. Session/start/finish calls use `ai/llm/session.ts`; provider calls must use the same endpoint. Turnstile requires both the widget hostname configuration and the server-side hostname allowlist.

The main site already supplies fonts, icon assets and shared providers. AI artwork imported from `ai/assets` should be bundled normally. Evals use `fetchData` for `/ai/evals/*.json`; verify the data origin instead of copying an independent robots/sitemap into the main output.

Chat history and prompt recall are origin-local localStorage. Tokens remain in memory. An old-origin export notice is needed before page redirects; no automatic history transfer is promised. Share re-asks the final question, so article entry questions must stand alone.

Homepage insertion point is `HomeDashboardScreen`'s `HubHead` search region; `searchPreview` already holds the flyover. Keep a single search preview composition. Main entry must not import AI registries. `src/App.tsx` initializes GA once; suppress prompt-bearing page locations and referrers rather than adding standalone AI analytics.

Articles are Hosting content under `public/articles`, not GCS data. Draft metadata alone does not guarantee raw asset exclusion. Publication requires checking the packaged output as well as the visible listing.

## Policy evidence

`functions/llm_security.js` pins google/gemini-3.5-flash-lite; configured policy is 20 starts per session/day, 60 per IP/day and 3 per session/minute. Sessions expire in one hour; daily/monthly ledger keys use UTC. Reverification creates a new session id but does not clear IP or service budgets. Reserved requests may consume allowance even when completion fails. Therefore “20 questions per person per day” would be inaccurate. Deployment and live policy parity remain to verify.

Non-AI routing baseline: `docs/plans/non-ai-evals-2026-09-10.md` records 729/942 expected prompt routes and 213 known gaps. These are routing/argument results, not end-to-end factual accuracy. Structured catalogue questions and free-text equivalents must be tested separately.

## Initial source matrix

| Claim | Evidence | Status |
| --- | --- | --- |
| Наясно offers guided questions across 18 category labels | `ai/app/starterCategories.json`, `starterPrompts.json` | Catalogue inspected; individual examples need execution |
| Cloud mode sends questions/context for processing | `ai/app/ModelPicker.tsx`, `ai/llm/openrouter.ts` | Implementation inspected |
| СИГМА documents a Bulgarian procurement AI assistant | https://github.com/midt-bg/sigma/blob/main/docs/spec/ai-assistant.md | Documentation inspected; public chat not tested |
| СИГМА serves procurement exploration | https://sigma.midt.bg | Public page inspected |
| Data Commons maps language to sourced statistics | https://www.datacommons.org/faq | Publisher documentation inspected |
| Perplexity supports web research and follow-ups | https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work | Publisher documentation inspected |
| ChatGPT search provides source access | https://help.openai.com/en/articles/9237897 | Publisher documentation inspected |
| OpenTender covers Bulgarian procurement | https://data.open-contracting.org/en/publication/44 | OCP registry inspected; units differ from our corpus |
| BIRD describes declaration search | https://bird.bg/judicial-money/ | Publisher article inspected |

No competitive accuracy ranking has been measured. Refresh this matrix and run the selected examples before publication.

## Baseline and validation record

The live chat was visually inspected before implementation: fixed header/composer, a table answer with period/source and follow-up chips, topic selectors, mode picker and share/export actions. Fresh task-owned homepage and empty-chat browser captures were taken on 2026-09-10 at desktop and 390 × 844 viewport sizes. The homepage places its flyover alongside search on desktop and below search on mobile. The browser's mobile chat capture was scaled unexpectedly; repeat that capture before using it as a publication asset. These tool-session captures are inspection evidence, not the final annotated article files.

Single public HTTP samples before frontend changes: homepage HTTP 200, 12,613 response bytes, 0.243497 s TTFB / 0.252114 s total; standalone chat HTTP 200, 6,002 bytes, 0.158078 s TTFB / 0.163715 s total. These are HTML transfer measurements, not browser LCP/CLS or a statistical performance benchmark. Main-origin OPTIONS to the AI endpoint returned 403, confirming the migration needs the additive CORS change.

Baseline TypeScript project check passed (`npx tsc -b`), as did six entry-graph tests, four PollsScreen tests and the tool-schema harness. Baseline lint found five formatting errors and one overly broad import restriction: repaired formatting and documented the safe QueryProvider exception; also corrected the map memo dependency warning. Scoped lint now passes. The unrelated InterregTile fast-refresh export warning remains informational. Review found zero actionable defects in the six scoped files.

Baseline main entry: `index-BHgPbUKm.js`, 292.05 kB raw / 76.17 kB gzip; Vite transformed 5,501 modules and built in 1m 56s. Postbuild emitted 91,559 routes plus 62,455 English mirrors. These artifact measurements will be compared after integration.

Full `npm run build` completed successfully, including postbuild image optimization. Initial sandbox execution could not create tsx's IPC pipe; the approved unsandboxed build completed normally.

The catalogue's 18 families are elections; parliament/government; budget/taxes; procurement; companies/interests/assets; EU funds/agriculture; prices/household spending; economy/work; healthcare; pensions/social support; education; population/my area; justice/security; energy; water/environment; transport/housing; culture/tourism; media/public attitudes. Their presence is not a guarantee that arbitrary questions in each family are supported. Select publication examples against actual tool outputs in T4.

Storage inventory: `naiasno.chat.v1`, `naiasno.chat.history.v1`, `naiasno.tools.recent.v1`, `naiasno.model.v1`. JSON tools use VITE_DATA_BASE_URL; DB tools use VITE_DB_API_ORIGIN (same-origin on the main site). Preserve these seams and check returned content types after migration.
