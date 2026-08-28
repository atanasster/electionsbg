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
