# Наясно chat migration and launch article

Status: implementation and release preparation complete; verified editorial preview is ready. Production publication/legacy rollout await the complete rendered editorial approval and release gates. Execution evidence: `chat-launch-evidence.md`; release runbook: `chat-launch-release.md`; later-domain handoff: `chat-launch-rebrand-handoff.md`.
Date: 2026-09-10.

## 1. Outcome and agreed direction

Launch the existing chat as an integrated part of electionsbg.com shortly before the move to naiasno.bg. Migrate all three public AI screens, introduce a prominent homepage invitation below search, and publish an illustrated Bulgarian launch article with an English counterpart. The primary audience is ordinary citizens; include a few deeper examples for journalists and researchers. Name comparable tools, including СИГМА's documented AI assistant, with dated evidence and a clear distinction between announced and tested capabilities.

The launch destination is `/chat`, later retained unchanged on naiasno.bg. Brand the invitation **Попитай Наясно**. Keep the existing data tools and chat behavior; this is an integration and communication project, not a model replacement or a rewrite of the data layer.

Done means a visitor can enter from the homepage or article, ask a supported question, inspect its evidence, continue the conversation, and return to a main-site dashboard. Existing external links continue to resolve. All illustrated examples reproduce on the deployed experience. Publication is a later execution step; this plan does not itself deploy anything.

## 2. Repository findings that constrain implementation

- `ai/main.tsx` mounts chat, tools and evals in an independent React root with its own providers and analytics. `ai/App.tsx` owns a fixed-height shell and its own language state.
- `src/routes.tsx` owns main-site routes. Integrating the screens must not mount a second React root or duplicate global providers, analytics, headers or footers.
- `ai/app/explorer/urlState.ts` and `workspace.ts` emit root-relative `/tools` and `/` navigation. Audit the full AI tree, including evaluation links, downloads and static assets, before changing the base path.
- Chat reads `?q=` and automatically asks it on initial load. Tools links carry `v`, `tool`, JSON `args`, `lang` and optional `area`. Preserve these contracts and validation.
- Share currently re-asks only the last question. It does not preserve the answer or entire conversation. Context-dependent final questions are not valid standalone article links.
- Chat and prompt history live in localStorage. Storage cannot be read across origins; moving screens does not migrate saved conversations automatically. AI session tokens are memory-only and require fresh verification.
- `.firebaserc` separates `elections-bg` and `electionsbg-ai`. The LLM function, Firestore quota ledger and secrets currently belong to the AI project. `functions/index.js` explicitly does not export `llm` in `elections-bg`.
- Main-site origin is absent from the current AI origin allowlist and the default Turnstile hostname list. A frontend-only move would leave hosted AI unusable.
- `vite.config.ai.ts` builds `dist-ai`, including SEO and required public assets. Main build must inherit required assets without copying the standalone HTML, robots, sitemap or analytics wholesale.
- Homepage search is in `HomeDashboardScreen.tsx`'s `HubHead`; its `searchPreview` already contains `HomeFlyoverSlot`. The promotion must coexist with this preview and respect the existing header height and performance gates.
- Articles already use `public/articles/index.json`, bilingual Markdown bodies, same-origin images, `ArticleScreen` and build-time prerendering. Use that pipeline.
- `draft: true` hides an article from production runtime/prerender listings, but do not assume it prevents raw Markdown/assets from being packaged in Hosting. Inspect packaging before treating a draft as inaccessible.
- `docs/plans/non-ai-evals-2026-09-10.md` records 213 known gaps among 942 bilingual routing checks. Its metrics measure tool/argument routing, not full answer accuracy. Do not market free-form or follow-up support as universal.

## 3. Route, language and deployment decisions

### Public routes

| Existing AI URL | Main-site destination |
| --- | --- |
| `/` | `/chat` |
| `/tools` | `/chat/tools` |
| `/evals` | `/chat/evals` |

Use the main site's `/en` convention for English equivalents. Accept legacy `?lang=en|bg` links and normalize once to the corresponding language route, preserving all functional parameters. An explicit legacy language parameter wins during that normalization; otherwise use the path language. Verify switching language and browser Back/Forward maintain the correct screen and tool state.

Use one import-light path/link module for app navigation and prompt URLs. It must not import the tool registry into the homepage or main entry bundle. Canonical URLs omit trailing slashes, following repository rules.

### Backend: retain the existing AI service for this launch

