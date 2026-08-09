# /funds as a dashboard hub — v1

**Status:** proposed, 2026-08-09.
**Pattern:** `.claude/skills/dashboard-hub`. Reference implementation: `/parliament`.
**Predecessor:** [funds-module-v2.md](funds-module-v2.md), whose band structure this
restructures — it does **not** undo it. See §1.2.

---

## 1. Why

### 1.1 Measured, on the dev server at a 1265 px viewport, 2026-08-09

| | |
|---|---|
| page height | **10 098 px** — about eleven screens |
| JSON/API fetched | **390 KB across 8 requests** |
| the single largest | `/api/db/dual-corpus-rankings` — **247 KB, 63% of the page**, fetched to draw a preview leaderboard |
| `FundsScreen.tsx` | **512 lines**, 14 analysis tiles rendered inline |

This is precisely the shape the hub pattern exists to replace: the module's front page
renders the module's analysis rather than fronting it. The skill's §1 records the same
defect on `/parliament`, where seven mini-tiles pulled 1.65 MB to draw three rows each.

*(Dev-server transfer sizes; prod compression will lower the absolute figures but not the
ratio — the 247 KB is a full ranking payload either way.)*

### 1.2 What this does NOT change

`funds-module-v2` established, from measured demand, that **look-up leads**: ~68% of the
audience arrives asking „can I get money", and the band-1 pair (open calls + the „финансирано
ли е нещо като моето" resolver) is that question rendered.

Converting those to tiles would undo the stage that shipped them, and the pattern does not
ask for it — **`/parliament` keeps live content above its grid too**: `Title → HubSearch →
wire → session strip → LeadCard → news rail → TileHubGrid`. `/funds` already has three of
those four (finder, wire, news rail). What it lacks is the grid.

So: the lead stays live, and everything **below** it becomes tiles.

---

## 2. Target shape

```
Title + description
HubSearch                    ← already there (FundsFinder → migrate to the shared adapter)
FundsWireLine                ← already there
─────────────────────────────────────────────────────────  live, above the grid
BAND 1  Какво е отворено сега  +  Финансирано ли е нещо като моето     ← unchanged
FundsNewsRail                ← already there
─────────────────────────────────────────────────────────  the grid
BAND 2  Кой получи парите        4 tiles
BAND 3  Проверки и връзки        4 tiles
BAND 4  Усвояване и движение     3 tiles
BAND 5  За теб                   2 tiles (live, they are personalised)   ← unchanged
SourceFooter
```

Bands are named for the question they answer, per the skill §3. Balance to the 4-column
`xl` grid: **4 / 4 / 3**, checked on the rendered last row, not the array length.

---

## 3. The tiles, and where each one goes

Every tile currently rendered inline needs a destination. Six do not have one yet.

| today, inline on `/funds` | destination | status |
|---|---|---|
| `OpenCallsTile` | `/funds/calls` | stays LIVE (band 1) |
| `FitResolverTile` | — | stays LIVE (band 1) |
| `TopBeneficiariesCard` | **`/funds/beneficiaries`** | NEW |
| `TopProgramsTile` | **`/funds/programmes`** | NEW — also the picker `MySectorTile` links to |
| `FundsMuniMapTile` + `GeographyMixTile` | **`/funds/places`** | NEW |
| `AbsorptionByPeriodTile` + `FundsSankeyTile` + `ProjectsStatusMixTile` | **`/funds/absorption`** | NEW |
| `DualCorpusLeaderboardTile` | **`/funds/dual-corpus`** | NEW — retires the 247 KB hub fetch |
| `InterregTile` | **`/funds/interreg`** | NEW — the picker for `/funds/interreg/:keepId` |
| `PoliticalConflictsTile` | `/funds/political` | exists |
| `IntegrityTeaserTile` | `/funds/integrity` | exists |
| `RrfTeaserTile` | `/funds/rrf` | exists |
| `FundsFocusTile` | `/funds/focus` | NEW picker; `/funds/focus/:slug` exists |

**`/funds/focus` is a picker, not a seed.** The skill §4 is explicit: a tile pointing at
`/x/:id` lands the reader on a subject somebody else chose and omits itself entirely when
the generator produces no seed. Same reasoning gives `/funds/interreg` and
`/funds/programmes` their index pages.

Each new page is **self-contained**: its own `Title`, its own breadcrumb, its own source
footer, and it owns the fetch its tiles need — which is what takes those fetches off the hub.

---

## 4. The stat blob

