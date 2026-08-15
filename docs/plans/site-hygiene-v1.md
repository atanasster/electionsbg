# Site hygiene v1 — the budget-hub audit's open items, and the artifacts nothing serves

Status: PLAN ONLY. Nothing here is implemented.
Written 2026-08-15, against `0d1cbf4cd0`. Every number below carries the command that
produced it; re-run §0 before starting, because two of the figures this plan corrects were
themselves stale within a day of being written.

Predecessor: `docs/plans/budget-hub-v1.md` (shipped 2026-08-15 — `944d8a9f2f`, `efb57a8826`,
`951ba655bb`, `963a05d62c`, `4df39221fb`). Its §11 gate table and `### T9.x` sections are the
conventions this plan holds itself to, in particular: **a gate that names no file is better
than one that names the wrong file**, and **every gate must be mutation-checked — break the
code and watch it go red**.

---

## 0. What I measured

### 0.1 The headline: the site-wide gap is 12, not 67

`ogAndSitemapCoverage.test.ts`'s `records the site-wide gap` test carries
`expect(undeclared.length).toBeLessThanOrEqual(67)`. Three independent facts about that
number:

| | Value | How |
|---|---|---|
| What the shipped gate computes **today** | **65** | re-ran the gate's own logic verbatim in a throwaway vitest file |
| What the tripwire allows | 67 | `scripts/prerender/ogAndSitemapCoverage.test.ts:205` |
| Routed static pages that are **actually** served the homepage's head | **12** | checked every routed path against the built `dist/` |

```bash
# ground truth — does each routed, non-parameterised page have its own prerendered head?
npm run build          # dist/ must exist and be current; mine was built 2026-08-15 15:14
# then, per path: dist/<path>/index.html exists AND its <title>/<link rel=canonical>
# differ from dist/index.html's
```

Result, over the 187 static (non-parameterised, non-redirect, element-bearing) routed pages:

```
STATIC_ROUTED_PAGES=187
HAS_OWN_PRERENDERED_HEAD=175
NO dist/<path>/index.html AT ALL=12
HAS FILE BUT HOMEPAGE HEAD=0
```

**The 12, and nothing else, are the defect the gate describes.** All twelve are consistent
across all three artifacts — no `dist/<path>/index.html`, no `dist/en/<path>/index.html`, no
sitemap `<loc>`:

```
consumption/basket              procurement/project        sector/administration/services
db                              procurement/projects       sofia/companies
following                       procurement/tenders        subsidies/browse
my-area                         procurement/watchlist
procurement/overview
```

### 0.2 Why the gate says 65 — three narrow reads, each independently wrong

This is the most important finding in the plan, because it means **the tripwire is not
measuring what its comment says it measures**, and the three routes its comment singles out
are not the three that matter.

**(a) The router side resolves only ONE level of nesting.** `prefixAt()` returns the *first*
matching parent span, so a route inside `<Route path="reports"><Route path="municipality">`
resolves to `municipality/invalid_ballots`. The real path is
`reports/municipality/invalid_ballots`. Measured: **41 of the 65** carry a path string that
is not a URL on this site.

The plan prompt inherited this error, and so did the gate's own comment — "`municipality/invalid_ballots`
lives under `/municipality/:code` and can never be one static page". It does not. It is
`/reports/municipality/invalid_ballots`, a fully static page that is prerendered, has a
`<loc>`, and has been working the whole time.

```bash
# the five parent groups, and the two-level nesting the resolver cannot see
grep -n '<Route\s*path="[^"]*"\s*>$' src/routes.tsx
#   3379: parliamentary   3659: reports   3666: reports/settlement
#   3772: reports/municipality   3878: reports/section
```

**(b) `routeDefs()` is a TREE and the gate reads its top level.** `RouteDef.children?:
RouteDefs` (`scripts/sitemap/route_defs.ts:7`) and the sitemap builder recurses into it
(`scripts/sitemap/index.ts:782-783`). The gate does `new Set(routeDefs(y).map(d => d.path))`,
so `reports > municipality > concentrated` contributes only `"reports"`.

```
BG_FLAT_SIZE=214   BG_TOPLEVEL_SIZE=170
FALSELY_REPORTED_AS_no-routeDefs_BY_FLAT_READ=41
```

All 41 `reports/*` pages have a Bulgarian `<loc>` in the committed sitemap:

```bash
grep -ho '<loc>[^<]*/reports/[a-z_/-]*</loc>' public/sitemap*.xml \
  | sed 's|.*electionsbg.com||;s|</loc>||' | sort -u | wc -l   # → 41
```

**(c) `prerenderRoutes` is not the whole prerender.** The gate imports `prerenderRoutes` from
`scripts/prerender/routes.ts`. A second producer, `scripts/prerender/dynamicRoutes.ts`, emits
non-parameterised pages too — `buildReportRoutes()` (:2948), `buildVotesRoutes()` (:3042),
`buildPollsRoutes()` (:2630), `buildArticleRoutes()`. So `reports/*`, `votes`, `polls` and
`articles` are reported `no-staticPage` while being prerendered with correct heads:

```bash
grep -o '<title>[^<]*</title>'                dist/reports/municipality/recount/index.html
# → Повторно преброяване по общини — Парламентарни избори | electionsbg.com
grep -o '<link rel="canonical" href="[^"]*"'  dist/reports/municipality/recount/index.html
# → https://electionsbg.com/reports/municipality/recount     (NOT the homepage's "/")
```