Preferred implementation: keep the LLM function, quota storage and secrets in `electionsbg-ai`; configure the integrated frontend to use a verified, stable HTTPS endpoint for that service. Inspect the deployed function URL and any existing `VITE_LLM_PROXY_URL` override rather than guessing it. Add the exact main/staging origins to CORS and the required hostnames to both Turnstile configuration and server verification. Preserve the old origin during transition.

Do not assume a main-project Firebase Hosting rewrite can target a different project's function. Use the existing CORS-capable HTTP handler directly, subject to an end-to-end staging proof. Restrict the old host's page redirects to page routes so `/api/llm` remains operational if used as the stable endpoint. Check CSP/connect-src, preflight, response cache headers and all session/start/completion/finish calls.

If direct access cannot meet these requirements, stop at the architecture gate and specify a same-origin forwarding endpoint that preserves abuse controls and client-IP semantics. Do not silently create a second quota ledger or move secrets into the frontend. Backend relocation is a separately scoped fallback, not a prerequisite inferred from moving screens.

### Saved conversations and legacy site

Provide a short transition period before permanent page redirects. On the old host, offer the existing conversation export and a clear move link. Explain that old browser history remains on that origin and does not transfer automatically. No new server-side conversation storage or automatic cross-origin transfer is required.

Keep a discoverable legacy export page available during the agreed transition, then enable explicit permanent page redirects after the integrated experience passes launch checks. Test actual query-string preservation for both text questions and tools JSON; do not assume Hosting behavior. Unknown legacy paths should produce an intentional fallback/404, not an invented destination. Keep old API routes and rollback artifacts available.

## 4. Tier 0 — inventory, evidence and baseline

- [x] Inventory all public routes, hard-coded origins, assets, API/data origins, storage keys, language behavior, entry providers, analytics and deployment scripts. Include `ai/`, `src/`, `functions/`, `vite/`, prerender and Hosting configuration.
- [x] Record desktop/mobile baseline screenshots and homepage/chat performance before changes. Use clean, task-owned conversations for publication captures.
- [x] Verify current hosted AI model, actual limit behavior, reset clock, session renewal, service budget behavior and error messages. Record settings without copying secrets.
- [x] Establish a list of supported question families from the tool/starter catalogue and their real sources, periods and known gaps. Avoid equating site-wide data availability with chat access.
- [x] Create an evidence matrix for article claims and competitors: claim, source URL, checked date, announced/documented/tested status, result and caveat.

Gate: resolve the backend endpoint and language contracts; retain baseline measurements. No domain/DNS migration or corpus reload is required.

## 5. Tier 1 — integrate chat, tools and eval screens

- [x] Introduce lazy main-site routes for all three screens and English mirrors. Reuse existing query/theme/tooltip/language providers.
- [x] Adapt the chat shell to main-site navigation with a spacious conversation area and visible return links. Per editorial review, use only the site logo/theme/language controls and a sticky local toolbar for New chat, Tools and Accuracy; keep sharing/export in the conversation area. Preserve the fixed composer, keyboard behavior, mobile keyboard handling and reachable conversation actions. Avoid nested competing page scroll areas.
- [x] Replace standalone `pushState` navigation with main-router-compatible transitions; verify same-route `?q=` changes as well as initial load. Reusing the existing initial-load-only effect unchanged is insufficient for SPA navigation.
- [x] Migrate all tools/workspace/evals links and preserve tool configuration, area, question and language state. Retain validation, URL-length checks and invalid-link messages.
- [x] Preserve typed prompts, structured starters, suggested follow-ups, manual follow-ups, clarification choices, memory, new chat, sharing, export, voice controls and answer-to-dashboard links.
- [x] Describe question sharing accurately. For article links, author self-contained prompts; do not expand scope into hosted conversation sharing. Ensure links never imply that they preserve a historical answer.
- [x] Migrate required static assets and evaluation artifacts. Confirm every request returns its expected type rather than an HTML SPA fallback at 200. Do not label experimental model artifacts as current production behavior.
- [x] Use the main site's analytics initialization once. Track aggregate interaction events without raw prompt text, conversation bodies or identifying query strings. Inspect existing page-view capture because `?q=` itself can leak prompt text.
- [x] Add page-specific title, description, canonical, language alternates, OG and prerender coverage. Default chat HTML must not contain saved conversations. Canonicalize question/tool state URLs to the appropriate base page rather than submitting them to the sitemap.

Gate: direct navigation, reload, Back/Forward and all migrated screens work in both languages; homepage/main entry does not statically import AI registries, model libraries or evaluation data.

## 6. Tier 2 — hosted AI, limits and fallback

