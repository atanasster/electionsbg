# Settlement card kit — research + design brainstorm (v1)

**Status:** research only. Nothing built. Written 2026-08-04, triggered by the
wish to post about СУ „Никола Й. Вапцаров", с. Ружинци (matura 2,00 — every one
of 12 examinees failed).

Goal as stated: *a cardKit that renders a rich infographic about **any**
settlement in Bulgaria — population, graduates, grades, demographics, mayor/party,
parliamentary winner.*

The headline finding is in §2: **"any settlement" is not achievable as one card.**
Four blocks cover essentially every settlement; the interesting money and school
blocks cover 5–16%. The design has to be coverage-aware or it will ship blank
panels on 84% of the country. §5 proposes how.

---

## 1. What already exists (the reuse surface)

`scripts/posts/cardKit.ts` (1,396 lines) is a mature 1080×1080 PNG renderer on
`@napi-rs/canvas`, already wired into the `naiasno-post` skill and
`scripts/posts/post_tool.ts`. It exports six renderers:

| renderer | shape |
|---|---|
| `renderStatCard` | one number + context line |
| `renderBarCard` | ranked bars, signed, shared left edge |
| `renderLineCard` | multi-series time line, `niceAxisStep` axis |
| `renderTableCard` | typed cells (`TableCell`) |
| `renderAnnounceCard` | feature/dataset launch |
| `renderMapCard` | Bulgaria outline + `MapPoint[]`, `loadBulgariaGeo` |

Shared: `THEME` (dark `#0b1224` / light `#f1ece0`, accent `#df6b43`, cool
`#4e9aa6`, rule `#22304d`), `FONT` (Inter stack), `drawWordmark`, `roundRect`,
`hexToRgb`.

**There is no composite renderer.** Every existing card answers ONE question with
ONE visual form. A settlement profile is inherently multi-block, so this is a
genuinely new seventh renderer — `renderPlaceCard` — not a variation on an
existing one. The palette, wordmark, footer and font work all carry over; the
layout engine does not.

Worth stealing rather than rewriting: `renderTableCard`'s cell typing is the
closest thing to a block abstraction already in the file.

---

## 2. Settlement-grain data inventory — with coverage

Universe: `data/settlements.json` = **5,364 settlements**, each with `ekatte`,
`name`/`name_en`, `oblast`, `obshtina`, `nuts3`, `kmetstvo`, `t_v_m` (с./гр.) and
`loc` (`lon,lat`). Every settlement has a name, a place hierarchy and a
coordinate — so the *frame* of a card is always renderable.

199 settlements have census population 0 and 1,250 have 1–49. A card for a
4-person hamlet is not a post. Coverage is therefore reported against three
universes:

| block | source | all 5,364 | pop ≥50 (3,806) | pop ≥200 (2,495) |
|---|---|---|---|---|
| Census 2021 (pop, age bands, sex) | `data/census_2021_settlements.json` | 5,255 | 3,806 | 2,495 |
| ГРАО registered population | `data/grao_population.json` | 5,105 | 3,795 | 2,489 |
| Parliamentary result 2026 | `data/2026_04_19/settlements/{ekatte}.json` | **5,364** | 3,806 | 2,495 |
| Full vote history (13 elections) | `data/settlements/{ekatte}_stats.json` | **5,364** | 3,806 | 2,495 |
| Local council trend by cycle | `data/local_place_trends/s/{ekatte}.json` | 3,708 | 3,274 | 2,153 |
| Kmetstvo mayor | `data/local_mayors/kmetstvo_to_ekatte.json` + `data/2023_10_29_mi/municipalities/*` | 2,989 | 2,926 | 2,185 |
| **Procurement (buyers seated here)** | PG `procurement_settlement_payloads` | **870** | — | — |
| **EU funds projects** | PG `fund_projects.ekatte` | **3,279** | — | — |
| **Matura school** | `data/schools/index.json` (loc join) | **299** | 297 | 297 |
| Retail prices | PG `price_grid_days.ekatte` | **245** | — | — |
| Public buyer seated | PG `awarder_seats.ekatte` | 905 | — | — |
| Hospital | PG `nzok_hospital_geo.ekatte` | 79 | — | — |

### The coverage cliff

