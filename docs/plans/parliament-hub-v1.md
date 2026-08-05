# Народно събрание — the /parliament module, v1

**One plan for the whole module: the hub UI, the Postgres migration, and the retirement of the
389 MB JSON corpus behind both.** Consolidated 2026-08-03 from `parliament-hub-v1` and
`parliament-rollcall-pg-v1`, which were siblings that kept having to explain each other.

Status: **ready to implement.** Drafted 2026-08-02; D1–D7 taken. Three audit passes have run
against the repo, the derived artifacts, local Postgres, GA4 and Search Console — every figure
below is **measured**, and §13 records what each pass overturned so the corrections are not
silently absorbed. Where a number is an extrapolation to Cloud SQL it says so.

Applies the module front-page template from [module-front-pages-v1.md](module-front-pages-v1.md)
to its first module, and the hub conventions the repo already enforces (`TileHubGrid` + a pure
registry + a scene map + a commit-time gate).

**How to read it.** §1–§3 are the case. §4–§6 are what gets built. §7–§9 are what gets retired,
loaded and published. §10–§11 are the sequence and the gates. Implementers can start at §10.

---

## 1. Decisions

| # | Decision | Resolution |
|---|---|---|
| **D1** | The name | **„Народно събрание".** Resolves the collision in §2.2 — the place-view pill keeps "Парламент" (a place's election results), the institution gets its own name. **Two independent parts of the repo already agree:** `scripts/prerender/bodyBuilders.ts:28` has said `bg: "Народно събрание", en: "National Assembly"` since the nav-hub list was written, and so does `data_map.json`'s `src:parliament` node. D1 closes an existing inconsistency rather than expressing a preference. Blast radius is larger than the i18n keys — §2.5. |
| **D2** | Top-level menu | **No.** Reached from the Управление hub tile + the Управление menu entry, as today. Revisit once the hub earns traffic. |
| **D3** | Governance tile | **Keep — it is the ONLY hub entry point**, which raises the stakes on the cross-hub gate in §11. Same shape as `/procurement`: both a governance tile and its own module. |
| **D4** | MP declarations / companies / cars | Stay under **Декларации** (their register is the Сметна палата, not the NS). Cross-linked from a dedicated band — promote the link, not the ownership. Same resolution as `/connections`. |
| **D5** | Hub layout | **Session strip as the hero, front-page structure beneath** — §4.1. Chosen over three alternatives on the recess finding and on the 613 record pages it promotes. |
| **D6** | Serving layer | **Migrate the roll-call facts to Postgres** (§6). The corpus is a 4M-row fact table with two dimensions being shipped as 2,964 static files, three of which individual page loads download whole. |
| **D7** | The JSON corpus | **Retire it — 2,948 of 2,964 files, 383 of 389 MB** (§7). Retirement is the deliverable, not a side effect: a migration that stands up tables and leaves the files in place has only doubled the number of places the truth lives. |

---

## 2. What exists today — measured

`/parliament` is `ParliamentHubScreen.tsx`: **49 lines of hardcoded JSX**, seven preview tiles,
no registry, no scene map, no test. It is the last hub in the app not built on the tile-hub kit.

The data is genuinely fresh — 52nd NS, **613 sessions, last 2026-07-31**, per-day files with item
titles, an 8-value topic taxonomy (`budget · tax · personnel · electoral · constitution ·
ratification · confidence_vote · other`), tallies and per-MP votes.

### 2.1 The payload problem — the biggest engineering finding

Each mini-tile fetches a full derived artifact to render three rows:

| Tile | Fetches | Size |
|---|---|---|
| `ParliamentSessionsTile` | `votes/index.json` | 303 KB |
| `ParliamentCohesionMiniTile` | `derived/cohesion.json` | 639 KB |
| `ParliamentMostPresent/AbsentMiniTile` | `derived/attendance.json` | 500 KB |
| `ParliamentEmbeddingMiniTile` | `derived/embedding.json` | 211 KB |
| `ParliamentVotingTile` | `derived/party_correlation.json` | 17 KB |
| `ParliamentSimilarityMiniTile` | `derived/similarity_headline.json` | 4.3 KB |
| | **total** | **~1.65 MB** |

`similarity_headline.json` (4.3 KB) is the pattern already proven *in this same directory* and
ignored by everything else: a precomputed headline slice instead of the 11.7 MB `similarity.json`
it summarises.

For a page meant to be opened daily, 1.65 MB of JSON to draw a tile grid is the defect. Every
other hub reads ONE small blob (procurement's `hub_stats.json` is **4.6 KB for all 30 scopes**,
because it carries numbers and nothing else).

**It is not the module's biggest payload, though — see §2.9.** `/votes/<date>` costs **482 KB on
an average day and 4.97 MB on the worst**, and those are the pages §2.7 shows people actually
reach. The hub's 1.65 MB is the louder number; the session files are the one readers pay.

### 2.2 The naming collision (why D1 exists)

`PLACE_VIEW_META.parliamentary` uses `cross_to_parliamentary` = **"Парламент"** for the
place-view switcher — a place's *parliamentary-election results* (`/`, `/municipality/:id`).
The governance tile to `/parliament` was **"Парламент"** too. Same word, two unrelated things.
D1 gives the institution its own name and leaves the switcher on ~40k place pages untouched.

### 2.3 The hub is already NS-scoped — via the global election selector

`useRollcallIndex` derives the parliament from the **header's election picker** —
`electionToNsFolder(selected)` in `src/data/parliament/nsFolders.ts` — and filters sessions by
`ns`. **Thirteen hooks** under `src/data/parliament/votes/` already consult `useElectionContext`.

So there is no new `?ns=` param to design. Two consequences, both binding:

- **The stats blob must be keyed by NS**, exactly as procurement's is keyed by scope.
- **Coverage must be resolved, and it is NOT binary.** `ELECTION_TO_NS` maps **13** elections to
  NS 40–52, but roll-call data exists for **NS 44–52 only**. Measured spans:

  | NS | plenary days | first → last | term covered |
  |---|---|---|---|
  | 40–43 | **0** | — | **none — the 2005/2009/2013/2014 elections have no roll-call data at all** |
  | 44 | 41 | 2020-10-28 → 2021-03-25 | **partial — the last ~5 months of a 2017–2021 term** |
  | 45 | 6 | 2021-04-21 → 2021-05-07 | full (a 17-day parliament) |
  | 46 | 26 | 2021-07-21 → 2021-09-15 | full |
  | 47 | 97 | 2021-12-03 → 2022-07-29 | full |
  | 48 | 52 | 2022-10-19 → 2023-02-02 | full |
  | 49 | 141 | 2023-04-12 → 2024-06-02 | full |
  | 50 | 37 | 2024-06-19 → 2024-09-26 | full |
  | 51 | 174 | 2024-11-11 → 2026-04-01 | full |
  | 52 | 39 | 2026-04-30 → 2026-07-31 | in progress |

  `?elections=` is in the `usePreserveParams` allowlist, so a visitor arriving from a 2009 page
  lands here with an empty parliament selected — the same trap CLAUDE.md documents for `?pscope`:
  *"A page narrower than the corpus MUST resolve the inbound scope."*

  **Three coverage states, not two**, and the middle one is the dangerous one:

  1. **no data** (NS 40–43) — the hub NAMES the gap: *„Няма поименни гласувания за 43-то НС
     (данните започват от 44-то)"*. Never zeros, never a silent re-anchor to the 52nd while the
     header still says 2009.
  2. **partial** (NS 44) — renders normally today and reports five months as if it were a
     four-year term. Nothing looks wrong, which makes it worse than case 1. The blob carries
     `coveredFrom`/`coveredTo` and the hub says *„данните за 44-то НС покриват само окт. 2020 –
     март 2021"* whenever the covered span is materially shorter than the term.
  3. **full** — the normal path. Session counts vary wildly (45: **6**; 51: **174**; 52: **39**),
     so "thin but present" is a normal state the tiles must read correctly.

### 2.4 Route sprawl — do not fix by moving

```
/parliament            hub          /parliament/cohesion   /parliament/attendance
/parliament/embedding  /parliament/similarity/:mpId
/votes   /votes/:date  /votes/:date/:slug   /votes/between/:pair
```

`/votes*` is the indexed, prerendered half — **613 live URLs** (`buildVotesRoutes`,
`scripts/prerender/dynamicRoutes.ts:2859`). Do not relocate it; unify by breadcrumb and hub.

Two routes have **no static entry point**, which §4.4 and §11 must handle:

- `/parliament/similarity/:mpId` — reachable only from `MpTwinsTile` / `MpSimilarityBrowser`;
- `/votes/between/:pair` — sourced only by `ParliamentVotingTile`, which renders on **three**
  screens (the hub, `/votes`, and `GovernanceCards` → `ParliamentSection`), so two survive the
  hub rebuild and the route is **not** orphaned by it.

### 2.5 D1 is nine i18n call sites *plus* hardcoded prerender copy

`gov_hub_parliament_title` resolves in **9 non-locale places**: five `GovernanceBreadcrumb`
`sectionKey`s (hub, attendance, cohesion, embedding, sessions index), two inline crumb arrays
(`SessionScreen:217`, `PartyPairBreaksScreen:79`), the Управление menu (`reportMenus.ts:157`)
and the governance registry (`governanceRegistry.ts:71`). Changing the two locale *values*
propagates to all nine at once; the key name stays.