One artifact, per the skill §1 — **`data/funds/derived/hub_stats.json`**, budgeted and gated.

It replaces the hub's per-tile fetches. Today the grid's numbers would come from
`projects-index` (17 KB), `index` (9 KB), `dual-corpus-rankings` (247 KB) and
`themes-index` (4 KB); after this the hub fetches one blob and the 247 KB moves to
`/funds/dual-corpus`, where the reader asked for it.

**Generated from the objects the pipeline already holds in memory**, at the end of its run —
never by re-reading the files it just wrote, which is what lets a hub's numbers drift from
its sub-pages'.

### 4.1 Step 0 is measurement, and it is not ceremony

Before a single figure is written, each one gets: **the number, its denominator, and the
other defensible answers to the same question.** The skill records six-of-six figures wrong
on the parliament hub because a draft picked a different basis per tile by accident.

The funds corpus has at least four live basis traps, all of which have already bitten in
`funds-module-v2`:

- **ИСУН alone vs ИСУН+Interreg.** `fund_projects` holds **zero** Interreg rows — a system
  boundary, not a filter. On a 5.5% sample, 29 municipalities gain money once Interreg is
  counted and **all 29 sit in a border oblast**. Every money figure must declare its arm.
- **Contracted vs paid.** The corpus carries both; „усвоени" is neither on its own.
- **Signed contracts vs published budget.** ИСУН publishes a contract value; the Interreg
  column is a partner's published budget. They are not the same quantity and must not be
  summed into one unlabelled figure.
- **`paid_project_count` is DISBURSEMENT, never approval.** ИСУН publishes no rejected
  applications, so an approval rate has no denominator. Already gated in
  `ProcedureBaseRates.test.tsx`; the hub must not reintroduce it.

Each tile's figure is stated in one clause in the registry comment, or it does not ship.

---

## 5. Steps

Each step is one commit, through the review→repair gate.

| # | step | notes |
|---|---|---|
| 1 | **Measure** every intended figure against the corpus; write the basis table into this plan | §4.1 — blocks everything else |
| 2 | `hub_stats` generator + type + budget gate + `--upload` wiring | one shared type, declared on the `src/` side |
| 3 | `/funds/beneficiaries` + `/funds/programmes` | moves 2 tiles off the hub |
| 4 | `/funds/places` + `/funds/absorption` | moves 4 tiles off the hub |
| 5 | `/funds/dual-corpus` + `/funds/interreg` + `/funds/focus` | moves 3 tiles; retires the 247 KB fetch; two pickers |
| 6 | Registry + scenes (13 bespoke 300×116 SVGs, unique accents) | pure data + `id → Scene` |
| 7 | Rewire `FundsHubScreen` to `TileHubGrid`; migrate `FundsFinder` → `HubSearch` | the 512-line screen shrinks to a composition |
| 8 | Gates + prerender entries + browser verification | skill §8 and §9 |

**Prerender:** each new page gets a `staticPage` entry and a verified
`dist/<path>/index.html`. The parameterised routes (`:code`, `:slug`, `:keepId`,
`:number`) are **not** prerendered — the pickers are. `dist/` already holds ~248k files
against a ceiling on file COUNT.

---

## 6. Gates

From the skill §8, plus two specific to this module:

| gate | catches |
|---|---|
| every tile id has a scene | white screen (`InfographicTile` renders `<Scene />` unguarded) |
| every `to` is absolute and in a literal routed list | dead links |
| every `/funds/*` sub-page is a hub destination | orphans |
| no accent twice on the page | „these are the same kind of thing" |
| `hub_stats` under its byte budget | regrowth to the full artifact |
| every figure recomputed from its declared basis, with the rejected bases as `notEqual`s | the six-of-six class |
| every written file appears in `--upload` | green locally, stale on prod |
| **every money figure declares ИСУН vs ИСУН+Interreg** | the 29-border-municipality understatement |
| **no tile figure is worded as an approval rate** | a denominator that does not exist |

Then break each clause and watch it fire — the skill records two gates that read as real
tests and could not fail.

---

## 7. Out of scope

- **Retiring the old `/funds` bands wholesale.** Bands 1 and 5 stay live; this plan moves
  bands 2–4 into the grid and their content into pages.
- **New analysis.** Every new page renders a tile that exists today. The only new code is
  the page shell, the registry, the scenes and the blob.
- **`funds-module-v2`'s open items** — АХУ, АЗ, the four unreachable Interreg programmes,
  and alerts/subscriptions (which need an account system).