**The three errors partially cancel**, which is why the total looked plausible. They also
account for the 5-entry difference between the gate's 65 and a correct router read's 60: four
group nodes with no `element` (`parliamentary`, `reports`, `reports/settlement`, and the
mislabelled `municipality`/`section`) and one redirect the `<Navigate>` filter misses,
`data/map` (it uses `<DataMapRedirect />`, `src/routes.tsx:1768`).

**And the tripwire has 2 units of slack today.** 65 ≤ 67 passes, so two more half-declared
pages could ship green. Nothing changed in the three inputs since the gate was written
(`git diff --stat efb57a8826 HEAD -- src/routes.tsx scripts/prerender/routes.ts
scripts/sitemap/route_defs.ts` → empty), so 67 was simply recorded wrong.

### 0.3 Which of the 12 are linked from prerendered copy

The gate's comment names `procurement/tenders`, `sofia/companies` and
`sector/administration/services` as "the ones that matter most, because each is LINKED from
prerendered copy". Measured, only the first is:

```bash
grep -rho 'SITE_URL}/[A-Za-z0-9_./-]*' scripts/prerender/ \
  | sed 's|SITE_URL}/||; s|^en/||' | sort | uniq -c | sort -rn
```

| path | links from prerendered copy |
|---|---|
| `procurement/tenders` | **2** (`routes.ts:4649`, BG + EN body) |
| `sofia/companies` | **0** |
| `sector/administration/services` | **0** |

The genuinely most-linked *undeclared-by-the-gate* paths are `votes` (16), `polls` (5),
`reports/section/problem_sections` (5) and `articles` (4) — and every one of those is
prerendered correctly. So the comment's ranking is wrong in both directions.

`sofia/companies` is still worth fixing, on the symmetry argument the prompt gives: its four
siblings are declared and it is not.

```bash
for p in sofia/parties sofia/preferences sofia/flash-memory sofia/recount sofia/companies; do
  printf "%-24s %s\n" "$p" "$([ -f dist/$p/index.html ] && echo yes || echo NO)"; done
# sofia/parties yes · sofia/preferences yes · sofia/flash-memory yes · sofia/recount yes
# sofia/companies NO
```

Same for `procurement/tenders` (siblings `procurement/contracts`, `/appeals`,
`/by-settlement` all `dist=yes en=yes`) and `sector/administration/services`
(parent `sector/administration` is `dist=yes en=yes`).

### 0.4 A2 — `/budget/deep-dive`'s og:image

Confirmed as described. `routes.ts:3137` declares `ogImage: "/og/budget.png"`; the only
capture writing that file is `capture-screens.ts:437-451`, re-anchored onto `waitFor:
'[data-og="budget-hub"]'` / `anchor: "h1"` when `/budget` became the hub. The anchor the
deep dive needs still exists:

```bash
grep -n 'data-og' src/screens/components/budget/BudgetFlowTile.tsx
# 222:    <Card className="my-4" data-og="budget-flow">
```

`/og/budget-deep-dive.png` does not exist, so declaring it before capturing would trip
`no route points at a card nothing writes`.

### 0.5 A3 — the four charts, rendered for the first time

The premise is exactly right, and I reproduced it first-hand: the in-app browser pane reports
`{w: 0, h: 0}` and `/budget/functional` yields **0** `.recharts-surface` there, while its
ranked `<ul>` renders every figure. That is the width-0 condition, and it is why a data-layer
gate cannot see a chart.

At a **real** viewport, driven by the same Playwright the og capture uses, all four render:

```bash
# probe: chromium.launch(); newPage({viewport:{width:1280,height:900}}); goto; waitForTimeout(3500)
```

| page | surface | bars/rects | line/area | axis texts |
|---|---|---|---|---|
| `/budget/functional` | 1264×300 | 10 | 0 | 15 |
| `/budget/execution` | 1230×280 | 12 | 4 | 17 |
| `/budget/revenue` | 220×200 (donut) | 0 | 0 | 0 |
| `/budget/personnel` | 1230×200 | 9 | 2 | 19 |
| `/budget/deep-dive` | 3 surfaces | 21 | 6 | 36 |

T9.1's label fix is confirmed live — three COFOG ticks are truncated with `…` and carry a
`<title>` with the full string, including the 38-character
„Жилищно строителство и благоустройство" that started the sweep.

**Two defects the data-layer gates cannot see, both found the moment a viewport existed.**
Re-run at 375×800:

1. **`/budget/personnel` scrolls horizontally on mobile.**
   `documentElement.scrollWidth = 514` against `clientWidth = 375` — 139 px of empty
   sideways scroll. The culprit is `<table className="sr-only">`
   (`src/screens/budget/BudgetPersonnelChart.tsx:181`), the screen-reader twin T9.1 gave the
   personnel chart. Tailwind's `sr-only` sets `width: 1px`, but **CSS `width` on a `<table>`
   is a minimum, not a maximum** — the table lays out at `min-content` (490 px) regardless,
   and although `position: absolute` takes it out of flow it still contributes to the
   scrollable overflow area. Measured: the table and 43 of its descendants report
   `right = 514`. The page renders correctly; only the scroll extent is wrong, which is
   precisely why nothing caught it.
