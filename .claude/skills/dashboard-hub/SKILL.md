---
name: dashboard-hub
description: Build or rework a module front page (a "hub") — the tile-grid landing that fronts a topic's sub-pages, like /parliament, /procurement or /governance/sectors. Covers the whole shape: the tile registry, bespoke SVG scenes, the ONE small precomputed stat blob that replaces per-tile artifact fetches, band structure and naming, destination reachability, the three artifacts every hub page and sub-page must ship (a prerendered static page, a sitemap <loc> in BOTH route_defs lists, and its own og:image screenshot of a chart or map), and the gates that keep every figure honest. Use when the user asks to build a hub / module landing / dashboard front page for a topic, to restructure an existing hub's tiles or sections, to add a tile, to cut a hub's payload, or to check a module's pages for prerender / sitemap / og:image coverage. Encodes the defect classes this pattern reliably produces — undeclared bases, figures that are arithmetically right and false as a sentence, seeded destinations, dead links, captions that describe a different chart, pages with no sitemap entry, and share cards that 404 or fall back to the site-wide default.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - Agent
  - Skill
---

# Dashboard hub skill

A **hub** is a module's front page: a short intro, optionally a hero and a news
band, then bands of `InfographicTile`s that front the module's sub-pages. `/parliament`
is the worked example; `/procurement`, `/governance/sectors` and the analysis hub are the
same shape.

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

| Trap | What it looks like | The rule |
|---|---|---|
| **Corpus total on a scoped hub** | `613 заседания` on a page scoped to one parliament (real answer: 39) | Scope every figure to the page's selector |
| **Destination counts a different set** | Tile says `240` and lands on a page listing 2,120 | Lead with the DESTINATION's basis, or show no figure |
| **Sums of votes read as headcounts** | `за 15 961` in a chamber of 240 — votes summed over 219 items | Express as SHARES, from the same function that draws the pixels |
| **A mean labelled as a minimum** | `0,94 средна кохезия` where 0.94 was the min and the mean was 0.970 | Two numbers, two labels; never one number wearing both |
| **A projection quoted as the roll** | Map tile says 270 members; the map plots 255 | Quote what the destination DRAWS |
| **Structural zero** | `Общини 0` under an MP filter | Hide a figure that cannot vary; do not print 0 |
| **Undeclared "not derivable"** | `0% присъствие` on a day with no roll call | NULL means "cannot derive"; render it as absent, never as 0 |
| **A ROLL-UP PARTITION inside the table** | `1 994 автомобила` on a registry of 621 — the table carries one partition per parliament PLUS an `'all'` row, so `count(*)` counts each car once per parliament its owner sat in | `GROUP BY` the partition key and READ the row; never `count(*)` a table you have not grouped |
| **The destination's DEFAULT SCOPE** | Tile shows the lifetime 621; `/mp-cars` opens `scope="ns"` on the 52nd's 65 — and the tile carries `?elections` forward, guaranteeing the mismatch on every parliament | Key the blob by the destination's scope and resolve it through the SAME helper that screen filters with |
| **The right subject, the wrong corpus** | Tile counts `company_politicians` (346) over `/mp/companies`, which renders `companies-index.json` (2,781) | When the destination fetches a FILE, count that file — not a table about the same subject |

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
- **Wire it into the pipeline's `--upload` branch** and gate that generically: *every file
  the generator writes appears in its upload list*. An artifact missing from it is
  regenerated locally, committed, and never uploaded — green everywhere, stale on prod.
- **A shared type gets ONE declaration.** Two hand-copied halves drifted on a nullability
  within a single review cycle. Put it on the `src/` side and import it from `scripts/`.

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
tiles are the same kind of thing". Gate it.

---

## 3. Bands

**Name a band for what is in it, then say what is in it.** The heading is a label; a hub
needs a table of contents. Give each band a one-line description under the heading —
`SectionHeading` takes an optional `description` — saying what a reader will find there, in
their terms.