Restricting to **pop ≥ 200** (2,495 settlements — the realistic post universe),
four blocks are effectively universal:

- **demographics** (census: population, five age bands, male/female) — 100%
- **parliamentary result** (turnout, per-party votes, paper vs machine) — 100%
- **political history** (13 elections of party votes) — 100%
- **local government** (council party split 86%, kmetstvo mayor 88%, and the
  obshtina mayor is 100% via the parent município)

And three are not:

- **matura/graduates — 297 of 2,495 = 12%.** This is the block the Ружинци post
  is about, and it is the *rarest* one. Only 994 schools nationally sit a ДЗИ, in
  299 distinct settlements. A "graduates + grades" block is a special case, not a
  standard row.
- **procurement — 870 nationally.** See the attribution trap in §3.
- **prices — 245.** Oblast centres and large towns only.

**Conclusion:** a single fixed template is wrong. §5.

### Join notes

- **school → ekatte has no key.** `schools/index.json` carries `id` (НЕИСПУО),
  `address` (`"С.РУЖИНЦИ"`), `loc` and `eik` — no ekatte. But **837 of 994 school
  `loc` values are byte-identical to a settlement centroid in
  `settlements.json`**, so an exact string join on `loc` resolves 84% for free.
  The remaining 157 (geocoded to real addresses in big cities) need
  `useNearestSettlement` (already exists in `src/data/area/`). A name join is the
  worst option — 149 school addresses match an ambiguous settlement name and 153
  match none.
- **kmetstvo → ekatte:** `kmetstva[].ekatte` in the local-election bundles is an
  **empty string**. The crosswalk `data/local_mayors/kmetstvo_to_ekatte.json`
  (2,989 entries, keyed `"BGS01:зетьово"`) is the resolver. Do not re-derive.
- **company HQ by settlement** (`public/parliament/companies-by-ekatte/{ekatte}-summary.json`,
  used by `CompaniesHqTile`) is **not present in this clone** — 0 files. It is
  generated by the connections pipeline. Treat as unavailable until confirmed.

---

## 3. Data traps found while researching (all three would ship wrong numbers)

**1. The vote-share denominator is not `numValidVotes`.** On Ружинци the party
totals sum to 347 while `protocol.numValidVotes` is 280. `numValidVotes` is
**paper-only**; machine valid votes live in `numValidMachineVotes`. The correct
denominator is `numValidVotes + numValidMachineVotes` — which is what
`ProtocolSummary.tsx` and `SectionsList.tsx` already do throughout the app. Using
the raw field inflates every share by ~24% here and produces a party table
summing to 110%.

**2. Settlement procurement is attributed by BUYER SEAT, not by spend location.**
Ружинци's `procurement_settlement_payloads` total is **€35.17M across 2 awarders**
— for a village of 721. That is the *municipal administration* being seated
there, spending across the whole obshtina. A card captioned "€35 млн. обществени
поръчки в Ружинци" would be flatly misleading. Either caption it as "възложители
със седалище тук" or drop the block for settlements that are an obshtina centre.
(`settlements.json.kmetstvo` ending `-00` marks the centre.)

**3. Matura data is the май–юни session only.** Already handled on `/school/:id`
this session; a card must carry the same qualifier, since the август–септември
retake is not in the МОН table.

A fourth, milder one: **census 2021 vs ГРАО measure different things** —
census = usual residence at a point in time, ГРАО = registered address, and ГРАО
is routinely much higher in depopulated villages. Pick one per card and name it;
never put both on the same card without labels.

---

## 4. Brainstorm — other top-level settlement data we hold

Ordered by (coverage × interest), best first.

**Strong candidates**

1. **EU funds — 3,279 settlements (61%), €17.3bn, 70,700 projects.** The best
   uncovered block by a distance. Ружинци: **13 projects, €2.46M** — €3,400 per
   resident, which is a genuinely striking number for a village of 721. Attributed
   by *Местонахождение*, not HQ, so unlike procurement it really is "money spent
   here". Strongest single addition to the kit.
2. **Turnout + machine share.** Free from the block we already have, and the
   paper/machine split is a distinctive Наясно signal (Ружинци: 58,7% turnout,
   24% of valid votes cast on machines).