2. **`/budget/revenue`'s donut is 417 px wide inside a 375 px viewport.** The
   `.recharts-responsive-container`, its `svg` and its legend `<ul>` all report
   `right = 425`. An ancestor clips it (page `scrollWidth` stays 375), so the visible result
   is a donut noticeably off-centre and a legend flush to the right edge rather than a broken
   page. Lower severity than (1), and I am proposing to record it rather than fix it here.

Cost of the mechanism: **23.4 s wall** for five pages including browser launch
(`time (W=375 BASE=… npx tsx probe.ts)`).

### 0.6 A4 — `adopted_by_item_id`

```bash
psql "$U" -c "select count(*) total, count(adopted_by_item_id) with_item from budget_document;"
#  total | with_item
#     33 |         0
psql "$U" -c "select count(*) total_bills, count(final_item) with_final from bill;"
#  total_bills | with_final
#          504 |          0
psql "$U" -c "select count(*) from vote_item
              where title ilike '%държавния бюджет%' and superseded_by is null;"   # → 1223
```

So: 33 documents, none resolved; 504 second-reading bills, **none** with a `final_item`
(matching CLAUDE.md's "`final_item` is always NULL … NULL means 'not derivable'"); 33 of
those bills are budget bills, spread across 8 parliaments, all `final_item IS NULL`; and
1,223 live roll-call items mention „държавния бюджет".

The corpus therefore *has* candidates and *has no adoption edge*. Closing the gap by matching
those 1,223 titles is exactly the "No title-regex inference of what adopted a document" clause
that `BudgetLawScreen.test.tsx` already enforces one row above in §11.

### 0.7 B1 — the bucket

**Three of the four families named in the prompt are already gone.** The `gsutil -m rm` that
`scripts/bucket_sync_paths.ts:111` documents as pending has evidently been run:

```bash
for d in parliament/mp-management parliament/companies-by-ekatte \
         parliament/companies-by-obshtina parliament/company-connections; do
  echo "$d $(gsutil ls -r gs://data-electionsbg-com/$d/** 2>/dev/null | grep -c '\.json$')"; done
```

| family | objects on bucket | bytes (`gsutil du -s`) |
|---|---|---|
| `parliament/mp-management/` | **0** (`CommandException: … matched no objects`) | — |
| `parliament/companies-by-ekatte/` | **0** | — |
| `parliament/companies-by-obshtina/` | **0** | — |
| `parliament/company-connections/` | **16,609** | 31,090,853 |

So the "1,542 frozen objects" in `bucket_sync_paths.ts` and in CLAUDE.md is stale prose, and
the one family actually still there is the 2026-07-29 one — at **16,609** objects, not the
"~16.8k" the code comment estimates.

Listing `gs://data-electionsbg-com/parliament/` surfaced **three more** orphan families the
prompt does not name:

| family | objects | bytes | excluded from sync? |
|---|---|---|---|
| `parliament/official-connections/` | 9,336 | 34,670,649 | **no** |
| `parliament/mp-connections/` | 1,069 | 12,286,465 | **no** |
| `parliament/by-id/` | 2,123 | 1,191,373 | **no** |
| `parliament/connections*.json` (7 files) | 7 | 25,120,077 | **no** |

Total recoverable: **29,144 objects / 104.4 MB**, of which 31.1 MB is frozen and 73.3 MB is
being **re-uploaded on every `bucket:sync`**.

### 0.8 B2 — `data/parliament/votes/sessions/`

```bash
ls data/parliament/votes/sessions/ | wc -l          # → 613
du -sh data/parliament/votes/sessions/              # → 290M
du -sk data/parliament/votes/sessions/ | awk '{print $1*1024/613}'   # → 495,556 B average
```

The blocking precondition is unchanged: `src/data/parliament/votes/useRollcallSession.tsx:13`
still fetches `/parliament/votes/sessions/${date}.json`. Disk-side readers that must survive
any bucket change: `scripts/db/load_rollcall_pg.ts:59`, `scripts/person/mpSeats.ts:64,318`,
`scripts/prerender/votesFacts.ts`, `scripts/db/tests/session_route.data.test.ts:17`.

### 0.9 B3 — the legacy budget tiles

The prompt says 35 files. There are **39** non-test `.ts(x)` files in
`src/screens/components/budget/` (35 `.tsx` + 4 `.ts`). More importantly, **only 17 of them
are reachable solely through `/budget/deep-dive`** — the other 22 are load-bearing for the
migrated sub-pages.

Measured by re-running `budgetHubCoverage.test.ts`'s own edge rules (comments stripped
line-first, `import type` excluded, static + `import()` followed) twice: once from the router
roots, once with the `routes.tsx → screens/BudgetScreen.tsx` edge severed.

```
TILES_TOTAL=39
REACHABLE_ONLY_VIA_DEEPDIVE=17
ALSO_REACHABLE_ELSEWHERE=22
TOTAL_SRC_FILES_THAT_WOULD_DIE=18      (the 17 + screens/BudgetScreen.tsx itself)
```

