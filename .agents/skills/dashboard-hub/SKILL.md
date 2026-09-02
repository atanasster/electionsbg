---
name: dashboard-hub
description: Build or rework a module front page (a "hub") — the tile-grid landing that fronts a topic's sub-pages, like /parliament, /procurement or /governance/sectors. Covers the whole shape: the HUB HEAD (hero) — eyebrow, title, deck, scope, search, a KPI band with a declared basis per figure, and a ranked evidence list — the tile registry, bespoke SVG scenes, the ONE small precomputed stat blob that replaces per-tile artifact fetches, band structure and naming, destination reachability, the three artifacts every hub page and sub-page must ship (a prerendered static page, a sitemap <loc> in BOTH route_defs lists, and its own og:image screenshot of a chart or map), and the gates that keep every figure honest. Use when the user asks to build a hub / module landing / dashboard front page for a topic, to add a hero / header / KPI band / stat strip to a hub, to restructure an existing hub's tiles or sections, to add a tile, to cut a hub's payload, or to check a module's pages for prerender / sitemap / og:image coverage. Encodes the defect classes this pattern reliably produces — undeclared bases, figures that are arithmetically right and false as a sentence, seeded destinations, dead links, captions that describe a different chart, pages with no sitemap entry, share cards that 404 or fall back to the site-wide default, a KPI band that publishes one scope's figures under another scope's caption, and rules written here that were never turned into gates.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - Agent
  - Skill
---

# Dashboard hub skill

A **hub** is a module's front page: a `HubHead` — eyebrow, title, deck, scope, search, a KPI
band and a ranked list — then bands of `InfographicTile`s that front the module's sub-pages.
`/parliament` is the worked example for the bands; `/procurement` and `/governance` for the
head. `/governance/sectors` and the analysis hub are the same shape.

⚠️ **The head is §3.0 and it is not optional.** Measured across all 13 tile hubs on
2026-08-22, **not one made a corpus-level statement above the fold**: the best four landed
their first figure at 803–826 px — at the fold edge, inside a tile banner, as a preview of one
destination — and `/governance` carried no number at all until **2 355 px** on a 2 789 px page.
Thirteen hubs each composed their own header by hand and no two agreed: search on 6 of 13, an
intro sentence on 5, a breadcrumb on 9, a KPI row on 2 (both below the fold). Full measurement
and the decisions: `docs/plans/hub-hero-v1.md`.

**For a SECTOR surface, read `sector-dashboard` alongside this.** That skill owns
the data layer underneath — the EIK register that decides who the sector is, the
multi-corpus money union, coverage declarations, competition baselines, the people
bridge and the grant→contract spine. This one owns everything you can see; that
one owns everything you can count.

This skill is mostly about **what goes wrong**. The layout is easy. Every hub built on this
pattern has shipped the same defects, and they share one signature: **a figure that is
arithmetically correct and, read as a sentence, false.** Those survive code review, survive
tests written from the same misunderstanding, and are caught by comparing against an
artifact you did not write — or by looking at the rendered page.

---

## 0. Before writing anything: measure the numbers you intend to show

Do this first, in a scratch script against the real corpus. Not from the plan, not from a
doc, not from a previous tile.

For **every** figure a tile will display, write down:

- the number,
- **the denominator**, and
- the other defensible answers to the same question.

This is not ceremony. On the parliament hub there were three defensible answers to "how
many votes were there" (raw / post-dedupe / titled — 1,263 / 1,198 / 1,157) and three to
"what is attendance" (simple mean 70.2% / weighted 73.2% / over full-term members 73.6%).
An earlier draft picked a different one per tile by accident and **six of six figures were
wrong**, each for a different reason.

A figure whose basis you cannot state in one clause is not ready to ship.

### The specific traps, all of which have shipped

| Trap                                     | What it looks like                                                                                                                                                                                                                                                                                                                   | The rule                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **Corpus total on a scoped hub**         | `613 заседания` on a page scoped to one parliament (real answer: 39)                                                                                                                                                                                                                                                                 | Scope every figure to the page's selector                                                                                    |
| **Destination counts a different set**   | Tile says `240` and lands on a page listing 2,120                                                                                                                                                                                                                                                                                    | Lead with the DESTINATION's basis, or show no figure                                                                         |
| **Sums of votes read as headcounts**     | `за 15 961` in a chamber of 240 — votes summed over 219 items                                                                                                                                                                                                                                                                        | Express as SHARES, from the same function that draws the pixels                                                              |
| **A mean labelled as a minimum**         | `0,94 средна кохезия` where 0.94 was the min and the mean was 0.970                                                                                                                                                                                                                                                                  | Two numbers, two labels; never one number wearing both                                                                       |
| **A projection quoted as the roll**      | Map tile says 270 members; the map plots 255                                                                                                                                                                                                                                                                                         | Quote what the destination DRAWS                                                                                             |
| **Structural zero**                      | `Общини 0` under an MP filter                                                                                                                                                                                                                                                                                                        | Hide a figure that cannot vary; do not print 0                                                                               |
| **Undeclared "not derivable"**           | `0% присъствие` on a day with no roll call                                                                                                                                                                                                                                                                                           | NULL means "cannot derive"; render it as absent, never as 0                                                                  |
| **A ROLL-UP PARTITION inside the table** | `1 994 автомобила` on a registry of 621 — the table carries one partition per parliament PLUS an `'all'` row, so `count(*)` counts each car once per parliament its owner sat in                                                                                                                                                     | `GROUP BY` the partition key and READ the row; never `count(*)` a table you have not grouped                                 |
| **The destination's DEFAULT SCOPE**      | Tile shows the lifetime 621; `/mp-cars` opens `scope="ns"` on the 52nd's 65 — and the tile carries `?elections` forward, guaranteeing the mismatch on every parliament                                                                                                                                                               | Key the blob by the destination's scope and resolve it through the SAME helper that screen filters with                      |
| **The right subject, the wrong corpus**  | **[2026-08-20]** Tile counted `company_politicians` (346) over `/mp/companies`, which rendered `companies-index.json` (2,781). Both are now retired — the tile quotes `official_companies` over `/governance/companies` — and the temptation is unchanged: `company_politicians` is still the table that is _about_ the same subject | Quote the DESTINATION's own relation, whatever kind it is — a table about the same subject is a different corpus             |
| **A serving function's DEFAULT scope**   | **[2026-08-24]** `agri_hub_stats('')` returns the latest FINANCIAL YEAR — €1.59bn for 2025 — against €11.04bn all-time from `agri_hub_stats('all')`. The empty string reads like "no filter" and means "the default one"                                                                                                             | Pass the scope you are quoting, EXPLICITLY, and link the tile with it (`?pscope=all`)                                        |
| **EXECUTED quoted as the budget**        | `budget_hub_stats().expenditureExecutedEur` was €14.15bn on 30 June against €29.58bn planned for the year — quoting it makes the state look like it spends half what it does                                                                                                                                                         | A part-year figure needs the part in its caption, or quote the PLAN and name the year                                        |
| **A SCOPED hook on an UNSCOPED page**    | **[2026-08-22]** `/governance` has no `?pscope`, so `useProcurementHubStats()` resolved to the SELECTED PARLIAMENT and its KPI band rendered **€3,32 млрд. · 3 481 · 227 · 332** under captions reading „договори 2007–2026". The corpus is **€93,56 млрд. · 29 622 · 898 · 871**. `tsc` was clean and 3 655 tests were green        | A page with no selector must ASK for the slice it names (`useX("all")`) — never take a scope hook's default. See §3.1 rule 6 |

**Corollary that has bitten twice:** if a number is computed in two places, it will drift.
Compute it ONCE and have both consumers read that. Where two implementations are
unavoidable (SQL for a route, TypeScript for a fallback — a route cannot import TS), write
the gate that re-derives one from the other over the WHOLE corpus, and verify the gate fails
by breaking each clause in turn.

---

## 1. The payload rule

A hub must not fetch the module's full artifacts to render preview numbers. The parliament
hub's seven mini-tiles pulled **~1.65 MB** between them to draw three rows each.

**One small precomputed blob, keyed by the page's selector.**

```
derived/hub_stats.json        all keys · numbers, coverage, seeds   ~6 KB · always fetched
derived/hub_feed/<key>.json   prose + per-key detail                ~8 KB · on demand
```

