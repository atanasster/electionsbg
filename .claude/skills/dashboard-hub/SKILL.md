---
name: dashboard-hub
description: Build or rework a module front page (a "hub") — the tile-grid landing that fronts a topic's sub-pages, like /parliament, /procurement or /governance/sectors. Covers the whole shape: the tile registry, bespoke SVG scenes, the ONE small precomputed stat blob that replaces per-tile artifact fetches, band structure and naming, destination reachability, and the gates that keep every figure honest. Use when the user asks to build a hub / module landing / dashboard front page for a topic, to restructure an existing hub's tiles or sections, to add a tile, or to cut a hub's payload. Encodes the defect classes this pattern reliably produces — undeclared bases, figures that are arithmetically right and false as a sentence, seeded destinations, dead links, and captions that describe a different chart.
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
3. **Crawlable.** A routed SPA path with no prerender entry serves the shell — so to a
   crawler it is a duplicate of the homepage. Add a `staticPage` entry and verify
   `dist/<path>/index.html` exists after the build. **Do not prerender per-entity
   parameterised routes** (2,120 members = 2,120 files against a ceiling on file COUNT);
   prerender the PICKER instead.

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

Do NOT build a new one. `src/ux/search/EntitySearchTile.tsx` is the generic shell — card,
combobox/listbox ARIA, keyboard nav, highlight, scroll-into-view, loading/empty states,
per-group `seeAll`. Adapters exist for a client-side pre-folded index
(`src/lib/entitySearchIndex.ts`) and for server-backed fetches. Plan:
`docs/plans/hub-search-v1.md`.

**SCOPE RANKS, IT NEVER FILTERS.** This is the rule that decides the shape. A hub has a
selector (`?elections`, `?pscope`), and the tempting move is to restrict results to it — but
a finder must find: „your hospital does not exist" is a far worse answer than „your hospital
has no contracts in this window", and the destination page scopes itself anyway. So in-scope
hits become the first group and out-of-scope hits a second, labeled one. Four consequences,
each a way to reintroduce filtering by accident:

- **Each scoped source yields TWO groups.** Build the partition into the shared component,
  or the second group is forgotten on the third hub that uses it.
- **The cap is PER GROUP.** One shared cap lets the in-scope group eat the whole budget,
  which is filtering with extra steps — the same failure `rankedFilter` documents, where
  fold-matches early in source order pushed 17 real Вълчев entries out of view.
- **Name the second group for the scope it is outside** („депутати от други НС"), never
  „други" — same reason a band is never called „Още".
- **Server sources rank in SQL, per group.** Ranking once and partitioning the result
  silently empties the narrower tier: measured, ZERO of a trailing week's rows appeared in
  a global top-200.

**Shliokavitsa must work, and on the server it does not.** `src/lib/translitSearch.ts` folds
Latin-typed Bulgarian („6umen", „4erven", „sofiq") client-side; `translit_bg_latin()` in
Postgres is Streamlined-only. `pg_trgm` hides half of it — „Jelyazkov" finds Желязков on
fuzzy tolerance alone, while „Jelqzkov" returns zero. And the client rule table is NOT
portable as written: it targets an alphabet that has already collapsed `ch`→`h`, so `4 → "h"`
is right in the browser and wrong in SQL. One table, one generator, one cross-implementation
gate.

## 5. Language

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

## 6. Rendering rules that keep being violated

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

## 7. Postgres-backed routes

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

## 8. Gates to write

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

## 9. Verify in the browser

**Four of the last defects were found by looking at the page, not by the suite** — a missing
`outcome` field rendering `votes_outcome_undefined`, two off-by-one dates, raw vote sums, and
a state toggle that silently never applied because a formatter had reshaped the target so the
edit matched nothing.

After every visible change: `preview_start`, load the page, and read the DOM — the rendered
figures, the hrefs, the grid's last-row count, the console. Then click the thing you built.

---

## 10. Shipping order

Hosting last, always.

```bash
npm run db:load:<x>:pg:cloud          # 1. tables the routes read
npm run deploy:db                     # 2. the function
npm run bucket:sync:paths -- <path>   # 3. bucket-served artifacts
npm run build                         # 4. prerender (needs its own local PG inputs)
npm run deploy                        # 5. hosting
```

**Step 3 is the one that gets skipped.** A new bucket-served shard that has not been synced
means the hub ships and its data-driven bands silently render nothing — the fetch 404s, the
hook returns `undefined`, and the bands return `null`. Check the bucket before deploying.

`npm run deploy` does **not** build. Deploying without building ships a stale `dist/`.

**Probing a route before it exists pins a 404 at the CDN** for up to an hour. If a
just-deployed route 404s, retry with a cache-buster before debugging.

---

## 11. What a hub cannot fix

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

## 12. Keeping this skill current

**When the user gives a new requirement or correction for a hub, fold it into this file in
the same turn** — not at the end of the session, not "if it comes up again". Every section
above exists because something shipped wrong once; the value is in it being written down
while the reason is still concrete.

Record the RULE and the EVIDENCE, not just the rule. "Name bands for what is in them" is
advice; "„Още" announces that the band above it mattered more, so attendance and both
similarity views read as offcuts" is why anyone will follow it.

---

## 13. Working style

- **Implement, then run `/code-review` in a subagent, then repair.** In this pattern's
  history the review found 2–5 real defects per step and the rate did not fall with
  experience.
- **Confirm each finding against the corpus before fixing it.** Reviewers are sometimes
  wrong about the cause even when right that something is wrong.
- **Report what you did not do.** A step that builds the routes but does not rewire the
  screen is a partial step; say so plainly rather than letting the commit imply completion.