The 17: `BudgetFlowTile`, `BudgetFlowGraphic`, `BudgetFlowMobile`, the five
`BudgetFlow*Drilldown`s, `budgetFlowModel.ts`, `DrilldownLoadingShell`,
`BudgetCitizenViewTile`, `BudgetJourneyTile`, `BudgetMinistriesTile`, `BudgetPersonnelTile`,
`BudgetSocialFundsTile`, `BudgetTopDeviationsTile`, `BudgetTrendTile`,
`BudgetInvestmentProjectsTile`.

The 22 that would **not** die include `BudgetTaxCalculator`, `BudgetPolicySimulator` and its
four policy components, `BudgetSummaryTile`, `BudgetPeerComparisonTile`,
`BudgetRevenueCompositionTile`, `budgetFormat.ts`. Retiring the deep dive is therefore an
18-file change, not a 35-file one, and "the 35 legacy tiles" is not a coherent unit of work.

### 0.10 B4 — the sweep

**Both traps confirmed. Neither may be retired.**

```bash
ls -la data/budget/derived/ministry_procurement.json    # 13,860 bytes (not 16 KB)
grep -n 'ministry_procurement' scripts/db/load_budget_pg.ts
# 483, 591 — stamps budget_admin_node.eik; 157's whole footprint joins contracts on it
ls -la data/macro_peers.json                            # 813,236 bytes (794 KB)
grep -rln 'macro_peers' --include=*.ts --include=*.tsx src/    # → 10 files
```

`macro_peers.json`'s readers include `src/screens/budget/BudgetHubScreen.tsx` and
`src/screens/components/budget/BudgetPeerComparisonTile.tsx` — so it is not even fully retired
*from `/budget`*, let alone from the site.

**New findings, applying the same "retired from one consumer is not retired" test:**

| artifact | state | verdict |
|---|---|---|
| `CompanyConnectionsSection.tsx` + `useCompanyConnections.ts` | imported by **nothing** — the only mention outside themselves is a comment in `retired.test.ts:22` | dead code; it was the last reader of `company-connections/` |
| `data/parliament/connections*.json` (7 files, 25.1 MB) | mtime + last commit both `2026-07-29` (`44718382f9`); **no writer anywhere in `scripts/`** | frozen — but see the next row |
| `parliament/connections.json` (15.6 MB) | **advertised as a downloadable dataset** on `/data` — `scripts/prerender/routes.ts:1018`, `dist:` entry with BG + EN names | **do not delete.** A published dataset link that no longer refreshes |
| `parliament/by-id/` | bucket copy has no reader; **disk copy is a parity reference** (`mp_serving.data.test.ts:496`) and is still written by `build_mp_by_id.ts` / `scrape_mps.ts` | never upload; keep on disk |
| `procurement_overview_cache`, `procurement_rankings_cache` | already absent locally (`pg_class` query returns 0 rows) | nothing to do locally; cloud still needs 124's tombstone applied per CLAUDE.md |

```bash
grep -rn 'CompanyConnectionsSection' --include=*.ts --include=*.tsx src/ scripts/   # 1 comment only
git log -1 --format='%h %ad' --date=short -- data/parliament/connections.json       # 44718382f9 2026-07-29
sed -n '1016,1020p' scripts/prerender/routes.ts                                     # dist: "/parliament/connections.json"
psql "$U" -tAc "select relname from pg_class where relkind='m'
                and relname in ('procurement_overview_cache','procurement_rankings_cache');"   # empty
```

---

## 1. Tiers

Each tier is one commit. Ordered so nothing depends on a later step.

### T0 — teach the coverage gate to read its three inputs correctly

**No behaviour change to the site.** This is first because every A1 decision after it is made
against numbers this step corrects, and because leaving the gate reporting 41 phantom paths
guarantees the next reader dismisses it.

Three fixes in `scripts/prerender/ogAndSitemapCoverage.test.ts`:

1. **Resolve router nesting to any depth.** Replace the `parentSpans` / `prefixAt` scan.
   A regex over JSX cannot do this (my own first attempt at a depth-tracking regex
   miscounted and produced 200-character garbage paths, because multi-line `element={…}`
   JSX contains `/>` of its own). Two workable options, in preference order:
   - **Read `dist/` instead.** The property the gate actually cares about is „does this page
     have its own prerendered head", and `dist/<path>/index.html` answers it directly,
     including for `dynamicRoutes.ts` producers. Requires a build, so the clause must
     `it.skip` when `dist/` is absent — the same shape `families.data.test.ts` already uses.
   - **Parse with the TypeScript compiler.** `ts.createSourceFile(…, ts.ScriptKind.TSX)` and
     walk `JsxElement` / `JsxSelfClosingElement`, carrying a segment stack. This is what
     produced §0.1's `187`; it needs no build and is exact. `typescript` is already a
     dependency.
2. **Flatten `routeDefs()` recursively**, mirroring `scripts/sitemap/index.ts:782-783`.
3. **Union in the `dynamicRoutes.ts` producers**, or drop the `no-staticPage` clause in
   favour of the `dist/` check from (1).

Also: filter `<Route>` nodes with no `element` (5 group nodes today) and recognise the
`*Redirect` component form alongside `<Navigate>` (`data/map`).

Then **re-baseline the tripwire to the corrected number and state the date beside it.**

**Defect class caught:** a routed page that ships without its own head.
**Mutation check — three, one per narrow read:**
- add a throwaway `<Route path="zz-ghost" element={<Layout/>}>` nested two deep inside
  `<Route path="reports">`; the gate must report `reports/zz-ghost`, not `zz-ghost`.