3. **Political volatility across 13 elections.** `settlements/{ekatte}_stats.json`
   is a 100%-coverage, unexploited series — "how this village's vote moved since
   2005" is a strong story shape with zero new ingest.
4. **Depopulation.** census 2021 vs ГРАО latest, or census-over-census. For
   Северозападна България this *is* the story, and it is 98% covered.
5. **Age structure as a dependency ratio.** 65+ vs 0–14 in one number. Ружинци:
   172 vs 152 — 1.13 pensioners per child.

**Medium**

6. **Polling sections** — `usePollingSectionsForEkatte` exists; section count and
   the risk/problem-section flags (`data/problem_sections_stats.json`).
7. **Local taxes** — obshtina grain, so it's a parent-tier fact, but a real one
   (5 ИПИ indicators, all 265 общини).
8. **Municipal budget / capital programme** — obshtina grain; 26 oblast centres
   have per-project capital programmes.
9. **Nearest hospital / МВР / water operator** — the `*_geo` tables give a
   distance-to-service story via `loc`. Coverage is thin per-settlement but the
   *distance* derivation is 100%.

**Weak / avoid for now**

10. Prices (245 settlements), land use (national/oblast categories), air quality
    (station-grain, not settlement), NGO density, transparency LISI (obshtina).

---

## 5. Recommended structure — coverage-aware, not one template

The single most important design decision. Three options considered:

- **(a) One fixed template with blank panels** — rejected. Ships an empty
  "graduates" panel on 88% of settlements.
- **(b) N bespoke templates per topic** — rejected. That is just the current
  cardKit with more entries, and loses the "profile of a place" idea.
- **(c) A block registry with a fixed spine + elastic body** — recommended.

**The spine (always renders, 100% coverage):** place name + `т.в.м.` + obshtina ·
oblast, a locator dot on the Bulgaria outline (reuse `renderMapCard`'s
`loadBulgariaGeo`), population, and the parliamentary winner bar.

**The body:** a `PlaceBlock[]` registry where each block declares
`available(ekatte) → boolean` and a `weight`. The renderer takes blocks in weight
order until the canvas budget is spent. A village with no school and no
procurement fills the space with depopulation + vote history instead of leaving a
hole; Ружинци (which has a school, EU funds AND the obshtina seat) has to *drop*
blocks, which is the healthier failure mode.

This also makes the Ружинци post a natural output rather than a special case:
weight the school block up when its value is extreme.

---

## 6. Brainstorm — card designs

All 1080×1080, existing palette, no emojis, EUR only, no sparklines (per
standing preferences). Bars over numbers wherever there is something to compare.

### A. „Профил на мястото" — 2×2 quadrant grid
Spine across the top (name, locator dot, population). Four equal quadrants below,
each one block: demographics pyramid · parliamentary bars · governance · money.
Every quadrant is a different visual form, which is the point — it reads as a
dossier, not a chart.
*Reuses:* bar drawing, map dot. *New:* quadrant layout, pyramid.
**Best default.** Highest information density that stays legible in a feed.

### B. „Възрастова пирамида + вот" — split-screen
Left half: horizontal age pyramid (5 bands × male/female, accent vs cool). Right
half: party bars in party colours from `cik_parties.json`. One caption ties them
("най-възрастното население гласува…").
*Strength:* the two universal blocks, both at full size. Works for all 2,495.
*Weakness:* implies a causal link the data does not support — caption carefully.

### C. „Числата на едно село" — big-number mosaic
5–7 tiles, each one figure + label, sized by importance (one hero at ~140px, the
rest at ~64px). No axes at all.
*Strength:* trivially coverage-elastic — drop a tile, resize the grid. Best fit
for §5's block registry, and the easiest to build first.
*Weakness:* no comparison, so it violates the infographic-bars-by-default
preference unless at least one tile carries a bar.

### D. „Кой управлява" — governance ladder
A vertical ladder: kmet на кметството → кмет на общината → общински съвет
(party-split bar) → мажоритарен депутат / parliamentary winner. Each rung shows
name + party colour, with `personSlug` deep links in the post body.
*Strength:* uniquely ours — nobody else joins kmetstvo mayors to parliament.
*Coverage:* 88% at pop ≥200.

