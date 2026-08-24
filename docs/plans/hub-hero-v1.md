# Dashboard hubs — the hub head, and what the review found

**Status:** review + decisions, 2026-08-22. §7's open questions were answered the same day
and the answers are folded in as §8 (`Title` — in scope), §9 (`/governance` blob) and §10
(palette — grow it).
**Original status:** review, 2026-08-22. Design review of all 13 tile hubs against the reference
open-data portals (City of Kyle / San José / King County redesigns) the user supplied.
**Pattern:** `.claude/skills/dashboard-hub`. Nothing here is implemented; §6 is the proposed
amendment set for that skill.
**Measured:** dev server, 2026-08-22, viewport 1024×820 unless stated, Bulgarian, light theme.

---

## 1. What the reference portals actually do

Stripped of their palettes, all three redesigns are the same four-part header:

| part              | Kyle                                    | San José                             | King County                             |
| ----------------- | --------------------------------------- | ------------------------------------ | --------------------------------------- |
| **identity**      | title + one-line deck                   | title + one-line deck                | title + one-line deck                   |
| **the way in**    | search + 4 topic chips                  | search + „Popular:" 5 chips          | search + „Popular:" 5 chips             |
| **live evidence** | a revenue-vs-expense bar chart, sourced | a „Portal activity" card, LIVE badge | a „datasets by category" ranked list    |
| **the KPI band**  | 62 datasets · 6 departments · $78.6M    | 170 · 10 · 1020 · 9                  | 265 · 39 · 17 · 2.7M, each with a basis |

Two things are worth copying and one is not.

- **Copy the KPI band, and copy its captions.** King County writes „live from bucket",
  „live sync", „all-time" under its four numbers. That is a basis declaration — the exact
  discipline `dashboard-hub` §0 is built around, done as visual design rather than as a gate.
- **Copy the two-column head**: identity + way-in on the left, evidence on the right.
- **Do NOT copy the hero chart.** §5 explains why it costs us specifically.

**We already build this header — twice, on our own site.** The homepage and `/consumption`
both open with `PlaceHeader`: a coloured eyebrow, a left-aligned full-contrast title, a view
switcher, and (on the homepage) a 4-up KPI strip in which every figure carries a comparison
basis („+11.87% п.п. спрямо 27/10/2024", „1 697 603 хартиени · 1 542 553 машинни"). The other
twelve hubs did not get it. So this is not a new pattern to invent; it is a pattern two of our
pages have and the hubs lack.

---

## 2. The measurement

### 2.1 How far a reader scrolls before the page says anything

`y` values are document coordinates. On every hub the community + news band occupies **0–241 px**
above the `<h1>` (dismissible, so a returning reader starts ~241 px higher). The fold at this
viewport is **820 px**.

| hub                        | `<h1>` y | `<h1>` px | first tile band | first figure                     | doc height |
| -------------------------- | -------- | --------- | --------------- | -------------------------------- | ---------- |
| `/governance`              | 241      | 132       | 425             | **2 355** ⚠︎                      | 2 789      |
| `/parliament`              | 241      | 132       | 1 238           | 675 (prose)                      | 2 954      |
| `/procurement`             | 241      | 132       | 872             | 424 — _a date in the scope pill_ | 2 400      |
| `/budget`                  | 241      | 132       | 1 462           | 869 — _„€100" in prose_          | 3 714      |
| `/funds`                   | 241      | 132       | **2 846**       | 742 — _a timestamp_              | 4 206      |
| `/culture`                 | 241      | 132       | 666             | 809 (tile metric)                | 2 554      |
| `/parliamentary/analysis`  | 241      | 132       | 397             | 537 (tile metric)                | 1 689      |
| `/parliamentary/reports`   | 241      | 132       | 397             | 537 (tile metric)                | 2 261      |
| `/indicators`              | 241      | 132       | 1 245           | 474 (KPI tile)                   | 2 114      |
| `/governance/sectors`      | 241      | 132       | 487             | 424 — _the scope pill_           | 2 740      |
| `/governance/declarations` | 241      | 132       | 682             | 805 (tile metric)                | 1 618      |
| `/subsidies`               | 241      | 132       | 660             | 803 (tile metric)                | 2 564      |
| `/consumption`             | **307**  | **36**    | 712             | 826 (tile metric)                | 2 528      |

**Not one hub makes a corpus-level statement above the fold.** The best four land their first
figure at 803–826 px — at the fold edge, inside a tile banner, as a preview of one destination
rather than as a claim about the module. `/governance` — the front page of the whole money
story — carries **no number at all until 2 355 px**, and the string found there is a tile
description, not a figure.

`/funds` is the extreme: the four `StatCard`s that ARE its corpus KPIs (53 122 бенефициенти ·
€44,27 млрд. договорени · €18,17 млрд. изплатени · 148 свързани с НП) sit at ~2 600 px, and
the tile grid starts at 2 846 — three and a half screens.

### 2.2 What each hub's header is made of