- delete the `children:` array from the `reports` entry in `route_defs.ts`; the count must
  jump by 41.
- delete `...buildReportRoutes()` from `dynamicRoutes.ts:4614`; the count must jump by 41.

Each mutation is reverted immediately; none is committed.

⚠️ **Do not skip the third mutation.** Without it, a gate rewritten to read `dist/` passes
vacuously on any checkout where `dist/` is stale — and a stale `dist/` is the normal state of
this repo between builds.

### T1 — declare the four pages that should be declared

Of the 12, four are ordinary public pages whose siblings are all declared. Add each to
`prerenderRoutes` (with an `english:` block), to `routeDefs()` and to `ENGLISH_STATIC_PAGES`,
then `npm run build && npm run sitemap` and commit `public/sitemap*.xml`.

| path | why declare | evidence |
|---|---|---|
| `procurement/tenders` | linked twice from prerendered `/procurement` copy; `contracts`/`appeals`/`by-settlement` siblings all `dist=yes en=yes` | `routes.ts:4649` |
| `sofia/companies` | four Sofia siblings declared, this one not | §0.3 |
| `sector/administration/services` | parent `sector/administration` declared | §0.3 |
| `subsidies/browse` | parent `subsidies` declared | §0.3 |

**One commit per family**, not one for all four — `procurement/tenders` needs a body written
about a server-driven browser, and bundling it with three others makes the sitemap diff
unreviewable.

⚠️ **Both halves are required.** `routeDefs()` mints the Bulgarian `<loc>`,
`ENGLISH_STATIC_PAGES` the `/en` mirror; `route_defs.ts`'s own Sofia comment records the last
time only one was filled and the sitemap named `/en/…` with no canonical.

Then widen the gate's `ENFORCED` list one family at a time: `procurement`, then `sofia`, then
`sector`, then `subsidies`. Widening the list is the last line of each commit, so a family is
never enforced before it is fixed.

### T2 — record the eight that legitimately have no static page