Split when the second file carries **text**. Titles in the always-fetched blob multiply by
the number of keys and every visitor downloads the ones they will never read.

Rules that have each been learned the hard way:

- **Generate the blob from the objects the pipeline ALREADY HAS IN MEMORY**, at the end of
  its run — not by re-reading the files it just wrote. Sharing the object is what makes it
  impossible for the hub's numbers to drift from the sub-pages'.
- **Budget it, and gate the budget.** Without a ceiling it regrows to the full artifact the
  first time someone adds a field carrying detail.
- **The artifact carries source text and numbers. No glue prose, no URLs.** Prose belongs in
  i18n or the English hub becomes the Bulgarian one with English headings. URLs belong to
  the SPA's slug helpers, or the generator keeps emitting the old shape after the rule moves
  — green on both sides.
- **`undefined` for an uncovered key is an ANSWER, not a loading state.** Selectors commonly
  map to keys with no data; render the named empty state, not a grid of zeroes.
- **Wire it into the pipeline's `--upload` branch** and gate that generically: _every file
  the generator writes appears in its upload list_. An artifact missing from it is
  regenerated locally, committed, and never uploaded — green everywhere, stale on prod.
- ⚠️ **If the blob is generated from POSTGRES there is no `--upload` branch, and the bullet
  above structurally cannot help you.** The `db:gen-*` family (`db:gen-hub-stats`,
  `db:gen-sector-stats`, `db:gen-culture-hub-stats`, `db:gen-declarations-hub-stats`) writes a
  committed file straight out of the database and uploads nothing. Its publish path is a
  scoped `bucket:sync:paths`, declared as `bucketPath` in **`REFRESH_GENERATORS`**
  (`scripts/db/refresh_coverage.ts`) and verified by `npm run db:check-generated`.

  That registry asserted chain-membership, git-tracking and generator-references-artifact —
  every one a property of the file on DISK — and nothing about the bucket. So all three were
  green for `culture/derived/hub_stats.json` while the object returned **404 for two days**
  (committed 2026-08-19, found 2026-08-21) and `/culture` drew its tiles with no numbers at a
  **200**: §11 step 5's failure exactly, from a direction that step does not look in.

  ⚠️ **The publish trigger is not the owning module's trigger**, which is why no per-module
  instruction closes this. `db:gen-culture-hub-stats` reads contracts, tenders,
  fund_projects, agri_subsidies, person_role and interreg_partners — so the culture hub's
  blob moves when the PROCUREMENT pipeline runs `db:refresh`, while the skill that owns
  `data/culture/` and names its sync wakes only on film-register flips. **A hub whose blob is
  PG-generated does not own its own freshness.** Check it unconditionally rather than
  reasoning about whether this hub is affected.

  The sibling found the same day is the worse shape: `governance/declarations_hub_stats.json`
  was **4 days stale across a key RENAME** (`companies`/`companyMps` →
  `organisations`/`organisationPeople`), so the deployed hub read keys the served blob did not
  carry. A 404 blanks every tile uniformly; a stale blob renders the ones that still match and
  blanks the rest, which reads as a data problem rather than a publish one.

- **A shared type gets ONE declaration.** Two hand-copied halves drifted on a nullability
  within a single review cycle. Put it on the `src/` side and import it from `scripts/`.

### 1.1 A HUB OF HUBS folds; it does not aggregate

When a hub's tiles point at other HUBS — `/governance` is 21 of 23 — every figure it shows is
already published by the page the tile opens. So the blob is a **FOLD of the destinations' own
numbers**, never a fresh aggregate, because an aggregate that is _about_ the same subject is a
different corpus and the two hubs then disagree one click apart. Measured 2026-08-24:

- `sum(amount_eur) FROM contracts WHERE tag='contract'` was **€93.81bn** on a day the committed
  procurement blob said **€93.56bn** — same table, different vintage.
- `funds_hub_stats().isun.contractedEur` is **€44.07bn**; `/funds` renders **€44.27bn**, from
  `fund_payloads(kind='index').totals`. Two definitions of "contracted EU funds", ~€197m apart,
  and only the second is what a reader clicking the tile will see.

Take each figure from the first of these that exists, in this order:

|     | source                                               | example                                                  |
| --- | ---------------------------------------------------- | -------------------------------------------------------- |
| a   | the destination's own serving FUNCTION               | `budget_hub_stats`, `agri_hub_stats`, `council_overview` |
| b   | the destination's own PAYLOAD row                    | `fund_payloads(kind='index')`                            |
| c   | the destination's own committed BLOB                 | `procurement/derived/hub_stats.json`                     |
| d   | a direct count — ONLY where it has none of the above | `declaration`, `graph_edge`                              |

Four consequences, each of which shipped as a rule rather than being reasoned about later:

- **The fold happens in the GENERATOR, at build time.** Client-side it is four requests on the
  one hub that previously made none, which is the thing the payload rule forbids. One blob out,
  one fetch in the browser.
- **Chain position is FORCED: last, after every sibling generator.** Anywhere earlier and it
  folds the previous vintage of whichever sibling has not run yet. Say so in the
  `REFRESH_GENERATORS` `reason`, because nothing else records it.
