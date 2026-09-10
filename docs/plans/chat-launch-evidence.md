# Chat launch evidence and execution record

Checked 2026-09-10. This records observations, not promises about untested behavior.

## Execution checklist

- [x] T0 inventory and baseline
- [x] T1 integrated screens
- [x] T2 hosted AI access and limits
- [x] T3 homepage invitation
- [x] T4 tested examples, research and screenshots
- [x] T5 bilingual article
- [x] T6 release validation and rollout preparation
- [ ] Production publication and legacy transition rollout — pending editorial approval
- [x] T7 subsequent rebranding handoff

Review report for this run: `CODE_REVIEW_REPORT_20260910-122538-chat-launch.md` (transient, never committed).

## Integration contracts

The three standalone entry screens live in `ai/main.tsx`: chat `/`, tools `/tools`, evaluation `/evals`. Main destinations are `/chat`, `/chat/tools`, `/chat/evals`, with `/en` mirrors. The main router owns language; normalize legacy `lang` parameters once and preserve question/tool parameters. The chat's initial-load effect must also handle SPA changes to `q` without re-running a question on ordinary re-renders.

Use the existing endpoint `https://ai.electionsbg.com/api/llm` for the integrated frontend. A public OPTIONS request from the old origin returned HTTP 204 with the expected CORS headers on 2026-09-10. Keep this API path outside all page redirects. This retains the AI project's secrets and single Firestore allowance ledger. The main origin's required additive CORS change is recorded in T2 below. No cross-project Hosting rewrite is required.

`functions/index.js` excludes `llm` from exports for elections-bg. Do not change this for a screen migration. Session/start/finish calls use `ai/llm/session.ts`; provider calls must use the same endpoint. Turnstile requires both the widget hostname configuration and the server-side hostname allowlist.

The main site already supplies fonts, icon assets and shared providers. AI artwork imported from `ai/assets` should be bundled normally. Evals use `fetchData` for `/ai/evals/*.json`; verify the data origin instead of copying an independent robots/sitemap into the main output.

Chat history and prompt recall are origin-local localStorage. Tokens remain in memory. An old-origin export notice is needed before page redirects; no automatic history transfer is promised. Share re-asks the final question, so article entry questions must stand alone.

Homepage insertion point is `HomeDashboardScreen`'s `HubHead` search region; `searchPreview` already holds the flyover. Keep a single search preview composition. Main entry must not import AI registries. `src/App.tsx` initializes GA once; suppress prompt-bearing page locations and referrers rather than adding standalone AI analytics.

Articles are Hosting content under `public/articles`, not GCS data. Draft metadata alone does not guarantee raw asset exclusion. Publication requires checking the packaged output as well as the visible listing.

## Policy evidence

`functions/llm_security.js` pins google/gemini-3.5-flash-lite; configured policy is 20 starts per session/day, 60 per IP/day and 3 per session/minute. Sessions expire in one hour; daily/monthly ledger keys use UTC. Reverification creates a new session id but does not clear IP or service budgets. Reserved requests may consume allowance even when completion fails. Therefore “20 questions per person per day” would be inaccurate. T2 records deployment and browser verification; production quotas were not deliberately exhausted.

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

## T1 integration verification

The main router lazily mounts chat/tools/evals with the shared header and existing providers. A navigation context adapts the retained standalone components; tool selection and area state use the host router. URL-question consumption waits for active responses and handles later SPA queries once. Legacy language parameters and trailing slashes normalize before rendering. Review's two verified routing findings were repaired with regression tests; there are no unresolved review findings.

Local browser checks: a parliamentary-seats starter produced a sourced chart in `/chat`; tools navigation rendered the catalogue; `/en/chat` reused local history with English controls; `/en/chat/evals` loaded the actual evaluation tables. Publication captures will use fresh conversations instead of reused language-switch history.

All six desktop/mobile browser checks and six static metadata checks pass. Unit checks cover 22 initial cases, the two route-normalization cases and two navigation cases; the linked-question case was repeated with the route repairs. Main and standalone AI type checks and scoped lint pass. The production main entry is 294.20 kB raw / 76.96 kB gzip (baseline 76.17 kB gzip); the 296.80 kB gzip chat chunk is lazy and raises Vite's informational chunk-size warning. No bundle budget was relaxed. The first parallel browser run exceeded the five-second cold-load expectation; a twenty-second readiness timeout and two workers passed, with navigation cases completing in two to three seconds.

Full build and postbuild passed; image optimization converted 627 images and verified references. The final active-tools guard was subsequently checked by its focused unit test and lint; deployment will use a fresh final build after the remaining tiers.

