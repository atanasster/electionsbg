# Наясно Новини — release readiness v1

Status: implementation audit in progress. This record documents checks actually run; it
does not claim production deployment or participant validation.

## T5.1 Information architecture

Validated against the current route table, footer, breadcrumbs, prerender registry and
sitemap contracts on 2026-08-28. Viewport/browser inspection is recorded separately in
T5.2; no manual desktop/mobile result is claimed here.

| Reader intent | Primary route | Discovery path | Return path |
| --- | --- | --- | --- |
| Compare current coverage | `/` | Logo / Истории | story breadcrumb → Истории |
| Compare one event | `/story/:id` | homepage cards, related stories, article context | breadcrumb → Истории |
| Verify one judgment | `/article/:domain/:id` | story member or article card | breadcrumb → source; separate story action when linked |
| Inspect a source | `/outlet/:domain` | Източници, source links | breadcrumb → Източници |
| Browse themes | `/topics` | primary navigation | linked taxonomy subjects → electionsbg.com; otherwise persistent navigation |
| Understand method | `/methodology` | primary navigation, article evidence | footer / primary navigation |
| Return to saved items | `/saved` | primary navigation | each saved item → its canonical page |
| Understand accountability | `/about` | footer | methodology/corrections links |
| Report and inspect changes | `/corrections` | detail-page action, About, footer | affected-page links after a correction exists; otherwise header/footer |

Findings and decisions:

- The five designated primary destinations stay in primary navigation; accountability and
  correction routes stay in the footer/context so the mobile row remains limited to five
  items. Whether that row is actually scannable is a T5.2 browser check.
- Every detail family has a visible `aria-label="Път"` breadcrumb; utility pages use the
  persistent header/footer rather than manufacturing a false hierarchy.
- `/saved` is intentionally `noindex` and excluded from the sitemap; `/about`,
  `/methodology`, and `/corrections` are indexable trust pages.
- Canonicals use the production no-trailing-slash form. The root remains `/`.
- The shell’s catch-all offers one explicit route back to Stories and does not silently
  render homepage content under an unknown URL.

Automated evidence: `newsapp/App.test.tsx` gates the skip/catch-all paths, selected footer
discovery and corrections route; `newsapp/prerender.test.ts` gates About/Corrections
metadata plus generic canonical mechanics; `newsapp/distSitemap.test.ts` gates the emitted
outlet/story families and Methodology. These tests passed 50/50. They do not prove mobile
scannability or every route-to-route path; those are explicit T5.2 browser checks rather
than claims inferred from jsdom. The full news test command is recorded in the final gate.

## T5.2 Visual QA

Run 2026-08-28 against local Vite 6.4.3 at base commit `93f306c08b` plus the
T5.2 class/CSS repair in `HomeScreen.tsx` and `news.css`, using Codex in-app browser runtime
26.825.31414 and the generated 2026-08-28 app-data (84 stories, 4,367 articles).
Durable screenshots: `docs/plans/news-qa-home-desktop-1440.jpg` and
`docs/plans/news-qa-home-mobile-390.jpg`.

| Route | Viewport | Check | Observed |
| --- | ---: | --- | --- |
| `/` | 1440×900 | shell/header/main alignment; visible lead; broken images; horizontal overflow | header 57 px; main 1344 px centered; lead visible; 0 broken images; body 1425/1425 px |
| `/` | 390×844 | mobile header/nav; hero/filter/card flow; broken images; horizontal overflow | header 108 px; five-item nav scrolls inside 375 px (`479/375`, `overflow-x:auto`); 0 broken images; body 375/375 px after repair |
| `/story/20260822-2176b0e5` | 390×844 | breadcrumb, title, actions, copy flow, overflow | breadcrumb and full title visible; save/share/report actions visible; body 375/375 px; 0 broken images |

Finding repaired: the supporting-card grid had no explicit column below `sm`. Its implicit
`auto` track expanded to an image credit’s ~821 px min-content width, producing an 829 px
body on a 375 px layout viewport. The bound `.news-supporting-grid` rule now supplies
`grid-template-columns: minmax(0, 1fr)` (and zero-minimum two/three-column breakpoints); the
same browser measurement is 375/375 px and the card is 359 px. No console warnings/errors were
reported on the inspected homepage/story states. The temporary viewport override was reset.

Measurements used `document.body.scrollWidth/clientWidth`, element
`getBoundingClientRect()`, `HTMLImageElement.complete/naturalWidth`, computed
`overflow-x`, and the browser console warning/error log after load. The regression test
`newsapp/app/screens/HomeScreen.layout.test.ts` gates that the rendered grid uses the
dedicated production class; its base CSS track is `minmax(0, 1fr)`. The real-browser
long-credit `scrollWidth === clientWidth` result remains recorded above; the Vitest DOM
environment does not perform CSS layout, so the test does not pretend to measure it.
`scripts/news_home_layout.test.ts` reads the production stylesheet in the Node test project
and gates the base, two-column and three-column `minmax(0, 1fr)` rules.

