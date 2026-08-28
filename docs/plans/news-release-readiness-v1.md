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