But the prerendered HTML — the strings Google indexes — carries the word **hardcoded**, outside
i18n: `scripts/prerender/routes.ts` lines 2230 (the governance body's cross-link), 4261 (`title`),
4264 (`breadcrumbName`), 4267 (`<h1>`), plus their English mirrors. Phase 0 changes those too.

### 2.6 There is no MP roster page

`TopMpsScreen` is mounted at `/procurement/mps` — the MP-tied procurement leaderboard, not a
roster. **`/persons?role=mp`** is the nearest thing (`?role` is validated in
`useUrlPersonFilters`), but it is **not NS-scoped and cannot be**: `person_role` rows for `mp`
carry `ref = mpId` and no term column, so the destination shows **2,122 roles / 2,120 distinct
people** — every MP since the 44th, not the 240 currently seated. The tile states the
destination's basis, not the chamber's (§4.3).

### 2.7 Measured traffic — the ordering hypothesis, tested

[module-front-pages-v1 §5.1](module-front-pages-v1.md) says outright: *"There is no analytics
export in the repo, so any ordering I give is a hypothesis."* There is now data. GA4,
**Jan 1 – Aug 3 2026** (7 months):

| Prefix | distinct paths with traffic | views | active users | avg engagement | vs site avg |
|---|---|---|---|---|---|
| `/votes*` | **51** | **107** | 33 | **1m 27s** | **+15.6%** |
| `/parliament*` | 14 | 97¹ | 33 | 56s | **−24.8%** |

¹ includes 9 views on `/parliamentary/analysis*`, a different module — so this module is ~88.
Whole module ≈ **195 views, ~0.3% of site traffic, over seven months**.

Broken down, with the two slash variants of each path summed (§2.8 — the redirect split every
page across two GA rows until 2026-08-03):

| Destination | views | users | avg engagement |
|---|---|---|---|
| `/votes` index | 32 | 12 | 1m 22s |
| `/votes/<date>` + `/votes/<date>/<slug>` — **~49 record pages** | **~75** | — | up to **3m 22s** |
| `/parliament` hub | 47 | 22 | 36s |
| `/parliament/embedding` | **21** | 13 | **1m 01s** |
| `/parliament/cohesion` | 12 | 6 | 27s |
| `/parliament/attendance` | **2** | 1 | **9s** |
| `/parliament/similarity/:mpId` | 2 | 1 | 9s |

**Three findings, and the first two change this plan.**

1. **The records beat the analytics, decisively.** `/votes*` out-earns the whole analytical half
   on views, on distinct pages reached, and on engagement — it is the only half of the module
   *above* the site's average engagement, while `/parliament*` is a quarter below. The single
   best-engaging page in the module is a **2020** item page
   (`/votes/2020-11-06/item-5-zid-na-zakona-za-merkite…`, **3m 22s**) — an NS 44 record, from the
   partial parliament §2.3 warns about. Record pages have durable long-tail value; dashboards do
   not. This is `module-front-pages-v1 §5.2`'s "look-up beats read" principle **confirmed**, but
   pointing at `/votes/:date`, not at attendance and cohesion.
2. **`/parliament/embedding` outperforms cohesion and attendance combined** — 21 views at 1m 01s
   against 12 and **2** — from the **last** tile position on the current hub. Band 3 is reordered
   accordingly (§4.3).
3. **Discovery, not demand, is the constraint — quantified.** ~49 of 613+ record pages were
   reached at all in seven months (**~8%**), by 33 people, with **zero search impressions** on the
   prefix (`project_seo_discovery_gap`). That is what a page nobody can find looks like, and it
   re-orders the phases (§10).

**How much weight to put on this.** Not much per-tile: n = 33 users, and the distribution is
**endogenous** — it measures what the current seven-tile hub links to. Embedding outperforming
*from last position* is the one signal that survives that objection; the `/votes`-beats-
`/parliament` split (different prefixes, no shared tile order) is the other. Everything finer is
noise, and the plan should not pretend otherwise.

### 2.8 Every URL on the site canonicalised to a redirect — RESOLVED

Found while checking why GSC reported `/parliament` as *"Page is not indexed: Page with
redirect"*. **That report was not a defect** — `/parliament` 301'd to `/parliament/`, so
"page with redirect" is the correct answer for the variant inspected. The real finding was
underneath, and **site-wide, not parliamentary**:

```
GET /parliament   →  301  location: /parliament/
GET /parliament/  →  200  <link rel="canonical" href="https://electionsbg.com/parliament" />
```

`bgUrlFor` / `enUrlFor` (`scripts/prerender/index.ts:145`) and the sitemap builder emit every URL
**without** a trailing slash, while the prerender writes `dist/<path>/index.html`, so Firebase
added one on serve. Every canonical, `hreflang`, `og:url` and sitemap `<loc>` pointed one 301 away
from the page that served — across **~248k prerendered URLs**.

**It was never the cause of the zero-impression gap.** Measured control: `/sofia`, `/governance`
and `/votes` had the identical shape, and `/sofia` earns impressions.

**RESOLVED 2026-08-03 — `"trailingSlash": false` (`0adc97b6dd`).** Taken as its own work item.
The count that decided it: the no-slash form is used by **350** `href="${SITE_URL}/…"` emitters,
by all **294** router paths in `src/routes.tsx` (**zero** end in a slash), by the sitemap, by
`functions/spa_page.js` and by `scripts/llms/buildIndex.ts`. Firebase's directory-index default
was the only component disagreeing, so the alternative fix was never "two generators in lockstep"
— it was four generators plus 350 hand-written links, and it could not reach `src/routes.tsx` at
all, leaving the address bar permanently disagreeing with the canonical.

The rule **inverts at the roots**: the bare `/` keeps its slash (hosting never strips it) but the
EN root is `/en`, **not** `/en/` — that was the single place the code already emitted a slash, so
it needed fixing in the same commit. Function-served routes (`/funds/contract/**`, `/company/**`)
are exempt from slash normalisation and were unaffected. `tests/seo.spec.ts` now asserts the new
direction plus a `canonical/og:url/hreflang do not redirect` gate over a hub, a sub-tab and both
roots — the assertion whose absence let this survive, since the old suite checked the canonical
*string* and never that the URL it named served 200.

**GA discontinuity at 2026-08-03.** The paired rows in §2.7 collapse. Comparisons spanning that
date must sum the pairs on the before side and must not on the after side.

### 2.9 The corpus as data — 389 MB, 2,964 files, 4M rows

| | |
|---|---|
| session files | **613**, `data/parliament/votes/sessions/*.json`, **288 MB** — avg **482 KB**, largest **4.97 MB** |
| derived artifacts | **99 MB**, of which `per-mp/` is **43 MB** across **2,330 shards** |
| **total** | **389 MB across 2,964 JSON files**, all bucket-served, **no `bucket_sync_paths` guard** |
| vote items | **16,741** (raw; `dedupeRevotes` collapses re-votes for the derived metrics) |
| vote casts | **4,017,603** |
| distinct `(ns, mp_id)` seats | **2,366** |
| distinct `mp_id` | **1,370** — ids are **recycled across parliaments** (§3.2) |
| worst parliament | NS 51 — 4,687 items, **1,124,892 casts**, 309 MPs |
| vote values | `yes` 1,691,839 · `absent` 1,257,396 · `no` 714,406 · `abstain` 353,962 |

Per-artifact, with its consumer (bytes on disk; the bucket serves identity encoding, so these are
wire sizes):

| Artifact | Size | Fetched by |
|---|---|---|
| **`sessions/<date>.json`** | **482 KB avg · 4.97 MB max** | **`useRollcallSession` → every `/votes/<date>` page load** |
| `dissents.json` | **31 MB** | `useMpDissents` → every candidate page **whose per-MP shard is missing** |
| `similarity.json` | **11.7 MB** | `useMpSimilarity` → same, plus `/parliament/similarity/:mpId` |
| `topic_index.json` | **8 MB** | `useTopicIndex` → `/votes`, `ContestedVotesFeed` |
| `party_pair_breaks.json` | 2.6 MB | `/votes/between/:pair` |
| `search_index.json` | 758 KB | offline harness only |
| `cohesion.json` | 639 KB | `/parliament/cohesion` + 2 tiles |
| `attendance.json` | 500 KB | `/parliament/attendance` + 2 tiles |
| `loyalty.json` | 413 KB | 5 consumers |
| `index.json` | 303 KB | the hub, `buildVotesRoutes`, the sitemap |
| `embedding.json` | 211 KB | `/parliament/embedding` + 3 tiles |
| `important_votes/<ns>.json` | 47 KB × 9 | **`useAreaImportantVotes` → the „Как гласуваха" tile on every My-Area dashboard** |
| `similarity_headline.json` | 4.3 KB | the hub tile |

---

## 3. The four defects that make the data layer change non-optional

### 3.1 The 31 MB fallback fires in production today

`useMpShard` fetches `per-mp/<ns>/<csvId>.json` and returns `null` on 404; the consumers
(`useMpDissents`, `useMpSimilarity`, `useMpLoyalty`) then **fall back to the NS aggregate**. The
comment calls this graceful. It is not — the fallback path is a **31 MB** download.

Shards exist only for MPs the loyalty pass considers rostered (`per_mp_shards.ts:109` —
*"Loyalty is the authoritative roster — no loyalty, no shard"*). Measured coverage:

| NS | MPs who cast a vote | shards written | **falling back** |
|---|---|---|---|
| 44 | 245 | 243 | 2 |
| 47 | 268 | 264 | 4 |
| 49 | 264 | 263 | 1 |
| **50** | **289** | **265** | **24** |
| 51 | 309 | 307 | 2 |
| 52 | 270 | 268 | 2 |
| | 2,366 | 2,330 | **36** |

Thirty-six candidate pages — 24 of them in the 50th NS — download 31 MB + 11.7 MB to render a
dissents tile. Nothing reports this; the fallback is silent by design. In Postgres the same page
is a point lookup: **1.146 ms, 693 buffers**.

### 3.2 `mp_id` is not unique, and 26 ids belong to two different people

`useMpShard` already warns that *"parliament.bg recycles ids across NSes"*, but nothing enforces
it. Measured: **1,370 distinct `mp_id` for 2,366 seats**, and after normalising whitespace and
punctuation, **26 ids carry two genuinely different names**:

```
3103 → ДИМИТЪР БОЙЧЕВ ПЕТРОВ  ||  ДЕНИЦА ДИМИТРОВА СИМЕОНОВА
3113 → ВЛАДИМИР СЛАВЧЕВ ВЪЛЕВ ||  ДИМИТЪР АНГЕЛОВ ИВАНОВ
3123 → ВЕСЕЛА НИКОЛАЕВА ЛЕЧЕВА||  ДРАГОМИР ВЕЛКОВ СТОЙНЕВ
… 26 in total
```

This is **load-bearing for the person layer**. `person_role` for `source='mp'` stores
`ref = mp_id::text` with **no NS column** (`104_mp_roster.sql`), so for these 26 ids the bridge
from a person to their votes is already ambiguous. A migration making `vote_cast.mp_id` a plain FK
to `mp_profile.mp_id` would silently merge two people's voting records.

**The natural key is `(ns, mp_id)`. Never `mp_id`.**

### 3.3 84 duplicate casts that the JSON layer counts twice

`ALTER TABLE vote_cast ADD PRIMARY KEY (item_id, mp_id)` failed on first attempt:

```
ERROR: could not create unique index "vote_cast_pkey"
DETAIL: Key (item_id, mp_id)=(1051, 3537) is duplicated.
```

**84 duplicate pairs, 168 rows** — the same MP listed twice in one item's roll, always with an
identical `absent`, always on the opening sitting of a parliament (NS 45 2021-04-21, NS 52
2026-04-30). 0.004% of the corpus and harmless to any conclusion, but the JSON `votes` object is
keyed by **position**, not by MP, so nothing dedupes it: every attendance denominator counts those
MPs twice. **A primary key is the only thing that has ever noticed.**

### 3.4 "What is a law" needs a dimension, not a regex

§4.2 has to cut the pass/fail law count from v1 because the corpus has no bill record: 7,782
second-reading items are per-article votes, and the only way to group them is a title-string
split. In SQL that becomes a real `bill` dimension — resolved once by the loader, indexed,
joinable — instead of a regex re-run in the browser on every render. The migration's biggest
*product* win, distinct from its performance win.

---

## 4. The hub

Band order is fixed; bands are individually optional.

**Every number on this page declares its basis.** Not a style note: §4.3 measures three legitimate
answers to "how many votes were there" and three to "what is attendance", and an earlier draft
picked a different one for each tile by accident. The generator computes one declared basis per
stat and §11's gate recomputes it.

### 4.1 Layout — the chosen option (D5)

Four layouts were mocked (front page · chamber-led · split masthead · session strip). They differ
only in **what occupies the top third** — bands 3–5 are `TileHubGrid` in every one.

```
band 0   wire line — „НС не заседава от 31 юли (2 дни)"
HERO     SESSION STRIP — one column per plenary day over ~6 weeks, gaps drawn
band 1   lead card
band 2   news rail (3–4)
band 3   Разгледай (4 tiles)
band 4   Още (3 tiles)
band 5   Депутатите извън залата (4 tiles)
band 6   За теб / Данни и метод
```

**Why the strip.** Recess is not an edge case — measured over all nine NS, the median gap between
plenary days is **1 day**, the maximum **34**, and **11–32% of each term's calendar days sit
inside a gap longer than 10 days** (NS 44: 32%, NS 49: 25%, NS 51: 21%). The front-page and
chamber-led layouts answer that with apologetic copy in the most valuable space on the page; the
strip answers it with **information** — fourteen columns, four of them empty, the shape of the
summer legible at a glance. It is also the only option that promotes the 613 `/votes/<date>`
pages, which §2.7 measures as the best-performing half and §9 as the half nothing links to.

Split-masthead was rejected on the mobile collapse: a 60/40 split stacks into the front-page
layout on phones, so its one advantage evaporates on most traffic, and it forks `NewsRail` away
from the shared horizontal component the other 18 modules will use.

**The hemicycle survives, one band down.** The chamber-led option had the best identity signal —
it says *institution*, which is D1's whole problem — but in the hero it draws from the roster
(`mp_profile`) while every tile below draws from the roll-call corpus: two sources, two freshness
dates, at the top of a page whose audit was largely about basis mismatches. So the hemicycle
becomes the **cohesion tile's scene** (§4.5). Same recognition value, decorative rather than
load-bearing, no second data source.

**One rule stolen from the rejected split-masthead: every rail and strip item carries its own
date, unconditionally** — not only in recess. Band 0 already softened the recess rule from
"collapse" to "re-label"; making the date unconditional removes the conditional state entirely,
and conditional presentation is where this page's audit found most of its defects.

#### What the strip can and cannot show

`RollcallIndexEntry` is `{ date, stenogramId, items, file, ns }` — **`index.json` carries no
tallies.** Per-day за/против/въздържал exists only inside the session files, which the hub may
never fetch. So the strip is phased:

| | Column encodes | Source | Phase |
|---|---|---|---|
| v1 | **items voted that day** (bar height), sitting vs gap | `index.json` — already fetched | H0 |
| v2 | stacked за / против / въздържал | `hub_feed/<ns>.json` | H2 |

v1 carries the whole point — the calendar shape, the gaps, 613 deep links. It encodes volume, not
outcome, and **must not be captioned as though it encodes outcome**.

The strip is **informational, not decorative**: unlike a tile scene it cannot be `aria-hidden`, so
it needs a text equivalent (a visually-hidden list of date + item count, or a `<table>` fallback).

### 4.2 Bands 0–2, and „Приети закони" — the derivation the corpus cannot support

**Band 0 — wire (one line).**
`Днес в НС: 5 гласувания · 3 законопроекта на второ четене · 73% присъствие` →
`/votes/<latest date>`. Three coverage states, all explicit (§2.3): full · partial · none. In
recess the framing flips (*„НС не заседава от 31 юли (12 дни)"*) and every item below carries an
explicit event date with no relative-time kicker.

**Band 1 — lead.** One item: the most consequential vote of the period, selected over the **full
session corpus**, restricted to final-adoption items. Overridable by a committed `leads.json`.

The draft's rule — highest `score` in `important_votes` among final-adoption items — is
unrunnable. Measured:

| NS | entries | „първо" | „второ" | neither | final-adoption candidates |
|---|---|---|---|---|---|
| 44 | 15 | 6 | 2 | 7 | 2 |
| 45 | 15 | 1 | 14 | 0 | 14 |
| 46 | 15 | 8 | 4 | 3 | 4 |
| 47 | 15 | 6 | 1 | 8 | 1 |
| 48 | 15 | 8 | **0** | 7 | **0** |
| 49 | 15 | 1 | 1 | 13 | 1 |
| 50 | 15 | 9 | 3 | 3 | 3 |
| 51 | 15 | **0** | **0** | 15 | **0** |
| 52 | 15 | 8 | 4 | 3 | 4 |

`derived/important_votes/<ns>.json` holds exactly **15 entries** — a top-15-by-score shard, not a
corpus — and carries no reading-stage field. For NS 48 and NS 51 the rule yields **nothing**; the
current top-scoring item in the 52nd (score 80) is titled `… - първо гласуване`.

**There is no "law adopted" record anywhere in the corpus.** Over all 14,870 items: 1,847 carry
„първо гласуване/четене", **7,782 carry „второ"**, 5,241 neither. But the second-reading items are
**per-article votes** — for NS 52 alone there are 754, of which 466 match `параграф`, plus
`член N`, `Приложение`, `наименование`, and per-MP amendment proposals:

```
ЗИ на Закона за държавната финансова инспекция – второ гласуване - параграф 1 до параграф 5
Закон за противодействие на корупцията … - второ гласуване - член 7 - предложение от Елена Нон…
```

A naive count reports ~750 „приети закони" for a parliament that passed a few dozen.

**The derivation that works — bill-stem grouping.** Split each second-reading title on
`/\s*[-–]\s*второ (гласуване|четене)/` and group by the stem. NS 52 collapses from 754 items to
**33 distinct bills** (largest: държавния бюджет 232 items, Изборния кодекс 136, противодействие
на корупцията 69).

**What is NOT derivable, and is cut from v1:** the pass/fail split. "Last item of the stem" does
not give adoption — the largest stem ends on `yes:38 no:4 abstain:135`, a rejected amendment. So
the tile is **„Законопроекти на второ четене" = 33**, band 0 says *„N законопроекта на второ
четене"*, and **„N окончателно приети · N отхвърлени" is dropped** until §6.1's `bill.final_item`
has a marker to fill it.

**Band 2 — news rail (3–4 `NewsCard`s).**

| Card | Source | Feasibility |
|---|---|---|
| Последни гласувания | `votes/index.json` sessions + the day file | **A** |
| Законопроекти на второ четене | bill-stem grouping over the corpus | **A** |
| Разцепления — кой гласува срещу своите | `dissents.json` 31 MB → precomputed top-N slice, in-memory (§5) | **B** |
| Отсъствия от последното заседание | `attendance.json` → slice | **B** |
| Предстоящи законопроекти | **not ingested** — a new parliament.bg crawl | **C, out of scope** |

### 4.3 Band 3 — Разгледай (core, 4)

Ordered by the template's rule — **look-up beats read** — which §2.7 confirms with data rather
than assuming. Today's hub opens with cohesion and embedding, the two most analytical things on it.

| Tile | To | stock · flow · change (NS 52, measured) | traffic |
|---|---|---|---|
| Гласувания | `/votes` | `39` заседания · `1 198` точки · `33` законопроекта на второ четене | **107** views, +15.6% |
| Карта на гласуването | `/parliament/embedding` | `270` депутати проектирани · `6` групи | **21** views, 1m 01s |
| Единство на групите | `/parliament/cohesion` | `0,97` средна кохезия · най-разединена: ГЕРБ - СДС (0,93) | 12 views |
| Депутати | `/persons?role=mp` | `2 120` депутати от 44-то НС насам · `240` в текущото | no history |

**The measured numbers, and their bases.** An earlier draft's illustrative figures were wrong in
six of six cases, each for a different reason. On NS 52:

| Figure | Draft said | Measured | Why the gap |
|---|---|---|---|
| сесии | 613 | **39** | 613 is the all-NS total on an NS-keyed hub |
| гласувания | `N` | **1,263** (`index.json`) · **1,198** (`attendance.totalVoteItems`) · **1,157** (`itemTitles`) | `dedupeRevotes` collapses re-votes; three counts are all legitimate |
| депутати | 240 | **240** seats · **270** attendance entries · **2,120** rows at the destination | substitutions inflate the roll; the destination is all-time |
| групи | 8 | **6** | ДПС, ВЪЗРАЖДАНЕ, ПП, ДБ, ПБ, ГЕРБ - СДС |
| присъствие | 87% | **70.2%** simple · **73.2%** weighted · **73.6%** over the 238 MPs present for ≥80% of items | no basis declared |
| кохезия | 0.94 средна | mean **0.970**; **0.934** is the *minimum* (ГЕРБ - СДС) | the "mean" was the min |

**Declared bases for v1**, asserted in §11: сесии = plenary days for the selected NS · гласувания
= post-dedupe item count (`attendance.totalVoteItems`), labelled *„точки за гласуване"* ·
присъствие = **weighted** (`Σ present / Σ items`), because a simple mean over-weights MPs who sat
for nine items · кохезия = unweighted mean over groups, with the least-unified group named
separately — two numbers, two labels, never one number wearing both · депутати = the
**destination's** basis, because it links there.

**Three changes from the draft, all forced by §2.7.** Присъствие moves to band 4 (2 views, 9s).
Карта на гласуването moves up (21 views, 1m 01s, from the *last* tile slot — the one signal that
survives the endogeneity objection). And **Законопроекти stops being a tile**: the draft gave it
`to: "/votes"`, the same destination as Гласувания, and `TileHubGrid` renders with
`key={tile.to}` — that is a **duplicate React key**, not just a duplicate link. It becomes the
flow number on Гласувания, which is also more honest, since §4.2's derivation has no destination
that can show what it counts (`?topic=`'s vocabulary is the 8-value `VoteTopic` taxonomy and
contains nothing meaning "second reading").

### 4.4 Band 4 — Още (3), and the crawlability requirement

Присъствие (`/parliament/attendance`) · Сходство между депутати · Двама депутати един срещу друг.

**Разцепления is CUT — it has no route.** `grep dissent src/routes.tsx` returns nothing; the only
surface is `MpDissentsSection` on a candidate page. It stays a band-2 news card, where it needs no
destination, and returns as a tile if `/parliament/dissents` is ever built.

**Two of the three have no STATIC destination** (§2.4). Both resolve from the blob:

- **Сходство** → `hubStats.byNs[ns].seeds.similarity` — `similarity_headline.json` computes a
  per-NS `seedId`, so the href is `/parliament/similarity/<seedId>`.
- **Двама депутати** → `hubStats.byNs[ns].seeds.pair` — `party_correlation.json` carries the
  most-divergent pair, so the href is `/votes/between/<pairSlug>`. The slug format is fixed by the
  existing consumer (`ParliamentVotingTile:143`) and must round-trip party names containing
  hyphens: `` `${encodeURIComponent(a)}--${encodeURIComponent(b)}` `` — a **double** hyphen
  separator, because `ГЕРБ-СДС` contains a single one.

**Registry representation**, so the gate can check rather than trust: every entry carries
`to: string`; a `to` with a `:` segment MUST also carry `seed: "similarity" | "pair"`, and the
screen substitutes. **A tile whose seed is unavailable is omitted, not rendered with a broken
href** — an absent tile is honest, a dead link is not.

**Routed is not CRAWLABLE, and both fail that second test.** Measured live:

```
/parliament/similarity/5064   <title>Парламентарни избори 2026 …</title>   canonical -> https://electionsbg.com/
/votes/between/GERB--PP       <title>Парламентарни избори 2026 …</title>   canonical -> https://electionsbg.com/
/parliament/cohesion          <title>Партийна дисциплина …</title>          canonical -> itself
```

Neither is prerendered — no `staticPage` entry, no `route_defs.ts` line — so both serve the **SPA
shell**: the homepage's title, description and canonical. To a crawler they are duplicates of `/`.
This is the defect CLAUDE.md records for `/funds/contract/**` and `/company/**` before
`spa_page.js`, at a smaller scale — and it lands worse here, because §9 deliberately feeds these
links crawl equity from a prerendered hub. So:

- **prerender ONE seed instance of each**, self-canonical, added to `route_defs.ts`. Two pages
  against a ~248k-file `dist/`; the file-count ceiling is untouched.
- The seed is NS-dependent, so it is rebuilt when the parliament changes — the same seed the hub
  reads from the blob, one source, not two.
- If that is judged not worth doing, the honest alternative is to **drop both tiles**. What band 4
  may not do is link a prerendered page at a homepage duplicate and say nothing.

### 4.5 Tile inventory — 11 tiles, 11 accents, 11 bespoke scenes

Every tile gets a hand-drawn vignette in the `SceneFrame` contract (300×116, ink =
`currentColor`, accent = `var(--sector)`, `PAPER` for under-ink fills). **None is reused from
another hub** — `governanceScenes.tsx` has a connections mark and a persons mark, but they carry a
different page's meaning; here the question is "what does this destination answer about the
National Assembly". Dense marks stay right-half and top, because phase H1 overlays a `metric` at
the banner's bottom-left. Accents are unique **per page**; the palette has 20 tokens.

| Band | Tile | `to` | accent | scene |
|---|---|---|---|---|
| 3 | Гласувания | `/votes` | plum | roll-call tally — three agenda rows as segmented за/против/въздържал bars. The one mark that shows the *shape* of a vote rather than a metaphor for one |
| 3 | Карта на гласуването | `/parliament/embedding` | indigo | the UMAP: three loose clusters, one pulled away, plus a hollow stray between two of them — the cross-party voter the map exists to reveal |
| 3 | Единство на групите | `/parliament/cohesion` | teal | **the hemicycle** (§4.1) — five fanned ranks blocked by group, with ONE seat in the accent block drawn hollow: the member voting against their own. That single mark *is* what cohesion measures |
| 3 | Депутати | `/persons?role=mp` | clay | four seated figures in a rank, heads + shoulders only so it survives thumbnail size, the accent one forward |
| 4 | Присъствие | `/parliament/attendance` | amber | the register — a 9×4 grid, filled = present, hollow = absent, absences clustering right the way a thinning sitting actually reads |
| 4 | Сходство между депутати | `/parliament/similarity/:mpId` | aqua | two voting records side by side with the matching rows bridged; the bridges are the score, drawn rather than stated |
| 4 | Двама депутати един срещу друг | `/votes/between/:pair` | terracotta | diverging bars either side of a shared axis — same items, two members, opposite sides |
| 5 | Декларации | `/governance/declarations` | rose | a filed sheet in `PAPER` under ruled ink, accent stamp across the corner |
| 5 | Имущество | `/mp-assets` | gold | a house in ink beside a coin stack in accent — the two asset classes that dominate the filings |
| 5 | Фирми | `/mp/companies` | moss | a company block, one storey lit in accent. Deliberately not an org chart: this tile is about ownership, not structure |
| 5 | Свързани лица | `/connections` | steel | the ego graph — one MP node in accent, company nodes around it, two edges running off-frame to say the graph does not stop here |

All four band-5 routes verified present in `routes.tsx`. That band is what makes the hub a
*module* rather than a vote-analytics silo, and it is pure linking — no new data (D4).

**Band 6 — За теб / Данни и метод.** Моят депутат (via `my-area`) · Following · then sources,
`lastDate`, coverage span (§2.3), and the §4.2/§4.3 bases in plain language. The bases belong on
the page, not only in the generator: "73% присъствие" without "претеглено спрямо точките, в които
депутатът е могъл да гласува" is the kind of number that gets quoted back at us.

Files: `src/screens/parliament/parliamentRegistry.ts` (pure data, no JSX), `parliamentScenes.tsx`
(the lookup table — needs the `react-refresh/only-export-components` disable, as every scenes
registry does), `ParliamentHubScreen.tsx`, and the strip as its own component so H2 can swap its
data source without touching the hub. Bands 3–5 need ~30 new i18n keys × 2 locales.

---

## 5. The hub's own data — two artifacts, one generator

New `scripts/parliament/derived/hub_stats.ts`, wired into `rebuildDerived` in
`scripts/parliament/derived/index.ts` — one module per artifact, the pattern is already there.

**It runs LAST and takes its inputs from memory.** `rebuildDerived` already computes
`attendanceByNs`, `cohesionByNs`, `dissentsByNs`, `importantVotesByNs` and the deduped `byNs`
session map before it writes anything. Passing those objects into `computeHubStats(...)` means the
31 MB `dissents.json` is never re-parsed, and — more importantly — the hub's numbers cannot drift
from the sub-page's, because both are the same in-memory object.

### 5.1 Two files, not one

A single blob holding tiles + feed + lead for all nine NS blows the budget: feed items carry
Bulgarian bill titles that routinely run 130+ characters, so nine parliaments × ~17 items ×
~250 B ≈ 38 KB of feed alone, with every visitor downloading eight parliaments of rail they will
not read. Shard it, matching `important_votes/<ns>.json` **in the same directory**:

```
derived/hub_stats.json          all NS · numbers, coverage, seeds   ~6 KB · always fetched
derived/hub_feed/<ns>.json      rail + lead for ONE NS              ~6 KB · fetched on demand
```

```jsonc
// hub_stats.json
{ "computedAt": "…",
  "byNs": {
    "52": { "lastDate": "2026-07-31", "sessions": 39, "inRecessDays": 2,
            "coveredFrom": "2026-04-30", "coveredTo": "2026-07-31", "coverage": "full",
            "tiles": { "votes": {...}, "embedding": {...}, "cohesion": {...}, "mps": {...} },
            "seeds": { "similarity": "/parliament/similarity/5064",
                       "pair": "/votes/between/gerb-sds__pp" } },
    "44": { "…": "…", "coverage": "partial",
            "coveredFrom": "2020-10-28", "coveredTo": "2021-03-25" }
    // … 45–51. NS 40–43 are ABSENT; the hub renders the no-data state (§2.3).
  } }
```

```jsonc
// hub_feed/52.json
{ "computedAt": "…", "ns": "52", "lead": { /* one FeedItem */ },
  "feed": { "sessions": [/* ≤4 */], "bills": [/* ≤4, stem-grouped */],
            "dissents": [/* ≤4 */], "absences": [/* ≤4 */] } }
```

Budget: **`hub_stats.json` ≤ 10 KB**, **each `hub_feed/<ns>.json` ≤ 12 KB**. Reuses the `FeedItem`
shape from the module plan (`id · kind · at · title · subtitle · to · badge? · tone?`) so
`NewsRail` stays generic. Two hooks mirroring `useProcurementHubStats`; both return `undefined`
for an uncovered NS, which is what drives the honest empty state rather than a zeroed tile.

**`hub_stats.json` stays a committed static artifact even after the Postgres migration.** §6
changes the generator's *source* from in-memory objects to SQL; it does not change the hub's
fetch. That is the shape `scripts/db/gen_procurement/hub_stats.ts` already uses (PG-sourced,
statically served), and a 6 KB static blob beats an API call on the page most likely to be hit
cold by a crawler — no connection, no 10 s `statement_timeout`, no degrade path to reason about.

### 5.2 Six of the seven mini-tiles are hub-only — H1 DELETES them

The claim that the existing mini-tiles "keep their own fetches on their own sub-pages" is **false**.
Measured, consumers excluding each component's own definition:

| Component | Rendered by | After H1 |
|---|---|---|
| `ParliamentSessionsTile` · `ParliamentCohesionMiniTile` · `ParliamentMostPresentMiniTile` · `ParliamentMostAbsentMiniTile` · `ParliamentSimilarityMiniTile` · `ParliamentEmbeddingMiniTile` | hub only | **dead** |
| `ParliamentVotingTile` | hub **+ `/votes` (`SessionsIndexScreen:165`) + `GovernanceCards` → `ParliamentSection:31`** | survives |

So H1 does not "stop using" six components — it **orphans** them. They must be deleted in the same
commit, together with any hook whose only remaining caller they were.

### 5.3 Publishing

`data/parliament/votes/derived/` is bucket-served, so both artifacts need:

1. **the `--upload` branch of `rebuildDerived`** (`index.ts:315–353`) — `uploadText` for
   `hub_stats.json`, `uploadTextTree` for `hub_feed/`, as `important_votes/` is handled. Without
   it the daily `update-rollcall` run refreshes eight artifacts and leaves the hub on last week's
   numbers: green locally, stale on prod.
2. `npm run bucket:sync:paths -- parliament/votes/derived` for a hand-run publish.
3. A `bucket:gz` decision — the bucket serves identity encoding.

§11 adds a generic gate for (1): **every file `rebuildDerived` writes appears in its `--upload`
branch**, which closes this class for the eight existing artifacts too.

---

## 6. The Postgres layer

### 6.1 Schema — migrations 132–134

Next free number is **132** (131 is `kzk_appeal_provenance`).

```sql
-- 132_rollcall.sql
CREATE TABLE vote_item (
  item_id   integer PRIMARY KEY,      -- synthetic, assigned in (date, item_no) order
  ns        smallint NOT NULL,
  date      date     NOT NULL,
  item_no   smallint NOT NULL,
  slug      text,                     -- the /votes/:date/:slug segment
  title     text,
  topic     text NOT NULL,            -- the 8-value VoteTopic taxonomy
  bill_id   integer REFERENCES bill(bill_id),   -- 134; NULL for non-bill items
  reading   smallint,                 -- 1 | 2 | NULL, from the title (134)
  yes smallint, no smallint, abstain smallint, absent smallint,
  UNIQUE (ns, date, item_no)
);
CREATE INDEX ON vote_item (ns, date);
CREATE INDEX ON vote_item (date);            -- the /votes/:date path, §6.2
CREATE INDEX ON vote_item (bill_id) WHERE bill_id IS NOT NULL;

CREATE TABLE mp_seat (                 -- the (ns, mp_id) dimension §3.2 forces
  ns smallint, mp_id integer, name text NOT NULL, party_id smallint REFERENCES party_dim,
  PRIMARY KEY (ns, mp_id)
);

CREATE TABLE vote_cast (
  item_id  integer  NOT NULL REFERENCES vote_item,
  mp_id    integer  NOT NULL,
  ns       smallint NOT NULL,          -- DENORMALISED — see below
  vote     "char"   NOT NULL,          -- 'y' | 'n' | 'a' | 'x'
  party_id smallint REFERENCES party_dim,
  PRIMARY KEY (item_id, mp_id),
  FOREIGN KEY (ns, mp_id) REFERENCES mp_seat (ns, mp_id)
);
CREATE INDEX ON vote_cast (ns, mp_id) INCLUDE (vote, party_id);
CREATE INDEX ON vote_cast (mp_id, item_id) INCLUDE (vote);
```

**Which item set does `vote_item` hold? The DEDUPED one, 15,096 rows — not the raw 16,741.**
This is the grain question the two source plans never had to answer together, and getting it
wrong breaks §11's own correctness gate. `dedupeRevotes` collapses an item and its
„прегласуване" (and verbatim same-day repeats) so a decision voted N times counts once; every
derived JSON artifact is computed **after** it:

| NS | raw items | after dedupe | collapsed |
|---|---|---|---|
| 44 | 1,050 | 1,036 | 14 |
| 47 | 2,116 | 1,933 | 183 |
| 48 | 1,690 | 1,435 | 255 |
| 49 | 4,308 | 3,855 | 453 |
| 51 | 4,687 | 4,187 | 500 |
| 52 | 1,263 | 1,198 | 65 |
| **all** | **16,741** | **15,096** | **1,645 = 9.8%** |

So: the loader applies `dedupeRevotes` **before** assigning `item_id`, `vote_item` holds 15,096
rows, and a `superseded_by integer REFERENCES vote_item` column keeps the collapsed casts
reachable rather than discarded — the raw roll is evidence, and `/votes/<date>` should still be
able to show that an item was re-voted. Loading the raw set instead would make
`mp_attendance` disagree with `attendance.json` by ~10% on every NS, and §11's **matview
agreement** gate — the migration's correctness proof — would fail by construction rather than
by defect.

**Three more decisions worth defending:**

- **`vote "char"`, not an enum or text.** 1 byte, no TOAST, no enum-ordering trap. `party_id` is a
  `smallint` into a **71-row** `party_dim(ns, short)` rather than the party short-name repeated
  4M times.
- **`ns` denormalised onto `vote_cast`.** Measured: without it the per-NS attendance aggregate
  hash-joins through `vote_item` and **seq-scans the fact table** — 183 ms / **25,769 buffers**.
  With it, 77 ms / **3,124 buffers**. The column packs into existing alignment padding beside
  `vote` and is immutable per item, so it cannot drift.
- **The `(ns, mp_id)` composite FK** (§3.2) — the constraint that makes the 26 recycled ids safe.
- **`party_id` lives on `vote_cast`, and `mp_seat.party_id` is a LABEL, not a join key.**
  Measured: **179 of 2,366 seats (8%) change party mid-term** — mostly to `НЕЗ` when a member
  leaves their group (`44:1564 ГЕРБ → НЕЗ`, `45:3537 БСП → ДБ`, `47:3993 ИТН → НЕЗ`). A single
  `party_id` per seat is therefore undefined for one seat in twelve. `vote_cast.party_id` is the
  affiliation **at the moment of the cast**, which the session files record per day, and it is the
  only one any derivation may join. In particular `mp_dissent` — "voted against their group's
  plurality" — **must** group on `vote_cast.party_id`; joining `mp_seat.party_id` would compare
  179 members against a group they had already left, and would do it silently. `mp_seat.party_id`
  is the last-seen affiliation, for display only, and the column comment must say so.

Measured size, clean build with both indexes: `vote_item` **6.3 MB**, `vote_cast` **498 MB**
(170 MB heap + 328 MB index), `party_dim` 71 rows. **~505 MB against a 15 GB database — 3%.**
COPY of all 4,017,519 rows takes **2.9 s** locally.

**`133_rollcall_derived.sql` — the four matviews.** Names, inputs and the not-populated fallback
join a `SCOPED_MATVIEWS`-style declaration in `scripts/db/lib/`, per the CLAUDE.md convention that
"the data changed" and "the precompute matches" cannot be two states.

| Matview | Grain | Rows | Build (local, measured) | Replaces |
|---|---|---|---|---|
| `mp_dissent` | (ns, mp_id, item_id) where the MP voted against their group's plurality | **105,571** | **1.56 s** | `dissents.json` **31 MB** |
| `mp_similarity` | (ns, a_mp, b_mp) with `shared` + `agree` | **297,495** | **37.5 s** | `similarity.json` **11.7 MB** |
| `mp_attendance` | (ns, mp_id) | 2,366 | < 1 s | `attendance.json` |
| `party_cohesion` | (ns, party_id, date) | ~10k | < 1 s | `cohesion.json` |

`mp_similarity` dominates at 37.5 s — comparable to `db:load:procurement-scopes:pg` (46 s
locally) and acceptable for a nightly. It is the **only** object whose cost scales quadratically,
which is exactly why it is a matview.

**`134_bill.sql` — the bill dimension (§3.4).**

```sql
CREATE TABLE bill (
  bill_id integer PRIMARY KEY, ns smallint NOT NULL,
  stem    text NOT NULL,                 -- title before " - второ гласуване"
  first_reading_item integer REFERENCES vote_item,
  final_item         integer REFERENCES vote_item,
  UNIQUE (ns, stem)
);
```

The stem split is a **TypeScript** concern owned by the loader, not a SQL regex — the same
reasoning `104_mp_roster.sql` gives for keeping `BRAND_ALIASES` out of SQL. `final_item` is
deliberately **nullable and initially NULL**: populating it needs a whole-bill adoption marker
that does not exist (§4.2). The column is the place it will live, not a claim that it is solved.

### 6.2 Live query vs precompute — the measured line

It does not split the way the intuition "per-MP is cheap, aggregate is expensive" suggests. All
timings local (Apple silicon, `shared_buffers = 160 MB`, warm), worst-case parliament where noted:

| Query | Time | Buffers | Verdict |
|---|---|---|---|
| One MP's votes, one NS, 50 rows | **1.1 ms** | 693 | **live** |
| Topic filter over a whole NS | **20 ms** | 249 | **live** |
| One session day, all items × party split — *index plan* | **15 ms** | 1,023 | **live**, but see the trap |
| One session day — *planner's default plan* | 169 ms | **21,904** | — |
| Attendance, one NS (52) | 77 ms | 3,124 | borderline → precompute |
| Party cohesion, one NS (52) | 79 ms | 2,802 | borderline → precompute |
| Attendance, worst NS (51) | **180 ms** | **21,774** | **precompute** |
| One MP's **dissents**, worst NS | **163 ms** | **27,762** | **precompute** |
| One MP vs all peers (**similarity**), worst NS | **164 ms** | **35,851** | **precompute** |
| All-pairs similarity, all NS | 37.5 s | — | **matview only** |

**The line is not "per-MP vs aggregate". It is "does the query need the MP's peers on the same
items".** Reading stored facts about one MP is a 693-buffer point lookup. The moment the answer
depends on how *everyone else* voted on those same 3,817 items — dissents, similarity — it fans
out to 28–36k buffers, i.e. more work than the whole-NS attendance aggregate.

**The planner trap on `/votes/:date`**, the query serving 613 prerendered pages:

```
default plan   169 ms   21,904 buffers   (Parallel Seq Scan on vote_cast)
enable_seqscan=off
               15 ms     1,023 buffers   (Nested Loop, vote_cast_pkey per item)
```

21× slower and 21× the I/O for choosing a seq scan over a 161-item nested loop. Two things follow,
and the second matters more: (1) drive the query from an explicit item-id set
(`WHERE item_id = ANY($1)`) so the shape is a semi-join the planner cannot flatten; (2) **check
`random_page_cost` on Cloud SQL** — the instance is SSD-backed, so ~1.1 is correct; if it is still
4, this plan flip is latent on *every* index-vs-seq decision in the database. A five-minute check
with repo-wide consequences, to be done **before** this migration.

**Cloud SQL extrapolation — not measured.** Prod is **db-g1-small** (1 shared vCPU, 1.7 GB), pool
`max: 4`, **10 s `statement_timeout`**, and CLAUDE.md's calibration point is a contracts reload at
**~68 minutes, CPU-bound**. A **21,774-buffer (170 MB)** scan there is plausibly **2–10 s cold**,
i.e. at or over the timeout, under exactly the saturation that produced the 500s migration 124 was
built for. **So the rule is stricter than the local numbers suggest: nothing above ~2,000 buffers
is served live.** That is how the matview list was chosen — a timeout budget, not a hedge.

Every route reading a matview follows the **123/124 degrade contract** verbatim: degrade on
`42P01 · 55000 · 42501 · 55P03`, **never on `57014`** (the pool's own timeout — the probe has
already burned the budget and the live fallback cannot finish either), log
`rc:not-built:<matview>` once per process.

---

## 7. The retirement ledger — every one of the 2,964 files

The point is not that Postgres is nicer. It is that **389 MB across 2,964 bucket-served JSON files
stops existing.** So the ledger is the deliverable, and every row states its phase.

| Artifact | Files | Size | Fate | Phase |
|---|---|---|---|---|
| `sessions/<date>.json` | **613** | **288 MB** | **RETIRED** → `/api/db/session?date=` (15 ms). Kept on disk as a **PG load source + prerender input** | P3 |
| `per-mp/<ns>/<id>.json` | **2,330** | 43 MB | **DELETED** — they exist only to dodge the 31 MB fallback (§3.1); PG removes the reason | P1 |
| `dissents.json` | 1 | **31 MB** | **DELETED** → `mp_dissent` matview | P1 |
| `similarity.json` | 1 | **11.7 MB** | **DELETED** → `mp_similarity` matview | P1 |
| `topic_index.json` | 1 | **8 MB** | **DELETED** → `vote_item (ns, topic)` index (20 ms) | P5 |
| `attendance.json` | 1 | 500 KB | **DELETED** → `mp_attendance` matview | P2 |
| `cohesion.json` | 1 | 639 KB | **DELETED** → `party_cohesion` matview | P2 |
| `party_pair_breaks.json` | 1 | 2.6 MB | **deferred** — derivable, but small; moving it buys little | — |
| `loyalty.json` | 1 | 413 KB | **deferred** — same, and it is `per_mp_shards`' roster authority | — |
| `index.json` | 1 | 303 KB | **kept** — the hub + `buildVotesRoutes` + the sitemap read it; a static file beats an API call for a prerender input | — |
| `embedding.json` | 1 | 211 KB | **kept, forever** — UMAP is a stochastic iterative projection, not a SQL workload. Re-implementing it in PL/pgSQL would give two definitions of the map with nothing testing that they agree | — |
| `important_votes/<ns>.json` | 9 | 47 KB ea | **kept** — `score` is an editorial weighting (the `BRAND_ALIASES` argument), **and it has a live consumer outside this module**: `useAreaImportantVotes` powers the „Как гласуваха" tile on every My-Area dashboard | — |
| `similarity_headline.json` | 1 | 4.3 KB | **kept** — feeds the hub tile + the band-4 seed. Regenerate it **from `mp_similarity`** once that exists | — |
| `search_index.json` | 1 | 758 KB | **kept** — offline harness only, no page reads it | — |

**Net: 2,948 of 2,964 files and 383 of 389 MB retire.** What is left is 16 files totalling ~6 MB,
each a deliberate keep with a stated reason.

### 7.1 `sessions/` is the largest row and retires differently

`useRollcallSession` fetches the whole day file for `/votes/<date>` (§2.9). Two things separate it
from the rest:

- **It cannot simply be deleted** — it is the loader's input **and** the prerender's fact source
  (§9.1). It becomes a **PG load source**, exactly like `parliament/index.json` and
  `parliament/profiles/` already are: present on disk, never uploaded, served from Cloud SQL.
- **`SessionScreen` must move first.** The route needs two calls, not one: the item list + tallies
  for the day (15 ms), then per-item per-MP votes **lazily**, when a reader expands an item. The
  single fetch is 482 KB average because it eagerly ships every MP's vote on all ~160 items;
  nobody expands 160 items.

### 7.2 Deletion protocol — three steps, in this order

Getting this wrong loses data with no fallback, so it is a sequence, not a cleanup:

1. **Routes live and verified on prod.** Not "deployed" — verified, because the degrade contract
   (§6.2) means a broken read serves an empty result at a 200 rather than erroring.
2. **Remove the client fetches**, then the local files.
3. **Then the bucket**, which is separate and irreversible — see 7.3.

### 7.3 `bucket_sync_paths.ts` must be updated in the same commit, or the files come back

`grep votes scripts/bucket_sync_paths.ts` returns **nothing**: `parliament/votes/**` is fully
bucket-served today with no guard. A retired tree needs BOTH halves of the pattern that file
already uses for `parliament/profiles`:

- an `isExcluded` refusal (`"parliament/votes/sessions/ is a PG load source, served from Cloud
  SQL — never upload it"`), so a direct scoped push is refused; **and**
- a `CHILD_EXCLUDES` entry, because `isExcluded` only guards the top-level argument — the natural
  `bucket:sync:paths -- parliament` would otherwise recursively re-upload all 613 files. That
  file's own comments record exactly this happening once already with `company-connections/`.

And the bucket copies must be removed explicitly. `bucket:sync` **has never passed `-d`**, so
deleted files linger and are served forever:

```bash
npm run bucket:sync:paths -- parliament/votes/sessions --delete --dry-run   # read every "Would remove"
npm run bucket:sync:paths -- parliament/votes/sessions --delete
```

Irreversible. After step 1, never before.

---

## 8. Loaders and the repo contracts

```
npm run db:load:rollcall:pg[:cloud]           # 132 + 134: vote_item, mp_seat, vote_cast, party_dim, bill
npm run db:load:rollcall-derived:pg[:cloud]   # 133: REFRESH the four matviews, in order
```

- **Stage-merge, not TRUNCATE+COPY.** `vote_cast` will be on a serving path, and
  `reference_stage_merge_reload` / `reference_contracts_reload_lock` both document that a
  `TRUNCATE`-and-rebuild on a served table holds an `AccessExclusiveLock` and 500s the routes at
  the pool's `lock_timeout`. Use `scripts/db/lib/stage_merge.ts`. The corpus is **append-only per
  day**, so the merge is genuinely incremental — one plenary day is ~250 items × 240 MPs =
  **~60,000 rows**, not 4M.
- **Order**: facts before derived; `bill` resolved before `vote_item.bill_id` is set. Declare it in
  the `SCOPED_MATVIEWS`-style list, not in prose.
- **No `recent_updates` row for the matviews** — a derived serving layer, like `person_search`.
  The *fact* loader takes one.

**Four repo-wide contracts, none optional:**

- **`db:refresh` chain membership.** `refresh_coverage.test.ts` fails unless every local
  `db:load:*` / `db:resolve:*` is either referenced by `db:refresh` or listed in
  `REFRESH_EXCLUSIONS` with an axis and a `ranBy`. Both new loaders belong **in the chain**: the
  source is committed (no `uncommitted-input` axis) and the `cost` axis is weak — 2.9 s to COPY,
  ~40 s for the derived refresh.
- **`recent_updates()` needs a branch decision** (`007_query_builders.sql`).
  `feedback_pg_changelog_required` makes wiring a new PG dataset into the feed the default, and
  007 has **no vote branch**. But 007 is the function that was **13.61 s at the route's default
  shape** until per-branch limits were added — over Cloud Run's 10 s timeout at its most common
  call. A sixth UNION branch inherits that discipline exactly: its own `LIMIT`, no join on an
  unindexed expression, and a re-measure after. If that cannot be met cheaply, record the dataset
  in `data-changes.json` only and say so here. What is not acceptable is an unlimited branch.
- **`sync_cloud.ts` `CRITICAL_TABLES` — deliberately NOT joined.** That list is about
  irrecoverability on two axes: size, and "no committed generator / gitignored source"
  (`kzk_decisions` is on it at 4.4k rows for exactly that reason). Roll-call fails both: 4M rows is
  mid-sized here, and the source is **committed JSON that stays on disk** (§7.1), so a dropped
  table is fully re-derivable. Recorded because a 4M-row table absent from that list otherwise
  reads as an oversight.
- **Wire both into `update-rollcall`**, per `reference_migrated_family_watch_reload`: a JSON→PG
  migration that does not add the `:cloud` loader to the regenerating watch skill leaves prod
  stale with nothing red. The single most-repeated failure in CLAUDE.md.

**Cloud ordering:** `db:load:rollcall:pg:cloud` before `db:load:rollcall-derived:pg:cloud`, both
before the `deploy:db` that ships the routes — except that the routes degrade (§6.2), so a wrong
order is slow, not broken. The one hard ordering: **never delete a JSON artifact until the cloud
loaders have run there**, or prod loses the data with no fallback.

---

## 9. Prerender · SEO · AIO/GEO · OG

`/parliament` already has a prerendered landing (in the safe `NAV_HUBS` list) with a body linking
four sub-pages. The gaps are one level down.

**What is missing** — measured in `buildVotesRoutes` (`dynamicRoutes.ts:2859`):

- the 613 `/votes/<date>` bodies contain **zero `<a>` elements** — dead ends for the crawler, on
  one of the two zero-impression prefixes `project_seo_discovery_gap` names;
- their JSON-LD breadcrumb ladder is `Начало → Поименни гласувания → <date>`, **skipping
  `/parliament`** — so the crawler never sees the module the SPA shows.

(`SessionsIndexScreen` **already** crumbs back to `/parliament` at line 119 — that item is struck.)

**§2.7 makes this the module's main event**: `/votes*` out-earns the analytical half, and only
~8% of the record pages were reached at all. The pages that earn attention are precisely the pages
nothing links to. That is why this work moves ahead of the payload work in §10. The phase is:

- extend the JSON-LD ladder to `Начало → Народно събрание → Поименни гласувания → <date>` on both
  `/votes` and all 613 `/votes/<date>` pages;
- add prev/next-session links plus a back-to-hub link to each `/votes/<date>` body;
- the `/parliament` body gains links to **every** sub-page (it currently omits
  `/parliament/attendance`, which has its own `staticPage` at `routes.ts:2286`), with the band-3/4
  blurbs as crawlable text;
- bands 3–6 prerendered, **bands 0–2 client-only** — a daily rail baked into static HTML goes
  stale between deploys, and Google should index the durable grid;
- the D1 rename applied to the hardcoded prerender copy (§2.5);
- **prerender the two band-4 seed instances** (§4.4).

### 9.1 The bodies carry links but no FACTS — the AIO/GEO gap

Everything above is about **crawl paths**. Answer engines need extractable claims. Measured live:

```
/votes/2026-07-30   <h1>Поименно гласуване · 30 юли 2026 г.</h1>
                    <p>161 точки в дневния ред на това заседание.
                       Кликнете върху точка, за да видите как е гласувал всеки депутат…</p>
/parliament         <h1>Парламент — анализ на гласуванията</h1>
                    …prose + a <ul> of four links.  ZERO numbers.
```

**613 near-identical stubs carrying one integer each**, plus a UI instruction that is worthless in
an answer and actively bad as a quoted snippet. A model asked *"как гласува НС на 30 юли 2026"*
can extract the date and the item count and nothing else — from a page holding every MP's vote.

**The fix is not more prose. It is putting the facts we already have into the body:**

| Page | Add to the prerendered body |
|---|---|
| `/votes/<date>` | the 3–5 highest-`score` items **by name**, each with its tally and outcome (`„ЗИД на Изборния кодекс — второ гласуване: 137 за, 25 против, приет"`); the per-group split for the top item; prev/next session dates |
| `/parliament` | the band-3 figures as sentences with their bases (§4.3), the NS and its covered span (§2.3), the session/item counts — the page currently states no number at all |
| `/parliament/cohesion` · `/attendance` | the headline figure and the extreme group/MP, named |

**`important_votes` cannot source this — it covers 15% of the days.** It is a **top-15 per NS**
shard, and its 135 entries cluster onto **92 distinct plenary days out of 613**:

```
plenary days                        613
days with >=1 important_votes entry  92
days with NONE                      521   = 85% of /votes/<date> pages
```

So `buildVotesRoutes` must read the **session files** at build time — it currently opens only
`index.json`. Two consequences: a build-time cost (613 files / 288 MB, so a streaming read, not
`readAllSessions()` into memory); and **an independent reason `sessions/` must stay readable on
the build machine** after §7 retires it from the bucket. §7.1 already keeps them on disk, so the
two agree — but if anyone later proposes querying Postgres at build time instead, that is the
`/court/**` trap CLAUDE.md spells out: `seo_courts.ts` degrades to `[]` on any failure, so a build
machine without the data emits **zero pages, no `<loc>`s, at exit 0**. The good failure, and an
invisible one.

**Two editorial rules**, from the module plan's §7:

1. **Every stated figure carries its basis and its window in the same sentence.** An answer engine
   quotes a sentence, not a page — a number only correct because of a caption three paragraphs up
   will be quoted wrong. §4.3's declared-basis rule applied to prose.
2. **Named MPs appear only in factual constructions** — *„X гласува против при 137 за"* — never
   evaluative ones. The derived characterisations (twins, dissenters, outliers) stay on pages that
   carry their methodology.

### 9.1.1 `/votes/:date/:slug` — the family the plan never addressed

**The single best-engaging page in the module is an item page, and item pages are neither
prerendered nor in the sitemap.** §2.7 cites `/votes/2020-11-06/item-5-zid-na-zakona-za-merkite…`
at **3m 22s** as the evidence that records beat dashboards — without noticing it belongs to a URL
family this plan does not cover. Verified live:

```
/votes/2020-11-06/item-5-zid-…   <title>Парламентарни избори 2026 …</title>   canonical -> https://electionsbg.com/
```

`buildVotesRoutes` emits `/votes` and `/votes/<date>` only; the sitemap enumerates the same two.
So every item page serves the SPA shell — the same homepage-duplicate defect as §4.4's seeded
routes, on the URLs with the module's **highest measured engagement**. GA shows at least two
item pages reached in the sample (`…/item-4`, `…/item-11-zakon-za-darzhavniya-byudzhet…`).

**This is a decision, not an oversight to fix by default,** because the family is large: 15,096
deduped items × 2 languages ≈ **30k more files** against a `dist/` already at ~248k, and
`project_firebase_deploy_ceiling` records a 453k-file `dist` failing to deploy. Three options,
in order of preference:

1. **Prerender a scored subset** — the items already carrying an `important_votes` entry (135) plus
   any item above a score threshold. Hundreds of pages, not thousands, and they are by construction
   the ones worth landing on. Cheapest, and it composes with §9.1's date-page facts.
2. **Prerender all 15,096** and accept ~278k files. Defensible on the traffic evidence, but it
   spends most of the remaining deploy headroom on one family.
3. **Prerender none, and stop citing item-page engagement as evidence** — the honest version of
   the status quo. Also acceptable, but then §2.7's headline example must be re-labelled.

Option 1 unless someone argues otherwise. Whichever is chosen, the `/votes/<date>` body should
link its own items by name (§9.1 already puts them there), so the item pages are reachable even
when they are not indexed.

### 9.2 JSON-LD — `/parliament` is the thinnest page in the module

| Page | Emits |
|---|---|
| `/votes/<date>` | `WebPage` · `BreadcrumbList` · **`Dataset`** · `DataDownload` · `Organization` · `Place` |
| `/parliament` | `WebPage` · `BreadcrumbList` — **nothing else** |

The hub describes itself less than any record page under it. Add, using builders that already
exist in `scripts/prerender/jsonLd.ts`:

- **`Dataset`** (`buildDatasetLd`), `distribution` pointing at the roll-call artifacts,
  `temporalCoverage` from the NS span. The highest-value addition — it makes the corpus citable
  rather than merely readable, and every `/votes/<date>` proves the shape works.
- **`ItemList`** of the band-3/4 destinations, so the hub's structure is machine-readable.
- **`FAQPage`** (`buildFaqLd`, already used on candidate pages) for the three questions this module
  answers: *колко гласувания има за N-то НС · кой е най-дисциплинираният състав · откъде идват
  данните*. FAQ entities are disproportionately quoted by answer engines.

### 9.3 `llms.txt` is wrong about this module

`llms.txt` and `llms-full.txt` both serve 200, and `robots.txt` explicitly allows **18** AI
crawlers (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, CCBot,
Applebot-Extended, Bytespider, cohere-ai …). **That infrastructure is good and needs no work.**
What is on it is the problem:

- **`/parliament` is described as *"MP roster, party seats, per-MP profiles"*** — a page that does
  not exist (§2.6). An assistant asked what is at `/parliament` currently answers wrongly, from our
  own file.
- **`/votes` is absent entirely.** 613 prerendered pages, the module's best-performing half, and
  the LLM-facing index does not mention the prefix. Nor `/parliament/attendance`, nor
  `/parliament/similarity/{mpId}`.
- `KEY_URLS` in `scripts/llms/buildIndex.ts` is a **hardcoded literal with no gate** — nothing
  checks it against the router, the prerender route list or the sitemap, which is why both defects
  went unnoticed.

Fix the three parliament entries, add `/votes` + `/votes/{date}` with the URL pattern spelled out
(answer engines follow patterns), apply the D1 name, and add the gate in §11.

### 9.4 The OG image is stale, cropped, and about to break

`public/og/parliament.png` was captured **13 May 2026** — it predates the current hub. Four
problems, ascending:

1. **It is a crop taken mid-card.** Text truncates at the right edge (*„Виж де…"*,
   *„парламентарн…"*), cards cut off top and bottom. It reads as a screenshot fragment, not a card.
2. **It leads with six named MPs** under „Гласови близнаци" with **no headline saying what the
   claim is**. MPs are public figures, so it clears rule 4 of the editorial constraints — but an
   unlabelled crop asserting *voting twins* about named people, shared into a feed stripped of the
   methodology, is the wrong first impression.
3. **Its comment is already stale** — `capture-screens.ts:262` says *"Hub has four tiles"*; seven.
4. **The capture BREAKS on H1.** The entry waits for `div[title*="↔"]` — a party-correlation
   heatmap cell inside `ParliamentVotingTile`, which the rebuilt hub stops rendering. Playwright
   waits 60 s and fails.

So the OG work is **phase H0, not a follow-up**: add `data-og="parliament-hub"` as every other hub
has (`GovernanceScreen.tsx:67`, `ProcurementScreen.tsx:212`); repoint the capture at it
(`waitFor: '[data-og="parliament-hub"] a'`, `anchor`, `leftAlign: true`, mirroring the procurement
entry) so the card leads with the **tile grid and its headline numbers**; recapture with
`npx tsx scripts/og/capture-screens.ts` against a running dev server. `/votes` keeps its own
capture (the hemicycle) — unaffected, and still the right image. `parliament-cohesion` and
`parliament-embedding` anchor on `.recharts-surface` on their own screens and are unaffected.

---

## 10. Phases — one sequence

**Dependency:** `InfographicTileProps` today carries `to · title · badge · desc · accent · scene ·
cta · metric · metricCaption` — there is **no `blurb`, `stats` or `delta`**, and `NewsRail` /
`NewsCard` / `LeadCard` do not exist. So **H1 requires module-front-pages-v1 Phase 0** (the tile
grammar) to land first, and **H2 builds** the generic rail components. That reverses
module-front-pages §9, which designates `/procurement` as the template-prover; taken deliberately,
since `/parliament` is the cleaner test of the *template* (no `feed_payloads` dependency). The cost
is that the DB degrade path in module-front-pages-v1 §8.2 goes unexercised until `/procurement` follows —
which must therefore follow, not be skipped.

| # | Phase | Scope | Retires |
|---|---|---|---|
| 1 | **H0** | D1 rename (2 locale values → 9 call sites + the hardcoded prerender copy, §2.5). Registry + **11 bespoke scenes** (§4.5) + `ParliamentHubScreen` on `TileHubGrid`; bands 3–5 + the **v1 session strip**. Deletes the hardcoded JSX. **Band 4's pair tile ships here.** `data-og="parliament-hub"` + OG capture repointed + **recaptured** (§9.4). | — |
| 2 | **H3** | Crawl paths **and** answerability: JSON-LD ladder through `/parliament`, prev/next + back-to-hub on 613 bodies, facts into the bodies (§9.1), `Dataset`+`ItemList`+`FAQPage` (§9.2), the three `llms.txt` entries (§9.3), the two band-4 seed prerenders (§4.4). **Promoted — §2.7 shows the record pages earn the engagement and ~92% are unreached.** | — |
| 3 | **P0** | `132_rollcall.sql` + `db:load:rollcall:pg`. **No route reads it.** Dedupe (§3.3) and the `(ns, mp_id)` audit (§3.2) as loader preflights that report rather than throw. | — |
| 4 | **P1** | `133` + the four matviews + `db:load:rollcall-derived:pg`. Point `useMpDissents` / `useMpSimilarity` at `/api/db`. | **`per-mp/` 2,330 files / 43 MB · `dissents.json` 31 MB · `similarity.json` 11.7 MB** |
| 5 | **H1** | `hub_stats.ts` + `useParliamentHubStats` + stock·flow·change on band 3 + the §2.3 three-state coverage. **Drops all six mini-tile fetches** — 1.65 MB → ≤10 KB. **Deletes the six orphaned components (§5.2).** | — |
| 6 | **P2** | `attendance` / `cohesion` routes. Regenerate `similarity_headline.json` from `mp_similarity`. **The hand-off**: rewrites H1's generator to read SQL. | `attendance.json` · `cohesion.json` (1.1 MB) |
| 7 | **P3** | **`SessionScreen` → two calls**: day items (15 ms) + lazy per-item MP votes. `sessions/` becomes a load source (§7.1). | **`sessions/` — 613 files, 288 MB, off the bucket** |
| 8 | **H2** | Bands 0–2: wire, lead, `NewsRail`+`NewsCard`+`LeadCard` built generic; `hub_feed/<ns>.json`; strip v2. | — |
| 9 | **P4–P5** | `134_bill.sql` + the bill resolver; `topic_index.json` → a `vote_item (ns, topic)` index. | `topic_index.json` 8 MB |

**Why this order.** H0 first — it is the registry everything else sits on and removes the last
hardcoded hub. H3 second because it is the only work with a plausible traffic effect: the payload
phases make a page faster for the **33 people** who reached this module in seven months, while the
linking phase is the only one that changes whether anyone reaches it. P0–P1 next: independent of
the hub, and they kill the silent 31 MB fallback. **P3 is the one readers feel** — the only phase
touching the pages §2.7 shows they actually reach. H2 last, because it is the only band with no
measured demand behind it.

**The single hand-off is step 6, and it is smaller than it looks.** H1 writes
`scripts/parliament/derived/hub_stats.ts` computing from in-memory artifacts; P2 rewrites it to
query SQL. `hub_stats.json` stays a committed static artifact either way (§5.1), so
`useParliamentHubStats` fetches the same URL before and after — only what fills the file changes.

**Re-measure after H3 before committing to the band-3 order.** §2.7's distribution is endogenous
to the current hub's links, so the first honest read of demand is the one taken after the link
structure changes.

---

## 11. Gates

The reports-matrix episode is the precedent: a hub fronting one grain per type, a comment claiming
the rest were reachable, and 28 orphan pages. Every gate exists because something comparable has
already shipped.

**`parliamentHubRegistry.test.ts`**

| Gate | Asserts |
|---|---|
| scenes | every tile `id` resolves to a scene; ids unique; every `to` absolute |
| seeded `to` | a `to` with a `:` segment carries a `seed`; the resolved href matches a routed pattern with a non-empty parameter |
| accent uniqueness | no accent used twice on one page (20 tokens, **11 tiles**) |
| **reachability, at every phase** | every routed `/parliament/*` and `/votes*` page is linked from the hub or from a page the hub links — run against the **post-H1** registry too, not only the final one |
| cross-hub tile | the Управление tile and the hub agree on `to` + `titleKey`; with D3 that tile is the only entry point, so losing it orphans the module |
| no dead mini-tiles | none of the six hub-only components in §5.2 remains in `src/` after H1 |

**`parliament_hub_stats.test.ts`**

| Gate | Asserts |
|---|---|
| payload | `hub_stats.json` ≤ 10 KB; each `hub_feed/<ns>.json` ≤ 12 KB; the hub imports none of `dissents` / `similarity` / `topic_index` / `party_pair_breaks` |
| **declared basis** | each band-3 stat is **recomputed from the source artifact**: attendance weighted (`Σ present / Σ items`), sessions per-NS, groups = `cohesion.entries.length`, votes = `attendance.totalVoteItems` |
| law derivation | bill-stem grouping yields 5–200 stems per NS; a result equal to the raw second-reading item count FAILS (that is the naive bug) |
| coverage honesty | an NS with no data yields `undefined`, never a zeroed tile; `coveredFrom`/`coveredTo` present for every `byNs` key; `coverage: "partial"` when the span is < 60% of the term |
| recess honesty | `inRecessDays > 10` ⇒ every feed item carries an explicit event date and no relative-time kicker (**not** an empty feed) |
| upload manifest | every file `rebuildDerived` writes appears in its `--upload` branch |

**`scripts/db/tests/rollcall.data.test.ts`** (auto-skips when Postgres is down)

| Gate | Asserts |
|---|---|
| row reconciliation | `count(vote_cast)` matches the session files ± the known 84 dupes; **`count(vote_item)` = 15,096, the post-`dedupeRevotes` total** — matching `index.json` raw counts would mean the dedupe was skipped |
| party at cast time | `mp_dissent` groups on `vote_cast.party_id`, never `mp_seat.party_id`; the **179 switching seats** are enumerated as data, so a 180th fails |
| id recycling | every `(ns, mp_id)` resolves to exactly one `mp_seat.name`; the **26 recycled ids** are enumerated as data, so a 27th fails |
| no orphan casts | no `item_id` absent from `vote_item`, no `(ns, mp_id)` absent from `mp_seat` |
| matview freshness | each matview's max `date` matches `vote_item`'s |
| **matview agreement** | `mp_attendance` and `party_cohesion` reproduce the JSON artifacts within a stated tolerance — **the migration's correctness proof**, and it must run while both layers exist |
| buffer ceiling | each live-served query stays under **2,000 buffers** on the worst NS (§6.2). Same shape as `person_connections.data.test.ts`, which proves its ceiling still discriminates by restoring the old body in a rolled-back transaction |
| plan shape | the `/votes/:date` query uses a nested loop, not a seq scan (the 21× trap) |
| chain membership | both loaders appear in `db:refresh` or `REFRESH_EXCLUSIONS` |
| `recent_updates` budget | if a vote branch is added to 007, the whole function stays under its ceiling at `(days=1, limit=200)` — the shape that was 13.61 s |
| retirement — no dangling fetch | after each phase, `grep` finds no `src/` fetch of an artifact that phase retired |
| retirement — bucket guard | every retired tree has BOTH an `isExcluded` refusal and a `CHILD_EXCLUDES` entry (§7.3) |
| retirement — ledger exhaustive | every file under `data/parliament/votes/` is in §7's ledger or the test fails |
| watch wiring | both `:cloud` loaders appear in the `update-rollcall` skill |

**Prerender / SEO**

| Gate | Asserts |
|---|---|
| prerender | `/parliament` emits a body linking every sub-page; JSON-LD ladder includes `/parliament`; present in `route_defs.ts` |
| body carries facts | the `/parliament` body states ≥3 figures, each with its basis in the same sentence; each `/votes/<date>` body names ≥1 item with its tally (§9.1) |
| JSON-LD depth | `/parliament` emits `Dataset` + `ItemList` + `FAQPage` (§9.2) |
| **`llms.txt` truth** | every `KEY_URLS` entry resolves to a routed path, AND every prerendered `NAV_HUBS` entry appears in `KEY_URLS` (§9.3) |
| OG capture | the `parliament` entry selects on `[data-og="parliament-hub"]`, and the screen carries it (§9.4) |
| item-page policy | whichever §9.1.1 option is chosen is asserted: if (1) or (2), every prerendered item URL has a `dist/<path>/index.html` and a `<loc>`; if (3), no `<loc>` names an item page and §2.7's example is labelled as unindexed |

---

## 12. Out of scope, risks, open questions

**Not in v1:** the pass/fail law outcome (§4.2 — the biggest honest gap); a bills/законопроекти
ingest; a top-level nav (D2); relocating `/votes` (§2.4); a new MP roster page (§2.6); changes to
the six sub-pages beyond breadcrumbs. `party_pair_breaks.json` and `loyalty.json` stay on JSON
(§7). The trailing-slash canonical fix was correctly kept out and shipped separately (§2.8).

**Risks:**

1. **`mp_similarity` at 37.5 s locally is unmeasured on db-g1-small.** The contracts calibration
   suggests minutes. If it exceeds a maintenance window, refresh only the current parliament
   nightly — the other eight are frozen history and never change.
2. **The `(ns, mp_id)` FK will reject rows on first load** if `mp_seat` is built from `mp_profile`
   rather than from the session files. Build it from the corpus; reconcile against `mp_profile` in
   the gate, not in the constraint.
3. **`person_role.ref = mp_id` has no NS** (§3.2), so the person→votes bridge stays ambiguous for
   26 ids *after* this migration. A person-layer change, out of scope, written down rather than
   assumed resolved by the FK.
4. **Deleting a tree from the bucket is irreversible** and `bucket:sync` has never passed `-d`
   (§7.3).

**Open questions:**

1. **Bills (`законопроекти`).** The one genuinely missing dataset — what would make this page worth
   opening on a morning when the chamber has not yet voted: "what is coming" rather than "what
   happened". Worth its own ingest plan, and it would supply the adoption marker §6.1's
   `final_item` waits for.
2. **`random_page_cost` on Cloud SQL** (§6.2) — five minutes to check, repo-wide consequences, and
   it should happen before P0.

---

## 13. Audit history

Kept so the corrections are not silently absorbed. Three passes ran before implementation.

### 13.1 Source audit (2026-08-02)

| Draft claim | Finding |
|---|---|
| Lead = highest-scoring final-adoption item in `important_votes` | Unrunnable — 15-row shard, no stage field; **0 candidates for NS 48 and 51** |
| „Приети закони: N окончателни · N отхвърлени" | **No such record exists.** 754 second-reading items in NS 52 are per-article; stem grouping gives 33 bills; pass/fail not derivable |
| Band-3 figures (613 · 240 · 8 · 87% · 0.94) | **Six of six wrong**, each with an undeclared basis |
| Phase 1 drops six mini-tiles | Six of seven have **no consumer but the hub** — H1 orphans them as dead code (§5.2) |
| Band 4 `to: /parliament/similarity/:mpId` | Parameterised; passes the "absolute `to`" gate vacuously. Resolved from blob seeds |
| One 40 KB `hub_stats.json` | Feed titles blow the budget; split into all-NS stats + per-NS feed shards |
| Coverage is present/absent | **NS 44 is partial** (5 months of a 4-year term) and renders as if complete |
| Recess ⇒ collapse bands 1–2 | Fires on 11–32% of term days; re-label instead |
| `SessionsIndexScreen` breadcrumb needs adding | Already present. The real gap: 613 bodies with no links and a ladder skipping `/parliament` |
| D1 = 2 locale lines | Plus hardcoded prerender copy at `routes.ts` 2230/4261/4264/4267 + EN mirrors |
| Blob generated by re-reading artifacts | Compute in-memory at the end of `rebuildDerived` |
| (not stated) | Publishing: `--upload` branch + `bucket:sync:paths` were both missing |

### 13.2 Traffic + SEO pass (2026-08-03)

| Draft position | Finding |
|---|---|
| Ordering is "a hypothesis, no analytics exist" | **Measured.** `/votes*` 107 views / 51 paths / **+15.6%** engagement vs `/parliament*` 97 / 14 / **−24.8%** |
| Присъствие + Единство in band 3, Карта in band 4 | Присъствие is **2 views / 9s**; Карта is **21 / 1m 01s** from the LAST slot. Swapped |
| „Законопроекти" as its own tile at `to: "/votes"` | **Duplicate React key** — `TileHubGrid` uses `key={tile.to}`. Demoted to a flow number |
| Phases ship 0 → 1 → 2 → 3 | Re-ordered: ~92% of record pages unreached; the payload phase optimises a page nobody can find |
| §7 covers SEO | It covered **crawl paths only** — the bodies carry no extractable facts (§9.1) |
| (not stated) | `/parliament` emits only `WebPage` + `BreadcrumbList`; every record page under it emits `Dataset` too |
| (not stated) | **`llms.txt` describes `/parliament` as a page that does not exist** and omits `/votes` |
| (not stated) | The OG image is a 13 May crop whose capture selector targets a tile H1 deletes |
| (not stated) | **Every URL on the site canonicalised to a redirect** — fixed same day, `0adc97b6dd` (§2.8) |
| §10: "`ParliamentVotingTile` is the ONLY link to `/votes/between/:pair`" | **Wrong.** It renders on three screens; two survive H1, so the route is not orphaned |

### 13.4 Post-consolidation audit (2026-08-03)

| Position | Finding |
|---|---|
| `vote_item` holds the raw item set | **It must hold the DEDUPED set — 15,096, not 16,741.** `dedupeRevotes` collapses 1,645 re-votes (9.8%), and every JSON artifact is computed after it. Loading raw would make `mp_attendance` disagree with `attendance.json` by ~10% per NS, so §11's matview-agreement gate — the correctness proof — would fail by construction (§6.1) |
| `mp_seat(ns, mp_id, party_id)` | **179 of 2,366 seats (8%) change party mid-term**, mostly to `НЕЗ`. A single `party_id` per seat is undefined for them. `vote_cast.party_id` is the only join key any derivation may use — `mp_dissent` joining `mp_seat.party_id` would compare 179 members against a group they had left, silently (§6.1) |
| §2.7 cites a 3m 22s item page as the headline evidence | **Item pages are neither prerendered nor in the sitemap** — they serve the SPA shell with `canonical=/`. The module's best-engaging URL family is one the plan never addressed (§9.1.1) |
| (merge artefact) | Two cross-references — `§6.3`, `§8.2` — pointed at the retired plan's numbering. Repaired |

### 13.3 Consolidation pass (2026-08-03)

| Position | Finding |
|---|---|
| The PG plan's artifact table | **Omitted `sessions/` entirely** — 613 files, 288 MB, and `/votes/<date>` fetches the whole day file (482 KB avg, 4.97 MB max). The biggest serving payload in the module, on its best-performing pages |
| Band 4's two seeded tiles link to routed pages | **Routed, not crawlable** — both serve the SPA shell with the homepage's title and `canonical=/` (§4.4) |
| §9.1's facts sourced from `important_votes` | **That shard covers 92 of 613 days** — 85% of pages have no entry. The prerender must read session files at build time |
| PG ledger: `important_votes/` has no consumer | It has one **outside this module** — `useAreaImportantVotes` on every My-Area dashboard |
| PG plan names the `update-rollcall` wiring | **Three more repo contracts apply** — `db:refresh` membership, a `recent_updates()` branch decision bounded by the 13.61 s regression, and an explicit *not*-`CRITICAL_TABLES` note (§8) |
| Retirement was a short "what does NOT migrate" note | Now a **file-by-file ledger** over all 2,964 files, with a deletion protocol and a `bucket_sync_paths` guard requirement (§7) |
| (minor) | The session strip is informational, not decorative — it needs a text equivalent, unlike a tile scene. Bands 3–5 need ~30 i18n keys × 2 locales |