- [x] Apply additive backend origin/hostname changes first, then prove integrated staging calls against the chosen service.
- [x] Verify Turnstile success, cancellation, expiry and renewal through the real UI. Do not bypass challenges or weaken checks to capture screenshots.
- [x] Verify invalid sessions, per-minute/per-session/IP allowance, shared budget exhaustion and temporary service failure using deterministic tests; do not exhaust production quotas to test them.
- [x] Preserve non-AI continuation and honest mode labels when AI is unavailable. Network-dependent data tools must not be described as offline merely because they avoid an LLM.
- [x] Show practical limit/reset guidance derived from the policy where feasible. Current code constants are 20/session/day, 60/IP/day, 3/minute and a one-hour session; verify semantics before turning them into a promise of “20 free questions daily.” Shared IPs and renewed sessions need accurate wording.
- [x] Keep provider/cloud-processing disclosure visible. Verify local conversation persistence, export behavior and the privacy page agree with actual operation.

Gate: both real AI and non-AI questions return on staging, with sources and mode labels; denial/fallback paths are understandable and old-host functionality still works.

## 7. Tier 3 — homepage promotion and artwork

Place a compact promotional card directly below the search bar/hint, coordinated with the existing flyover preview. It must not obscure search results or displace essential navigation below an oversized hero.

Proposed copy:

> **Попитай Наясно**  
> Задай въпрос за бюджета, цените, обществените поръчки или изборите. Разгледай отговора и провери данните.  
> **Задай въпрос** · Как работи

- [x] Primary CTA → `/chat`; secondary → the launch article once published. Keep the secondary absent until its destination is available.
- [x] Add three tested starter links across everyday expenses, public money and civic life. Each must be understandable without prior context.
- [x] Create artwork in the existing cream/charcoal/orange style: question → real chart/table → source. Keep headline/buttons as accessible HTML, decorative artwork with appropriate alternative text, and numerical examples grounded in actual captures.
- [x] Use restrained dimensions, explicit image size, compressed responsive assets and appropriate loading priority. No chat/model initialization, video or autoplay cost on the homepage.
- [x] Verify keyboard focus, contrast, touch targets, light/dark themes, zoom, narrow screens and the existing hub height/CLS/LCP budgets. Adjust the composition instead of casually widening budgets.

Gate: promotion reads clearly on mobile and desktop, its links work, search remains usable and performance checks pass.

## 8. Tier 4 — examples, competitive research and screenshots

### Example selection

Build an example manifest containing exact BG/EN prompt text, entry URL, intended tool/arguments, mode, expected scope, sources, capture date, actual result, follow-up sequence and screenshot filenames. Do not include an example until its data and narration have both been checked.

| Audience | Candidate example | What it should teach |
| --- | --- | --- |
| Everyday | Prices in Plovdiv | Place and observation date; what a quoted price covers |
| Everyday | State budget plan and execution | Annual plan versus partial-year execution |
| Everyday | Parliamentary seat distribution | A concise question, chart and source |
| Deeper | Municipality's procurement suppliers and contracts | Narrow the period, inspect individual records |
| Deeper | Party voting behavior and a specific roll call | Move from aggregate to evidence |
| Deeper | Declared interests/company involvement | Relationship basis and dates; limits of identity matching |

These are candidates, not verified capability promises. Test 3 everyday and 2–3 deeper examples. Choose only supported follow-ups; a failed example may be replaced by a supported one or receive a narrowly scoped correctness fix and regression test. Do not rewrite expected answers to match incorrect behavior.

Include one honest coverage-gap example. Explain missing data versus zero, incomplete years, declared values versus market values, and risk signals versus established wrongdoing where relevant to the chosen examples.

### Comparison research

Primary-source starting points, identified 2026-09-10:

- СИГМА: https://sigma.midt.bg and https://github.com/midt-bg/sigma/blob/main/docs/spec/ai-assistant.md — procurement focus and documented Bulgarian text/voice assistant, registry/web searches and reports. Public chat availability has not yet been tested.
- Data Commons: https://www.datacommons.org/faq — natural-language access to sourced structured statistics.
- Perplexity: https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work — web research, sources and conversational follow-ups.
- ChatGPT: https://help.openai.com/en/articles/9237897 — web search and source access.
- OpenTender Bulgaria: https://data.open-contracting.org/en/publication/44 — procurement corpus; inspect its own portal/methodology for feature comparisons.
- BIRD: https://bird.bg/judicial-money/ — declaration search described by its publisher.

