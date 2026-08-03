# Народно събрание — the /parliament dashboard hub, v1

Status: **final, ready to implement.** Drafted 2026-08-02; decisions D1–D4 taken.
Revised 2026-08-02 after a full audit against the repo, the derived artifacts and local
Postgres — every number below is measured, and §3/§4 changed materially as a result
(see §10 for what the audit overturned).
Applies the module front-page template from [module-front-pages-v1.md](module-front-pages-v1.md)
to its first module, and the hub conventions the repo already enforces
(`TileHubGrid` + a pure registry + a scene map + a commit-time gate).

**Scope of v1: the dashboard hub only.** No new top-level nav — `/parliament` keeps its
existing entry points (the Управление hub tile and the Управление menu), both relabelled.

**Serving layer:** v1 reads committed JSON, as the rest of `/parliament` does today. The
roll-call corpus is a strong Postgres candidate and that is analysed separately in
[parliament-rollcall-pg-v1.md](parliament-rollcall-pg-v1.md); this hub is deliberately built
so the migration replaces its generator without touching its components.

---

## 1. Decisions

| # | Decision | Resolution |
|---|---|---|
| **D1** | The name | **„Народно събрание".** Resolves the collision in §2.2 — the place-view pill keeps "Парламент" (a place's election results), the institution gets its own name. **The prerender already agrees:** `scripts/prerender/bodyBuilders.ts:28` has said `bg: "Народно събрание", en: "National Assembly"` since the nav-hub list was written, so D1 closes an existing inconsistency rather than expressing a preference. Blast radius is larger than the i18n keys — see §2.5. |
| **D2** | Top-level menu | **No.** Reached from the Управление hub tile + the Управление menu entry, as today. Revisit once the hub earns traffic. |
| **D3** | Governance tile | **Keep — and it is now the ONLY hub entry point**, which raises the stakes on the cross-hub gate in §6. Same shape as `/procurement`: both a governance tile and its own module. |
| **D4** | MP declarations / companies / cars | Stay under **Декларации** (their register is the Сметна палата, not the NS). Cross-linked from a dedicated band — promote the link, not the ownership. Same resolution as `/connections` last week. |

---

## 2. What exists today — measured

`/parliament` is `ParliamentHubScreen.tsx`: **49 lines of hardcoded JSX**, seven preview tiles,
no registry, no scene map, no test. It is the last hub in the app not built on the tile-hub kit.

The data is genuinely fresh — 52nd NS, **613 sessions, last 2026-07-31**, per-day files with item
titles, an 8-value topic taxonomy (`budget · tax · personnel · electoral · constitution ·
ratification · confidence_vote · other`), tallies and per-MP votes.

### 2.1 The payload problem — the biggest engineering finding

Each mini-tile fetches a full derived artifact to render three rows:

| Tile | Fetches | Size (bytes on disk) |
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
**Non-negotiable budget: ≤ 40 KB for the whole hub, enforced by a test — and split so that
neither half can grow into the other's allowance (§4).**

The artifacts a rail would otherwise want are far worse — `dissents.json` **31 MB**,
`similarity.json` **11.7 MB**, `topic_index.json` **8 MB**. None may be fetched by the hub, ever.
(The bucket serves identity encoding — `reference_gcs_bucket_compression` — so these are wire
sizes, not gzipped ones.)

### 2.2 The naming collision (why D1 exists)

`PLACE_VIEW_META.parliamentary` uses `cross_to_parliamentary` = **"Парламент"** for the
place-view switcher — a place's *parliamentary-election results* (`/`, `/municipality/:id`).
The governance tile to `/parliament` was **"Парламент"** too. Same word, two unrelated things.
D1 gives the institution its own name and leaves the switcher on ~40k place pages untouched.

### 2.3 The hub is already NS-scoped — via the global election selector

This was the draft's open question; the code answers it. `useRollcallIndex` derives the
parliament from the **header's election picker** — `electionToNsFolder(selected)` in
`src/data/parliament/nsFolders.ts` — and filters sessions by `ns`. **Thirteen hooks** under
`src/data/parliament/votes/` already consult `useElectionContext`.

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
  lands here with an empty parliament selected. This is the same trap CLAUDE.md documents for
  `?pscope`: *"A page narrower than the corpus MUST resolve the inbound scope."*

  **Three coverage states, not two**, and the middle one is the dangerous one:

  1. **no data** (NS 40–43) — the hub NAMES the gap: *„Няма поименни гласувания за 43-то НС
     (данните започват от 44-то)"*. Never zeros, never a silent re-anchor to the 52nd while the
     header still says 2009.
  2. **partial** (NS 44) — renders normally today and reports five months as if it were a
     four-year term. Nothing looks wrong, which makes it worse than case 1. The blob carries
     `coveredFrom`/`coveredTo` and the hub says *„данните за 44-то НС покриват само окт. 2020 –
     март 2021"* whenever the covered span is materially shorter than the term.
  3. **full** — the normal path. Note session counts vary wildly (45: **6**; 51: **174**;
     52: **39**), so "thin but present" is a normal state the tiles must read correctly.

### 2.4 Route sprawl — do not fix by moving

```
/parliament            hub          /parliament/cohesion   /parliament/attendance
/parliament/embedding  /parliament/similarity/:mpId
/votes   /votes/:date  /votes/:date/:slug   /votes/between/:pair
```

`/votes*` is the indexed, prerendered half — **613 live URLs** (`buildVotesRoutes`,
`scripts/prerender/dynamicRoutes.ts:2859`). Do not relocate it; unify by breadcrumb and hub.

Two of these routes have **no static entry point at all**, which §3 band 4 and §6 must handle:

- `/parliament/similarity/:mpId` is reachable only from `MpTwinsTile` and `MpSimilarityBrowser`
  (i.e. from a specific MP's page);
- `/votes/between/:pair` is reachable from **exactly one place in the whole app** —
  `ParliamentVotingTile:149`, which is one of the six tiles §8 phase 1 deletes. See §6.

### 2.5 D1 is nine i18n call sites *plus* hardcoded prerender copy

`gov_hub_parliament_title` resolves in **9 non-locale places**: five `GovernanceBreadcrumb`
`sectionKey`s (hub, attendance, cohesion, embedding, sessions index), two inline crumb arrays
(`SessionScreen:217`, `PartyPairBreaksScreen:79`), the Управление menu (`reportMenus.ts:157`)
and the governance registry (`governanceRegistry.ts:71`). Changing the two locale *values*
propagates to all nine at once; the key name stays as-is.

But the prerendered HTML — the strings Google actually indexes — carries the word **hardcoded**,
outside i18n: `scripts/prerender/routes.ts` lines 2230 (the cross-link from the governance
body), 4261 (`title`), 4264 (`breadcrumbName`), 4267 (`<h1>`), plus their English mirrors.
Phase 0 changes those too, or the rename is invisible to search.

### 2.6 There is no MP roster page

`TopMpsScreen` is mounted at `/procurement/mps` — the MP-tied procurement leaderboard, not a
roster. "Депутати" is the most obvious tile on this hub and has nowhere to go.
**`/persons?role=mp`** is the nearest thing (`?role` is a validated filter in
`useUrlPersonFilters`), but it is **not NS-scoped and cannot be**: `person_role` rows for `mp`
carry `ref = mpId` and no term column, so the destination shows **2,122 roles / 2,120 distinct
people** — every MP since the 44th, not the 240 currently seated. The tile must state the
destination's basis, not the chamber's (§3 band 3).

### 2.7 Measured traffic — the ordering hypothesis, tested

[module-front-pages-v1 §5.1](module-front-pages-v1.md) says outright: *"There is no analytics
export in the repo, so any ordering I give is a hypothesis."* There is now data. GA4,
**Jan 1 – Aug 3 2026** (7 months), `page path` contains `/parliamen` and `/votes`:

| Prefix | distinct paths with traffic | views | active users | avg engagement | vs site avg |
|---|---|---|---|---|---|
| `/votes*` | **51** | **107** | 33 | **1m 27s** | **+15.6%** |
| `/parliament*` | 14 | 97¹ | 33 | 56s | **−24.8%** |

¹ includes 9 views on `/parliamentary/analysis*`, a different module — so this module is ~88.
Whole module ≈ **195 views, ~0.3% of site traffic, over seven months**.

Broken down, and with the two slash variants of each path summed (§2.8 — the redirect splits
every page across two GA rows, so an unsummed reading systematically under-counts):

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
   that is *above* the site's average engagement, while `/parliament*` is a quarter below it. The
   single best-engaging page in the module is a **2020** item page
   (`/votes/2020-11-06/item-5-zid-na-zakona-za-merkite…`, **3m 22s**) — an NS 44 record, from the
   partial parliament §2.3 warns about. Record pages have durable long-tail value; dashboards do
   not. This is `module-front-pages-v1 §5.2`'s "look-up beats read" principle **confirmed**, but
   pointing at `/votes/:date`, not at attendance and cohesion.

2. **`/parliament/embedding` outperforms cohesion and attendance combined** — 21 views at 1m 01s
   against 12 and **2** — and it does that from the **last** tile position on the current hub.
   The draft put attendance and cohesion in band 3 (core) and embedding in band 4 (Още). That is
   the one band-3 choice with evidence against it. Band 3 is reordered accordingly (§3.4).

3. **Discovery, not demand, is the constraint — quantified.** ~49 of 613+ `/votes` record pages
   were reached at all in seven months (**~8%**), by 33 people, with **zero search impressions**
   on the prefix (`project_seo_discovery_gap`). That is what a page nobody can find looks like,
   and it re-orders the phases (§8).

**How much weight to put on this.** Not much per-tile: n = 33 users, and the distribution is
**endogenous** — it measures what the current seven-tile hub links to, not what people want.
Embedding outperforming *from last position* is the one signal that survives that objection, and
the `/votes`-beats-`/parliament` split is the other (different prefixes, no shared tile order).
Everything finer than those two is noise, and the plan should not pretend otherwise.

### 2.8 Every URL on the site canonicalises to a redirect

Found while checking why GSC reported `/parliament` as *"Page is not indexed: Page with
redirect"*. **That report is not a defect** — `/parliament` 301s to `/parliament/`, so
"page with redirect" is the correct answer for the variant that was inspected. The real finding
is underneath it, and it is **site-wide, not parliamentary**:

```
GET /parliament   →  301  location: /parliament/
GET /parliament/  →  200  <link rel="canonical" href="https://electionsbg.com/parliament" />
```

`bgUrlFor` / `enUrlFor` (`scripts/prerender/index.ts:145`) and the sitemap builder emit every URL
**without** a trailing slash, while the prerender writes `dist/<path>/index.html`, so Firebase
adds one on serve. Every `<link rel="canonical">`, every `hreflang` alternate, every `og:url` and
every sitemap `<loc>` therefore points one 301 away from the page that actually serves —
across **~248k prerendered URLs**.

**Do not attribute the zero-impression gap to this.** Measured control: `/sofia`, `/governance`
and `/votes` have the identical shape, and `/sofia` is one of the five prefixes that *does* earn
impressions. It is hygiene — wasted crawl budget, weakened hreflang, an extra hop on every social
unfurl — not the cause.

It also **contaminates the GA numbers in §2.7**: `/parliament` and `/parliament/` are two rows
(36 + 10 views), `/votes` and `/votes/` are two rows (29 + 3), and the slash variants read **0s
and 4s engagement** because they are redirect landings. Any future ordering decision taken from
GA must sum the pairs.

Two candidate fixes, the second a one-liner: add the trailing slash in `bgUrlFor`/`enUrlFor` **and**
the sitemap builder, or set `"trailingSlash": false` in `firebase.json` so the no-slash form
serves 200 directly and matches what the code already believes. **This is not in this plan's
scope** — 248k URLs is too large a blast radius to ride along with a hub rebuild, it interacts
with `cleanUrls`, and it needs a staging verification. It wants its own work item; recorded here
because this is where it was found.

---

## 3. The hub — seven bands (0–6)

Band order is fixed; bands are individually optional.

**Every number on this page declares its basis.** That is not a style note: §3.3 measures three
legitimate answers to "how many votes were there" and three to "what is attendance", and the
draft of this plan picked a different one for each tile by accident. The generator computes one
declared basis per stat and §6's gate recomputes it.

### 3.1 Layout — the chosen option

Four layouts were mocked (front page · chamber-led · split masthead · session strip). They
differ only in **what occupies the top third**, which is the sole real decision — bands 3–5 are
`TileHubGrid` in every one of them.

**Chosen: the session strip as the hero, the front-page structure beneath it.**

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

**Why the strip and not the other three.** §3 band 0 establishes that recess is not an edge case
— 11–32% of every term's days sit inside a >10-day gap, and today is the start of one. The front
page and the chamber-led layouts both answer that with apologetic copy in the most valuable space
on the page. The strip answers it with **information**: fourteen columns, four of them empty, and
the shape of the summer legible at a glance. It is also the only option that promotes the 613
`/votes/<date>` pages directly — which §2.7 measures as the best-performing half of the whole
module, and §7 as the half nothing links to.

The split-masthead option was rejected on the mobile collapse: a 60/40 split stacks on phones
into exactly the front-page layout, so its one advantage evaporates on most traffic, and it forks
`NewsRail` away from the shared horizontal component the other 18 modules will use.

**The hemicycle survives, one band down.** The chamber-led option had the best identity signal —
it says *institution*, which is D1's whole problem — but putting it in the hero means the hero
draws from the roster (`mp_profile`) while every tile below draws from the roll-call corpus: two
sources, two freshness dates, at the top of a page whose audit was largely about basis mismatches.
So the hemicycle becomes the **cohesion tile's scene** (§3.5) instead. Same recognition value,
decorative rather than load-bearing, no second data source.

**One rule stolen from the rejected split-masthead: every rail and strip item carries its own
date, unconditionally** — not only when `inRecessDays > 10`. Band 0 already softened the recess
rule from "collapse" to "re-label"; making the date unconditional removes the conditional state
entirely, and conditional presentation is where this page's audit found most of its defects.

### 3.1.1 What the strip can and cannot show

Measured while speccing it: `RollcallIndexEntry` is `{ date, stenogramId, items, file, ns }` —
**`index.json` carries no tallies.** Per-day за/против/въздържал exists only inside the session
files (~470 KB each, 290 MB total), which the hub may never fetch.

So the strip is phased, and the first version is the honest one:

| | Column encodes | Source | Phase |
|---|---|---|---|
| v1 | **items voted that day** (bar height), sitting vs gap | `index.json` — already fetched | 0 |
| v2 | stacked за / против / въздържал | `hub_feed/<ns>.json` | 2 |

v1 still carries the whole point — the calendar shape, the gaps, and 613 deep links. It just
encodes volume rather than outcome, and must not be captioned as though it encodes outcome.

### Band 0 — Wire (one line)

`Днес в НС: 5 гласувания · 3 законопроекта на второ четене · 73% присъствие` →
`/votes/<latest date>`.

**Recess is a first-class state, and it is common.** Measured over all nine NS, the median gap
between plenary days is **1 day** and the maximum is **34** — but between **11% and 32% of each
term's calendar days sit inside a gap longer than 10 days** (NS 44: 32%, NS 49: 25%, NS 51: 21%).
Today, 2 August, is the start of the summer recess, so this state fires on the first deploy and
holds for most of August and September.

**So the recess rule RE-LABELS; it does not collapse.** An earlier draft emptied bands 1–2 above
a 10-day threshold, which would blank half the page for a fifth of all days. The dishonesty was
never "showing older items" — it was "presenting older items as today". Therefore:

- band 0 flips its framing: *„НС не заседава от 31 юли (12 дни)"*;
- band 1 and band 2 persist, but **every item carries its own event date and no relative-time
  kicker** — *„31 юли"*, never *„преди 2 дни"*, and the rail's heading becomes *„От последното
  заседание"* rather than *„Тази седмица"*.

**Three coverage states, all explicit** (§2.3): full · partial · none.

### Band 1 — Lead

One item: the most consequential vote of the period.

**Source: the full session corpus, NOT `important_votes`.** The draft's rule ("highest `score` in
`important_votes` among final-adoption items") is unrunnable — measured:

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
corpus — and carries no reading-stage field (stage is only inferable from the title string). For
NS 48 and NS 51 the rule yields **nothing at all**; the current top-scoring item in the 52nd
(score 80) is titled `… - първо гласуване`.

The generator already holds every deduped session in memory (`readAllSessions` → `dedupeRevotes`
→ `groupByNs`), so the lead is selected over the **whole corpus** with the same scoring inputs
`computeImportantVotes` uses, restricted to final-adoption items per §3.2's classifier. The
convention itself is unchanged (`feedback_article_vote_links`: link second-reading/final votes,
never first readings). Overridable by a committed `leads.json`.

### 3.2 „Приети закони" — the derivation, because the corpus has no such record

This is the single largest data finding of the audit and it constrains bands 0, 1, 2 and 3.

**There is no "law adopted" record anywhere in the roll-call corpus.** Measured over all 14,870
items: 1,847 carry „първо гласуване/четене", **7,782 carry „второ"**, 5,241 carry neither. But
the second-reading items are **per-article votes** — for NS 52 alone there are 754, of which 466
match `параграф`, plus `член N`, `Приложение`, `наименование`, and per-MP amendment proposals:

```
ЗИ на Закона за държавната финансова инспекция – второ гласуване - наименование
ЗИ на Закона за държавната финансова инспекция – второ гласуване - параграф 1 до параграф 5
Закон за противодействие на корупцията … - второ гласуване - член 7 - предложение от Елена Нон…
```

A naive count reports ~750 „приети закони" for a parliament that passed a few dozen.

**The derivation that works — bill-stem grouping.** Split each second-reading title on
`/\s*[-–]\s*второ (гласуване|четене)/` and group by the stem. NS 52 collapses from 754 items to
**33 distinct bills**, which is a credible and defensible number:

```
232x  Закон за държавния бюджет … за 2026 г.
136x  ЗИД на Изборния кодекс
 69x  Закон за противодействие на корупцията сред лица, заемащи публични длъжности
 47x  Закон за бюджета на държавното обществено осигуряване за 2026 г.
 …    33 stems in total
```

**What is NOT derivable, and is therefore cut from v1:** the pass/fail split. "Last item of the
stem" does not give adoption — the largest stem (държавния бюджет, 232 items) ends on
`yes:38 no:4 abstain:135`, a rejected amendment. So:

- the band-3 tile is **„Законопроекти на второ четене" = 33**, labelled as such;
- band 0's wire says *„N законопроекта на второ четене"*, never *„N приети закона"*;
- **„N окончателно приети · N отхвърлени" is dropped from v1** and listed in §5. It returns when
  a whole-bill adoption marker exists — which is one of the strongest arguments for the Postgres
  migration, where a `bill` dimension can be resolved once rather than regex-matched per render.

### 3.3 The band-3 numbers, measured — and their bases

The draft's illustrative figures were wrong in six of six cases, each for a different reason.
Measured on NS 52 (2026-04-30 → 2026-07-31):

| Figure | Draft said | Measured | Why the gap |
|---|---|---|---|
| сесии | 613 | **39** | 613 is the all-NS total on an NS-keyed hub |
| гласувания | `N` | **1,263** (`index.json`) · **1,198** (`attendance.totalVoteItems`, post-dedupe) · **1,157** (`itemTitles` keys) | `dedupeRevotes` collapses re-votes, so three counts are all legitimate |
| депутати | 240 в 52-то НС | **240** seats · **270** `attendance` entries · **2,120** rows at the destination | substitutions inflate the roll; the destination is all-time |
| групи | 8 | **6** | `cohesion.byNs["52"].entries` = ДПС, ВЪЗРАЖДАНЕ, ПП, ДБ, ПБ, ГЕРБ - СДС |
| присъствие | 87% | **70.2%** simple mean · **73.2%** weighted · **73.6%** over the 238 MPs present for ≥80% of items | no basis was declared |
| кохезия | 0.94 средна | mean **0.970**; **0.934** is the *minimum* (ГЕРБ - СДС) | the draft's "mean" was the min |

**Declared bases for v1** (asserted in §6):

- **сесии** — plenary days for the selected NS.
- **гласувания** — post-dedupe item count (`attendance.totalVoteItems`), because that is the
  denominator every other metric on the module already uses. Stated as *„точки за гласуване"*.
- **присъствие** — **weighted** (`Σ present / Σ items`), because a simple mean over-weights MPs
  who sat for nine items. 73.2%.
- **кохезия** — unweighted mean over parliamentary groups (0.970), with the least-unified group
  named separately (ГЕРБ - СДС, 0.934). Two numbers, two labels, never one number wearing both.
- **депутати** — the tile shows the **destination's** basis, because it links there.

### Band 2 — News rail (3–4 `NewsCard`s)

| Card | Source | Feasibility |
|---|---|---|
| Последни гласувания | `votes/index.json` sessions + the day file | **A** |
| Законопроекти на второ четене | bill-stem grouping over the corpus (§3.2) | **A** |
| Разцепления — кой гласува срещу своите | `dissents.json` **31 MB → precomputed top-N slice, computed in-memory (§4)** | **B** |
| Отсъствия от последното заседание | `attendance.json` → slice | **B** |
| Предстоящи законопроекти | **not ingested** — a new parliament.bg crawl | **C, out of scope** |

### 3.4 Band 3 — Разгледай (core, 4)

Ordered by the template's rule — **look-up beats read** — which §2.7 now confirms with data
rather than assuming. Today's hub opens with cohesion and embedding, the two most analytical
things on it.

| Tile | To | stock · flow · change (NS 52, measured) | traffic (§2.7) |
|---|---|---|---|
| Гласувания | `/votes` | `39` заседания · `1 198` точки · `33` законопроекта на второ четене | **107** views, +15.6% engagement |
| Карта на гласуването | `/parliament/embedding` | `270` депутати проектирани · `6` групи | **21** views, 1m 01s |
| Единство на групите | `/parliament/cohesion` | `0,97` средна кохезия · най-разединена: ГЕРБ - СДС (0,93) | 12 views |
| Депутати | `/persons?role=mp` | `2 120` депутати от 44-то НС насам · `240` в текущото | no history (new destination) |

**Three changes from the draft, all forced by §2.7:**

- **Присъствие moves to band 4.** 2 views and 9s over seven months, against embedding's 21 and
  1m 01s. It stays a destination; it is not a core one.
- **Карта на гласуването moves up from band 4.** It is the best-performing analytical page in the
  module and it earned that from the *last* tile position, which is the one traffic signal here
  that survives the endogeneity objection.
- **Законопроекти на второ четене stops being a tile** and becomes the *flow* number on
  Гласувания. Two reasons, and the first is a bug: the draft gave it `to: "/votes"` — the **same
  destination as Гласувания** — and `TileHubGrid` renders tiles with `key={tile.to}`, so two
  tiles sharing a `to` is a **duplicate React key**, not merely a duplicate link. Second, §3.2's
  derivation has no distinct destination to offer until a bills view exists (the `?topic=`
  vocabulary is the 8-value `VoteTopic` taxonomy and contains nothing meaning "second reading"),
  so a tile would be pointing at a page that cannot show what it counts.

Note the **Депутати** tile leads with the destination's number and carries the chamber's as the
secondary. Leading with `240` and landing on a 2,120-row page is the "show one window and count
another" failure CLAUDE.md names for `?pscope`.

### Band 4 — Още (3)

Присъствие (`/parliament/attendance`) · Сходство между депутати · Двама депутати един срещу друг.

**Разцепления is CUT as a tile — it has no route.** `grep dissent src/routes.tsx` returns
nothing: the only surface is `MpDissentsSection` on a candidate page. The draft listed it here
without checking, which is precisely the orphan-by-assumption the §6 reachability gate exists to
catch — caught in speccing rather than in review this time. It stays a band-2 news card, where it
needs no destination of its own, and it returns as a tile if a `/parliament/dissents` page is
ever built.

**Two of the remaining three have no STATIC destination** (§2.4), and writing
`to: "/parliament/similarity/:mpId"` would pass the "absolute `to`" gate vacuously while linking
nowhere. Both resolve from the blob:

- **Сходство** → `hubStats.byNs[ns].seeds.similarity` — `similarity_headline.json` already
  computes a per-NS `seedId` (the MP with the most cross-party twins), so the href is
  `/parliament/similarity/<seedId>`.
- **Двама депутати** → `hubStats.byNs[ns].seeds.pair` — `party_correlation.json` (17 KB) already
  carries the most-divergent party pair, so the href is `/votes/between/<pairSlug>`. Slug format
  is fixed by the existing consumer (`ParliamentVotingTile:143`) and must round-trip party names
  containing hyphens: `` `${encodeURIComponent(a)}--${encodeURIComponent(b)}` `` — a **double**
  hyphen separator, because `ГЕРБ-СДС` contains a single one.

**How the registry represents a seeded tile,** so the gate can check it rather than trust it:
every entry carries `to: string`; a `to` containing a `:` segment MUST also carry
`seed: "similarity" | "pair"`, and the screen substitutes. **A tile whose seed is unavailable is
omitted, not rendered with a broken href** — an absent tile is honest, a dead link is not.

### 3.5 Tile inventory — 11 tiles, 11 accents, 11 bespoke scenes

Every tile gets its own hand-drawn vignette in the `SceneFrame` contract (300×116, ink =
`currentColor`, accent = `var(--sector)`, `PAPER` for under-ink fills). **None is reused from
another hub** — `governanceScenes.tsx` already has a connections mark and a persons mark, but
they carry a different page's meaning; here the question is "what does this destination answer
about the National Assembly". Dense marks stay on the right half and top band, because phase 1
overlays a `metric` at the banner's bottom-left.

Accents must be unique **per page** (§6); the palette has 20 tokens, so 11 is comfortable. Reuse
across hubs is fine — `plum` is also the governance tile's accent for this module, which is a
deliberate echo, not a collision.

| Band | Tile | `to` | accent | scene |
|---|---|---|---|---|
| 3 | Гласувания | `/votes` | plum | roll-call tally — three agenda rows as segmented за/против/въздържал bars. The one mark that shows the *shape* of a vote rather than a metaphor for one |
| 3 | Карта на гласуването | `/parliament/embedding` | indigo | the UMAP: three loose clusters, one pulled away, plus a hollow stray between two of them — the cross-party voter the map exists to reveal |
| 3 | Единство на групите | `/parliament/cohesion` | teal | **the hemicycle** (§3.1) — five fanned ranks blocked by group, with ONE seat in the accent block drawn hollow: the member voting against their own. That single mark *is* what cohesion measures |
| 3 | Депутати | `/persons?role=mp` | clay | four seated figures in a rank, heads + shoulders only so it survives thumbnail size, the accent one forward |
| 4 | Присъствие | `/parliament/attendance` | amber | the register — a 9×4 grid, filled = present, hollow = absent, absences clustering right the way a thinning sitting actually reads |
| 4 | Сходство между депутати | `/parliament/similarity/:mpId` | aqua | two voting records side by side with the matching rows bridged; the bridges are the score, drawn rather than stated |
| 4 | Двама депутати един срещу друг | `/votes/between/:pair` | terracotta | diverging bars either side of a shared axis — same items, two members, opposite sides |
| 5 | Декларации | `/governance/declarations` | rose | a filed sheet in `PAPER` under ruled ink, accent stamp across the corner |
| 5 | Имущество | `/mp-assets` | gold | a house in ink beside a coin stack in accent — the two asset classes that dominate the filings |
| 5 | Фирми | `/mp/companies` | moss | a company block, one storey lit in accent. Deliberately not an org chart: this tile is about ownership, not structure |
| 5 | Свързани лица | `/connections` | steel | the ego graph — one MP node in accent, company nodes around it, two edges running off-frame to say the graph does not stop here |

Files: `src/screens/parliament/parliamentRegistry.ts` (pure data, no JSX),
`parliamentScenes.tsx` (the lookup table — needs the `react-refresh/only-export-components`
disable, as every scenes registry does), `ParliamentHubScreen.tsx`, and the strip as its own
component so phase 2 can swap its data source without touching the hub.

### Band 5 — Депутатите извън залата (cross-links, 4)

Декларации (`/governance/declarations`) · Имущество (`/mp-assets`) · Фирми (`/mp/companies`) ·
Свързани лица (`/connections`). All four routes verified present in `routes.tsx`. This band is
what makes the hub a *module* rather than a vote-analytics silo, and it is pure linking — no new
data (D4).

### Band 6 — За теб / Данни и метод

Моят депутат (via `my-area`) · Following · then sources, `lastDate`, coverage span (§2.3),
and the §3.2 / §3.3 bases stated in plain language. The bases belong on the page, not only in
the generator: "73% присъствие" without "претеглено спрямо точките, в които депутатът е могъл да
гласува" is the kind of number that gets quoted back at us.

---

## 4. Data plan — two artifacts, one generator

New `scripts/parliament/derived/hub_stats.ts`, wired into `rebuildDerived` in
`scripts/parliament/derived/index.ts` — one module per artifact, the pattern is already there.

**It runs LAST and takes its inputs from memory.** `rebuildDerived` already computes
`attendanceByNs`, `cohesionByNs`, `dissentsByNs`, `importantVotesByNs` and the deduped
`byNs` session map before it writes anything. Passing those objects into `computeHubStats(...)`
means the 31 MB `dissents.json` is never re-parsed, and — more importantly — the hub's numbers
cannot drift from the sub-page's, because both are the same in-memory object.

### 4.1 Two files, not one

The draft put tiles + feed + lead for all nine NS in a single `hub_stats.json`. Procurement's
equivalent is 4.6 KB **because it carries numbers and nothing else**; feed items carry Bulgarian
bill titles that routinely run 130+ characters, so nine parliaments × ~17 items × ~250 B ≈ 38 KB
of feed alone — the 40 KB budget met by a hair, with every visitor downloading eight parliaments
of rail they will not read.

Shard it, matching `important_votes/<ns>.json` **in the same directory**:

```
derived/hub_stats.json          all NS · numbers, coverage, seeds   ~6 KB · always fetched
derived/hub_feed/<ns>.json      rail + lead for ONE NS              ~6 KB · fetched on demand
```

```jsonc
// hub_stats.json
{
  "computedAt": "…",
  "byNs": {
    "52": {
      "lastDate": "2026-07-31", "sessions": 39, "inRecessDays": 2,
      "coveredFrom": "2026-04-30", "coveredTo": "2026-07-31", "coverage": "full",
      "tiles": { "votes": {...}, "mps": {...}, "attendance": {...},
                 "cohesion": {...}, "bills": {...} },
      "seeds": { "similarity": "/parliament/similarity/5064",
                 "pair": "/votes/between/gerb-sds__pp" }
    },
    "44": { "…": "…", "coverage": "partial",
            "coveredFrom": "2020-10-28", "coveredTo": "2021-03-25" }
    // … 45–51. NS 40–43 are ABSENT, and the hub renders the no-data state (§2.3).
  }
}
```

```jsonc
// hub_feed/52.json
{ "computedAt": "…", "ns": "52",
  "lead": { /* one FeedItem */ },
  "feed": { "sessions": [/* ≤4 */], "bills": [/* ≤4, second reading, stem-grouped */],
            "dissents": [/* ≤4 */], "absences": [/* ≤4 */] } }
```

Budget becomes **`hub_stats.json` ≤ 10 KB** and **each `hub_feed/<ns>.json` ≤ 12 KB** — both far
easier to hold than one 40 KB ceiling, and Phase 1 (stats) ships independently of Phase 2 (feed)
with no re-shaping.

Reuses the `FeedItem` shape from the module plan (`id · kind · at · title · subtitle · to ·
badge? · tone?`) so `NewsRail` stays generic across modules.

Two hooks, mirroring `useProcurementHubStats` — `useParliamentHubStats()` and
`useParliamentHubFeed()`. Both read the selected election's NS and return `undefined` for an
uncovered one, which is what drives the honest empty state rather than a zeroed tile.

The six existing mini-tiles keep their own fetches **on their own sub-pages**, where the full
artifact is what the page is for. The hub simply stops using them.

### 4.2 Publishing — the step the draft omitted

`data/parliament/votes/derived/` is **bucket-served** (`bucket_sync_paths.ts` allows it; only
`profiles/`, `index.json`, `declarations/`, `mp-assets/` and `company-connections/` are
child-excluded). So the new artifacts need, on every regeneration:

1. **the `--upload` branch of `rebuildDerived`** (`index.ts:315–353`) — `uploadText` for
   `hub_stats.json`, `uploadTextTree` for `hub_feed/`, exactly as `important_votes/` is handled.
   Without this the daily `update-rollcall` run refreshes eight artifacts and leaves the hub on
   last week's numbers: green locally, stale on prod, the trap CLAUDE.md documents a dozen times.
2. `npm run bucket:sync:paths -- parliament/votes/derived` for a hand-run publish.
3. A `bucket:gz` decision — the bucket serves identity encoding, so a 12 KB feed shard is 12 KB
   on the wire.

§6 adds a generic gate for (1): **every file `rebuildDerived` writes must appear in its
`--upload` branch.** That closes this class for the eight existing artifacts too.

---

## 5. What v1 does NOT include

Stated so scope creep is visible:

- **no pass/fail law outcome** (§3.2) — „N окончателно приети · N отхвърлени" is not derivable
  from the corpus at acceptable precision. This is the biggest honest gap in v1;
- no bills/законопроекти ingest (§3 band 2, the strongest future addition — it turns the rail
  from "what happened" into "what is coming");
- no top-level nav (D2); no `/votes` relocation (§2.4); no new MP roster page (§2.6);
- no changes to the six sub-pages beyond breadcrumbs;
- no Postgres migration — see [parliament-rollcall-pg-v1.md](parliament-rollcall-pg-v1.md);
- **no trailing-slash / canonical fix** (§2.8) — real, site-wide across ~248k URLs, found here
  but far too large a blast radius to ride along with a hub rebuild. Needs its own work item.

---

## 6. Gates

The reports-matrix episode is the direct precedent: a hub fronting one grain per type, a comment
claiming the rest were reachable, and 28 orphan pages. Every gate below exists because something
comparable has already shipped.

| Gate | Asserts | Precedent |
|---|---|---|
| `parliamentHubRegistry.test.ts` | every tile `id` resolves to a scene; ids unique; every `to` absolute | `hubRegistry.test.ts` |
| — accent uniqueness | no accent used twice on one page (20 tokens available, **11 tiles** across bands 3–5 — §3.5) | added for `/governance` this week |
| — **reachability** | every routed `/parliament/*` and `/votes*` page is linked from the hub, or from a page the hub links | the 31-orphan reports gap |
| — **reachability, at every phase** | the assertion runs against the **post-Phase-1 registry**, not only the final one — §8's B4 case is only catchable on the intermediate state | new |
| — **resolved seeds** | band-4 hrefs from `seeds` match a routed pattern AND carry a non-empty parameter | §3 band 4 |
| — **cross-hub tile** | the Управление tile and the hub agree on `to` + `titleKey` — and since D2 makes that tile the ONLY entry point, losing it orphans the whole module | the `persons` / `connections` gates |
| `parliament_hub_stats.test.ts` | **`hub_stats.json` ≤ 10 KB**, **each `hub_feed/<ns>.json` ≤ 12 KB**; every band-3 tile has a stat entry; `byNs` keys ⊆ the NS that actually have data; `lastDate` matches `index.json` | new — the budget is the point |
| — **declared basis** | each band-3 stat is **recomputed from the source artifact** by the test: attendance weighted (`Σ present / Σ items`), sessions per-NS, groups = `cohesion.entries.length`, votes = `attendance.totalVoteItems` | §3.3 — six of six draft figures were wrong |
| — **law derivation** | bill-stem grouping yields 5–200 stems per NS; a result equal to the raw second-reading item count FAILS (that is the naive bug) | §3.2 |
| — coverage honesty | an NS with no roll-call data yields `undefined`, never a zeroed tile; `coveredFrom`/`coveredTo` present for every `byNs` key; `coverage: "partial"` whenever the span is < 60% of the term | §2.3 |
| — recess honesty | `inRecessDays > 10` ⇒ every feed item carries an explicit event date and no relative-time kicker (**not** an empty feed — see §3 band 0) | §3 band 0 |
| **upload manifest** | every file `rebuildDerived` writes appears in its `--upload` branch | §4.2 — generic, covers the eight existing artifacts |
| prerender | `/parliament` emits a body linking every sub-page; JSON-LD ladder includes `/parliament`; present in `scripts/sitemap/route_defs.ts` | `project_seo_discovery_gap` |

The payload gate is the one worth stating plainly: **without it the hub silently regrows to
1.65 MB the first time someone adds a tile that reads `cohesion.json` directly.**

---

## 7. Prerender / SEO

`/parliament` already has a prerendered landing (it is in the safe `NAV_HUBS` list) with a body
linking four sub-pages. The real gap is one level down, and it is larger than the draft thought.

**What the draft got wrong:** `SessionsIndexScreen` **already** crumbs back to `/parliament`
(`SessionsIndexScreen.tsx:119`). That line is struck from Phase 3.

**What is actually missing** — measured in `buildVotesRoutes` (`dynamicRoutes.ts:2859`):

- the 613 `/votes/<date>` bodies contain **zero `<a>` elements**. They are dead ends for the
  crawler, on one of the two zero-impression prefixes `project_seo_discovery_gap` names;
- their JSON-LD breadcrumb ladder is `Начало → Поименни гласувания → <date>`, **skipping
  `/parliament` entirely** — so the crawler never sees the module the SPA shows.

**§2.7 promotes this from a tidy-up to the module's main event.** `/votes*` out-earns the whole
analytical half — 107 views across **51** distinct paths, at engagement **+15.6% above** the site
average, with the single best-engaging page in the module being a 2020 record page at **3m 22s**.
And only ~49 of 613+ record pages were reached at all in seven months (**~8%**), by 33 people,
with zero search impressions. The pages that earn attention are precisely the pages nothing links
to. That is why this work moves ahead of the payload work in §8.

So this phase is:

- extend the JSON-LD ladder to `Начало → Народно събрание → Поименни гласувания → <date>` on
  both `/votes` and all 613 `/votes/<date>` pages;
- add prev/next-session links plus a back-to-hub link to each `/votes/<date>` body — a 613-page
  internal-linking win for the price of a few lines in one builder;
- the `/parliament` body gains links to **every** sub-page (it currently omits
  `/parliament/attendance`, which has its own `staticPage` entry at `routes.ts:2286`), with the
  band-3/4 blurbs as the crawlable text;
- bands 3–6 prerendered, **bands 0–2 client-only** — a daily rail baked into static HTML goes
  stale between deploys, and Google should index the durable grid;
- the D1 rename applied to the hardcoded prerender copy (§2.5).

---

## 8. Phases

**Dependency, stated because it is easy to miss:** `InfographicTileProps` today carries
`to · title · badge · desc · accent · scene · cta · metric · metricCaption` — there is **no
`blurb`, `stats` or `delta`**, and `NewsRail` / `NewsCard` / `LeadCard` do not exist. So Phase 1
below requires **module-front-pages-v1 Phase 0** (the tile grammar) to land first, and Phase 2
*builds* the generic rail components.

That reverses module-front-pages §9, which designates `/procurement` as the template-prover
("the components already exist"). Taken deliberately: `/parliament` is the cleaner test of the
*template* because it has no `feed_payloads` dependency at all. The cost is that the DB degrade
path in that plan's §8.2 goes unexercised until `/procurement` follows — which must therefore
follow, not be skipped.

**The order is 0 → 1 → 2 → 3 by number, but they SHIP 0 → 3 → 1 → 2.** The numbers are kept so
earlier references stay valid; the ship order is what to follow.

§2.7 is the reason. The payload phase makes a page faster for the **33 people** who reached this
module in seven months; the linking phase is the only one that can change whether anyone reaches
it at all. Optimising a page nobody can find is the wrong thing to do first, however real the
1.65 MB is.

| Phase | Ships | Scope | Gate before merge |
|---|---|---|---|
| **0** | 1st | D1 rename (2 locale values → 9 call sites, **plus the hardcoded prerender copy, §2.5**). Registry + **11 bespoke scenes** (§3.5) + `ParliamentHubScreen` rebuilt on `TileHubGrid`; bands 3–5 + the **v1 session strip** (§3.1.1). No `hub_stats`, no rail. Deletes the hardcoded JSX. **Band 4's pair tile ships here**, before anything is deleted. | registry test: scenes, unique ids, absolute `to`, **seeded-`to` has a `seed`**, accent uniqueness, reachability, cross-hub tile |
| **3** | **2nd** | `/parliament` body links every sub-page; JSON-LD ladder through `/parliament`; prev/next + back-to-hub on all 613 `/votes/<date>` bodies. **Promoted — §2.7 shows the record pages earn the engagement and ~92% of them are unreached.** | prerender + sitemap gates |
| **1** | 3rd | `hub_stats.ts` + `useParliamentHubStats` + stock·flow·change on band 3 + the §2.3 three-state coverage. **Drops all six mini-tile fetches from the hub** — 1.65 MB → ≤10 KB. | payload, declared-basis, law-derivation, coverage-honesty, upload-manifest gates; reachability re-run on THIS state (`/votes/between/:pair` loses its only link here — §2.4); measure before/after in the PR |
| **2** | 4th | Bands 0–2: wire, lead, `NewsRail` + `NewsCard` + `LeadCard` built generic; `hub_feed/<ns>.json` with sessions + bills (**A**), then dissents + absences (**B** slices). | recess-honesty gate; per-shard payload gate |

Phase 0 still goes first — it is the registry every later phase sits on, and it removes the last
hardcoded hub. Phase 3 is now the one with a plausible traffic effect; phase 1 remains the
engineering win and is worth doing regardless, just not first.

**Phase 0 is not zero-fetch, and the draft's "no stats" phrasing hid that.** The v1 strip reads
`index.json`, and the two seeded band-4 tiles read `similarity_headline.json` +
`party_correlation.json`. The trajectory is still monotone down, which is what matters:

| | fetches | total |
|---|---|---|
| today | 6 artifacts | **~1.65 MB** |
| after phase 0 | `index.json` 303 KB + headline 4.3 KB + correlation 17 KB | **~324 KB** |
| after phase 1 | `hub_stats.json` (+ `hub_feed/<ns>.json` from phase 2) | **≤ 22 KB** |

So phase 0 is already a 5× cut and phase 1 finishes the job. The §6 payload gate binds from
phase 1, when `hub_stats.json` exists to measure; until then the gate asserts only that the hub
imports none of the four artifacts it may never touch (`dissents`, `similarity`, `topic_index`,
`party_pair_breaks`).

**Re-measure after phase 3 before committing to the band-3 order.** §2.7's distribution is
endogenous to the current hub's links, so the first honest read of demand is the one taken after
the link structure changes.

---

## 9. Remaining open questions

1. **Bills (`законопроекти`).** The one genuinely missing dataset. Out of scope for v1, but it is
   what would make this page worth opening on a morning when the chamber has not yet voted —
   "what is coming" rather than "what happened". Worth its own ingest plan. It would also supply
   the whole-bill adoption marker §3.2 lacks.
2. **Serving layer.** Everything above is committed JSON. The corpus has outgrown that shape in
   at least three places (a 31 MB dissents artifact, a 12 MB similarity artifact, and a "what is
   a law" question that wants a `bill` dimension rather than a title regex). See
   [parliament-rollcall-pg-v1.md](parliament-rollcall-pg-v1.md).

---

## 10. What the 2026-08-02 audit overturned

Kept for the next reader, so the corrections are not silently absorbed:

| Draft claim | Finding |
|---|---|
| Lead = highest-scoring final-adoption item in `important_votes` | Unrunnable — 15-row shard, no stage field; **0 candidates for NS 48 and 51** |
| „Приети закони: N окончателни · N отхвърлени" | **No such record exists.** 754 second-reading items in NS 52 are per-article; stem grouping gives 33 bills; pass/fail not derivable |
| Band-3 figures (613 · 240 · 8 · 87% · 0.94) | **Six of six wrong**, each with an undeclared basis. Measured: 39 · 2 120/240 · 6 · 73.2% · 0.970 (0.934 is the min, not the mean) |
| Phase 1 drops six mini-tiles | `ParliamentVotingTile` is the **only** link to `/votes/between/:pair` in the app — Phase 1 as drafted orphans it |
| Band 4 `to: /parliament/similarity/:mpId` | Parameterised; passes the "absolute `to`" gate vacuously. Resolved from blob seeds instead |
| One 40 KB `hub_stats.json` | Feed titles blow the budget; split into all-NS stats + per-NS feed shards |
| Coverage is present/absent | **NS 44 is partial** (5 months of a 4-year term) and renders as if complete |
| Recess ⇒ collapse bands 1–2 | Fires on 11–32% of term days; re-label instead of collapse |
| `SessionsIndexScreen` breadcrumb needs adding | Already present. The real gap: 613 `/votes/<date>` bodies with no links and a JSON-LD ladder that skips `/parliament` |
| D1 = 2 locale lines | Plus hardcoded prerender copy at `routes.ts` 2230/4261/4264/4267 + EN mirrors |
| Blob generated by re-reading artifacts | Compute in-memory at the end of `rebuildDerived` — no 31 MB re-parse, no drift |
| (not stated) | Publishing: `--upload` branch + `bucket:sync:paths` were both missing |

### 10.1 What the 2026-08-03 traffic data changed

The audit above was source-only. GA4 + GSC (§2.7, §2.8) then moved four more things:

| Draft position | Finding |
|---|---|
| Ordering is "a hypothesis, no analytics exist" (module-front-pages §5.1) | **Measured.** `/votes*` 107 views / 51 paths / **+15.6%** engagement vs `/parliament*` 97 / 14 / **−24.8%**. Look-up beats read — confirmed, and pointing at the record pages |
| Присъствие + Единство in band 3, Карта in band 4 | **Присъствие is 2 views / 9s**; Карта is **21 / 1m 01s** from the LAST tile slot. Swapped (§3.4) |
| „Законопроекти на второ четене" as its own band-3 tile at `to: "/votes"` | **Duplicate React key** — `TileHubGrid` uses `key={tile.to}` and Гласувания already owns `/votes`. Demoted to a flow number |
| Phases ship 0 → 1 → 2 → 3 | **0 → 3 → 1 → 2.** ~92% of record pages unreached in 7 months by 33 users; the payload phase optimises a page nobody can find |
| (not stated) | **Every URL on the site canonicalises to a redirect** (§2.8), ~248k pages. Not the cause of the impression gap (`/sofia` has the same shape and ranks) — but it splits every GA row in two, so §2.7's pairs must be summed |

### 10.2 What speccing the UI changed

Two more, found while writing the tile inventory (§3.5) rather than in review:

| Draft position | Finding |
|---|---|
| Разцепления is a band-4 tile | **No route exists.** `grep dissent src/routes.tsx` is empty — the only surface is `MpDissentsSection` on a candidate page. Cut to 3 tiles; it stays a band-2 card. This is the orphan-by-assumption the §6 reachability gate is for, caught one step earlier |
| The session strip shows за/против/въздържал per day | **`index.json` carries no tallies** — `RollcallIndexEntry` is `{date, stenogramId, items, file, ns}`. Outcome lives only in the 290 MB of session files. v1 encodes **items per day**; stacked outcome waits for `hub_feed` (§3.1.1) |