Analytics only emits mode, entry type, follow-up boolean and result class for chat interactions. Prompt/tool-state URLs disable GA collection for the rest of that document before history mutation; incoming prompt-bearing referrers also disable it. This intentionally undercounts linked-question sessions. Google's documentation confirms that `send_page_view: false` alone does not stop Enhanced Measurement history events: https://developers.google.com/analytics/devguides/collection/ga4/views. Do not remove this safeguard without verifying the property's Enhanced Measurement configuration and actual network payloads.

## T2 hosted access and policy

The integrated client retains `https://ai.electionsbg.com/api/llm`. The AI function was deployed with additive exact origins and Turnstile hostnames; the Cloudflare “Naiasno AI Chat” widget was updated without changing its key, Managed mode or no-pre-clearance setting. Main-origin preflight now returns 204 (baseline 403). The preview origin also returns 204. The same AI project and quota ledger remain in use.

The separate staging project does not provide the required DB rewrites. The isolated main-project Hosting channel is therefore `https://elections-bg--chat-launch-gu0gkopz.web.app`, initially expiring 2026-09-17. Its exact hostname is included in the server and widget lists. This avoids deploying the main DB function with an unpublished main HTML shell. Main production Hosting and DB were not deployed during T2.

Public session/day/minute constants now have one JSON source shared by the server and disclosure. The disclosure explains shared IPs, UTC renewal, one-hour sessions, budget exhaustion, interrupted requests, local origin-specific history, last-question sharing and Google Gemini processing. “No AI” no longer implies offline data access. Rejected sessions clear credentials; network failures replace stale allowance notices.

Validation: 15 security cases pass, including exact-host acceptance/lookalike rejection and shared IP allowance across renewed sessions; 2 client session cases pass (expiry, invalid credentials and stale-error replacement); 2 controlled verification UI cases pass (expiry/retry and closing during a pending request); full functions suite passes 613 tests with 1 skipped plus 17 Vitest cases. Standalone AI typecheck and scoped lint pass. Source review found no actionable issues.

The full T2 build passed. For review, a reduced package copied its exact assets, fonts, icons and six chat HTML pages into the isolated channel, retaining existing API rewrites and adding `X-Robots-Tag: noindex, nofollow`. No full production release occurred. Initial real-browser data fetches exposed the bucket's missing preview origin; the deployed CORS policy was read and preserved, including two news origins absent from the local file, then the exact preview origin was added for GET/HEAD. A fresh browser subsequently returned the sourced 240-seat chart. The legacy chat also still returned that chart. Browser-cached pre-change CORS responses took longer to clear than a fresh context.

Real Managed Turnstile verification passed in Chrome and the in-app browser, including reverification after reload. A real Gemini 3.5 Flash-Lite call completed in 3.2 seconds with a sourced seat chart. Its narration placed vote percentages next to seat counts without a clear label and inferred a governing majority; this response is **not approved for article use**. Selected article examples must be independently checked in T4. Expiry and cancellation are covered by controlled UI/session tests; live verification completed automatically before the attempted manual cancellation.

The selected production environment explicitly sets `VITE_DB_API_ORIGIN=https://electionsbg.com`. The main-only lazy chat entry now overrides this to same-origin before mounting; standalone keeps the environment configuration. This prevents cross-origin DB requests on previews and the later domain. The regression verifies destination switching and cache invalidation (1 case); the existing data-cache and entry-graph checks pass (15 cases). Final full build/postbuild, AI typecheck, scoped lint and all 12 desktop/mobile/metadata browser cases pass. The refreshed preview answered “Какви са цените в Пловдив?” in No AI mode; both price-payload requests returned HTTP 200 JSON from the preview's own origin. Source review remained at zero actionable findings.

## T3 homepage invitation

The compact invitation sits immediately below the search hint and preserves the flyover. It links to chat plus self-contained price, budget and parliamentary-seat questions in both languages. The main footer now links to integrated `/chat`. A small publication flag keeps the invitation development-only until the article is reviewed; the article link is absent until publication. Aggregate click events carry only entry type and starter id, never prompt text.

The built-in imagegen illustration is symbolic rather than a numerical example. Its retained original, optimized derivative and prompt are in `chat-launch-assets/`; the page consumes a 20,474-byte 720 × 480 WebP with explicit display dimensions and decorative alt text. Headline and links are HTML. Desktop and narrow dark-mode review captures are saved alongside the original.

Measured in both BG/EN, light/dark at 1280px: header 516.625px against the unchanged 520px budget; four KPI cells remain. At 320px there is no horizontal overflow. Every invitation link is at least 44 × 44px. Text contrast: title 12.20:1 light / 15.50:1 dark; subtitle 4.52:1 / 7.61:1; starter 12.74:1 / 13.79:1. Keyboard focus has a 2px solid ring with minimum 3.00:1 light / 9.36:1 dark contrast against adjoining surfaces.