- [x] Recheck sources and availability close to publication. Find Sigma's actual announcement if available; a specification establishes documented intent, not a completed implementation or measured accuracy.
- [x] Compare scope, source/record access, dates, guided questions, follow-ups, visualizations and access limits. Use “not tested/not documented” rather than an unsupported “no.”
- [x] For runnable chats, use the same small task set: basic lookup, dated/place comparison, contextual follow-up and unavailable-data question. Record model/mode/date and evidence support. Do not score non-chat search portals on conversational tasks.
- [x] Publish a concise, respectful table explaining when each tool helps. Keep detailed testing notes separately. Do not infer superiority from corpus row counts with different units/periods, or from a few selected successful answers.

### Screenshot production

- [x] Capture the integrated UI after layout and examples are stable: (1) typing/starter catalogue/mode, (2) answer with date and source, (3) follow-up sequence, (4) AI verification or allowance/fallback. Add at most two detail crops for deeper examples.
- [x] Keep originals and add numbered annotations with captions explaining what the reader should notice. Never alter answer text, figures, sources or mode labels to improve the demonstration.
- [x] Crop for readable article width and mobile; do not shrink a full desktop page into illegible text. Provide descriptive alt text and captions; annotations must not be the only way information is conveyed.
- [x] Capture fresh task-owned conversations, excluding browser chrome, tokens and unrelated saved history. Label any synthetic limit illustration explicitly; prefer real UI under a controlled test state.
- [x] Check a representative screenshot against production after deployment. If the UI or data changed materially, recapture or clearly date the image.

Gate: every published question link and follow-up reproduces, all figures have evidence, and the competitive table distinguishes observed behavior from documentation.

## 9. Tier 5 — write and package the article

Working title: **Попитай Наясно: нов начин да разглеждаш публичните данни за България**.

Target: approximately 1,200–1,600 Bulgarian words, with a faithful English counterpart, four main annotated images and a compact comparison. Use familiar language; describe “готови въпроси” before introducing “prompts.”

Outline:

1. An everyday question and a useful real answer, with an early Try link.
2. Coverage grouped by citizen interests, with `/data/sources` and `/chat/tools` links and an explicit note that coverage varies by dataset.
3. Guided starters, typed questions and follow-ups, illustrated as a short sequence.
4. Non-AI versus AI: predefined tools/templates versus model-assisted interpretation and explanation; distinguish returned records from narration.
5. Two or three deeper examples, each with a self-contained entry link and evidence trail.
6. Limitations, freshness, Turnstile, allowance/reset behavior, cloud processing and non-AI continuation.
7. Named alternatives, including Sigma's documented assistant, with dated sources and fair scope comparisons.
8. Invitation to try the chat and report an unclear/wrong answer through an existing feedback/community channel.

Mention the impending rebrand briefly: Наясно is the project's new identity, with the domain move coming soon. Avoid saying the domain has already moved. Keep article URLs and internal links origin-relative so the content survives rebranding.

- [x] Select one stable article slug; register bilingual metadata in `public/articles/index.json` and bodies as `public/articles/<slug>-bg.md` and `-en.md`. Store artwork/screenshots within the existing article asset convention.
- [x] Draft locally with `draft: true`; inspect actual production packaging before any staging publish of unpublished text.
- [x] Include byline, actual publication date, summaries, OG image, source links and sensible topics. Do not tag every dashboard merely because the chat covers it.
- [x] Verify article renderer preserves prompt/tools query parameters, language and fragment links; article CTAs must not auto-run an ambiguous follow-up from an absent conversation.
- [x] Check the rendered article and generated HTML: one H1, correct title/canonical/hreflang, readable figures, working anchors, OG image, sitemap/index inclusion only when published.
- [x] Editorial review checks every capability and comparison claim against the evidence manifest, including any accuracy figures. Routing metrics must not become “answer accuracy.”

Gate: finished bilingual draft, screenshots, final homepage card and all links are reviewable together before launch.

## 10. Tier 6 — verification, release and rollback

### Verification matrix

| Area | Required checks |
| --- | --- |
| Routing | All six BG/EN pages, direct load/reload, Back/Forward, same-route new question, old URL mappings and invalid tool state |
| Chat | Typed question, starter, suggested/manual follow-up, clarification, new chat, memory, share/export and voice where supported |
| AI access | Real verification/question; deterministic expiry/allowance/budget/error tests; non-AI continuation |
| Evidence | Correct tool/scope, dates, result/narration agreement, source and dashboard links |
| Browser | Mobile/desktop, light/dark, keyboard/zoom, narrow screen and virtual keyboard |
| Delivery | Static asset types, data access/CORS, CSP, production entry separation, article prerender/metadata |
| Privacy | No prompt/conversation leakage through analytics, URLs in analytics or screenshots |
| Performance | Existing entry graph and homepage/hub budgets; no eagerly loaded AI registry/model dependency |