### E. „Парите, които стигат дотук" — money flow
Three stacked bars on one €-scale: EU funds (Местонахождение), procurement
(seat — labelled as such), municipal capital programme. Plus a per-resident
divisor line, which is what makes a village legible against a city.
*Coverage:* funds 61%, so this is a strong-but-not-universal card.
*Requires:* trap #2 handled in the caption.

### F. „Мястото на картата" — locator-led
Bulgaria outline with the settlement as an accent dot, three or four stats
running down the right third. Closest to the existing `renderMapCard`, so cheapest
to ship.
*Use when:* the story is "where", e.g. a Северозапад depopulation post.

### G. „Училището" — the Ружинци card (topical, not a profile)
Purpose-built for this post: the 2,00 in hero type, the 12-examinee cohort, the
five-year school-vs-country line (`renderLineCard` already does this), and a
national context bar — **16 schools at exactly 2,00 in 2026, 17 in 2025, 8 in
2024**. The settlement profile is a *second* card in the same post, not the first.

**Recommended pairing for the Ружинци post:** G as the lead card (the finding),
A or C as the second (the context — a village of 721, 58,7% turnout, €2.46M of EU
projects, a 1,13 pensioner-per-child ratio). The profile card explains the school
without excusing it.

---

## 7. Worked example — с. Ружинци (ekatte 63255), every number verified

| | |
|---|---|
| Place | с. Ружинци, община Ружинци, обл. Видин (NUTS3 BG311), обхщина centre (`kmetstvo VID33-00`) |
| Population (census 2021) | **721** — 357 м / 364 ж |
| Age | 0–14: 152 · 15–29: 103 · 30–44: 95 · 45–64: 199 · 65+: 172 |
| Parliament 2026 | 629 registered, 369 voted — **58,7% turnout**; 347 valid (280 paper + 67 machine, **24% machine**) |
| Winner | **ГЕРБ-СДС 129 (37,2%)**, ПрБ 107 (30,8%), ДПС 55 (15,9%), МЕЧ 18 (5,2%) |
| Mayor (2023) | **Александър Иванов Александров (ГЕРБ)**, elected R1 with 85,5% |
| Council | ГЕРБ 59,55%, 8 mandates |
| School | СУ „Никола Й. Вапцаров" — ДЗИ БЕЛ **2,00 / 12 зрелостници (2026)**, 2,00 / 10 (2025) |
| EU funds | **13 projects, €2,458,875** (≈ €3,410 per resident) |
| Procurement | €35.17M / 2 awarders — **buyer-seat attribution, do not caption as village spend** |

Shares recomputed on the correct denominator (§3 trap 1).

---

## 8. Open questions before building

1. **Does the settlement card ship as a post artefact only, or also as a web
   page?** `/governance/:id` (`MyAreaScreen`) already assembles most of this on
   the site. If the card is a render of an existing page, the block registry
   should be derived from that page's tiles rather than invented alongside them —
   otherwise two copies of "what we know about a place" drift apart. **My
   recommendation: derive from `MyAreaScreen`'s tile list.**
2. **One card or a carousel?** Facebook supports multi-image. §6 assumes 1–2.
3. **Minimum population floor for a card at all** — I would set it at 200
   (2,495 settlements) and refuse below it rather than render a card about 6 people.
4. **Census vs ГРАО as the headline population** — trap 4. Recommend census 2021,
   labelled, because the age and sex breakdown comes from the same table.
5. **Is `companies-by-ekatte` recoverable?** If yes it is a strong seventh block
   (business density per resident); if no, drop it from scope.

---

## 9. Suggested build order (if this proceeds)

1. `placeFacts.ts` — one resolver, `ekatte → PlaceFacts`, with the correct
   denominators and the loc-based school join. Unit-tested against §7. **This is
   the load-bearing step**; every design in §6 consumes it.
2. `renderPlaceCard` design C (mosaic) — cheapest, proves the block registry.
3. Design A (quadrants) on the same registry.
4. The Ружинци post (design G + A) via the `naiasno-post` skill.

Note that step 4 does not depend on 1–3: design G is `renderLineCard` +
`renderStatCard`, both of which exist today. **The post is not blocked on the
card kit.**
