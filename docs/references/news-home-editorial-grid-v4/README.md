# Home composition — the "before" state, 2026-09-01

These are the **defect** captures that `docs/plans/news-home-editorial-grid-v4.md`
argues from. They are a dated record, not a reference the suite compares against:
nothing fails when they stop matching, and they are expected to look wrong.

Regenerate with:

```bash
UPDATE_NEWS_HOME_REFS=1 npx playwright test --config playwright.news.config.ts home-grid --grep captureable
```

⚠️ **Do not regenerate them after the layout is fixed.** Their whole value is
that they show the state the plan was written against; overwriting them with the
repaired layout deletes the evidence and leaves the plan arguing from nothing.
The "after" state belongs in a sibling directory when the work lands.

One file per scenario in `newsapp/test-fixtures/home-grid.tsx` (the fixture is
the authority for what each scenario contains — `home-grid.scenarios.ts` holds
the names, and both the fixture and the spec import them from there):

| capture | what it shows |
| --- | --- |
| `today-1440.png` | the measured live composition — a 2-card update band in 3 tracks, and 3 of 5 standard rows made tall by an image card (row 2 carries two) |
| `no-images-1440.png` | the same sections at image coverage 0 |
| `all-images-1440.png` | image coverage 1 — where `h-full` produces the *internal* void instead, 110px on `update[1]` |
| `short-sections-1440.png` | 1-, 2- and 3-card sections; the first two reserve tracks they have no card for, the third fills its row at 3 columns |
| `mixed-kinds-1440.png` | the only row shape where a comparison cue and a plain card meet — and the worst row void in the matrix, 422.9px |
| `compact-1440.png` | compact density — **no card renders an image at all**, because `StoryCard` gates the image block on `!compact`. Captured while compact also dropped the lead entirely; §4.7 later kept it at a shallower media ratio, so the current fixture renders one |

## What the captures cannot tell you

The measurements are in `tests/news/home-grid.spec.ts`; those are the authority.
An image cannot tell you a row void is 110px, and it cannot tell you *why* a
check failed.

⚠️ That second point is the sharp edge of the `test.fail()` mechanism the spec
used while these defects were live: **it verifies THAT a test fails, never
WHY.** A 404 fixture, a renamed CSS class, a `NaN` comparison or a dead dev
server all satisfy it exactly as the real defect does. Every annotation is gone
now — each was removed by the commit that fixed its defect, because Playwright
fails a `test.fail()` test that starts passing — but the guard that made the
mechanism survivable stayed: `open()` asserts which scenario rendered and how
many cards it holds before anything is measured.

⚠️ Two of the measurements also SATURATED when the fix landed, and each needed a
second one rather than a looser threshold. Every card now stretches to its grid
row, so a per-card height ratio is pinned to 1.000 whatever the media does —
media cost is measured across whole sections at three image ratios instead. And
a bottom-aligned footer makes the residue below a card's last content block a
structural 17px, so the void check gained the largest gap BETWEEN blocks.

## Where the fixture is not the app

Recorded so a reader does not mistake either for a finding:

- **The lead sits in its own section** under a "Водеща история" heading. The app
  renders it *inside* "Обнови ме" with no such heading — the fixture separates
  it so the lead can be included or excluded per scenario.
- **`cardMetrics` excludes the lead.** It walks `[data-fixture-section]` grids
  only, because the lead is a different anatomy (a 5-column media/body split,
  not a grid cell) and its height is not comparable to a story card's. The
  headline-order check *does* include it, since reading order spans the page.

Everything else the app owns is imported rather than restated — the grid class
from `HomeScreen`, the shell from `app/shell.ts`, the scenario names from
`home-grid.scenarios.ts`.

## What was verified

Measured 2026-09-01 against the running app at 1440px **as it was then**, the
`today` scenario reproduced the live page exactly: **16 cards, 5 images**,
update grid 2 cards in 3 tracks, standard grid 13 cards in 3 tracks, per-row
image counts `(1, 0, 2, 1, 0)`. That equivalence is what makes these captures
evidence rather than illustration.

⚠️ Those track counts describe the layout the captures SHOW, not the current
one. The grid is two auto-fit tracks now; the fixture and the app moved
together, and `tests/news/home-grid.spec.ts` is what keeps them in step.

The six captures total ~2.3 MB because they are `fullPage` composites rather
than the card crops in the v3 sibling. `today`, `all-images` and
`short-sections` carry the whole argument; the other three are kept because the
spec walks all six and a missing capture would read as a dropped scenario.