## T5.3 Accessibility and theming

Audited 2026-08-28 against WCAG 2.1 AA with the accessibility skill and the same local
browser build. The shell respects system preference until the reader chooses a theme, the
toggle has a state-specific accessible name, and the choice persists locally. Colors in
components use semantic tokens; hardcoded colors are confined to data-visualization hues
whose adjacent text labels carry the same meaning.

Browser checks on the homepage found one `h1`, an `h1→h2→h3` hierarchy, one each of
`header/main/footer`, two labelled nav landmarks, no duplicate IDs, no unnamed interactive
elements, and 16/16 rendered images with alt attributes. The existing skip-link component
test gates the `#news-main` target; browser keyboard focus automation could not reliably
advance focus in the in-app browser and is therefore not claimed as a manual pass.

Observed color pairs and WCAG contrast ratios:

| Mode | Pair | Ratio | Requirement |
| --- | --- | ---: | ---: |
| Light | foreground `rgb(35,30,26)` / background `rgb(249,246,241)` | 15.31:1 | 4.5:1 |
| Light | muted `rgb(100,91,84)` / background | 6.15:1 | 4.5:1 |
| Light | editorial kicker `rgb(141,56,32)` / background | 7.16:1 | 4.5:1 |
| Light | border `rgb(149,133,117)` / background | 3.31:1 | 3:1 |
| Dark | foreground `rgb(241,236,229)` / background `rgb(17,21,29)` | 15.55:1 | 4.5:1 |
| Dark | muted `rgb(183,176,164)` / background | 8.50:1 | 4.5:1 |

Focus rings use a dedicated magenta `--ring: 329 86% 50%` token. Its lowest calculated
contrast across the actual adjacent background, foreground, primary, secondary and card
surfaces is 3.48:1; the ranges are 3.48–4.04:1 in light mode and 3.48–4.37:1 in dark mode. The
3 px skip-link offset exposes the page background between its dark fill and outline.
`scripts/news_accessibility.test.ts` extracts the light and dark selector blocks, calculates
from their audited tokens, and gates normal text (4.5:1), borders, and focus rings against
every audited adjacent control surface (3:1). Keyboard focus traversal remains an open manual check; this
is a contrast/implementation pass, not a claimed interaction pass. Existing
component tests cover image alt/fallback behavior, filter pressed state, live-region status,
skip target, theme action naming, and native button/link semantics.

## T5.4 Performance budgets

Production build run 2026-08-28 with Vite 6.4.3 and the generated corpus used above:
1,672 modules, 293 prerendered routes (206 sitemap entries), completed in 62 seconds on the
local host. These are build/resource measurements, not field Core Web Vitals; no LCP/INP
claim is made without production traffic.

| Critical resource | gzip bytes | Budget | Headroom |
| --- | ---: | ---: | ---: |
| root HTML | 1,190 | 2,000 | 40.5% |
| initial stylesheets | 25,738 | 30,000 | 14.2% |
| initial JS (entry + modulepreloads) | 127,944 | 140,000 | 8.6% |
| `home.json` | 32,803 | 33,792 | 2.9% |

`npm run news:perf:gate` reads entry module/style references from the production HTML (so
async chunks do not become false ambiguity), sums all initial stylesheets and modulepreloaded
JavaScript, compresses with the repository/CDN convention
of gzip level 6, fails on missing/ambiguous/out-of-root entry artifacts, and enforces all
four limits. The homepage reuses the builder’s 33 KiB launch ceiling rather than defining a
weaker duplicate.
`scripts/news_performance_budget.test.ts` gates the threshold and multi-failure behavior.
The JS budget has the least headroom; additions should prefer route-level lazy loading or
removing shared entry cost rather than raising the limit without a recorded decision.

## T5.5 Image rights and attribution

`npm run news:image-coverage:gate` passed on 2026-08-28 against the committed selection,
review queue and analysis index:

- 28 reviewed selections resolve to the same article URL, stored image and recorded source;
- all 28 are current inside the 30-day window and 8 are multi-outlet comparison stories;
- zero invalid/unknown selected rights and zero unresolved selections;
- the rebuilt review queue is structurally equal to the committed queue;
- all five launch checks are true (`launch_ready: true`).