Six BG/EN starter URLs were exercised against the hosted preview. Semantic inspection found that English “prices” matched the unbounded rice alias. The alias is now word-bounded; three overview regressions and one explicit-rice preservation case pass, and the corrected English development answer returns the full city basket. Local and hosted price values differ, so publication captures must use the hosted data and record its observation date. Budget and seats returned their expected scoped answers in both languages. Eleven focused tests pass, plus the non-AI suite (731 passed / 213 expected failures out of 944) and all 1,828 regression cases. These counts measure routing behavior, not factual answer accuracy. The full build/postbuild and main/AI typechecks passed. The refreshed hosted English link now returns the eight-product city basket rather than rice. Five initial performance checks passed; the remaining preload check exposed a parser mismatch with Vite’s namespace-selector wrapper. The parser now accepts that emitted form while retaining exact route names and adjacent dependency lists. Its new collision/missing-route fixture and all three real preload checks pass; no budget or forbidden dependency was relaxed. Scoped lint, diff checks and tier review pass with no outstanding findings.

## T4 examples, research and figures

Three everyday examples (Plovdiv prices, state budget, dated parliamentary seats), two deeper examples (2025 guardrail tenders with an actual detail follow-up, section 050900092 election history), and a missing-2027-budget example completed in both languages on the refreshed preview. Exact questions, arguments, envelopes, narration, dates, links and caveats are retained in `chat-launch-assets/examples.json`. Price observation date is 2026-09-08; budget execution ends 2026-07-31; seats are the 2026-04-19 allocation. The budget's balance reconciles after subtracting the EU contribution; seat counts sum to 240. Tender estimated value and six lots match the served detail. These checks verify UI-to-payload agreement, not the entire upstream corpus.

A real verified AI budget explanation matched its period and figures. The earlier AI seat narration remains excluded. Far-future free-text questions exposed routing limits and are documented as excluded trials. The 2027 budget example explicitly reports missing data in its subtitle while showing 2026; the article must explain that behavior rather than present the fallback as a future budget.

Four bilingual main figures use original preview screenshots with separate numbered HTML gutter annotations and captions, preserving all screenshot pixels. Supporting screenshots include the deeper and missing-data cases. `chat-launch-assets/review.html` is the local visual review composition; T5 will reuse its annotation data in the article.

Competitor checks used primary documentation and anonymous public interfaces. ChatGPT completed four small tasks, Data Commons provided sourced charts but did not resolve the short fragment or future-observation query, and Perplexity asked for sign-up before answering. СИГМА's public procurement site and official launch announcement were inspected; its assistant is documented in a design specification, not certified as a live tested feature. Detailed observations and limits are in `chat-launch-assets/research.md`; no accuracy ranking is claimed.

T4 review identified two figure issues: full-resolution links are now provided for narrow-screen reading, and the price-map watermark captures are explicitly excluded from publication. Only the four selected, watermark-free figures will enter the article. Capture-script syntax and diff checks pass.

## T5 bilingual draft and publication safeguards

The launch draft uses the stable `2026-09-10-popitai-naiasno` slug, about 1,500 Bulgarian words and a faithful English counterpart. Its six self-contained question links reproduce the T4 manifest. Four figures retain the original pixels and use translated HTML annotations, alt text and explicit full-size links. The static article renderer also includes the captions. The excluded price maps are not public article assets.

`VITE_CHAT_LAUNCH_PREVIEW=true` exposes only this draft and the invitation on the isolated preview build. Normal builds remove every draft Markdown body and the launch draft's declared dedicated image directory from `dist`; source files remain intact. Packaging rejects a draft asset directory shared by a visible article. A hidden build manifest records the preview state, and an unconditional main Hosting predeploy check rejects preview artifacts even when routine predeploy checks are skipped. The invitation publication flag and article draft status must agree.

Article-body fetching now waits for visible metadata, preventing a hidden draft or unknown slug from rendering a raw SPA fallback. Prerender checks confirm normal exclusion, four bilingual annotated figures, one H1 and preserved English prompt URLs; packaging checks cover exclusion, shared assets, preview rejection and reintroduced draft bodies. Local browser checks at 1280px and 390px confirm one H1, four figures, six correct prompt links, no horizontal overflow and a working final invitation/article link in both languages. Main typecheck and scoped lint pass. The full preview build/postbuild passed, including 635 optimized images and the dangling-reference gate. The final optimized BG/EN articles pass desktop/390px checks: four visible figures, one visible H1, six correctly localized question links, no horizontal overflow, and complete image loads. Static HTML has one H1, correct canonicals and WebP references; the preview sends noindex. Desktop homepage height remains 516.625px. Five final entry/preload/HTML performance checks pass. Full lint passes with one pre-existing InterregTile fast-refresh warning; the budget suite and AI harness pass. Four packaging and four renderer cases pass, and the real preview artifact is rejected by the production guard. The preview expires 2026-09-17 unless refreshed. Source review and repair verification found no outstanding issues.