| hub                        | `<Title>`       | breadcrumb | search  | intro | scope | KPI row    | feed/strip |
| -------------------------- | --------------- | ---------- | ------- | ----- | ----- | ---------- | ---------- |
| `/parliament`              | ✓               | ✓          | ✓       | ✓     | —     | —          | ✓          |
| `/procurement`             | ✓               | ✓          | ✓ (old) | —     | ✓     | —          | ✓          |
| `/governance`              | ✓               | —          | —       | ✓     | —     | —          | —          |
| `/funds`                   | ✓               | ✓          | —       | ✓     | —     | ✓ (buried) | ✓          |
| `/budget`                  | ✓               | ✓          | ✓       | ✓     | —     | —          | —          |
| `/culture`                 | ✓               | ✓          | ✓       | —     | —     | —          | —          |
| `/parliamentary/analysis`  | ✓               | —          | —       | —     | —     | —          | ✓          |
| `/parliamentary/reports`   | ✓               | —          | —       | —     | —     | —          | —          |
| `/indicators`              | ✓               | ✓          | —       | —     | —     | ✓          | —          |
| `/consumption`             | — (PlaceHeader) | —          | ✓ (old) | —     | —     | —          | —          |
| `/subsidies`               | ✓               | ✓          | —       | —     | ✓     | —          | —          |
| `/governance/sectors`      | ✓               | ✓          | —       | —     | ✓     | —          | —          |
| `/governance/declarations` | ✓               | ✓          | ✓       | ✓     | —     | —          | —          |

**Thirteen hubs, seven header features, and no two hubs agree.** Search on 6, an intro
sentence on 5, a breadcrumb on 9, a KPI row on 2 (both below the fold or mid-page). There is
no shared hub-header component: every screen composes `Title` + loose `<p>` + whatever else by
hand, so „what a hub opens with" is decided per screen and has drifted thirteen ways.

`/council` is a fourteenth hub that is not in the system at all — its own `<h1 class="text-2xl
font-bold">`, its own `mx-auto w-full px-4 py-8` container, no `Title`, no tiles, no scenes.

### 2.3 The title block

`src/ux/Title.tsx:16` and `src/ux/H1.tsx:9` share one class string:

```
text-xl md:text-4xl lg:text-3xl … text-center py-4 md:py-12 … text-muted-foreground
```

Measured on `/governance`:

|                                  |                                                       |
| -------------------------------- | ----------------------------------------------------- |
| colour                           | `rgb(105 97 89)` on `rgb(241 237 228)` → **5.20 : 1** |
| the 14 px intro `<p>` beneath it | **5.20 : 1** — _the identical colour_                 |
| body ink would be                | `rgb(34 31 28)` → 12.2 : 1                            |
| size ladder                      | **20 px (sm) → 36 px (md) → 30 px (lg)**              |
| padding                          | 48 px top + 48 px bottom                              |
| alignment                        | `center`, over a page that is left-aligned throughout |

Three defects in one component:

- **The page's title is the same colour as its least important paragraph.** Muted is the
  site's "this is secondary" signal; the `<h1>` opts into it.
- **The title shrinks as the viewport grows** — 36 px on a tablet, 30 px on a desktop. Whatever
  the intent, `md:text-4xl lg:text-3xl` inverts the ladder.
- **96 px of padding plus a centred axis.** The block costs 132 px and breaks the page's
  alignment to do it.

`/consumption` and the homepage are the counter-example: `PlaceHeader` renders a 30 px,
left-aligned, `rgb(34 31 28)` title at **12.2 : 1** in a 36 px line. Same site, same theme.

⚠︎ **181 files import `Title`.** The fix is site-wide, not a hub change, and should be decided
as its own step.

### 2.4 Bands, accents and CTAs

| hub                        | bands (tiles)      | bands with a description | duplicate accents | per-tile CTAs | strands a tile at `xl` |
| -------------------------- | ------------------ | ------------------------ | ----------------- | ------------- | ---------------------- |
| `/parliament`              | 4 / 4 / 4          | 3 of 3                   | 0                 | 0             | no                     |
| `/budget`                  | 4 / 4 / 3 / 3      | 4 of 4                   | 0                 | 2             | no                     |
| `/funds`                   | 3 / 4 / 3          | 3 of 3                   | 0                 | 0             | no                     |
| `/subsidies`               | 4 / 3 / 4 / 2      | 4 of 4                   | 0                 | 0             | no                     |
| `/culture`                 | 5 / 4 / 4          | 3 of 3                   | 0                 | 0             | **yes** (5 → 4+1)      |
| `/governance/declarations` | 6 / 2              | 2 of 2                   | **1**             | 0             | no                     |
| `/governance`              | 6 / 6 / **9** / 2  | **0 of 4**               | 0                 | **23**        | **yes** (9 → 4+4+1)    |
| `/governance/sectors`      | 6 / 4 / 3 / 3 / 3  | **0 of 5**               | 0                 | **19**        | no                     |
| `/procurement`             | **11 in one band** | **0 of 1**               | **2**             | 5             | no                     |
| `/parliamentary/analysis`  | 6 / 3              | **0 of 2**               | **2**             | 0             | no                     |
| `/parliamentary/reports`   | 5 / 4 / 4          | **0 of 3**               | **1**             | 0             | **yes** (5 → 4+1)      |
| `/indicators`              | **7 in one band**  | **0 of 1**               | 0                 | 0             | no                     |
| `/consumption`             | 6 / 2 / 4 / 4      | **0 of 4**               | **3**             | 1             | no                     |

The skill's own §3 and §9 rules fail on **7 of 13** hubs. Specifically:

- **„Разгледай" is a live band name on `/procurement`** (11 tiles under one heading that says
  „Explore"), and `/consumption` has „Разгледай цените". `/indicators` has „Раздели"
  („Sections"). §3 rules all three out by name and by kind — an instruction and a container
  word, neither of which is a table of contents.
- **The accent-uniqueness gate does not run over the composed page.** On `/procurement`
  `#c9702f` is worn by the „Договори" tile _and_ by the „Пътища" featured-sector tile, and
  `#2f8fb0` by „Места" and „Води" — the tile band and the `FeaturedStrip` come from two
  registries, and the per-registry gates cannot see across them. `/consumption` has three
  duplicate pairs _within_ its own 16 tiles, i.e. no gate at all.
- **The palette is exactly exhausted.** `tileAccents.ts` holds **23** tokens and `/governance`
  renders **23** tiles, each with a different one. „One accent per page" is not "nearly" at its
  limit — it is at it. The next tile added to that hub cannot satisfy the rule.
- **42 per-tile „разгледай →" / „виж сектора →" CTAs** across `/governance` (23) and
  `/governance/sectors` (19) — §3 removed these from `/parliament`, `/funds` and `/culture`
  and they were never removed here.

### 2.5 Figures with no declared basis, on the page furthest from its basis

`ProcurementScreen.tsx` passes `metric` for ten tiles (`ProcurementScreen.tsx:52–124`) and
`metricCaption` for **none** of them — while the `FeaturedStrip` sector tiles below do pass one
(`:234`). So the hub's headline reads **„€3,3 млрд."** with nothing saying it is _this
parliament's_ contracts; the only thing that qualifies it is a scope pill 448 px above it that
has scrolled away by the time the number is on screen. On mobile the pill is ~1 000 px above.

That is `dashboard-hub` §0's first trap — a figure that is arithmetically right and, read as a
sentence, false — reintroduced not by a wrong query but by a layout that separates the number
from its window.

### 2.6 Mobile drops the disambiguating figure

`InfographicTile` renders `metricSecondary` inside a `hidden sm:flex` block
(`InfographicTile.tsx:126–133`). The mobile row (`:158–176`) renders `metric` and
`metricCaption` and **not** `metricSecondary`.

§3 introduced that second figure specifically so that „a mean is much safer beside its
minimum". On phones the mean loses its minimum. Given the audience is Facebook-first, that is
the majority case, not an edge case.

---

## 3. Findings, ranked

1. **No hub states what it is about in numbers before the reader scrolls.** (§2.1)
2. **There is no shared hub header**, so thirteen hubs answer „what does a hub open with"
   thirteen ways, and no gate can be written against a shape that does not exist. (§2.2)
3. **The `<h1>` is the lowest-contrast element on the page**, centred against a left-aligned
   page, on an inverted size ladder, for 132 px. (§2.3)
4. **The skill's band/accent/CTA rules are unenforced on 7 of 13 hubs**, and the accent gate
   is structurally blind to a page that composes two registries. (§2.4)
5. **`/procurement`'s ten headline figures declare no basis** while the page is scoped. (§2.5)
6. **Mobile drops `metricSecondary`**, the field that exists to keep a headline honest. (§2.6)
7. **`/council` is outside the system**; `/procurement` and `/indicators` have one unnamed
   band each; `/governance` strands a tile and prints 23 redundant CTAs. (§2.2, §2.4)
8. **The accent palette runs out at the next hub.** (§2.4)

---

## 4. The proposal — one `HubHead`

One component, used by every hub, in this order:

```
breadcrumb                    ← above the title, not below it
eyebrow + freshness           „ОБЩЕСТВЕНИ ПОРЪЧКИ · обновено 21.08"
h1                            left, foreground ink, one size ladder
deck                          one sentence, ≤ ~140 chars, what a reader can do here
scope control                 where the hub has one — adjacent to the numbers it governs
search                        full width
── KPI band ──                3–5 figures, each: label · value · basis · destination
── evidence ──                a 5-row ranked list with „виж всички →"   (right column at lg)
────────────────────────────
bands of tiles
```

At `lg` the deck + search sit left and the evidence list sits right; below `lg` everything
stacks and the evidence list keeps its five rows.

### 4.1 Rules for the KPI band

1. **Four numbers that are the hub's thesis**, not four counts that happened to be handy. The
   test: read them aloud as one sentence. If it does not describe the module, they are wrong.
2. **Every KPI states its basis in the tile**, under the value, in the reader's words —
   „договори 2020–2026", „по текущия парламент", „за последните 30 дни". This is the King
   County caption and it is the same requirement as §0's "state the denominator in one clause".
3. **Read the SAME blob the tiles read. Zero new fetches.** On `/procurement` this is already
   on the wire: `data/procurement/derived/hub_stats.json` ships `totalEur · contracts ·
contractors · tenders · appeals · places · flags · connected`, keyed by scope. The KPI band
   there is a presentation change costing **0 bytes**.
4. **A KPI links to a page that can name its rows.** §7 already says a count that links
   somewhere must be nameable there; a hero KPI is the loudest instance of that.
5. **A KPI is never also a tile metric.** Tile metrics preview one destination; KPI figures are
   corpus-level claims. The same number twice on one page reads as two different facts.
6. **A scoped hub's KPI band moves with the scope pill, or says it does not.** The pill must
   be inside the head, above the numbers it qualifies.
7. **`undefined` is an answer.** §1's rule applies verbatim: a scope with no data renders the
   named empty state, not a row of zeroes.

### 4.2 Why the „evidence" column is a ranked list, not a chart

Kyle puts a bar chart there. We should not, for three reasons that are ours and not theirs:

- **Bytes.** `vendor-charts` is ~115 KB brotli and is deliberately lazy; `tests/perf.spec.ts`
  holds the entry chunk at **56 000 B br**. A Recharts hero on thirteen hubs pulls that chunk
  onto thirteen more critical paths. If a chart earns its place it goes _below_ the KPI band,
  lazily — never above the fold.
- **Crawlers.** §5.1 requires a real `bodyHtml`, and says it is the only thing a JS-less
  crawler sees. A ranked list is text: it prerenders, it translates, it is five more internal
  links, which is what §4's reachability rule wants anyway. A chart contributes nothing to any
  of that.
- **The repo already forbids the cheap version.** Sparklines are out
  (`feedback_no_sparklines`); the sanctioned shapes are an axed chart, numeric columns, or a
  dumbbell row. Numeric columns _are_ the ranked list.

Where a visual is genuinely wanted in the head, build it from `scenePrimitives`
(`Bars` / `TrendLine` / `Donut`) — inline SVG, zero dependencies, already themed.

### 4.3 What each hub's KPI band would say

Proposed, from data each hub already holds. Not measured against alternatives yet — that is
§0 work and must happen before any of these ships.

| hub                        | the four                                                          | source                           |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `/procurement`             | договорени € · договори · изпълнители · обжалвания                | `hub_stats[scope]` (on wire)     |
| `/funds`                   | договорени € · изплатени € · бенефициенти · отворени процедури    | `funds_hub_stats()` (on wire)    |
| `/governance/declarations` | хора в регистъра · с декларация · длъжностни лица · фирми зад тях | `declarations_hub_stats.json`    |
| `/culture`                 | € поръчки · € фондове · институти · читалища €                    | `culture/derived/hub_stats.json` |
| `/governance`              | — **needs a blob**; compose from the four sibling hubs            | new                              |

`/governance` is the one that needs new data, and it is also the one with the worst symptom
(no figure until 2 355 px). Its blob should be a fold over the sibling blobs rather than a
fifth query path.

### 4.4 The other fixes, independent of the head

| #   | fix                                                                                | scope                               |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| A   | `Title`: left, foreground ink, monotonic ladder, ~half the padding                 | **site-wide, 181 files** — own step |
| B   | `/procurement`: 11 tiles in „Разгледай" → three named bands with descriptions      | one screen                          |
| C   | `/indicators` „Раздели", `/consumption` „Разгледай цените" → named bands           | two screens                         |
| D   | band descriptions on the 7 hubs with none                                          | seven screens                       |
| E   | drop the 42 per-tile CTAs on `/governance` + `/governance/sectors`                 | two screens                         |
| F   | accent gate runs over the **composed page**, not per registry                      | the gate                            |
| G   | decide the palette question before hub #14 (grow it, or scope uniqueness to bands) | design system                       |
| H   | render `metricSecondary` on mobile, or stop relying on it for honesty              | `InfographicTile`                   |
| I   | `/procurement` tiles get `metricCaption`                                           | one screen                          |
| J   | `/council` joins the system (or is explicitly declared not a hub)                  | one screen                          |

---

## 5. What this must not become

- **A hero is not a banner.** If the head grows past ~420 px at `lg` it has replaced the
  problem it fixes. Budget it and gate the budget, the way §1 budgets the blob.
- **A KPI band is not a place to put a number because there was room.** Every figure added
  here is a corpus-level claim in the largest type on the page — the highest-stakes position
  for §0's failure mode, not the lowest.
- **No new fetch.** A head that needs its own request has become a sub-page.
- **The deck is not the SEO description.** `Title`'s `description` prop feeds `<meta>`; the
  deck is read by humans. Writing one and reusing it as the other gives you a sentence that
  serves neither — and §6 (language) applies to the deck: it must be Bulgarian somebody says.

---

## 6. Proposed amendments to `.claude/skills/dashboard-hub`

Numbered against the skill's current sections.

1. **New §3.0 „The hub head"** — the anatomy in §4 above, its order, and the ~420 px budget.
   Replaces the current one-line "a short intro, optionally a hero and a news band".
2. **New §3.1 „The KPI band"** — the seven rules in §4.1, with the evidence that
   `/procurement` already ships every figure it needs (so the band is free) and that
   `/governance` shows no number until 2 355 px (so it is not optional).
3. **§3, band naming** — add „Разгледай", „Раздели" and „Разгледай цените" to the „Още"
   example, with the count: three live hubs, one of them carrying 11 tiles under it.
4. **§3, add „the head owns the scope control"** — with §2.5's evidence that a pill 448 px
   above a figure does not qualify it.
5. **§3, `metricSecondary`** — record that it is `hidden sm:flex`, so it may not be the only
   thing keeping a headline honest.
6. **§5, add a fourth artifact? No — extend §5.3** — the head is what the og:image should
   frame once it exists, replacing „anchor on `h1`" for hubs specifically.
7. **§9, three new gates:**
   - every hub renders a `HubHead` (so the thirteen-way drift cannot recur);
   - the accent gate runs over the **composed page**, not per registry — with the
     `/procurement` cross-registry pair as the case it must catch;
   - every KPI in the band has a `basis` string and a destination.
8. **§9, make the existing band gates actually run** — description present, no instruction-word
   headings, no per-tile CTA, `xl` row balance. Seven hubs fail them today, which means they
   are advice in a document rather than gates in a file.
9. **New §7 entry** — the palette ceiling: 23 accents, all 23 in use on one page.
10. **§4.2 (new) „no chart above the fold"** — the 56 000 B br entry budget and the ~115 KB br
    `vendor-charts` chunk, and the ranked-list alternative.

---

## 7. Open questions — 1, 2 and 3 ANSWERED 2026-08-22 (see §8, §9, §10)

1. ~~**Is the `Title` change in scope?**~~ **Yes — §8.** It is the single largest visual improvement and it
   touches 181 files. It can be done first, independently, and every hub benefits — or it can
   be deferred and the head can override `Title`'s classes locally, which leaves the rest of
   the site as it is.
2. ~~**Does `/governance` get its own blob**~~ **Yes, one file — §9.** or does its head fold the four sibling blobs
   client-side? Folding costs four fetches on the one hub that currently makes none.
3. ~~**The palette:**~~ **Both — §10.** Four new tokens (23 → 27) _and_ a declared per-band
   scope above 20 tiles.
4. **`/council`:** bring it into the system, or declare it a screen rather than a hub?
5. **How many KPIs — 3, 4 or 5?** The references use 3 (Kyle) and 4 (both others). Four fits
   our `xl` grid; three reads calmer.

---

## 8. DECIDED — the `Title` fix is in scope

`src/ux/Title.tsx:16` and `src/ux/H1.tsx:9`, one class string each, changed together.

|           | today                                                   | proposed                                             |
| --------- | ------------------------------------------------------- | ---------------------------------------------------- |
| colour    | `text-muted-foreground` — 5.20 : 1                      | `text-foreground` — 12.2 : 1                         |
| alignment | `text-center`                                           | `text-left`                                          |
| ladder    | `text-xl md:text-4xl lg:text-3xl` → 20 / 36 / **30** px | `text-2xl sm:text-3xl md:text-4xl` → 24 / 30 / 36 px |
| padding   | `py-4 md:py-12 sm:py-4` → 96 px at md+                  | `py-3 md:py-5` → 40 px at md+                        |

**The blast radius is smaller than the 181 imports suggest.** Only **four** call sites pass a
`className` at all — `PartiesFinancing.tsx:25` (`pt-8`), `FinancingTable.tsx:301` (`py-8`),
`ReportTemplate.tsx:345` (`md:py-8`) and `ErrorSection.tsx:19` (`text-destructive`) — and not
one of them overrides alignment or colour. So no page is holding the centred axis on purpose;
`Title` is used as-is everywhere, and every page gets the same change.

Three things to check when it lands, none of which a test will catch:

- **Pages whose whole layout is centred** (an error state, a single-card page) will now have a
  left title over centred content — the axis break, inverted. Sweep the four `className` call
  sites plus `NotFound`, `ErrorSection` and the report template by eye.
- **`ReportTemplate` already halves the padding** (`md:py-8`), which is evidence the 96 px was
  felt as too much before. Its override becomes redundant and should be dropped in the same
  commit rather than left to fight the new default.
- **`H1` and `Title` must move together.** They carry duplicate class strings today; 16 files
  import `H1` directly and would otherwise keep the old treatment, so the site would split into
  two title styles instead of one.

**This is not a hub change and should not wait for one.** It is independently shippable, it
recovers ~56 px of vertical on every page in the site, and it takes the site's most important
line of text from the "this is secondary" colour to the reading colour.

---

## 9. DECIDED — `/governance` gets a blob, and the tiles get rearranged

### 9.1 The shape of the problem

`/governance` is a **hub of hubs**: 21 of its 23 tiles point at another hub, not at a leaf.
That changes the KPI question. A leaf hub asks "how big is my corpus"; this one asks "how big
is each tap, and can I compare them" — and the answer to the second half is **no**, which is
the first thing the design has to encode.

⚠️ **The four money corpora OVERLAP and must never be summed.** A contract funded from ИСУН is
in both `fund_projects` and `contracts`; a ДФЗ payment to a município can reappear as that
município's own procurement. So there is no honest „€X млрд. публични пари" total on this page,
and a KPI band of four money figures must read as _four taps_, never as parts of one number.
Say it in the band's own caption line rather than leaving it to be inferred.

### 9.2 The scope trap, which is specific to a hub of hubs

Every money tile here points at a hub that has its **own** scope selector, and `/governance`
has none. So a corpus-wide figure on this page and the destination's own default disagree:
`/governance` would say **€93.56 млрд.** for procurement and `/procurement` opens on
**€3.32 млрд.** (the current parliament). That is §0's "destination counts a different set",
guaranteed rather than possible.

**The rule, and it splits by whether the destination's scope can be forced from a link:**

- **Forceable (`?pscope`)** — `/procurement`, `/governance/sectors`, `/subsidies`. Quote the
  CORPUS figure and link with `?pscope=all`. `useTileHref` already merges tile-own params over
  the preserved ones, so the tile's own `pscope` wins over anything carried in. The reader
  lands on the number they clicked.
- **Not forceable (`?elections`)** — `/parliament`, and anything reading `ElectionContext`.
  A link cannot clear the selected election, and `usePreserveParams` carries it. So these
  tiles quote the **selected parliament** and the caption names it („52-ро НС"), which means
  the blob needs an `ns`-keyed section for exactly those tiles and nothing else.

### 9.3 The blob

New generator `db:gen-governance-hub-stats` → `data/governance/hub_stats.json`, the **fifth**
member of the `db:gen-*` family, in `REFRESH_GENERATORS` with a `bucketPath` and covered by
`npm run db:check-generated`.

```jsonc
{
  "generatedAt": "2026-08-22",
  "money": {                       // corpus-wide; every tile links with ?pscope=all
    "budget":      { "eur": …, "basis": "expenditure", "year": 2026 },
    "procurement": { "eur": 93559353702, "basis": "contracts", "from": 2007, "to": 2026 },
    "funds":       { "eur": 44270390974, "basis": "contracted", "from": 2014, "to": 2027 },
    "subsidies":   { "eur": …, "basis": "paid", "from": 2015, "to": 2026 },
    "municipal":   { "eur": …, "basis": "commitments", "period": "2026-Q1" },
    "sectors":     { "eur": …, "basis": "procurement" }
  },
  "people":  { "persons": …, "withDeclaration": …, "companies": …, "councils": … },
  "byNs":    { "52": { "sittings": …, "items": … } }   // ONLY the ?elections-bound tiles
}
```

Rules it inherits from §1 and one it adds:

- **No prose, no URLs.** `basis` is an ENUM key; i18n turns `contracts` + `from`/`to` into
  „договори 2007–2026". Otherwise the English hub is the Bulgarian one with English headings.
- **Byte budget ≤ 2 KB raw, gated.** It is numbers and enum keys only; if it needs more it has
  started carrying detail that belongs on a sub-page.
- **NEW: a figure in this blob names the tile it belongs to, not the table it came from.**
  This is the one blob whose keys span six modules, so `procurement.eur` must be the number
  `/procurement` itself publishes for that window — derived by the same SQL, not a fresh
  aggregate that happens to be about the same subject.

**Its trigger is `db:refresh`, not any module's own skill.** It reads budget, contracts,
fund_projects, agri_subsidies and the person layer, so it moves when the PROCUREMENT pipeline
runs — the same freshness hazard that left `culture/derived/hub_stats.json` 404-ing for two
days. `db:check-generated` is what closes it; the generator is useless without that entry.

### 9.4 Efficient loading — four measures, in order of certainty

1. **One file, one fetch, `staleTime: Infinity`.** Today `/governance` makes **zero**
   page-specific fetches, so this must stay at exactly one; folding the four sibling blobs
   client-side would be four, on the hub that currently makes none. That is the option this
   rules out.
2. **Bake the same figures into the prerendered `bodyHtml`** as a sentence. §5.1 already
   requires a real body; making it the actual numbers means a crawler and a JS-less reader see
   them, and it costs nothing at runtime. **Not a hydration island** — an island goes stale
   between deploys while the bucket blob does not, and reconciling the two would visibly change
   a number after paint.
3. **Reserve the KPI band's height in the skeleton.** The band is above the fold by
   construction, so a band that grows on arrival is CLS on the site's main landing. Measure it
   the repo's way — served `dist/` at the real origin, never localhost
   (`reference_cls_measurement_recipe`).
4. **`preloadData` on the route — MEASURE, do not assume.** `CLAUDE.md` records that the whole
   hint set is a small net loss at 1.6 Mbps and that `as="fetch"` defaults to HIGH priority,
   which competes with the render-blocking JS. Add the entry only if it measures better at 1.6
   **and** 10 Mbps.

**The alternative that was rejected and why:** a `/api/db/governance-hub-stats` route is always
fresh and needs no bucket sync — but it puts a Cloud Run round-trip (with cold starts) on the
critical path of the site's main landing, and the prerender cannot bake it into `bodyHtml`.
Latency and crawlability beat freshness here; the staleness class is closed by
`db:check-generated` instead.

### 9.5 The rearrangement

Today: 6 / 6 / **9** / 2 = 23 tiles, no band descriptions, 23 per-tile CTAs, and the 9-tile
band strands one tile alone on its own row at `xl`.

⚠️ **Do not collapse the nine indicator tiles back to one `/indicators` tile.** That expansion
was deliberate — `governanceRegistry.ts` records it („was a single Показатели tile →
/indicators") — so the fix is to SPLIT the band, not to undo the decision.

| band                        | tiles                                                                     | n   | at `xl` |
| --------------------------- | ------------------------------------------------------------------------- | --- | ------- |
| **Парите**                  | budget · procurement · funds · subsidies · municipal-finance · sectors    | 6   | 4 + 2   |
| **Властта и отчетността**   | parliament · council · governments · declarations · persons · connections | 6   | 4 + 2   |
| **Как се справя държавата** | overview · ind_economy · ind_fiscal · ind_budgets                         | 4   | 4       |
| **Обществото и хората**     | ind_governance · ind_society · demographics · schools                     | 4   | 4       |
| **Сравни и пресметни**      | tax_calculator · simulator · ind_compare                                  | 3   | 3       |

All 23 tiles kept, nothing orphaned, no lone-tile row, and every band gets a description line.
`ind_compare` moves out of the indicator block into the last band because it is the third thing
on this page where the reader _does_ something (picks peers) rather than reads — which is also
what lets the indicator block split cleanly into 4 + 4. The band is renamed from „Инструменти"
for the same reason.

The 23 per-tile „разгледай →" CTAs go. The whole card is the link and already has a hover
state.

---

## 10. DECIDED — grow the palette

`tileAccents.ts` holds **23** tokens and `/governance` renders **23** tiles. Measured over all
23 on both grounds (cream `#F1ECE0`, navy `#0B1224`):

|                   | min                       | max            |
| ----------------- | ------------------------- | -------------- |
| contrast on cream | **2.79** (`leaf`, `aqua`) | 6.03 (`slate`) |
| contrast on navy  | **2.62** (`slate`)        | 5.68 (`leaf`)  |
| lightness         | 35%                       | 57%            |

So the header's „~48–58% lightness" is a direction, not a rule (it already says so), and **3 : 1
on both grounds is a rule the existing palette does not meet** — nine tokens are below it on one
side. State the real floor rather than a floor the palette fails.

### 10.1 Four new tokens, placed at the measured hue gaps

The gaps, largest first: **128°** (52°), **72°** (44°), **325°** (33°), **292°** (32°), **245°**
(29°), 165° (21°), 185° (20°).

| token     | hex       | hue  | cream | navy | separation |
| --------- | --------- | ---- | ----- | ---- | ---------- |
| `fern`    | `#2e843a` | 128° | 3.98  | 3.98 | 26°        |
| `cobalt`  | `#6862a7` | 245° | 4.58  | 3.46 | 14°        |
| `violet`  | `#a553b2` | 292° | 3.98  | 3.98 | 16°        |
| `magenta` | `#b74e8b` | 325° | 3.98  | 3.97 | 16°        |

All four clear **3.4 : 1 on both grounds**, which is better than nine of the incumbents. 23 → **27**.

**Three numerically-available gaps were rejected, and the reason is the useful part:** 165°
(`jade`) and 185° (`cyan`) sit 10° from `aqua`/`teal`/`emerald` — a numeric gap in a
perceptually crowded neighbourhood, which reads as "the same colour, slightly off" rather than
as a different kind of thing. 72° (`lime`) is 22° from `gold` and `moss` but lands in the same
drab yellow-green family as `olive`/`brass`/`gold`, and the only versions with real chroma
there (`#758c1d`) are too loud for this palette. **A hue gap is a candidate, not a licence.**

### 10.2 The rule that actually removes the ceiling

Four more tokens buys headroom; it does not remove the ceiling, because a hub of hubs will
always be the widest page. Change the rule instead:

> **Default: unique per PAGE.** Above 20 tiles a hub may declare `accentScope: "band"` in its
> registry, and uniqueness is then enforced **within a band and across adjacent bands** — a
> repeat between band 1 and band 5 is not confusable, which is the thing the rule exists to
> prevent.

Keep the strict default so the exception has to be declared and reviewed.

### 10.3 And the gate has to run over the composed page

The current gates are per-registry, which is why `/procurement` ships `#c9702f` on both
„Договори" and the „Пътища" featured tile: the tile band and the `FeaturedStrip` come from two
registries and neither gate can see the other. The gate must take the tile list the SCREEN
renders, not the array a registry exports. `/consumption`'s three duplicate pairs are the same
defect with no gate at all.

---

## 11. The preview — built, measured, and the six defects it produced

Built 2026-08-22 against the dev server. **Nothing is committed.** `src/ux/infographic/HubHead.tsx`
(new), the `Title`/`H1` class strings, four accent tokens, `/procurement` and `/governance`.
`npx tsc -b` clean, `npx eslint` clean, **3 655 unit tests green**.

### 11.1 What it measures

Viewport 1024×820, light, Bulgarian, community band present. The fold is 820 px.

|                                               | before                                 | after               |
| --------------------------------------------- | -------------------------------------- | ------------------- |
| `/governance` — first corpus figure           | **2 355 px**                           | **429 px**          |
| `/governance` — first tile band               | 425 px                                 | 582 px              |
| `/procurement` — first LABELLED corpus figure | none (a date in the scope pill at 424) | **673 px**          |
| `/procurement` — first tile band              | 872 px                                 | 998 px              |
| `<h1>` block height                           | 132 px                                 | **40 px**           |
| `<h1>` contrast                               | 5.20 : 1                               | **12.2 : 1**        |
| `<h1>` size ladder                            | 20 / 36 / **30** px                    | 24 / 30 / **36** px |

The tile grid moves DOWN on both — 157 px and 126 px — and that is the trade being made: the
head buys four labelled figures and a ranked list above the fold with the space the tiles used
to have. On `/procurement` the KPI band costs **zero extra bytes**: every figure is the
`hub_stats[scope]` blob the tiles already read.

### 11.2 The six defects the preview produced, in the order they were found

Worth recording in full, because five of the six were invisible to the type checker and four
were invisible to the whole test suite.

1. ⚠️ **The KPI band shipped §0's own defect on its first build.** `/governance` has no
   `?pscope`, so `useProcurementHubStats()` resolved to the SELECTED PARLIAMENT and the band
   rendered **€3,32 млрд. · 3 481 · 227 · 332** under captions reading „договори 2007–2026".
   The corpus figures are **€93,56 млрд. · 29 622 · 898 · 871**. Found by reading the rendered
   page — `tsc` was clean and 3 655 tests were green. Fixed by giving the hook an explicit
   `scopeKey` and linking the tiles with `?pscope=all`. **This is the strongest argument for
   §4.1 rule 6 there is: the band was designed to prevent exactly this and produced it anyway
   within twenty minutes.**
2. **A TEMPLATE i18n key defeats the bundle analysis.** `t(`${cluster.labelKey}\_desc`)` reads
   as naming every key ending `_desc`, so all eight deferred `budget.json` description keys
   became "reachable from `/governance`" and `bundle_reachability.test.ts` failed. Band
   description keys are written out in the registry now. **A hub registry must not build its
   i18n keys by template.**
3. **A registry import widened the route's static graph.** A „Държавни сектори 19" row derived
   its count from `SECTORS` — the right instinct (never a literal) applied to the wrong module,
   pulling `sectorRegistry`'s whole reference-data closure into `/governance`. This is
   `src/entryGraph.test.ts`'s class exactly. The row was dropped rather than hard-coded.
4. **The evidence card was mislabelled.** „Най-големи възложители" over rows that are SECTORS —
   a sector contains many buyers (АПИ sits inside „Пътища"). §4's "a group's content, its label
   and its destination must be the same set", one screen after writing it down.
5. **DOM order is the MOBILE order.** Rendering the aside as the grid's second child put a
   ranked list between the deck and the numbers on every phone. Fixed with explicit grid
   placement so the source order is identity → KPI → evidence and `lg` pulls the aside up.
6. **The 404 page's axis inverted.** `Title` now defaults to `text-left`, and `ErrorSection`
   centres its block — so the heading went left over centred body copy and a centred button.
   The one regression the site-wide change produced, found by loading `/nope-404`; fixed with
   an explicit `text-center` there. **§8 predicted this class and named the file.**

### 11.3 What the preview does NOT do

- **`/governance`'s KPI band still reads two blobs, not one.** It stands in for the
  `db:gen-governance-hub-stats` blob §9.3 specifies. Shipping means writing the generator; the
  page must go back to exactly one fetch.
- **No budget / funds / subsidies figures** — those come from the blob that does not exist yet,
  so the band shows procurement + people rather than the four taps §9.1 describes.
- **`/procurement`'s evidence card duplicates the `FeaturedStrip`** below it. It should carry
  top AWARDERS — a different set, and the one the heading originally promised.
- **No prerendered `bodyHtml` figures, no `preloadData`, no skeleton height** — §9.4 items 2–4.
- **The remaining eleven hubs are untouched**, as are the band/accent/CTA fixes in §4.4 B–J.

---

## 12. SHIPPED — the `/governance` blob, its finder, and the tile metrics

Built 2026-08-24. `/governance` is now the showcase the rest of the hubs get rebuilt against.

### 12.1 What it measures

|                         | before (2026-08-22) | after                                            |
| ----------------------- | ------------------- | ------------------------------------------------ |
| page-specific fetches   | **0**               | **1** (`governance/hub_stats.json`, 3.1 KB)      |
| first corpus figure     | 2 355 px            | **566 px** (the band; search at 447)             |
| first tile band         | 425 px              | 719 px                                           |
| tiles carrying a figure | 0 of 23             | **7 of 23** (+ 4 in the band)                    |
| a finder                | none                | 3 groups, 2 routes, **2 requests** per keystroke |

### 12.2 The generator is a FOLD

`scripts/db/gen_governance/hub_stats.ts` → `data/governance/hub_stats.json`, the FIFTH
`db:gen-*`, in `REFRESH_GENERATORS` with `bucketPath: governance/hub_stats.json`, and LAST in
the chain (after `db:gen-culture-hub-stats`) because it folds all four sibling generators.

Every figure is the destination's own number — its serving function (`budget_hub_stats`,
`agri_hub_stats`, `council_overview`), its payload row (`fund_payloads(kind='index')`), its
committed blob (procurement, sectors, parliament, declarations), or a direct count only where
it has none of those (`declaration`, `graph_edge`, `municipal_fiscal`). The rule is in
`dashboard-hub` §1.1 with the two measurements that forced it: a fresh `sum()` over `contracts`
was €93.81bn on a day the committed blob said €93.56bn, and `funds_hub_stats()` answers
"contracted EU funds" €197m differently from what `/funds` renders.

### 12.3 The band is the four taps, and the note is finally true

Band: държавен бюджет €29.6bn (план 2026) · обществени поръчки €93.6bn (договори 2011–2026) ·
европейски средства €44.3bn (договорени по ИСУН) · земеделски субсидии €11.0bn (изплатени от
ДФЗ). Those four tiles carry **no** metric — the resolution of §3.1 rule 5 is to take the figure
off the tile, not out of the band. The head's ranked list is corpus SIZES („Какво има вътре"),
because every money figure is already in the band above it.

`gov_hub_kpi_note` — "four separate corpora, they do not add up" — was moved off the band by
FINDING-004 because the band was not four money corpora. It is now, so the note is back and true.

### 12.4 Still open

- **The artifact is not published.** `db:check-generated` reports
  `governance/hub_stats.json  MISSING  404 — the artifact has NEVER been published`;
  the publish is `npm run bucket:sync:paths -- governance/hub_stats.json`, an operator step.
- No place/settlement group in the finder — there is no route for it that `/governance` can
  reuse, and inventing one is its own piece of work.
- `/governance` still has no `?pscope`, so the band is corpus-wide by construction; the tiles
  whose destinations are scoped link with the scope their caption names.
- The other eleven hubs are untouched.