The generated home bundle contains 28 unique eligible articles. Every one has
`display_home: true`, a non-empty credit text and credit URL, and a named licence; statuses
are only `cc` or `public_domain`. This is a point-in-time audit of selected records, not a
claim that arbitrary publisher images are reusable.

The build remains fail-closed: missing/malformed rights stay off the homepage; `unknown`
and `blocked` may never carry `display_home`; unsafe URLs and malformed dates fail the data
build. `ArticleImage` visibly renders creator/source and linked licence beside every reviewed
photo, uses source/article attribution for fallbacks, gives content images the record’s
reviewed descriptive alt text when present, and exposes new-tab behavior in accessible link names. Delivery
(`hotlink_ok`) remains separate from permission (`image_rights`). Existing Python data tests,
`ArticleImage.test.tsx`, and the coverage gate protect those distinctions.
The coverage gate also identity-checks status, creator, credit text/URL, licence name/URL,
source URL and review date against the committed selection; mutation tests cover every field.

## T5.6 Staged rollout and rollback

No production deployment was performed during this implementation audit. The release is a
four-stage decision, and each stage leaves an inspectable artifact rather than relying on a
fresh build during promotion.

| Stage | Action | Exit criterion |
| --- | --- | --- |
| 0 — candidate | Run `npm run news:release:gate` locally | image gate, Python/JS suites, news-app tests, production build and resource budgets all pass in one command |
| 1 — unlisted public preview | Run `npm run deploy:news:preview` | named `news-candidate` Firebase preview URL opens; desktop/mobile smoke checks pass; no production traffic changes |
| 2 — moderated validation | Run the protocol in `news-moderated-validation-v1.md` against that exact preview | five participants complete the core tasks; no severity-1 issue; observations and decisions are recorded |
| 3 — production | Set the recorded immutable version, then run `NEWS_VERSION_ID=<version> npm run deploy:news:promote` only after an explicit release decision | Firebase clones that exact reviewed version to `live`; production smoke checks pass |

The preview URL is public to anyone who possesses it; it is unlisted, not access-controlled.
Never put sensitive or test personal data in the candidate. The preview expires after seven days. If validation takes longer, deploy a new candidate and
repeat the checks; do not promote an expired or superseded URL. Firebase Hosting has no
percentage traffic split for this site, so a “limited rollout” can only mean limited
announcement/discovery after production, not a technical cohort. Keep the first 24 hours
unannounced beyond the validation group, then broaden links only after the checks below stay
green.

### Release checklist and evidence

The gate writes `dist-news/.release-manifest.json`, containing the Git HEAD plus a content
identity for every tracked change and every non-ignored untracked news/build/release input,
and a SHA-256 for every deployable file. Preview upload first verifies both identities and bypasses the Firebase
predeploy rebuild; a post-gate source, Hosting-config or dist change therefore refuses upload.
The release owner records that candidate identity, gate output,
preview URL, Firebase version ID, validation notes, decision time and operator before
promotion. Immediately before promotion, confirm the recorded version ID is still the version
participants reviewed; promotion refuses to run without `NEWS_VERSION_ID`. Immediately after promotion, verify `/`, one
multi-source story, one article evidence page, one outlet page, `/methodology` and
`/corrections` on desktop and mobile. For each, check status/canonical, images and visible
attribution, navigation, theme, console errors and horizontal overflow. Re-run
`npm run news:image-coverage:gate` against the promoted commit and retain the command output
with the release record.

Stop promotion—or roll back immediately—if any of these occurs:

- an image lacks visible attribution or its rights identity differs from the reviewed record;
- a story attributes a claim, stance or political classification to the wrong article/outlet;
- a correction/report path is unavailable, or a severity-1 moderated-validation issue remains;
- a core route fails, returns the wrong canonical, has persistent client errors or horizontal
  overflow, or the release gate/performance budget fails;
- the deployed artifact cannot be tied to the candidate commit and recorded preview.

### Rollback

In Firebase Hosting, use the `electionsbg-news` site’s release history to roll back `live` to
the immediately preceding known-good release. This is deliberately a console operation: the
CLI exposes preview deployment and channel cloning but no direct `hosting:rollback` command.
After rollback, repeat the production smoke set above, record the restored release/version and
incident reason, and keep announcements paused. Fixes start again at Stage 0 with a new
candidate; never overwrite the evidence for the failed one.

The scripts are intentionally separated: `news:release:gate` contains no Firebase command,
`deploy:news:preview` verifies the gated hashes, bypasses a second build and cannot target
`live`; `deploy:news:promote` requires and clones an immutable Firebase version rather than a
mutable channel head. `scripts/news_release_contract.test.ts` and
`scripts/news_release_manifest.test.ts` gate those properties so future command edits fail
closed.