A further real English Gemini 3.5 Flash-Lite budget question completed after normal Turnstile reverification: 2.8 seconds, 12,224 input / 140 output tokens, correct 2026-07-31 period and matching rounded figures. An expired session first returned an explicitly labelled No AI answer and renewal notice. This independently confirms the mode/fallback disclosure; the article retains its narrower Bulgarian-test wording.

## T6 release preparation and legacy recovery

The standalone entry now has a bilingual move/export notice, a noindex `/legacy-export` HTML route using the same browser-local conversation key, and an intentional unknown-page recovery fallback. Its former GA initialization is removed. The integrated entry does not import this wrapper. The legacy frontend must remain available while the recovery route depends on it.

Five explicit permanent page rules are retained as a candidate JSON file, not activated in live Hosting. A real one-day isolated Hosting proof preserved question punctuation, JSON arguments, language and area; the local emulator's double-encoded question mark is caught by the probe regression. The proof used static API/recovery fixtures, not real AI calls. Actual live AI API behavior remains covered by T2/T4/T5 and must be rechecked after any eventual redirect rollout.

`chat-launch-release.md` records live rollback versions, the complete editorial review links, the main Hosting → DB → Hosting order, a proposed minimum 14-day transition, distinct cached-redirect recovery, and sanitized manual observation. Production article/promotion, legacy notice deployment and permanent redirects remain pending the plan's complete rendered editorial review and subsequent gates. No domain change or automation has occurred.

Standalone typecheck/build and strict output packaging pass after resolving a macOS filename-case collision. Seven route/asset unit cases and two redirect-probe cases pass. Browser recovery passes in BG/EN at 1280px and 390px: task-owned saved conversation preserved, downloaded Markdown includes the answer, English PDF has a valid PDF header, migration links retain language, no horizontal overflow, composer reachable. The emitted recovery HTML has one noindex directive and its own canonical. Scoped lint and source/repair review pass with zero findings. The complete main build, required functions suites, AI harness/non-AI regression, integrated browser and entry-performance evidence are recorded in T1–T5; no unverified production rollout is claimed.


## T7 subsequent domain handoff

`chat-launch-rebrand-handoff.md` preserves all six screen paths and the bilingual article slug, identifies additive origins/Turnstile capacity work, retains the existing AI quota ledger, and coordinates canonical/static-origin checks with the broader rebrand. It explicitly requires a second recovery route on electionsbg.com before that origin is redirected: the old AI-origin recovery cannot read main-origin history. Final-domain redirects must be re-proven with query state and avoid chains. Domain configuration, DNS, publication and recurring monitoring were not performed.


## Editorial revision: shared site preferences and local toolbar

User review requested removal of the integrated chat logo, theme/language controls and other standalone toolbar items. Chat, tools and evaluation now share one sticky 48px local toolbar containing only New chat, Tools and Accuracy. Site preferences supply language/theme; all integrated standalone headers/footers are suppressed. Conversation sharing/export and memory remain in the conversation area. New chat clears the saved conversation and linked question while retaining explicit area context; toolbar view changes preserve area without copying old question/tool arguments.

Browser checks confirm BG/EN labels and navigation across all three screens at 1280px/320px, no horizontal overflow, and a sticky evaluation toolbar. Changing language and dark theme through the site's own menu updates all three screens without duplicate controls. Eight article figures were recaptured from the actual revised UI with live hosted public data; narration and envelopes exactly match the prior evidence. Source review found area preservation and a residual evaluation footer; both were verified and repaired with regression coverage. A linked-question reset regression also exposed a router-transition race: New chat now unmounts the old conversation and waits for its question-free target URL before remounting, preventing accidental re-asking. Six desktop/mobile browser cases pass locally and on the refreshed hosted preview. The hosted site-menu language/theme check passes across all three screens after allowing the language-menu transition to settle. Six focused toolbar/renderer cases, four packaging cases, AI typecheck, scoped lint and five final homepage/entry performance checks pass. The complete preview build/postbuild and image-reference gate pass; BG/EN desktop/mobile article checks confirm all four figures, six prompt links and no overflow. Source/repair review has zero outstanding findings. The revised preview is deployed; production publication remains gated.