Run targeted unit/integration gates while implementing, then required repository lint/build/test checks once the final change is ready. Relevant existing commands include `npm run ai:test:non-ai`, `npm run ai:test`, `npm run ai:harness`, `npm run functions:test`, `npm run lint`, `npm run build`, and relevant Playwright checks. Inspect scripts and test prerequisites before running; preserve known-gap reporting. Run hosted-model evaluations only when needed for selected claims/examples, with their costs and environment understood. No broad data reload is part of validation.

### Release sequence

1. Preserve current Hosting releases and build/config rollback artifacts; document chosen LLM endpoint and a rollback owner/action.
2. Deploy additive AI backend origin/hostname configuration and Turnstile settings while the old chat still works.
3. Ship integrated routes to staging and complete the verification matrix. A real AI question and working data cards, not just HTTP 200 on the page, are required.
4. Deploy integrated production routes before advertising them. Verify chat/tools/evals, hosted AI and source links there.
5. Publish the final article and homepage promotion together after editorial/technical gates. Publishing is an explicit execution action, not implied by creating this plan.
6. Keep the legacy move/export notice during transition; then enable tested permanent page redirects. Preserve API operation and confirm old prompt/tools links after the redirect deploy.
7. Retire standalone screen build/analytics/deploy paths only once no active legacy/export route depends on them. Retain the AI backend deployment scripts while its function remains in that project.

Follow CLAUDE.md's actual hosting/function release rules. If the main bundle hash changes, account for function-served pages caching the old entry shell: hosting → `deploy:db` → Hosting edge purge using the already verified build. If new DB function routes are introduced, the documented function-first addition also applies. This migration should not require a SQL migration. Do not confuse deploying the AI-project LLM function with refreshing the main-project `db` shell cache.

Rollback: remove/disable the homepage promotion if needed; restore the preceding integrated Hosting release or legacy frontend; keep additive backend origins valid. Undo page redirects if the destination is broken. Preserve a distinct legacy recovery URL/build because a cached permanent redirect can prevent the original URL serving as an immediate rollback. Do not roll back by deleting quota data or disabling verification. Article claims/links must match whichever experience remains available.

### Launch observation

Inspect aggregate promotion clicks, chat starts, successful answers, source clicks, follow-ups, fallback/limit rates and errors after launch. Define success around people reaching useful, verifiable answers; use only sanitized telemetry. This is a manual post-launch check in this plan, not authorization to create an automation.

## 11. Tier 7 — subsequent naiasno.bg move

The full main-site domain migration remains a separate project, but this work must prepare its chat/article surfaces:

- [ ] Retain `/chat`, `/chat/tools`, `/chat/evals`, language paths and article slug.
- [ ] Add/verify naiasno.bg origins and Turnstile hostnames before switching traffic; maintain the same backend quota ledger.
- [ ] Update canonicals, OG URLs, sitemaps, source links and public origin configuration together with the broader rebrand.
- [ ] Point old AI and electionsbg.com redirects directly to the final destinations where practical, avoiding unnecessary chains and preserving query parameters.
- [ ] Repeat browser-storage/verification disclosure: a second origin change again cannot transfer local history automatically.
- [ ] Refresh article rebranding sentence and any obsolete domain labels in artwork/screenshots.

## 12. Completion checklist and implementation order

Dependencies: **T0 → T1/T2 → T3/T4 → T5 → T6**. Research and draft prose can progress while integration is under way; final screenshots depend on stable integrated screens. T7 executes with the later domain migration.

Deliverables:

- [x] Integrated, tested chat/tools/evals screens with shared site identity.
- [x] Stable hosted AI access and honest limits/fallback experience.
- [x] Legacy URL transition/export notice and verified redirect candidates (prepared; live activation follows the release gate).
- [x] Homepage card, optimized artwork and three working starter links.
- [x] BG/EN launch article, annotated screenshots, OG assets and source links.
- [x] Example/evidence manifest and dated competitive research notes, including Sigma.
- [x] Validation record, concrete release order and tested rollback route.
- [x] Rebranding handoff checklist with remaining domain-specific actions.

No additional product decision is required to start implementation. Confirm the final public allowance wording from observed policy behavior, choose the strongest passing examples, and present the complete rendered article/homepage/screens for editorial review before publication. Do not treat this as a request to publish, migrate domains or start recurring monitoring now.