- **A missing sibling is a SKIPPED FIGURE, never a zero.** The tile renders descriptor-only —
  what it did before the blob existed. `0` is a claim („no EU funds have been contracted").
  Carry a `sources` map in the blob so a reader of the FILE can tell the two apart.
- **`basis` is an ENUM KEY, not prose.** The generator writes `contracted`; i18n turns it into
  „договорени по ИСУН" / "contracted via ISUN". Prose in the blob makes the English hub the
  Bulgarian one with English headings, and gate that both corpora carry every key it emits.

---

## 2. The three files

```
src/screens/<topic>/<topic>Registry.ts    pure data, no JSX
src/screens/<topic>/<topic>Scenes.tsx     id → SVG scene (needs the react-refresh disable)
src/screens/<Topic>HubScreen.tsx          composition
```

**The registry is data.** Each tile: `id`, `titleKey`, `descKey`, `to`, `accent`. Bands carry
a `labelKey` and their tiles.

**Every tile id needs a scene.** `InfographicTile` renders `<Scene />` unguarded, so a
missing one is `undefined` as a component type — "Element type is invalid" and a white
screen, not a blank vignette. Add a DEV console guard and a commit-time gate.

**Scenes are bespoke, 300×116, `currentColor` ink + `var(--sector)` accent.** Draw the thing
the tile is about — a hemicycle, a matrix, an ego graph. A scene that draws the actual
structure (the matrix's diagonal, the strip's gaps) is worth the effort; generic bars are
not.

**Accents are unique per PAGE.** All bands render together, so a repeat reads as "these two
tiles are the same kind of thing". Gate it — and gate it over the **composed page**, not per
registry: on `/procurement` `#c9702f` is worn by the „Договори" tile AND by the „Пътища"
`FeaturedStrip` tile, because the two come from different registries and neither registry's
gate can see the other. `/consumption` has three duplicate pairs inside its own 16 tiles, i.e.
no gate at all.

⚠️ **The palette has a CEILING and it is close.** `tileAccents.ts` held 23 tokens while
`/governance` rendered 23 tiles — exactly exhausted. It is 27 now (four added at the widest
measured hue gaps, each ≥3.4 : 1 on cream AND navy), and **a hue gap is a candidate, not a
licence**: three numerically-available gaps were rejected because 10° from `aqua`/`teal` reads
as "the same colour, slightly off". Above 20 tiles a hub may declare `accentScope: "band"` and
enforce uniqueness within a band and its neighbours instead — a repeat between band 1 and
band 5 is not confusable, which is the thing the rule exists to prevent.

⚠️ **A hub screen must not import a REGISTRY to read a constant from it.** A „Държавни сектори
19" row derived its count from `SECTORS` — the right instinct (never a literal) applied to the
wrong module — and pulled `sectorRegistry`'s whole reference-data closure into `/governance`'s
static graph. That is `src/entryGraph.test.ts`'s class exactly: take a constant from an
import-free module, or take it from the blob you already fetch.

⚠️ **A registry must not BUILD its i18n keys.** ``t(`${cluster.labelKey}_desc`)`` reads to
`scripts/i18n/bundle_reachability.test.ts` as naming every key ending `_desc`, so one template
made all eight deferred `budget.json` description keys "reachable from `/governance`" and
failed the gate. Write `descKey` out beside `labelKey`.

---

## 3. The head, then the bands

### 3.0 The hub head

One component, one order, every hub — so that "what does a hub open with" cannot drift
thirteen ways again:

```
breadcrumb                    ← ABOVE the title. It is below it on nine hubs and absent on four
eyebrow + freshness           „ОБЩЕСТВЕНИ ПОРЪЧКИ · обновено 21.08"
h1                            LEFT, foreground ink, one monotonic size ladder
deck                          one sentence: what a reader can DO here
scope control                 where the hub has one
search                        full width          |  evidence: a 5-row ranked list
KPI band                      3–5 figures, full width
──────────────────────────────────────────────────
bands of tiles
```

At `lg` the identity column and the evidence list sit side by side and the KPI band spans
both; below `lg` everything stacks.

- ⚠️ **The DOM order IS the mobile order.** Rendering the evidence aside as the grid's second
  child put a ranked list between the deck and the numbers on every phone — which, for a
  Facebook-first audience, is the majority case, not an edge case. Place the grid children
  explicitly (`lg:col-start-2 lg:row-start-1`) so the source order stays identity → KPI →
  evidence.
- **The head renders the page's `<h1>` AND its `<SEO>`.** A screen using it must not also
  render `<Title>`, or the page emits two `h1`s.
- **The deck is not the SEO description.** One is read by a crawler, the other by a human;
  writing one and reusing it as the other gives a sentence that serves neither. §6 (language)
  applies to the deck.
- **Budget the head at ~420 px at `lg` and gate the budget.** A head that grows past that has
  replaced the problem it fixes.
- ⚠️ **The title treatment is `src/ux/Title.tsx` + `src/ux/H1.tsx`, and they move TOGETHER.**
  Both carried `text-center … text-muted-foreground` on an inverted ladder
  (`md:text-4xl lg:text-3xl` → 36 px on a tablet, 30 px on a desktop) with 96 px of padding:
  measured 5.20 : 1, **the same colour as the least important paragraph on the page**, against
  12.2 : 1 for body ink. Changing one and not the other splits the site into two title styles.
  The one regression it produces is an **inverted axis on a centred block** — `ErrorSection` /
  404 put a left heading over centred body copy — so sweep the handful of call sites that pass
  a `className` and any page whose container is `text-center`.

### 3.1 The KPI band

The band is the largest type on the page, so it is the highest-stakes position for §0's
failure mode — a number that is arithmetically right and, read as a sentence, false.

1. **Four numbers that are the hub's THESIS**, not four counts that were handy. The test: read
   them aloud as one sentence. If it does not describe the module, they are wrong.
2. **Every KPI states its basis IN the tile**, under the value, in the reader's words —
   „договори 2007–2026", „по текущия парламент", „за последните 30 дни". This is the same
   requirement as §0's "state the denominator in one clause", done as visual design.
3. **Read the SAME blob the tiles read. Zero new fetches.** A band that needs its own request
   has become a sub-page. On `/procurement` every figure was already on the wire, so the band
   costs **0 extra bytes**.
4. **A KPI links to a page that can NAME the rows behind it** (§7's rule, loudest instance).
5. **A KPI is never also a tile metric.** Tile metrics preview one destination; KPI figures are
   corpus-level claims. The same number twice on one page reads as two different facts.
   **The resolution is to take the figure OFF the tiles, not out of the band** — the band is
   above the fold and carries a declared basis, so it is the better position. On `/governance`
   the four money taps are in the band and those four tiles are deliberately descriptor-only;
   the other seven tiles keep theirs, so band and grid say different things.
6. ⚠️ **A page with no selector must ASK for the slice it names.** See the §0 trap row: the
   first build of this band published the selected parliament under a corpus caption.
7. **`undefined` is an answer.** A scope with no data renders the named empty state, not a row
   of zeroes.

**Figures that overlap must never be summed, and the band has to say so.** `/governance`'s four
money corpora intersect — an ИСУН-funded contract is in `fund_projects` AND `contracts` — so
there is no honest „total public money" on that page. Four taps, four periods, stated in the
band's own note rather than left to be inferred.

#### The evidence column is a ranked list, NOT a chart

Reference portals put a chart there. For this repo that is the wrong call, for three reasons
that are ours:

- **Bytes.** `vendor-charts` is ~115 KB brotli and deliberately lazy; `tests/perf.spec.ts`
  pins the entry chunk at **56 000 B br**. A hero chart on thirteen hubs puts that chunk on
  thirteen more critical paths. A chart that earns its place goes BELOW the band, lazily —
  never above the fold.
- **Crawlers.** §5.1 requires a real `bodyHtml` and says it is the only thing a JS-less
  crawler sees. A ranked list is text: it prerenders, it translates, and it is five more
  internal links, which is what §4's reachability rule wants anyway.
- **Sparklines are out** (`feedback_no_sparklines`); the sanctioned shapes are an axed chart,
  numeric columns or a dumbbell row. Numeric columns ARE the ranked list.

Where the head genuinely wants a visual, build it from `scenePrimitives` (`Bars` / `TrendLine`
/ `Donut`) — inline SVG, zero dependencies, already themed.

⚠️ **A ranked list's heading, rows and destination must be the SAME SET** — the §4 finder rule,
one component over. „Най-големи възложители" over rows that are SECTORS is false: a sector
contains many buyers (АПИ sits inside „Пътища"). And check it does not simply restate a
`FeaturedStrip` further down the page.

**Its rows must also be figures no tile and no KPI shows.** On a money hub the tempting list is
money, and every money figure is already in the band directly above it. `/governance` lists
CORPUS SIZES instead — 409,848 договора · 237,941 процедури · 2,481,857 плащания от ДФЗ ·
82,159 проекта — under „Какво има вътре", which answers a different question with the same
authority.

#### An ELECTION RESULTS HUB is a results surface, not a tile hub

The rule above protects ordinary module landings from paying for a decorative hero chart. It
does **not** move an election result's map below a grid of KPIs or destination tiles. Elections
answer a different first task — „who won here, and where?" — and the repository already has the
right raw shape: the parliamentary country page pairs 'RegionsMapTile' with
'PartyResultsTile', while the local page leads with separate mayor/council maps plus the
regions result table. The 2026-09-01 elections-hub research found the same result-first order
across official German, Norwegian, Australian and European result systems and BBC/Guardian
lookup views; the evidence and level matrix are recorded in
'docs/plans/elections-hub-research-v1.md'.

So an election results front uses a compact scope/place/status head, a 3–4 figure outcome
strip, then an **outcome canvas** as its first substantive section:

- **The map and ranked result are one answer.** A map may lead only when a textual/table result
  sits in the same first section; neither is a teaser for the other. On mobile the ranked
  result precedes the map in DOM order, because the list is the accessible result as well as
  the faster scan.
- **The map stays analytical, not decorative.** Winner, margin, selected share, change,
  turnout (only with a valid denominator) and review-signal modes each answer one named
  question. A map never replaces the rows behind it.
- **Local elections keep their two outcomes.** Mayor/executive control and council
  vote/seat control must remain separately named even when they share a canvas; split control
  is a finding, not a reason to manufacture one blended winner.
- **Depth moves below the outcome, not out of the page.** Candidates, seats, mayors, council
  composition, flows, history and evidence-backed review signals remain available as named
  previews and destinations. The exception rejects KPI-only simplification; it does not
  license an unranked wall of panels.
- **Abroad is parliamentary-only and has a denominator contract.** Show votes cast and place
  distribution; do not publish a conventional turnout rate unless the eligible-voter
  denominator is valid and named.

'src/screens/dashboard/electionsResultsFirst.gates.test.ts' pins the existing country
surfaces: the parliamentary votes section must retain both map and result list, and the local
lead must retain mayor map, council map, and the regions table before the separate mayor and
council detail sections. Extend that gate to the composed shared outcome component when the
new '/elections' shell exists; do not leave the permanent gate as a scan of two legacy files.

#### A HUB OF HUBS: quote the corpus, or quote what you inherit

When a hub's tiles point at other SCOPED hubs and the hub itself has no selector, its figure
and the destination's default disagree by construction — `/governance` says €93.56bn,
`/procurement` opens on €3.32bn. The rule splits on whether a link can force the destination's
scope:

- **Forceable (`?pscope`)** — quote the CORPUS and link `?pscope=all`. `useTileHref` merges the
  tile's own params over the preserved ones, so the tile's scope wins.
- **NOT forceable (`?elections`)** — a link cannot clear the selected election and
  `usePreserveParams` carries it. Quote the SELECTED parliament and let the caption name it.

#### The scope control belongs IN the head

Next to the numbers it governs. On `/procurement` it sat **448 px above** the first tile figure
and had scrolled off screen by the time the number was read — so ten headline figures were
qualified by a control nobody could see. On a phone it was ~1 000 px above.

### 3.1b A REGISTRY BROWSER takes half the head — and the half it drops matters

`/procurement/contracts` is a `DbDataTable` over a corpus, not a tile grid. The head still
applies, but two slots are **deliberately empty**, and both omissions are the same argument:

- **No search slot.** The table owns its own search box, directly above the rows it filters.
  Lifting it into the head puts it ~300 px from its own results.
- **No evidence list.** The table IS the ranked list. An aside ranking the same rows restates
  the page's body.

So a browser's head is identity + deck + scope + KPI band, and it is the narrowest in the
tree: 304 px at 1280 against 442–507 for the three tile hubs.

**The band is REACTIVE here, and that inverts §3.1's usual reading.** On a hub the band is a
corpus-level claim; on a browser the most useful headline is „what am I looking at right now".
That is correct — and it is why the basis line stops being good practice and becomes the
thing holding the page up.

⚠️ **THE DEFECT THIS PRODUCES IS THE SHARPEST INSTANCE OF §0 IN THE REPO, because the figures
that do NOT react sit in identical cards beside ones that do.** Measured on
`/procurement/contracts`, 2026-08-25:

| card            | idle       | after typing „пътища" |
| --------------- | ---------- | --------------------- |
| Обща стойност   | €3,4 млрд. | **€59,3 млн.**        |
| Договори        | 13 819     | **89**                |
| 1 оферта        | 47%        | **47%**               |
| Пряко възлагане | 18%        | **18%**               |

The page read „89 contracts worth €59,3 млн., 47% of them single-bidder". The 47% was over all
13 819. Two causes, and neither is a bug in the thing causing it:

- **`/api/db/facets` has no free-text parameter at all**, so a facet-derived figure structurally
  cannot follow a search box.
- **A facet EXCLUDES the dimension it enumerates** — correct, so the reader can still see the
  other options — which means „Пряко възлагане" holds at 18% under `?proc=direct` over a table
  that is 100% direct awards.

Two different fixes, because they are not the same question:

- **Diverges on SEARCH, or on the OTHER dimension → say so.** „47%, over the period rather than
  over your search" is still worth reading; it is a benchmark to filter against.
- **Diverges on its OWN dimension → WITHHOLD the cell.** Once a reader has filtered to
  single-bidder rows, „47% са с една оферта" answers a question they have already answered,
  over a set that is 100% by construction. No caption rescues that.

Withholding also **surfaces figures the constant was masking**: with the procedure filter on,
„1 оферта" reads **92%** (direct awards are overwhelmingly single-bid) instead of 47%, and with
the single-bidder filter on, „Пряко възлагане" reads **35%** instead of 18%.

**Write the divergence as a truth table in a pure module, and execute it.** The rule is four
figures × four dimensions; that is not reviewable by reading the JSX
(`contractsKpiBasis.ts` / `.test.ts` are the worked example). And **gate the shared strip**:
`ContractsAnalysisStrip` renders the same four figures for `/company` and `/awarder`, so the
browser opts out with `showKpis={false}` — a prop a refactor drops with nothing failing.

⚠️ **The scope control is the page's other sentence, and it published an internal key.** The
default pill read „Този парламент · 2026-04-19" — the election FOLDER ID with underscores
swapped for hyphens — on all 31 surfaces that mount `ScopeControl`. It sits directly above the
band, so it is what says which window those figures cover. Route it through `formatDate`, which
pins a date-only value to UTC; a bare `Intl` call prints the 18th for every reader west of
Greenwich.

### 3.2 Naming and balancing the bands

**Name a band for what is in it, then say what is in it.** The heading is a label; a hub
needs a table of contents. Give each band a one-line description under the heading —
`SectionHeading` takes an optional `description` — saying what a reader will find there, in
their terms.

**Name a band for what is in it.** „Разгледай" (Explore) and „Още" (More) are an instruction
and a leftover. „Още" is the worse of the two — it announces only that the band above it
mattered more, so everything under it reads as offcuts.

Name them for the question they answer: „В залата" / „Кой с кого гласува" / „Депутатите
извън залата". A hub's headings are its table of contents.

**Three are live as of 2026-08-22 and all three are the same mistake.** „Разгледай" on
`/procurement` — with **eleven tiles under it**, the whole hub in one unnamed band; „Разгледай
цените" on `/consumption`; and „Раздели" („Sections") on `/indicators`, seven tiles under a
container word. An instruction and a container are both non-answers: neither tells a reader
what is inside.

**Seven of thirteen hubs have NO band description at all** — `/governance`, `/governance/sectors`,
`/procurement`, `/parliamentary/analysis`, `/parliamentary/reports`, `/indicators`,
`/consumption`. The rule above is three years old and unenforced; §9 now gates it.

**Balance to the grid.** It is 4 columns at `xl`, so a five-tile band strands one tile alone
on its own row. 4/3/4 beats 3/3/5. Check the rendered grid, not the array length.

**Order within a band by measured demand** where you have analytics, and say so in a comment
— otherwise the order encodes nothing and the next person reshuffles it.

**A tile may carry a SECOND figure, smaller, under the caption.** The headline answers "how
much"; the second answers "and what about it". `InfographicTile` takes `metricSecondary` as
a whole composed phrase, because the useful shape varies per tile.

Two rules. It must come from the **same blob** as the headline — a second figure that needs
a second fetch or a new derivation is a sub-page, not a tile. And prefer the one that
**disambiguates the headline**: a mean is much safer beside its minimum, and a percentage is
safer beside the population it is over. One line only; a third number makes it a table.

⚠️ **`metricSecondary` is `hidden sm:flex` — it does NOT render on a phone.** The mobile row
draws `metric` and `metricCaption` and drops the second figure entirely, so on the majority of
this site's traffic the mean loses its minimum. Either render it on mobile, or do not lean on
it to keep a headline honest — put the disambiguation in `metricCaption`, which does render.

**No per-tile CTA.** The whole card is the link and already has a hover state; „разгледай →"
repeated eleven times is one affordance restated. Keep the `cta` prop for the rare tile whose
action is genuinely different ("Създай досие" — create, not open).

---

## 4. Destinations

Three tests, in order. Each has failed in production.

1. **Routed.** `grep` the path in `routes.tsx`. A tile pointing at a page that does not
   exist is a dead link that no type system catches. Keep the allowed list as LITERALS in a
   gate so a new destination has to be declared and a deleted route breaks loudly.
2. **Reachable.** Every sub-page the module owns must be linked from the hub, or it is an
   orphan nothing indexes.
3. **Crawlable and shareable.** A routed SPA path with no prerender entry serves the shell
   — so to a crawler it is a duplicate of the homepage. The hub AND every sub-page it fronts
   needs a static page, a sitemap `<loc>` and its own og:image. That is §5, and all three
   have been forgotten separately.

### Seeded destinations are a smell — prefer a picker

A tile pointing at `/x/:id` needs a seed the generator picks, which means:

- the reader lands on **a subject somebody else chose**, with no way to reach their own;
- the tile **omits itself entirely** whenever the generator produced no seed.

Build `/x` as a picker page beside `/x/:id`, point the tile there, and **keep the picker on
screen after a choice** — comparison means switching subjects repeatedly, and a picker you
must navigate back to is one you use once.

If you keep the seeded machinery for a future tile, keep it TESTED against a synthetic tile.
The case that matters is the ABSENT seed: an omitted tile is honest, a tile rendered with a
raw `:param` in its href is a dead link that also passes any "destination is absolute" check.

---

### A hub needs a finder, not only tiles

Tiles are a fixed set of curated destinations. A reader who arrives already knowing what they
want („Желязков", „бюджет 2026", „моята болница") cannot say so — they have to guess which
tile contains their subject. Give the hub one search box over its own subjects.

**Do NOT build a new one.** `src/ux/search/HubSearch.tsx` is the hub adapter: it takes a list
of sources, each either a client-side `EntityIndex` (`src/lib/entitySearchIndex.ts`) or a
server `fetch`, and renders them through `EntitySearchTile` — which owns the card, the
combobox/listbox ARIA, keyboard nav, highlight and the empty states. Declare the sources in a
`<topic>Search.ts` beside the tile registry. Plan: `docs/plans/hub-search-v1.md`.

Live on `/governance/declarations` and `/parliament`. `/procurement` and `/consumption` have
their own older boxes (`ProcurementSearchTile`, `ConsumptionSearchTile`) — not yet on this
adapter, because the first composes nine groups with bespoke per-group rendering. **Still
with no finder at all: `/governance`, `/governance/sectors`, `/analysis`, `/indicators`,
`/reports`.** Each is a hub whose reader can only arrive by guessing a tile.

**SCOPE RANKS, IT NEVER FILTERS.** A hub has a selector (`?elections`, `?pscope`), and the
tempting move is to restrict results to it. A finder must find: „your hospital does not
exist" is a far worse answer than „your hospital has no contracts in this window", and the
destination page scopes itself anyway. So in-scope hits are the first group and out-of-scope
hits a second, labelled one — `scopedSources()` mints the pair so a hub cannot declare one
half and forget the other.

**The two halves must be independent SOURCES, not one source plus a partition.** This is the
part that looks like an implementation detail and is not. A partition applied to the rows
that came back can only see an out-of-scope row if the ranked scan REACHED one — so with 240
in-scope MPs ranked above 1,880 others, any cap that is a multiple of the display limit
returns nothing but in-scope rows, the second group renders empty, and the box has silently
become a filter. Each half needs its own corpus and its own cap. Server sources rank per
group in SQL for the same reason; ranking once and splitting the result empties the narrower
tier (measured: ZERO of a trailing week's rows appeared in a global top-200).

Three rules from composing a finder over SEVERAL groups, learned building `/governance`'s:

- **Two groups fed by ONE route must share ONE request.** Declaring them as two sources issues
  the same call twice per keystroke for the same needle. Memoise the in-flight promise by
  query — keyed by the needle, not cached across needles, so it can never answer one query
  with another's rows.
- **A company row needs `isLinkableCompanyKey`.** `contractor_eik` carries synthetic keys
  (`ph-` a filler registration number, `np-` a natural person keyed by name) that render a page
  and name nothing checkable against a register. It deliberately KEEPS `obed-` carriers, whose
  page is the only route from a joint bid to the firms behind it.
- **Ship a see-all only where the destination reads the param.** `/governance`'s institutions
  group has none, because no awarders browse page reads `?q` — and a link advertising a
  filtered destination that delivers an unfiltered one is worse than no link.

Three more, each shipped once:

- **Name the second group for the scope it is outside** („депутати от други НС"), never
  „други" — the same reason a band is never called „Още".
- **A "see all" must land on a page that can serve the query.** `/votes?q=` is discarded by
  a screen that reads only `?topic`; `/officials/assets?q=` is discarded entirely. Both
  advertise a filtered destination and deliver an unfiltered one. Grep the destination for
  the param before linking, and if no page can serve it, ship no see-all.
- **A group's content, its label and its destination must be the same set.** A group built by
  re-querying the group above it, labelled „Класация на длъжностните лица" and linking to an
  `is_exec`-filtered page, was three different sets and one duplicated request per keystroke.

**Shliokavitsa must work, and on the server it used to not.** `src/lib/shlyoRules.ts` is the
one rule table; `translitSearch.ts` consumes the client half and `pg/141_shlyo_query_fold.sql`
is GENERATED from it (`npm run gen:shlyo-sql`). A search route composes it with
`translit_bg_latin()` on the QUERY side only, as a SECOND probe issued after the plain one —
never ORed inline, because a database without 141 then raises 42883 for the whole statement
and returns nothing at all. Two traps if you touch it: the client table has already collapsed
`ch`→`h`, so `4 → "h"` is right in the browser and wrong in SQL; and the rewrite must be
gated on an unambiguous Latin trigger, because `y → ъ` cannot tell a typed „y" from the one
`translit_bg_latin` emits for й — ungated it fired on 13.6% of ordinary Cyrillic names.

## 5. Every page ships three artifacts

The hub **and every sub-page it fronts** needs all three. A page missing one is not broken:
it renders, it passes the suite, and it is either invisible or unshareable.

Every failure named below was measured against this repo on **2026-08-13** and fixed the same
day (`0c1db348ef`, `ef1dee6f24`). They are kept as evidence, in the past tense, because the
point is the SHAPE — each recurs the next time a module ships.
`scripts/prerender/ogAndSitemapCoverage.test.ts` now gates all of it; **read that file before
writing a new gate here**, and add to it rather than beside it.

| Artifact            | Declared in                                                                                | What its absence costs                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **Static page**     | `staticPage({…})` in `scripts/prerender/routes.ts`                                         | The SPA shell is served — to a crawler the page is a duplicate of the homepage          |
| **Sitemap `<loc>`** | BOTH lists in `scripts/sitemap/route_defs.ts`, then `npm run sitemap`, then COMMIT the XML | The page is never enumerated; discovery depends on a crawler following an internal link |
| **og:image**        | `ogImage:` on the route **and** a captured file in `public/og/`                            | The share card is the site-wide default, so every page in the module shares one picture |

Do all three in the **same commit as the screen**. Each lives in a different file from the
route, none is derived from the others, and the clustering below is the tell: nobody forgets
one page, they forget a module.

### 5.1 Static page

`staticPage({ path, title, description, breadcrumbName, bodyHtml, ogImage, preloadData,
english: {…} })`. Four things to get right:

- **`path` carries no leading and no trailing slash.** Hosting is `trailingSlash: false`, and
  the EN root is `/en`, never `/en/` — see the URL rule in `CLAUDE.md`.
- **Write a real `bodyHtml`.** It is what a crawler reads, and it is the only part of the
  page a crawler that runs no JS ever sees. A `staticPage` with a title and no body is a stub
  with good metadata. Add the route to `tests/seo.spec.ts` with a `minBodyChars` — the suite
  checks body length only for routes listed there.
- **Add the `english:` block**, or the page has no EN mirror and an `/en` sitemap entry for
  it would be a claim about a page that does not exist.
- **Verify the file.** `npm run build`, then check `dist/<path>/index.html` is there. The
  prerender exits 0 when it writes nothing.

**Do not prerender per-entity parameterised routes** (2,120 members = 2,120 files against a
ceiling on file COUNT); prerender the PICKER instead.

### 5.2 Sitemap — two lists, and a committed artifact

`scripts/sitemap/route_defs.ts` holds **two** lists that look like one:

- **`routeDefs(year)`** emits the **Bulgarian** `<loc>`. Needs `path` and `file:`, whose
  mtime becomes the `lastmod`. Point `file:` at the artifact the page RENDERS, not at the
  screen's `.tsx` — otherwise `lastmod` is the date somebody last touched the JSX.
- **`ENGLISH_STATIC_PAGES`** emits **only** `/en/<slug>`. It is not derived from the other
  list and does not imply it.

Three traps, all of which had shipped:

- **The EN list alone gets you the mirror and not the original.** `/sofia/parties`,
  `/sofia/preferences`, `/sofia/flash-memory`, `/sofia/recount`, `/consumption/electricity`
  and `/consumption/gas` are in `ENGLISH_STATIC_PAGES` and in no `routeDefs` entry — so the
  sitemap names the English mirror of six pages and not the Bulgarian original.
- **A `file:` that does not exist SKIPS THE ENTRY SILENTLY.** `scripts/sitemap/index.ts` does
  `if (!fileExists) return;`, so a typo in that path costs the page its `<loc>` with no
  warning and no failure.
- **`npm run sitemap` is manual and its output is COMMITTED.** Adding both entries changes
  nothing until you run it and commit `public/sitemap*.xml`. `/budget/explorer`,
  `/budget/ministries` and `/budget/revenue` had their entries and no `<loc>`, because the
  committed XML predated them — and `/budget/spending` was in the same state a day later.

Six more were prerendered and in NEITHER list, so they had no `<loc>` in either language:
`/governance/sectors` — a HUB fronting 20+ dashboards — plus `/demographics/regions`,
`/demographics/municipalities`, `/parliament/similarity`, `/parliament/correlation` and
`/votes/between`.

**Two omissions are deliberate and must stay**, and both are the same rule: never list a URL
that canonicalises somewhere else, because it asks Google to index a page pointing elsewhere.
`/data-changes` 301s onto `/data/updates`; the 987 `/en/funds/procedure/*` and 11
`/en/funds/programme/*` mirrors canonicalise back to Bulgarian, since ИСУН publishes no
English names. `english.canonicalUrl` is the discriminator a gate should read — not a path
allowlist, which goes stale.

`scripts/sitemap/families.data.test.ts` checks the OTHER direction (every `<loc>` has a
`dist/` file behind it).

### 5.3 og:image — a screenshot of the page's best visual

Three producers. Pick by what the page actually has:

| The page has                                   | Producer                                                                                  | Output                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| a chart, map or hero worth looking at          | add a `Capture` to the table in `scripts/og/capture-screens.ts`                           | `public/og/<slug>.png`                         |
| a FAMILY of pages needing identical framing    | a `scripts/og/screenshot_<family>.ts` (sectors, funds, procurement, regional, transport…) | `public/og/<family>-<id>.png`                  |
| prose only — a methodology or definitions page | `renderStaticPageCard(…)` in `scripts/og/generate.ts`                                     | a rendered 4-tile card, emitted by `postbuild` |

**Prefer the screenshot.** A hub or a dashboard always has something better to show than four
text tiles. Frame the element that IS the page's argument — the chart, the map, the
hemicycle, the choropleth.

**For a HUB specifically, that element is now the head.** The old advice here was "not the KPI
row and not the page header", and it was right about a page header that carried a centred
muted title and nothing else. A `HubHead` is the opposite: four labelled corpus figures and a
ranked list, i.e. the page's argument in one frame. Anchor on it (`data-og` on the head) rather
than on `h1`, and make sure the capture waits for the blob — a head shot before its numbers
arrive is a screenshot of a skeleton, which is exactly what `waitFor` exists to prevent.

Mechanics that are easy to get wrong:

- **The captures are MANUAL.** `postbuild` runs `generate.ts` only; nothing runs Playwright.

  ```bash
  npm run dev                                       # another shell
  npx tsx scripts/og/capture-screens.ts <slug>      # ONE slug
  ```

  Always pass the slug. Re-shooting the whole table re-frames cards you did not change, and a
  page that has moved since comes back worse. `OG_BASE_URL=http://localhost:5174` when the
  dev server took another port.

- **Reference it as `.png`** in `routes.ts` even though the shipped file is `.webp` —
  `scripts/images/optimize.ts` converts `dist/og/**` and rewrites every reference.
- **`waitFor` must name something that exists only after DATA loads** — `[data-og="x"]
.recharts-surface`, a Leaflet tile pane. A container mounts empty, and the card becomes a
  screenshot of a skeleton. Put a `data-og="…"` attribute on the element rather than keying
  on class names, which a refactor renames silently.
- **Prefer a static-data anchor over an `/api/db` one.** The `water` capture anchors on the
  riverbed tile for exactly this reason: a capture whose visual depends on a live route
  quietly produces an empty card whenever that route is down.
- **1280 is Tailwind's `xl` and the clip is 1200 wide.** A hub IS a tile grid, so at the
  default viewport it renders four columns and the clip slices the fourth down the middle.
  Set the per-capture `viewport` below 1280 for three full columns.
- **`anchor: "h1"` is the recipe for a ranked list or table** — `HIDE_CHROME_CSS` drops the
  site header, so the `h1` IS the top of the page and the clip reads title → intro → first
  rows. Two things go with it: pair it with `OG_CLIP_VIEWPORT` (1200), because at 1280 the
  content column is ~1264 and a centred 1200 clip shaves ~32px off **both** sides — measured,
  `/funds/beneficiaries` lost the first two letters of its breadcrumb and its last money
  column; and never add `leftAlign`, which pins the clip to the `h1`'s own left edge rather
  than the content's.
- **Centring on the first `.recharts-wrapper` is a trap on a page with several.** On
  `/parliament/correlation` it framed the time-series card 1,000px below the fold and, the
  chart being only 878px wide, shifted the 1200px clip left until the sidebar beside it was
  sliced mid-word — while the page's actual signature visual, the party×party matrix at the
  top, is a plain grid that Recharts selectors cannot see at all. Anchor on `h1` and let the
  clip fall over the visual.

Both directions of drift had shipped, and neither failed anything:

- **Referenced, never captured.** `/funds/calls` declared `ogImage: "/og/funds-calls.png"`;
  `screenshot_funds.ts` had the entry and nobody had run it, so both language variants
  shipped an `og:image` that 404s. `tests/seo.spec.ts` asserts only
  `toMatch(/^https?:\/\//)` — which an absolute URL to a missing file satisfies.
- **Captured, never referenced.** `public/og/funds-focus.png` existed and every
  `/funds/focus/<slug>` child used it, while the `/funds/focus` landing carried no `ogImage`
  at all. The children were shareable and the page they hang off was not.

**A missing `ogImage` is silent by design** — `seoBlock.ts` falls through to
`DEFAULT_OG_IMAGE`. 28 of the 1,185 entries in `prerenderRoutes` were on that fallback, and
they clustered by family: seven `/funds/*` sub-pages, five `/budget/*`, both
`/demographics/*`, `/parliament/similarity`, `/parliament/correlation`.

**A family script that shoots its whole table is a hazard, not a convenience.** Fixing the
one card `screenshot_funds.ts` had never written re-framed five that were fine. Give every
capture script the per-slug filter `screenshot_sectors.ts` has, and pass a slug.

**And `screenshot_*.ts` is not `capture-screens.ts`.** The per-family scripts clip
`{x:0, y:0}` and hide no chrome, so their card is the nav bar, the community banner and the
news rail, with the page starting below the fold — which is what `/funds/calls` got the first
time it was finally shot. `capture-screens.ts` drops the header and anchors the clip. Prefer
it; a family script earns its place only when the framing is genuinely per-family.

**Audit a module before you add to it.** Two loops over `prerenderRoutes` in a scratch script
answer all of it — which paths have no `ogImage`, which `ogImage` paths have no file under
`public/og/`, and which paths have no `<loc>` in `public/sitemap*.xml`. That is how every
figure in this section was measured, and it is now
`scripts/prerender/ogAndSitemapCoverage.test.ts`.

---

## 6. Language

Write the target language, not a translation of the English. This is a repo convention
(`feedback_bg_language`) and hub copy breaks it constantly, because a tile description is
written next to its English sibling.

The failure is the **calque**: a phrase that parses but that nobody says. „Кой гласува близо
до кого" is a literal rendering of "who votes close to whom" — Bulgarian expresses that
agreement as „гласуват еднакво / сходно" or „съвпада вотът", and reserves „близо до" for
distance. Same class: „Кой до кого гласува".

When a phrase describes a RELATION (agreement, proximity, similarity, opposition), check it
against how the language actually says it before shipping. If the English reads naturally and
the Bulgarian reads like a diagram label, it is a calque.

---

## 7. Rendering rules that keep being violated

**Calendar days are formatted in UTC.** `new Date("2026-07-31T00:00:00Z")` through an
`Intl.DateTimeFormat` with no `timeZone` renders "30 юли" for every reader west of UTC — so
a label and the URL it links to disagree by a day. This shipped on 613 pages and in six more
files found by sweep. Use the shared day-label hook; keep the repo-wide grep gate.

**The DOM order is the MOBILE order.** A two-column layout at `lg` is one column below it, in
source order — so a right-hand column written as the second child of the grid renders BETWEEN
the intro and whatever follows on every phone. Place grid children explicitly rather than
relying on flow, and check the phone before the desktop: this site's audience arrives from
Facebook.

**A site-wide typographic default has a blast radius, and it is smaller than the import count
suggests — check the OVERRIDES, not the imports.** `Title` is imported by 181 files and only
four pass a `className`, none of which touched alignment or colour. What broke was not any of
the 181 but the one page whose CONTAINER is `text-center`: the 404. A left heading over centred
body copy is the same axis break, inverted. Grep for centred containers, not for call sites.

**A caption describes what is drawn, in the mode it is drawn in.** A caption outside a
mode branch will describe the other mode. A caption promising an interaction ("click a cell")
must be deleted or made true.

**An affordance exists or it does not.** Render a `<button>` when a cell acts and a plain
element when it does not; do not give every cell a button role and have a third do nothing.
Use the repo's `focus-visible:ring-*` — an `outline-transparent hover:outline` trick
overrides the UA focus ring and leaves keyboard users with no indicator.

**A chart's colour scale must measure the thing the title names.** A "bridge between groups"
matrix scaled on its diagonal is a chart about group size. Exclude the diagonal from the
ramp, draw it in neutral ink, and keep it — it is worth reading, it is just not the ranked
quantity.

**No backtick inside SQL held in a template literal.** Quoting an identifier the way SQL
comments usually do — ``-- the `person` table`` — terminates the literal. This has now
recurred four times, in `.js` routes and in a `.ts` generator, so it is not a
route-file quirk: it is any SQL written inside backticks anywhere. Write the identifier bare.

**A count that links somewhere must be nameable there.** A card saying "50 of 240 MPs did
not vote" that lands on a page which cannot name the fifty is worse than no card.

**Never name individuals on an arbitrary tie-break.** Ranking people by a value that ties
(everyone who missed a 5-item sitting missed all five) sorts by whatever the comparator falls
back on — an id. Publish the aggregate instead, and link to where the names are.

---

## 8. Postgres-backed routes

If a tile's destination or the hub itself reads `/api/db/*`:

- **Degrade on `42P01 · 55000 · 42501 · 55P03`. Never on `57014`.** `55000` is a matview
  created `WITH NO DATA` — the first cloud deploy. `57014` is the pool's own timeout: the
  probe has already burned the budget and the fallback cannot finish either.
- **A missing GRANT on a plain TABLE is permanent**, not a refresh artifact, so `42501` must
  500 there rather than serve an empty page for ever.
- **Log the miss once per process** with the loader to run. That log, not latency, is how an
  operator learns the cloud loader never ran.
- **Keep the static fallback** where one exists, and make the query function return `null`
  on ANY failure including a **thrown** one — `!r.ok` alone leaves React Query settling with
  `undefined`, so a fallback gated on `=== null` is unreachable.
- **Nothing above ~2,000 buffers is served live.** Measure with `EXPLAIN (ANALYZE, BUFFERS)`
  on the WORST key, not the current one.
- **Rank each tier in SQL.** Ranking once and filtering afterwards silently empties the
  narrower tier: measured, ZERO of a trailing week's rows appeared in a global top-200.

---

## 9. Gates to write

Not optional, and each exists because its absence shipped something:

| Gate                                                                                                                         | Catches                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Every hub renders a `HubHead`                                                                                                | The thirteen-way header drift — no two hubs agreeing on what a hub opens with                                          |
| A reactive band's cells each declare the dimensions they follow, as an executed truth table                                  | „89 contracts, 47% of them single-bidder" where the 47% is over 13 819 (§3.1b)                                         |
| A browser's shared analysis strip does not re-render the head band's figures                                                 | The same €-figure twice on one page, once with a basis and once without                                                |
| The head's height budget, measured at CI's viewport, with ≤20% slack                                                         | A head quietly acquiring the slot its own comment says it omits                                                        |
| A hub blob keys only tiles the registry renders                                                                              | A figure keyed to an id nothing draws — bytes on every visitor, shown to nobody                                        |
| A hub blob is under its byte budget                                                                                          | Regrowth to the full artifact the first time somebody adds a field with detail                                         |
| Every `basis` the blob emits has a key in BOTH corpora                                                                       | Prose in the blob, i.e. the English hub as the Bulgarian one with English headings                                     |
| The band's own tiles are excluded from the tile metrics                                                                      | The same string rendered twice on one page                                                                             |
| A `REFRESH_GENERATORS` artifact is git-tracked AND the bucket serves those bytes                                             | A committed blob that 404s (`db:check-generated` names the publish command)                                            |
| Every KPI in the band has a `basis` string AND a destination                                                                 | A corpus-level claim in the largest type on the page with no denominator                                               |
| No KPI value equals a tile metric on the same page                                                                           | One number rendered twice, reading as two facts                                                                        |
| A hub with no scope selector never calls a scope hook's DEFAULT                                                              | The `/governance` €3,32bn-under-a-corpus-caption class                                                                 |
| Every band has a description, and no heading is an instruction or a container word                                           | „Разгледай" over 11 tiles; 7 of 13 hubs with no description at all                                                     |
| Every band's tile count leaves no lone tile on the last `xl` row                                                             | 9 → 4+4+1                                                                                                              |
| No accent twice on the COMPOSED PAGE (not per registry)                                                                      | The `/procurement` tile-band ↔ `FeaturedStrip` pair a per-registry gate cannot see                                     |
| No hub screen statically imports a registry, and no registry builds an i18n key by template                                  | A reference-data closure in the route chunk; a template key that defeats the bundle analysis                           |
| Every tile id has a scene                                                                                                    | White screen                                                                                                           |
| Every `to` is absolute AND in the routed list                                                                                | Dead links                                                                                                             |
| Every sub-page is a hub destination                                                                                          | Orphans                                                                                                                |
| Blob under its byte budget                                                                                                   | Regrowth to the full artifact                                                                                          |
| Blob's keys == the shard files present                                                                                       | A hub with tiles and no detail                                                                                         |
| Every figure recomputed from its declared basis                                                                              | The six-of-six class                                                                                                   |
| Every written file appears in `--upload`                                                                                     | Green locally, stale on prod                                                                                           |
| A committed hub blob is in `REFRESH_GENERATORS` (PG-generated) **or** `UPLOAD_PUBLISHED_ARTIFACTS` (published by a script own `--upload` list), and the bucket serves those bytes (`db:check-generated`) | A committed blob that 404s, or is stale across a key rename. ⚠️ Being IN an `--upload` list is not enough — that list only runs on an INGEST, so a blob whose SHAPE changed in a code commit is never published |
| Cloud SQL runs the same function/view bodies as local (`db:check-cloud`) | „Applied, never loaded“ — a serving fn changed by a code commit, which flips no watcher, so no orchestrator step ever ships it |
| Calendar days formatted in UTC                                                                                               | Off-by-one dates                                                                                                       |
| A scoped source returns out-of-scope rows for a query that has them                                                          | Scope silently filtering — invisible, because the page still shows results                                             |
| Each search group's cap is independent                                                                                       | An in-scope group eating the out-of-scope budget                                                                       |
| Every see-all param is read by its destination                                                                               | A link advertising a filtered page and delivering an unfiltered one                                                    |
| Every routed sub-page of the module has a `staticPage` entry                                                                 | The shell served to crawlers as a homepage duplicate                                                                   |
| Every routed sub-page has a BG `routeDefs` entry, and an `ENGLISH_STATIC_PAGES` one iff it has an `english:` block           | The `/sofia/*` + `/consumption/*` class — the mirror indexed, the original not                                         |
| Every `routeDefs` `file:` exists on disk                                                                                     | The silent skip that costs a page its `<loc>`                                                                          |
| Every prerendered path in the module has a `<loc>` in the COMMITTED sitemap                                                  | Both entries present, `npm run sitemap` never re-run                                                                   |
| Every sub-page carries its own `ogImage` (or is on a reasoned exemption list)                                                | A whole module sharing the site-wide default card                                                                      |
| Every `ogImage` path resolves to a file under `public/og/`                                                                   | An `og:image` that 404s — the absolute-URL check passes                                                                |
| Every capture slug in `capture-screens.ts` / `screenshot_*.ts` is referenced by some route                                   | A card shot and wired to nothing                                                                                       |

A source-scanning gate strips comments through **`src/ux/infographic/stripJsxComments.ts`**,
never a hand-rolled regex: the repo-wide `stripComments` is line-anchored and leaves a JSX
brace-star block intact, and a start-anchored `//` rule breaks a scan in BOTH directions — a
trailing `// TODO restore showKpis={false}` satisfied a clause that should have failed, and a
trailing `// contractsKpis(old)` failed one that should have passed. There were three copies of
that stripper before it had a file.

**Ten are now WRITTEN**, in `src/ux/infographic/hubHead.gates.test.ts`
(basis-year floor, band↔tile disjointness, no two KPI cells sharing a destination, no screen
rendering both `HubHead` and `<Title>`, and no default-aligned heading over a centred sibling)
plus the four blob gates above and `src/ux/infographic/HubHead.test.tsx` for the component
contract. Each was mutation-checked — break the clause, watch it fire — per the rule below.
The band gates — description present, no instruction/container heading, scene coverage, unique
accents, `xl` row balance — are written for `/procurement` in
`src/screens/procurement/procurementHubBands.test.ts`, beside the funds/parliament/budget
registry gates it copies. Still unwritten: "every hub renders a `HubHead`" (only two do so
far), and the COMPOSED-PAGE accent gate (each hub's is per-registry, which is exactly the
blind spot `/procurement`'s `clay`/`teal` collisions sat in).

⚠️ **Write those gates against a REGISTRY, never against the screen's source.** A first cut of
the `/procurement` one regex-scanned `ProcurementScreen.tsx` and was quietly almost vacuous: it
read the other bands' i18n keys as tile ids, counted quoted strings rather than tiles (so a
band holding an inline tile read one short), could not see that tile at all, and broke on a
code comment — which §3.2 encourages. Five sibling hubs already declare `*_BANDS` with the
tiles NESTED and derive `*_TILES = BANDS.flatMap(b => b.tiles)`, which makes an orphan or a
duplicate unrepresentable rather than merely detectable. Extracting the registry retired nine
findings at once, and the rewritten gate immediately caught a real regression the source-scan
could not: the project-file tile had lost its scene in the move.

⚠️ **The first eight are new because the band/accent/CTA rules in §3 were ADVICE, not gates,
and had failed on 7 of 13 hubs by the time anyone measured** — 42 redundant per-tile CTAs on
two hubs, five hubs with duplicate accents, seven with no band description, three with a band
named for an instruction. A rule written in this file and not in a test file is a rule the
next hub will break. When you add a rule here, add its gate in the same turn.

The last seven live in `scripts/prerender/ogAndSitemapCoverage.test.ts` — extend that file
rather than writing a second one. They read as ceremony and are not: `tests/seo.spec.ts`
asserts `og:image` `toMatch(/^https?:\/\//)`, which the site-wide fallback AND a URL to a
missing file both satisfy, so every failure §5 names was green when it shipped.

**Then check the gate can fail.** Break each clause and watch it fire. In this pattern's
history: a gate asserted `max(id) >= count(*)`, true of any gap-free sequence — the very
symptom it named; another matched a `timeZone: "UTC"` string inside the COMMENT explaining
the fix, so deleting the option left it green. Both read as real tests.

**A figure gate must assert against something the GENERATOR DOES NOT USE.** The strongest
version of this failure is a gate that re-runs the generator's own SQL and compares it to
the generator's own output: it proves only that the file was freshly written, and it
inherits every misunderstanding it was meant to catch. The declarations hub's first gate did
exactly that and then _pinned the bug_ — asserting `mpAssetYears == count(*)` on a
partitioned table, and `cars > carOwners`, which is true whether cars is the real 621 or the
1,994 that counts each vehicle once per parliament. Assert against the destination screen's
own filter, the partition structure, or the file the destination fetches — and write the
alternatives you rejected as explicit `notEqual`s, because a wrong basis is usually one word
away from the right one.

---

## 10. Verify in the browser

**Six of six defects in the 2026-08-22 head build were found this way, five of them invisible
to `tsc` and four invisible to the whole 3 655-test suite.** The worst — a KPI band publishing
one parliament's figures under a corpus caption — was green everywhere and obvious on sight.
Load the page, read the numbers, and check them against the file they came from.

**Four of the earlier defects were found by looking at the page, not by the suite** — a missing
`outcome` field rendering `votes_outcome_undefined`, two off-by-one dates, raw vote sums, and
a state toggle that silently never applied because a formatter had reshaped the target so the
edit matched nothing.

After every visible change: `preview_start`, load the page, and read the DOM — the rendered
figures, the hrefs, the grid's last-row count, the console. Then click the thing you built.

**And OPEN the captured PNG.** A capture reports success on any 1200×630 clip it managed to
take, including one of a loading skeleton, an empty chart, a cookie banner or the fourth
column of a tile grid sliced down the middle. Nothing downstream looks at the pixels — the
image is only ever seen by a reader on Facebook. `Read` the file.

---

## 11. Shipping order

Hosting last, always. The two manual `public/` writers come FIRST, because `vite build`
copies `public/` into `dist/` — run them after the build and they ship one deploy late.

```bash
npm run dev                                    # 0. another shell, for the captures
npx tsx scripts/og/capture-screens.ts <slug>   # 1. og card → public/og/<slug>.png
npm run sitemap                                # 2. rewrites public/sitemap*.xml — COMMIT it
npm run db:load:<x>:pg:cloud                   # 3. tables the routes read
npm run deploy:db                              # 4. the function
npm run bucket:sync:paths -- <path>            # 5. bucket-served artifacts
npm run build                                  # 6. prerender + og cards + png→webp
npm run deploy                                 # 7. hosting
```

**Steps 1 and 2 are the ones that get skipped**, because neither is wired into anything:
`postbuild` runs `generate.ts` but no Playwright capture, and `npm run sitemap` is a manual
command whose output is committed. Skipping 1 ships an `og:image` pointing at a file that
does not exist; skipping 2 ships a page with no `<loc>`. Both are 200s.

**Step 5 is the third.** A new bucket-served shard that has not been synced means the hub
ships and its data-driven bands silently render nothing — the fetch 404s, the hook returns
`undefined`, and the bands return `null`. Check the bucket before deploying, and do not infer
it from a green build:

```bash
npm run db:check-generated     # every committed hub blob, byte-compared against the bucket
npm run db:check-cloud         # every serving fn/view: is Cloud SQL on the same body as local?
```

**A NEW blob is `MISSING`, not stale, and the check prints its own remedy** — it reports
`404 — the artifact has NEVER been published` and the exact `bucket:sync:paths` argument.
Two things have to happen before that check can even run: the artifact must be **git-tracked**
(`REFRESH_GENERATORS` asserts it, and the gate fires on a generator whose output was never
`git add`ed), and its generator must be in the chain at a position its `reason` justifies.

That is not a failure mode written up in the abstract. `/culture` shipped in exactly this
state for two days (2026-08-19 → 21): `culture/derived/hub_stats.json` committed, its
generator in `db:refresh`, every gate green, and the bucket object **404**. The hook degrades
a 404 to „no figure" deliberately, so the page rendered its tiles blank at a 200 with nothing
red anywhere. See §1 for why the module's own pipeline never noticed.

`npm run deploy` does **not** build. Deploying without building ships a stale `dist/`.

**Probing a route before it exists pins a 404 at the CDN** for up to an hour. If a
just-deployed route 404s, retry with a cache-buster before debugging.

---

## 12. What a hub cannot fix

A hub surfaces a data layer; it does not repair one. When a tile's figure is empty or a
destination is thin, find out which of the two it is before touching the hub:

- **The page is honest and the data is absent.** A person who sat in the 39th National
  Assembly has no declaration (the register postdates them) and no candidacy (the CIK corpus
  starts later). A page showing only their role is correct. Do not invent a figure.
- **The data exists and the layer does not carry it.** Quantify by ROLE before concluding:
  `person_role` holds party on 76% of `candidate` rows and 48% of `councillor` rows, and on
  **0 of 2,122 `mp` rows** — so every MP shows „—" for party. That is a resolver gap, fixed
  where the roles are written, not on the hub.

The distinction matters because both look identical on the page. Run the counts, split by
role or by era, and say which one you found. A hub change that papers over a resolver gap
makes the gap permanent.

---

## 13. Keeping this skill current

**When the user gives a new requirement or correction for a hub, fold it into this file in
the same turn** — not at the end of the session, not "if it comes up again". Every section
above exists because something shipped wrong once; the value is in it being written down
while the reason is still concrete.

Record the RULE and the EVIDENCE, not just the rule. "Name bands for what is in them" is
advice; "„Още" announces that the band above it mattered more, so attendance and both
similarity views read as offcuts" is why anyone will follow it.

---

## 14. Working style

- **Implement, then run `/code-review` in a subagent, then repair.** In this pattern's
  history the review found 2–5 real defects per step and the rate did not fall with
  experience.
- **Confirm each finding against the corpus before fixing it.** Reviewers are sometimes
  wrong about the cause even when right that something is wrong.
- **Report what you did not do.** A step that builds the routes but does not rewire the
  screen is a partial step; say so plainly rather than letting the commit imply completion.