Not a code change to the router — an **exemption table with a reason each**, in the gate,
in the shape §11 asks for ("a row that names no file is better than a row that names the
wrong one"):

| path | reason |
|---|---|
| `following` | browser-local watchlist; already commented „noindex; never prerendered and absent from the sitemap" at `src/routes.tsx:4251` and `noindex` in `FollowingScreen.tsx` |
| `procurement/watchlist` | browser-local (`localStorage`), same class — but it carries **no `noindex`** today; add one in this commit |
| `procurement/projects` | „my project files", browser-local (`localStorage`), same class; also no `noindex` today |
| `procurement/project` | a resolved DIY/URL-built file; already sets `noindex, follow` at runtime (`ProjectFileScreen.tsx:416,430`) |
| `my-area` | an entry/redirector into `/governance/:id`; the destinations are prerendered |
| `db` | the SQL browser (`src/screens/dev/SqlBrowserScreen.tsx`) — a developer tool |
| `consumption/basket` | needs a decision (below) |
| `procurement/overview` | needs a decision (below) |

**Two of the twelve I am not deciding, because deciding them is not a hygiene call:**

- **`procurement/overview`** may be category (c) — the route should not exist. `/procurement`
  is the hub and `ProcurementOverviewScreen` is a second, unlinked overview. Whether it is a
  live page or migration residue is a `/procurement` question. Recorded, not resolved.
- **`consumption/basket`** is the only `/consumption` sub-page not declared; its eleven
  siblings are. Likely a T1 case, but `/consumption` is an in-flight module
  (`project_consumption_view`), so declaring a page there could conflict with work in
  progress.

Both go in the exemption table as **`UNDECIDED`, with the question written out** — an
exemption that records a question is honest; an exemption that implies a decision nobody made
is the "aspirational rather than descriptive" failure §11 documents.

⚠️ **A `noindex` is not a substitute for a decision.** Adding `noindex` to
`procurement/watchlist` and `procurement/projects` makes the exemption *true* — without it,
the exemption says „a crawler should not index this" while nothing tells the crawler so.

### T3 — capture `/budget/deep-dive`'s own card, then declare it

**Order is load-bearing and is the whole point of this tier.** Declaring an `ogImage` before
the card exists ships an og:image that 404s — the `/funds/calls` defect
`ogAndSitemapCoverage.test.ts` was written for.

1. **Commit 1 — capture.** Add a `capture-screens.ts` entry: `slug: "budget-deep-dive"`,
   `routePath: "budget/deep-dive"`, `waitFor: '[data-og="budget-flow"]'`,
   `anchor: '[data-og="budget-flow"]'`, `centerOnAnchor: true`, `settleMs: 3000`. Run the
   capture; commit `public/og/budget-deep-dive.png` **with** the entry. The Sankey is a wide,
   short graphic, so check the clip before committing — `centerOnAnchor` on a wide element is
   what `capture-screens.ts:439-450` records going wrong for the hub.
2. **Commit 2 — declare.** Change `routes.ts:3137` to `ogImage: "/og/budget-deep-dive.png"`
   and replace the ⚠️ comment with what was done.

**Defect class:** a page sharing another page's share card / pointing at a card nothing
writes.
**Mutation check:** the existing `no route points at a card nothing writes` and `no capture
writes a card no page points at` clauses already cover both directions. Prove they still
discriminate by (a) doing commit 2 first in a scratch working tree and watching the first
clause go red, then (b) doing commit 1 alone and watching the second go red. Neither scratch
state is committed. If **neither** fires, the gate has gone vacuous and that is the finding.

### T4 — the four charts get a render gate

The mechanism is the one the repo already owns: Playwright at a real viewport. §0.5 proves it
works on all four pages and costs 23.4 s for five pages.

Add to `tests/ui.spec.ts` (which already runs under both a Desktop Chrome and a Pixel 7
project, so one spec gives both viewports for free):

1. **Every charted page paints a chart.** For each of `/budget/functional`,
   `/budget/execution`, `/budget/revenue`, `/budget/personnel`: at least one
   `.recharts-surface` with `width > 0`, and its expected mark count — 10 bars on
   `functional` (one per COFOG function, the T9.1 clause), `> 0` rects on `execution` and
   `personnel`. `revenue` asserts a surface only: it is a donut with no axis and no
   `.recharts-rectangle`.
2. **No category tick is silently clipped.** Every `.recharts-yAxis text` either fits or
   carries a `<title>` with the full string. This is T9.1's actual finding, and today it
   passes by construction on three ticks — which is what makes it worth pinning.
3. **No horizontal overflow at 375 px**, per page. `ui.spec.ts:115` already has this test but
   only against `/`. Generalise it over a route list including the four.

**Defect class:** a chart that renders nothing, renders the wrong number of marks, clips its
labels, or overflows the viewport — none of which any data-layer test can observe, because
`ResponsiveContainer` at width 0 satisfies every one of them.

**Mutation check (this is where §11's "prove it can fail" bites hardest, because a chart gate
in a headless environment is the textbook vacuous gate):**
- slice `budgetFunctionalBars.ts` to 7 bars → clause 1 must go red. (T9.1 records that with
  the derivation inline, exactly this mutation left the whole suite green.)
- remove the `<title>{full}</title>` child from `CategoryTick` → clause 2 must go red.
- **the anti-vacuity clause:** assert `.recharts-surface` count `> 0` *site-wide* before any
  per-page assertion, so a Playwright config change that gives the project a 0-width viewport
  fails loudly rather than passing every clause trivially.

⚠️ Clause 3 **fails today** — `/budget/personnel` is at `scrollWidth = 514` vs
`clientWidth = 375`. So T4 is two commits:

- **T4a — fix the overflow.** `<table className="sr-only">`
  (`BudgetPersonnelChart.tsx:181`) needs `table-layout: fixed` plus an explicit `w-px`, or
  the `sr-only` moved to a wrapping `<div>` with the table inside it. Verify with the 375 px
  probe: `scrollWidth` must equal `clientWidth`.
- **T4b — add the gate.** Committing the gate first would land a red suite.

### T5 — resolve the ⛔ §11 row

`adopted_by_item_id` cannot become a gate on this corpus (§0.6). Three options; I recommend
the second.

1. ~~Resolve the edge by matching the 1,223 „държавния бюджет" items.~~ Rejected — it is
   title-regex inference, which §11 forbids one row above.
2. **Rewrite the row as a conditional gate and leave the column NULL.** The clause becomes:
   *„if any `budget_document.adopted_by_item_id` is non-NULL, it references a `vote_item`
   with `superseded_by IS NULL`"* — plus the anti-vacuity assertion *„and today that set is
   empty, which is why this clause has never executed its body"*. This is a real gate from the
   day the first row is resolved, it can be mutation-checked **now** (insert a resolved row
   pointing at a superseded item inside a rolled-back transaction and watch it fail), and it
   stops being a claim about coverage the repo does not have. Lives in
   `budget_pg_roundtrip.data.test.ts`, beside the existing
   `adopted_by_item_id is never inferred` clause (`:416-419`) which asserts the converse.
3. Delete the row. Rejected: the column, the loader field (`load_budget_pg.ts:305`), the
   serving field (`155_budget_serving.sql:606`) and the UI field
   (`useBudgetLawDocuments.ts:25`) all exist, so the rule is live even though the data is not.

One commit: rewrite the §11 row in `budget-hub-v1.md`, add the conditional clause with its
mutation check.

### T6 — remove the bucket's dead connections families

**Nothing here is deleted on suspicion.** Every family below has been checked against
`src/`, `scripts/` and `functions/` for a runtime fetch, a build-time read and a test
reference.

**Commit 1 — delete the dead code that was the last reader.**
`src/screens/components/connections/CompanyConnectionsSection.tsx` and
`src/data/parliament/useCompanyConnections.ts`. Verification that they are unreferenced:

```bash
grep -rn 'CompanyConnectionsSection\|useCompanyConnections' --include=*.ts --include=*.tsx src/ scripts/
# → one comment in src/screens/components/connections/retired.test.ts:22 and nothing else
npx tsc -b && npm run test:unit
```

Update that comment (it currently exempts both symbols from the retired-symbol scan) to
**add** them to `RETIRED`, so the dead pipeline cannot creep back. Undo: `git revert`.

**Commit 2 — exclude the four unexcluded families from sync.** In
`scripts/bucket_sync_paths.ts`: `isExcluded` branches **and** `CHILD_EXCLUDES` entries for
`parliament/mp-connections`, `parliament/official-connections`, `parliament/by-id`, and the
seven `parliament/connections*.json` files; plus the matching arm in the `-x` regex of **both**
`bucket:sync` and `bucket:sync:dry` in `package.json`. `bucket_sync_paths.test.ts` already
holds all three in lockstep and asserts the two regexes are byte-identical — extend its
existing `describe`s rather than adding a new file.

⚠️ **`parliament/connections.json` gets an exclusion but must NOT be deleted from the
bucket.** It is advertised on `/data` as a downloadable dataset
(`scripts/prerender/routes.ts:1018`, BG + EN). Excluding it freezes the download at its
2026-07-29 vintage — which is already the truth, since nothing regenerates it. Deleting it
turns a stale download into a 404 on a page that promises it.

⚠️ **`parliament/by-id/` gets an exclusion and stays on disk.**
`scripts/db/tests/mp_serving.data.test.ts:496` reads it as the parity reference for
`mp_entry()`, and `build_mp_by_id.ts` still writes it. Same shape as `parliament/profiles`.

**Commit 3 — operator action, run by hand, not in a commit.** Verify before and after:

```bash
# BEFORE — record the counts
for d in company-connections mp-connections official-connections by-id; do
  echo "$d $(gsutil ls gs://data-electionsbg-com/parliament/$d/** 2>/dev/null | wc -l)"; done
# expect 16609 / 1069 / 9336 / 2123
gsutil du -s gs://data-electionsbg-com/parliament/{company-connections,mp-connections,official-connections,by-id}

# THE REMOVAL
gsutil -m rm -r gs://data-electionsbg-com/parliament/company-connections \
                gs://data-electionsbg-com/parliament/mp-connections \
                gs://data-electionsbg-com/parliament/official-connections \
                gs://data-electionsbg-com/parliament/by-id

# AFTER — every one must report "matched no objects"
for d in company-connections mp-connections official-connections by-id; do
  gsutil ls gs://data-electionsbg-com/parliament/$d/ 2>&1 | head -1; done
```

**Undo:** all four exist on disk (`data/parliament/company-connections` 19,232 files / 83 MB —
note the disk copy is *larger* than the 16,609 on the bucket; `mp-connections` 939 / 12 MB;
`official-connections` 4,483 / 25 MB; `by-id` 2,122 / 8.3 MB). Re-upload is
`gsutil -m cp -r -Z data/parliament/<family> gs://data-electionsbg-com/parliament/`. Three of
the four are git-TRACKED (`company-connections` is gitignored), so the disk copy is itself
recoverable. **Do the removal after commit 2 has been pushed**, so no sync can re-upload
between the two.

**Commit 4 — correct the stale prose.** `scripts/bucket_sync_paths.ts:105-118` and the
matching CLAUDE.md paragraph both describe a removal as pending that has already happened, and
put the frozen count at 1,542 when the one surviving family held 16,609. Replace both with
what T6 actually did. This is the cheapest commit in the plan and the one most likely to be
skipped; it is also the one whose absence caused this plan to start from a wrong premise.

### T7 — `data/parliament/votes/sessions/` stays, and here is what would move it

**Not doing the retirement.** Its precondition is unmet and meeting it is not a hygiene task.

Recorded so the next reader does not re-derive it. In order:

1. Move `SessionScreen` off `useRollcallSession` onto `/api/db/session?date=` +
   `/api/db/session-item?item=`. The screen currently reads `mpNames`, `mpParty` and every
   item's `votes` from the file; the two routes split that into a 14-buffer day call and a
   ~64-buffer per-item call.
2. Verify on prod.
3. **Then** the three lockstep places, in one commit: `isExcluded`, `CHILD_EXCLUDES`, and the
   `-x` regex in **both** `bucket:sync` and `bucket:sync:dry`.
   `bucket_sync_paths.test.ts` holds them.

⚠️ **The files stay on disk either way** — they are the loader's input
(`load_rollcall_pg.ts:59`), the prerender's fact source (`scripts/prerender/votesFacts.ts`),
`mpSeats.ts`'s input and a data test's fixture. The 290 MB is not recoverable from disk; only
the bucket copy is.

⚠️ **The exclusion FREEZES rather than retires.** `gsutil rsync -x` excludes a match from
deletion as well as upload and `syncPaths` passes `-x` with `-d`, so removing the objects is a
separate explicit `gsutil -m rm -r`. Do not write step 3 as if it retires anything.

### T8 — `/budget/deep-dive` stays, and the tile gate stays as it is

**Assessed honestly, as the prompt asks: the Sankey is worth keeping the page for.**

- It is the only surface rendering the money-flow Sankey and its five drilldowns. `/budget/explorer`
  renders a **level** of a tree, not a flow, so it does not reproduce them — `routes.tsx:720-728`
  and `budget-hub-v1.md` T7 both record this, and my reachability measurement confirms the five
  `BudgetFlow*Drilldown` files have no other route.
- The page is `lazy`, so its chunk and its four fetches are paid only by a reader who asks
  for it. Keeping it costs the hub nothing.
- Retiring it deletes **18** files, not 35 (§0.9). The other 22 are load-bearing for the
  migrated pages, so "delete the legacy tiles" is not available as a unit of work regardless.
- T3 is about to give it its own share card, which is an investment in the page, not a
  step toward retiring it.

**One correction to make, though**, since the numbers are in hand:
`budgetHubCoverage.test.ts:'keeps every LEGACY tile reachable too, or deleted'` carries the
comment „the 26 tiles the migration replaced" (`:144`). There are 39 files, 17 of them deep-dive-only.
Fix the comment and record the 17/22 split — a gate whose comment misstates its own scope is
the §11 failure mode, and this one understates it by 13.

That is a comment-only commit and belongs with T0.

---

## 2. Cloud deploy ordering

**Nothing in this plan touches Cloud SQL, and nothing needs `deploy:db`.** Stated explicitly
because the CLAUDE.md rule (Cloud SQL migration → `npm run deploy:db` → `npm run deploy`)
governs most work in this repo and its absence here should be a decision, not an omission.

- T0–T5, T8 are source, test and doc changes → `npm run deploy` only, and only after
  `npm run build` regenerates `dist/` and `npm run sitemap` regenerates the committed
  sitemaps.
- T1 changes the sitemap. `public/sitemap*.xml` is committed and `npm run sitemap` is manual,
  so **the commit must include the regenerated XML** or `every prerendered page is in the
  committed sitemap` fails.
- T6 is a bucket operation. It touches neither hosting nor the function, and the ordering
  that matters is internal to T6: **exclusion commit pushed before the `gsutil rm`**, or a
  sync between the two re-uploads what was just deleted.
- T4a changes a component → `npm run deploy` after `npm run build`.

The one CLAUDE.md item this plan **surfaces but does not do** is the migration-124 tombstone
on Cloud SQL (`apply_functions.ts 025_procurement_overview.sql 031_procurement_rankings.sql`).
Both matviews are already gone locally (§0.10); whether prod still carries them is unmeasured,
because I did not connect to Cloud SQL. Measure before acting.

---

## 3. Not doing, and why

| Item | Why not |
|---|---|
| **Retiring `data/parliament/votes/sessions/`** | Precondition unmet — `useRollcallSession.tsx:13` still fetches it. Moving `SessionScreen` onto the two PG routes is a feature change, not hygiene. Sequenced in T7. |
| **Retiring `/budget/deep-dive` and the legacy tiles** | The Sankey and its five drilldowns exist nowhere else, the page is lazy so it costs the hub nothing, and only 17 of the 39 files are actually deep-dive-only. Assessed in T8. |
| **Deleting `parliament/connections.json` from the bucket** | It is a published dataset on `/data`. Frozen ≠ deletable. T6 excludes it from sync and leaves the object. |
| **Deleting `data/budget/derived/ministry_procurement.json`** | Load-bearing: `load_budget_pg.ts:483,591` stamps `budget_admin_node.eik` from it for 46 of 54 nodes, and migration 157's whole footprint joins `contracts` on that column. |
| **Deleting `data/macro_peers.json`** | 10 readers in `src/`, including `/indicators/compare` **and** `BudgetHubScreen.tsx` — it is not even fully retired from `/budget`. |
| **Resolving `adopted_by_item_id` by title matching** | 1,223 candidate items exist, and matching them is the title-regex inference §11 forbids one row above. T5 takes the conditional-gate route instead. |
| **Deciding `procurement/overview` and `consumption/basket`** | `procurement/overview` may be an unlinked duplicate of the `/procurement` hub — a module question. `/consumption` is an in-flight module. Both recorded as `UNDECIDED` with the question written out rather than given an exemption that implies a decision nobody made. |
| **Fixing `/budget/revenue`'s 417 px donut at 375 px** | Real (§0.5) but cosmetic: an ancestor clips it, so the page does not scroll and the effect is an off-centre donut. Recorded here; not worth a commit against the four-page chart gate. If T4's clause 3 is later widened to per-element overflow it will surface on its own. |
| **A full PG "tables nothing reads" sweep** | Scoped out honestly. I checked the two matviews CLAUDE.md names as retired (both already gone locally) and did not attempt a whole-database orphan sweep — doing it properly needs a reader census across `functions/`, every `*.sql` body via `pg_get_functiondef`, and the AI tool registry, which is its own plan. Claiming a clean sweep on a grep would be worse than saying it was not done. |
| **Anything on Cloud SQL** | No measurement was taken against the serving database. Every cloud claim in this plan would be inferred, and CLAUDE.md is full of cases where local and cloud disagreed while every row count reconciled. |

---

## 4. One thing to carry forward

Three of this plan's inputs — the tripwire's `67`, `bucket_sync_paths.ts`'s `1,542 objects`,
and `budgetHubCoverage.test.ts`'s `26 tiles` — were prose describing a measurement that had
moved. Each was written by someone who had just measured it. The pattern is not carelessness;
it is that **a number in a comment has no gate on it**.

Where a number matters, the cheap fix is to make the code compute it and assert a *property*
instead: not „67 undeclared" but „every routed page has a `dist/<path>/index.html`"; not
„1,542 frozen objects" but the `gsutil ls | wc -l` that T6 runs before and after; not „26
tiles" but the 17/22 split, which falls straight out of the reachability walk
`budgetHubCoverage.test.ts` already performs — it builds the whole edge graph and then asks it
only one question.