**Name a band for what is in it.** „Разгледай" (Explore) and „Още" (More) are an instruction
and a leftover. „Още" is the worse of the two — it announces only that the band above it
mattered more, so everything under it reads as offcuts.

Name them for the question they answer: „В залата" / „Кой с кого гласува" / „Депутатите
извън залата". A hub's headings are its table of contents.

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
it renders, it passes the suite, and it is either invisible or unshareable. Every failure
named below is live in this repo as written.

| Artifact | Declared in | What its absence costs |
|---|---|---|
| **Static page** | `staticPage({…})` in `scripts/prerender/routes.ts` | The SPA shell is served — to a crawler the page is a duplicate of the homepage |
| **Sitemap `<loc>`** | BOTH lists in `scripts/sitemap/route_defs.ts`, then `npm run sitemap`, then COMMIT the XML | The page is never enumerated; discovery depends on a crawler following an internal link |
| **og:image** | `ogImage:` on the route **and** a captured file in `public/og/` | The share card is the site-wide default, so every page in the module shares one picture |

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

Three traps, all currently shipping:

- **The EN list alone gets you the mirror and not the original.** `/sofia/parties`,
  `/sofia/preferences`, `/sofia/flash-memory`, `/sofia/recount`, `/consumption/electricity`
  and `/consumption/gas` are in `ENGLISH_STATIC_PAGES` and in no `routeDefs` entry — so the
  sitemap names the English mirror of six pages and not the Bulgarian original.
- **A `file:` that does not exist SKIPS THE ENTRY SILENTLY.** `scripts/sitemap/index.ts` does
  `if (!fileExists) return;`, so a typo in that path costs the page its `<loc>` with no
  warning and no failure.
- **`npm run sitemap` is manual and its output is COMMITTED.** Adding both entries changes
  nothing until you run it and commit `public/sitemap*.xml`. `/budget/explorer`,
  `/budget/ministries` and `/budget/revenue` have their entries and no `<loc>` today, because
  the committed XML predates them.

Prerendered right now with no `<loc>` in either language: `/governance/sectors` — a HUB —
plus `/demographics/regions`, `/demographics/municipalities`, `/parliament/similarity`,
`/parliament/correlation` and `/votes/between`.

`scripts/sitemap/families.data.test.ts` checks the OTHER direction (every `<loc>` has a
`dist/` file behind it). Nothing checks this one.

### 5.3 og:image — a screenshot of the page's best visual

Three producers. Pick by what the page actually has:

| The page has | Producer | Output |
|---|---|---|
| a chart, map or hero worth looking at | add a `Capture` to the table in `scripts/og/capture-screens.ts` | `public/og/<slug>.png` |
| a FAMILY of pages needing identical framing | a `scripts/og/screenshot_<family>.ts` (sectors, funds, procurement, regional, transport…) | `public/og/<family>-<id>.png` |
| prose only — a methodology or definitions page | `renderStaticPageCard(…)` in `scripts/og/generate.ts` | a rendered 4-tile card, emitted by `postbuild` |

**Prefer the screenshot.** A hub or a dashboard always has something better to show than four
text tiles. Frame the element that IS the page's argument — the chart, the map, the
hemicycle, the choropleth — not the KPI row and not the page header.

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

Both directions of drift are live today and neither fails anything:

- **Referenced, never captured.** `/funds/calls` declares `ogImage: "/og/funds-calls.png"`;
  `screenshot_funds.ts` has the entry and the file has never been written. Both language
  variants ship an `og:image` that 404s. `tests/seo.spec.ts` asserts only
  `toMatch(/^https?:\/\//)` — which an absolute URL to a missing file satisfies.
- **Captured, never referenced.** `public/og/funds-focus.png` exists and every
  `/funds/focus/<slug>` child uses it, while the `/funds/focus` landing carries no `ogImage`
  at all. The children are shareable and the page they hang off is not.

**A missing `ogImage` is silent by design** — `seoBlock.ts` falls through to
`DEFAULT_OG_IMAGE`. 28 of the 1,185 entries in `prerenderRoutes` are on that fallback, and
they cluster by family: seven `/funds/*` sub-pages, five `/budget/*`, both `/demographics/*`,
`/parliament/similarity`, `/parliament/correlation`.

**Audit a module before you add to it.** Two loops over `prerenderRoutes` in a scratch script
answer all of it — which paths have no `ogImage`, which `ogImage` paths have no file under
`public/og/`, and which paths have no `<loc>` in `public/sitemap*.xml`. That is how every
figure in this section was measured.

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
comments usually do — `` -- the `person` table `` — terminates the literal. This has now
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

| Gate | Catches |
|---|---|
| Every tile id has a scene | White screen |
| Every `to` is absolute AND in the routed list | Dead links |
| Every sub-page is a hub destination | Orphans |
| No accent twice on the page | "These are the same kind of thing" |
| Blob under its byte budget | Regrowth to the full artifact |
| Blob's keys == the shard files present | A hub with tiles and no detail |
| Every figure recomputed from its declared basis | The six-of-six class |
| Every written file appears in `--upload` | Green locally, stale on prod |
| Calendar days formatted in UTC | Off-by-one dates |
| A scoped source returns out-of-scope rows for a query that has them | Scope silently filtering — invisible, because the page still shows results |
| Each search group's cap is independent | An in-scope group eating the out-of-scope budget |
| Every see-all param is read by its destination | A link advertising a filtered page and delivering an unfiltered one |
| Every routed sub-page of the module has a `staticPage` entry | The shell served to crawlers as a homepage duplicate |
| Every routed sub-page has a BG `routeDefs` entry, and an `ENGLISH_STATIC_PAGES` one iff it has an `english:` block | The `/sofia/*` + `/consumption/*` class — the mirror indexed, the original not |
| Every `routeDefs` `file:` exists on disk | The silent skip that costs a page its `<loc>` |
| Every prerendered path in the module has a `<loc>` in the COMMITTED sitemap | Both entries present, `npm run sitemap` never re-run |
| Every sub-page carries its own `ogImage` (or is on a reasoned exemption list) | A whole module sharing the site-wide default card |
| Every `ogImage` path resolves to a file under `public/og/` | An `og:image` that 404s — the absolute-URL check passes |
| Every capture slug in `capture-screens.ts` / `screenshot_*.ts` is referenced by some route | A card shot and wired to nothing |

The og:image gates are the ones that read as ceremony and are not: `tests/seo.spec.ts`
asserts `og:image` `toMatch(/^https?:\/\//)`, which the site-wide fallback AND a URL to a
missing file both satisfy. Every failure §5 names is green today.

**Then check the gate can fail.** Break each clause and watch it fire. In this pattern's
history: a gate asserted `max(id) >= count(*)`, true of any gap-free sequence — the very
symptom it named; another matched a `timeZone: "UTC"` string inside the COMMENT explaining
the fix, so deleting the option left it green. Both read as real tests.

**A figure gate must assert against something the GENERATOR DOES NOT USE.** The strongest
version of this failure is a gate that re-runs the generator's own SQL and compares it to
the generator's own output: it proves only that the file was freshly written, and it
inherits every misunderstanding it was meant to catch. The declarations hub's first gate did
exactly that and then *pinned the bug* — asserting `mpAssetYears == count(*)` on a
partitioned table, and `cars > carOwners`, which is true whether cars is the real 621 or the
1,994 that counts each vehicle once per parliament. Assert against the destination screen's
own filter, the partition structure, or the file the destination fetches — and write the
alternatives you rejected as explicit `notEqual`s, because a wrong basis is usually one word
away from the right one.

---

## 10. Verify in the browser

**Four of the last defects were found by looking at the page, not by the suite** — a missing
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
`undefined`, and the bands return `null`. Check the bucket before deploying.

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
