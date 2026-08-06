---
name: settlement-post
description: Draft a Наясно social post about ONE Bulgarian settlement (село / град) — a place-profile card mixing the settlement's own latest figures (population, age, parliamentary vote, mayor, council, matura) with its municipality's context (education, employment, EU funds, procurement, ethnic/religion). Resolves the place, checks it clears the coverage floor, gathers every fact from the right grain, and hands off to naiasno-post for composition and saving. Use when the user asks to post about a village or town, a named school's place, "пост за с./гр. X", a My-Area / governance page, or turns a settlement-level finding (worst matura, highest turnout, fastest depopulation) into a shareable card.
allowed-tools:
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Bash
  - Write
  - WebSearch
  - WebFetch
---

# Наясно — settlement post

One settlement, one card, all **latest** figures (never trends — trends are a
different post). This skill owns the *place* half: resolving the settlement,
proving it is postable, pulling each fact from the grain it actually exists at,
and avoiding the five ways settlement data lies. Composition, the duplicate
check, public-source confirmation and saving the draft all belong to
**`naiasno-post`** — invoke it at Step 8 and do not duplicate its rules here.

Research behind this skill: `docs/plans/settlement-card-kit-v1.md`.

## The one thing to internalise

**Settlement data has a coverage cliff.** Four blocks cover essentially every
settlement; the interesting ones cover 5–16%. A card that assumes otherwise
ships blank panels. Always run Step 2 before writing anything.

---

## Step 1 — Resolve the settlement

`data/settlements.json` is the universe: **5,364 entries**, each with `ekatte`,
`name`, `name_en`, `oblast`, `obshtina`, `nuts3`, `kmetstvo`, `t_v_m` (`с.`/`гр.`)
and `loc` (`"lon,lat"`). Everything downstream keys on **ekatte**.

```bash
node -e "const s=require('./data/settlements.json');console.log(JSON.stringify(s.filter(x=>/NAME/.test(x.name)),null,1))"
```

Names repeat across the country (there are several Ружинци-alikes). If more than
one matches, disambiguate by oblast with the user — never guess.

The latest parliamentary election is `require('./src/data/json/elections.json')[0].name`
— the file is **newest-first**. Do not hardcode `2026_04_19`.

## Step 2 — Eligibility gate (run before any drafting)

Refuse, or warn loudly, when:

- **Population < 200.** 199 settlements have census population 0 and 1,250 have
  1–49. A card about 6 people is not a post. The realistic universe is the
  **2,495** settlements at pop ≥200.
- **The angle needs a block the place doesn't have.** Check coverage in Step 3
  before promising a school / procurement / prices figure.

```bash
node -e "const c=Object.values(require('./data/census_2021_settlements.json'));const r=c.find(x=>x.ekatte==='EKATTE');console.log(JSON.stringify(r))"
```

## Step 3 — Gather the facts, at the right grain

### Settlement grain (`ekatte`)

| Fact | Path | Coverage (pop ≥200) |
|---|---|---|
| Population, 5 age bands, male/female | `data/census_2021_settlements.json` | 2,495 / 2,495 |
| Registered population (ГРАО) | `data/grao_population.json` → `.settlements` | 2,489 |
| Parliamentary result, turnout, paper/machine | `data/<latest>/settlements/<ekatte>.json` | **100%** |
| Party names + colours | `data/<latest>/cik_parties.json` | 100% |
| Vote history, 13 elections | `data/settlements/<ekatte>_stats.json` | 100% |
| Local council trend by cycle | `data/local_place_trends/s/<ekatte>.json` | 2,153 |
| Kmetstvo mayor | `data/local_mayors/kmetstvo_to_ekatte.json` + `data/2023_10_29_mi/municipalities/<obshtinaCode>.json` | 2,185 |
| Matura school | `data/schools/index.json` (loc join, below) | **297 — 12%** |
| Procurement (buyer seat) | PG `procurement_settlement_payloads` | **870 nationally** |
| EU funds | PG `fund_projects.ekatte` | 3,279 nationally |
| Prices | PG `price_grid_days.ekatte` | 245 nationally |

### Municipality grain (`obshtina` code) — 265 of 265, always available

| Fact | Path |
|---|---|
| Ethnic, mother tongue, religion, education, employment | `data/census/municipalities/<CODE>.json` |
| Mayor, council seats, kmetstva | `data/2023_10_29_mi/municipalities/<CODE>.json` |
| Socioeconomic index (SES) | `data/education/school_context.json` → `byObshtina` |
| EU funds, procurement | PG, summed over the obshtina's ekatte list |

**This band is the reliable half of the card.** Unlike the school and
procurement blocks, it renders for every settlement in Bulgaria.

```bash
psql "postgres://postgres:postgres@localhost:5433/electionsbg" -t -A -F' | ' -c "
select count(*), round(sum(coalesce(total_eur,0))::numeric,0) from fund_projects where ekatte in ('…');"
```

### Two joins with no key

- **school → ekatte.** `data/schools/index.json` has no ekatte. **837 of 994
  school `loc` values are byte-identical to a settlement centroid**, so join on
  the `loc` string first; fall back to `useNearestSettlement` for the ~157
  geocoded to a real address. **Never join on name** — 149 school addresses match
  an ambiguous settlement name and 153 match none.
- **kmetstvo → ekatte.** `kmetstva[].ekatte` in the local-election bundles is an
  **empty string**. Use `data/local_mayors/kmetstvo_to_ekatte.json` (2,989
  entries, keyed `"<OBSHTINA>:<lowercase kmetstvo name>"`). Do not re-derive it.

---

## Step 4 — The five traps. Check every one, every time.

**1. The vote-share denominator is not `numValidVotes`.**
That field is **paper-only**. Machine votes are in `numValidMachineVotes`.

```
validTotal = protocol.numValidVotes + protocol.numValidMachineVotes
```

On Ружинци the party totals sum to 347 against a `numValidVotes` of 280 — using
the raw field inflates every share by ~24% and yields a table summing to 110%.
`ProtocolSummary.tsx` and `SectionsList.tsx` already do it correctly; match them.

**2. Settlement procurement is attributed by BUYER SEAT, not spend location.**
Ружинци reads €35.17M for 721 residents because the municipal administration is
seated there. **Report procurement at MUNICIPALITY grain**, where "buyers seated
in this obshtina" is exactly true. If it must appear at settlement grain, the
label is "възложители със седалище тук" — never "поръчки в селото".
EU funds are the opposite: `fund_projects` is attributed by *Местонахождение*,
so it genuinely is money spent there, at either grain.

**3. Matura is the май–юни session only.** The август–септември retake is not in
the МОН table. Any matura claim carries "сесия май–юни". In a *cell* there is no
room for it — put it in the `source` line (`… НСИ, МОН · матура май–юни`), which
is full width. The source is bounded against the CTA, so keep it under ~700px or
it elides.

**3b. НВО carries NO cohort count.** `nvoByYear` has `bel`/`math` points and no
`n`, unlike `countsByYear` for ДЗИ. So an НВО figure cannot be sized, and in a
small school it swings wildly on a handful of pupils — Малко Търново went
38,74 → **9,44** on maths between 2025 and 2026. **Do not print an НВО score for
a small school**; the ДЗИ figure at least reports its examinees.

**4. Census age and sex are NOT cross-tabulated.** `census_2021_settlements.json`
gives `age` (5 bands) and `gender` (male/female) as separate totals. **A
two-sided population pyramid split by sex is fabrication.** Draw age one-sided
and sex as its own split bar.

**5. Two denominators that don't reconcile, both at municipality grain.**
- `education` sums to a smaller base than `population` (Ружинци: 3,091 vs 3,299)
  — the census tabulates education over a restricted age range. Compute shares
  over the education sum, not the population.
- `religion` carries very high non-response — Ружинци: **18,3%** across
  `cantDetermine` + `dontWantAnswer` + `unknown`, the second-largest segment.
  Either show the non-response segment explicitly or drop religion. Never
  normalise it away.

A sixth, milder one: **census 2021 vs ГРАО measure different things** (usual
residence vs registered address, and ГРАО runs much higher in depopulated
villages). Pick one per card and name it. Prefer census, since the age and sex
breakdown comes from the same table.

---

## Step 5 — The settlement mayor has three states

Do not assume one mayor per settlement.

1. **Own кметство** → two rows: `кмет на кметството` (from the `kmetstva` array,
   the candidate with `isElected`) and `кмет на общината`.
2. **No separate кметство** (kmetstvo code ends `-00`) → **one merged row**,
   labelled "кмет на селото и на общината". Printing the same person twice reads
   as a rendering bug. Note `-00` means "no kmetstvo of its own", **not** "is the
   obshtina seat" — in община Ружинци, Динково and Роглец are also on `-00` and
   neither is the seat.
3. **Not in the crosswalk** (settlements outside the 2,989) → obshtina mayor
   only, labelled as such.

Every mayor row carries name, party, and the elected share as a bar
(`mayor.elected` / the `kmetstva[].candidates[]` entry with `isElected`).

---

## Step 6 — The card

### Zones (the agreed design)

Settlement grain, 2×2:

| Zone | Form |
|---|---|
| ХОРАТА | population hero + 5 age bands as horizontal bars + sex split bar |
| ПАРЛАМЕНТАРЕН ВОТ | turnout as a filled track + ranked party bars in real `cik_parties.json` colours |
| УПРАВЛЕНИЕТО | mayor row(s) with elected-share bar + council seat bar |
| the fourth | matura, or EU funds when there is no school |

Then a full-width **municipality band** with its own rule, label and population
(`ОБЩИНА X · N ЖИТЕЛИ`). **The band header is what makes mixing two grains
honest** — the reader must never be in doubt which grain they are reading.

The band has **two forms, and they STACK** — pass either or both, under one
header.

- **`cells` — the profile form.** Up to **four** cells: EU funds, procurement,
  a matura cell where the settlement has a school, and a first cell that is
  **education+employment or ethnic composition, whichever the operator picked in
  Step 7**. Ask before you build the band; do not fill that cell on your own
  judgement.
  **A 4th cell is free vertically** — cells divide the width, not the height —
  but it takes every cell from 316px to 226px (186px inner), so all four labels
  and notes must be short. Measured: `матура БЕЛ` / `2,41` / `при 4,33 за
  страната` fits; `17 зрелостници · 4,33 страната` elides even at the 15px
  floor. Put what does not fit in the post copy, not in a smaller font.
- **`benchmarks` — the comparison form.** Up to four full-width rows, each
  measuring this municipality against a national reference: a bar for the
  place, a **tick** for the reference, the value right-aligned, and an optional
  `note` for a rank. Use it when the post's claim is *"this place beats its
  peers"* rather than *"this is what this place looks like"*.

**Prefer both to either.** The cells carry the magnitudes (`20,70 млн. €`,
`54 проекта`) and the benchmarks carry the ranking of those magnitudes — a
card with only benchmarks tells the reader this place is №1 without ever saying
№1 at *what size*, and a card with only cells gives a number with nothing to
judge it against.

**Every governance KPI is municipality-grain, so it belongs in the band and
nowhere else.** Procurement competition, EU-funds capacity, project density and
execution are all properties of the общинска администрация, not of the
settlement — putting them in the 2×2 grid puts a municipality number under a
settlement heading, which is the exact confusion the band exists to prevent.

`value` and `reference` must be in the **same units** — the row derives its
scale from the pair, so a share against a count silently rescales into
nonsense. Both labels are pre-formatted BG strings; the renderer never formats a
benchmark number, because only the caller knows whether it is a percentage, a
euro figure or a rate per 1 000. Nothing is colour-coded good/bad: the bar
passing the tick or falling short of it is the whole message, and the direction
belongs in the label and the copy.

**The band trades against the grid, so pick the canvas first.** A benchmark row
costs 68px, a cells row 132px, and a zone needs 268px. `format` decides how much
there is to spend:

| `format` | canvas | what fits |
|---|---|---|
| `"square"` (default) | 1080×1080 | 4 zones + **either** 3 cells **or** 2 benchmark rows |
| `"portrait"` | 1080×1350 | 4 zones + 3 cells + **3 benchmark rows** |

**Reach for `portrait` as soon as the band carries both forms** — the full card
does not fit a square, and 1080×1350 is Facebook's tallest uncropped feed ratio
(4:5), so it costs nothing and gains feed height. Anything taller than 4:5 is
cropped in feed, which is why there is no third option.

Portrait buys 270px, not a licence to stack everything: four zones + cells +
**four** benchmark rows is still 263px a zone and throws. Drop to three
benchmark rows (fold two rows that tell the same story — "еднооферни поръчки"
and "средно оферти на поръчка" are one claim about competition), or drop a zone.

Ranks and medians are computed over the **265 общини** — fold Sofia's 24 `S**`
district codes into one Столична община and drop the six abroad pseudo-codes
(`OC`/`EU`/`NA`/`SA`/`AS`/`AF`), or the universe comes out at 272 and the
denominator in the caption is wrong.

### Marks must be count-independent

**No dot-per-unit rows.** They bleed at a 61-seat Sofia council or a 183-pupil
cohort. Use:

- **Council** → segmented proportional bar, seat counts written inside the
  segments, a majority line at ⌊n/2⌋+1.
- **Matura** → a dumbbell on the fixed 2–6 grade axis: school marker, country
  marker, the gap annotated. Position encodes the grade, never the cohort size,
  so it renders identically at 12 or 183.

### What you may NOT draw

**A pass/fail split of a cohort.** `schools/index.json` carries only
`(count, mean)` per school — never a grade distribution. "All 12 got a 2" is
derivable *only* because the mean sits on the floor of the scale (Слаб 2). For a
school at 4,33 we have no idea how many failed, so a pass/fail bar is honest on
~16 schools a year and fabricated on the other 978.

### The renderer — `renderPlaceCard`, and NOTHING ELSE

`scripts/posts/cardKit.ts` exports `renderPlaceCard`. A card spec carrying a
**`place`** key routes to it (`post_tool.ts` checks `place` FIRST, before
`bars`). That discriminator is the whole contract.

**Never build a settlement post out of `renderBarCard` / `renderStatCard`.**
An earlier version of this skill said to, as a stopgap, and the result was a
post about с. Ружинци that published a national ranking of schools — a correct
chart, an entirely different card from the one this skill specifies. If a zone's
data is missing, DROP THE ZONE; the grid lays out whatever is present (see
below). Falling back to a different renderer is never the fix.

Spec shape — every zone optional, `place` and `source` required:

```jsonc
"card": {
  "place":  { "name": "с. Ружинци", "context": "община Ружинци · област Видин" },
  "people": { "total": "721", "totalLabel": "жители\nпреброяване 2021",
              "ageBands": [{ "label": "0–14", "value": 152 }, …],
              "sex": { "male": 357, "female": 364,
                       "maleLabel": "357 мъже", "femaleLabel": "364 жени" } },
  "vote":   { "title": "Парламентарен вот 2026", "turnoutPct": 58.7,
              "turnoutNote": "369 от 629 избиратели",
              "parties": [{ "label": "ГЕРБ-СДС", "value": 37.2,
                            "color": "rgb(12, 69, 135)" }, …],   // ≤4
              "note": "347 валидни гласа · 24% с машина" },
  "government": { "mayors": [{ "role": "…", "name": "…", "note": "ГЕРБ · първи тур",
                               "pct": 85.5, "color": "…" }],      // ≤2, see Step 5
                  "council": { "label": "общински съвет · 11 мандата",
                               "seats": [{ "label": "ГЕРБ", "value": 8 }, …],
                               "majorityLabel": "мнозинство 6" } },
  "focus":  { "title": "Матурата по БЕЛ", "value": "2,00",
              "valueNote": "среден успех · 12 зрелостници",
              "scale": { "min": 2, "max": 6, "value": 2, "reference": 4.33,
                         "valueLabel": "2,00", "referenceLabel": "4,33 страната" },
              "caption": "…", "captionNote": "сесия май-юни 2026" },
  "municipality": { "label": "община Ружинци · 3 299 жители",
                    "cells": [ { "label": "безработица", "value": "44,2%",
                                 "note": "заетост 22,9%" },
                               { "label": "етнически състав",
                                 "split": [{ "label": "българи", "value": 81.4, "color": "…" }, …],
                                 "splitCaption": ["българи 81,4%", "роми 15,3%"] } ] },  // ≤3
  // …and/or, in the SAME band, the comparison form (≤4 rows, 68px each):
  "municipality": { "label": "община Малко Търново · 2 628 жители",
                    "cells": [ … ],                        // magnitudes
                    "benchmarks": [ { "label": "еднооферни поръчки на общината",
                                      "value": 28.0, "valueLabel": "28,0%",
                                      "reference": 43.4,
                                      "referenceLabel": "43,4% средно за страната",
                                      "note": "107 договора от 2020" }, … ] },
  "format": "portrait",   // needed whenever the band carries BOTH forms
  "source": "Източник: МОН, ЦИК, НСИ, ИСУН",
  "cta": "виж училището"
}
```

Notes that are load-bearing:

- **Party colours come from `data/<latest>/cik_parties.json` verbatim** — pass
  the raw value, `safeColor()` resolves it. The file mixes `rgb(…)`, hex,
  three-component `rgba(…)` (valid: CSS Color 4 aliases rgba to rgb with
  optional alpha) and bare CSS names like `lightslategrey`; all four are
  accepted as-is. What `safeColor()` is really for is the ABSENT or unparseable
  case: canvas keeps the previous fillStyle rather than throwing, so an
  unresolved colour paints a bar in the last party's colour and looks
  deliberate. Never pass a colour field straight to `fillStyle`.
- **`focus` is the zone that varies.** Matura when the settlement has a school
  (12%), EU funds otherwise. It is the fourth zone, and the one the post is about.
  **Having a school does not oblige you to print its matura** — on a
  governance-money post, a weak school result in the same frame is a different
  story with no causal link (Малко Търново, 2026-08-06: 2,41 БЕЛ beside a №1
  funds ranking). That is the operator's call, so ask; do not decide it silently
  in either direction.
- **A `focus` with no `scale` puts its caption under the value, not at the zone
  foot** — otherwise a money hero leaves ~150px of void that reads as a zone
  that failed to load. Keep `captionNote` short; it is one line and elides.
- **The renderer refuses rather than garbles**: no zones at all throws, and so
  does a grid squeezed below **268px** a zone. Drop a zone or shorten the band.
  That floor read 190 until 2026-08-06 and was a lie — it passed a 202px grid
  that overprinted the age bands, the party rows and the mayor's note onto the
  council label. 268 is derived: the `people` zone spends 168px on the hero, the
  sex split and its padding, and five age bands need 20px of pitch each.
- Always `Read` the rendered PNG before showing the operator — check for
  overlapping rows as well as tofu boxes.

---

## Step 7 — Editorial guardrails

### Ethnic composition — ALWAYS ASK, never decide silently

`data/census/municipalities/<CODE>.json` carries `ethnic` (bulgarian / turkish /
roma / other / unknown) and `religion` for all 265 municipalities, so the data is
always there and the choice is always live. **It is the operator's call, not
yours.** Do not include it on your own judgement, and do not quietly drop it
either — both are decisions the operator owns.

Ask once, with `AskUserQuestion`, before composing — as soon as the municipality
band has facts in it:

> **header** `Ethnic data`
> **question** Include the municipality's ethnic composition on this card?
>
> 1. **Education + employment** *(Recommended)* — swap in the same census
>    table's education and unemployment figures instead. Carries more
>    explanatory weight for a school or turnout story and makes no ethnic claim.
> 2. **Include ethnic composition** — show ethnic shares beside the other
>    finding. Be aware the layout implies a link the data does not support.
> 3. **Ethnic composition is the subject** — the post is *about* the ethnic
>    picture, not about another finding that happens to sit next to it.

**Give the operator the reason with the question, not instead of it.** The
concern is the juxtaposition, not the data: a Roma share in the same frame as a
failing school, a low turnout or a crime figure makes an ethnic causal claim
without a word being written, because the layout supplies the framing the caption
avoids. Наясно's rule is to let the number be the point with no framing. On the
merits, education + employment usually explains more (Ружинци: 44,2%
unemployment, 7,4% tertiary) and claims only what the data supports.

If they choose 2 or 3, build it — that is a legitimate editorial choice and the
figures are sound. Then still apply the rest of this step: no causal caption, and
show the `без отговор` segment rather than normalising it away (trap 5).

Also:
- **No causal claims across zones.** Age structure beside a vote result, or SES
  beside a school result, must not be captioned as explanation. State both; let
  the reader connect them.
- Never name pupils, and never name a school in a way that reads as blaming its
  teachers. The `/school/:id` page's own framing — "данните са начало на
  разговор, не присъда" — is the register to match.
- Non-partisan, no emojis, EUR (not BGN), natural Bulgarian.

---

## Step 8 — Hand off to `naiasno-post`

Invoke the `naiasno-post` skill with the assembled facts. It owns: the duplicate
check (`post_tool.ts check`), public-source confirmation (rule 2), BG/EN copy,
`post_tool.ts save`, and the review step. Deep link is `/governance/<ekatte>`
for the place, `/school/<id>` when the post is about the school.

**The card spec is the ONE thing that does not transfer.** `naiasno-post` says
"default to the infographic (bar) card" — that instruction is for its own posts
and does NOT apply here. A settlement post always renders `renderPlaceCard` via
a `place` key, per Step 6. Say so explicitly when handing off, or the bar-card
default wins and you publish a chart instead of a profile.

Pass it: every figure with its dataset path, the traps you resolved, the grain
of each number, and the finished `place` card spec.

---

## Worked example — с. Ружинци (ekatte 63255), all verified 2026-08-04

**Settlement (721 residents, census 2021)**

| | |
|---|---|
| Place | с. Ружинци, община Ружинци, обл. Видин · `kmetstvo VID33-00` |
| Age | 0–14: 152 · 15–29: 103 · 30–44: 95 · 45–64: 199 · 65+: 172 |
| Sex | 357 м / 364 ж |
| Parliament 2026 | 629 registered, 369 voted — 58,7% turnout; **347 valid** (280 paper + 67 machine, 24% machine) |
| Result | ГЕРБ-СДС 129 (37,2%) · ПрБ 107 (30,8%) · ДПС 55 (15,9%) · МЕЧ 18 (5,2%) |
| Mayor | Александър Иванов Александров (ГЕРБ), 85,5%, first round — serves the village directly (no separate кметство) |
| Council | 11 mandates — ГЕРБ 8, МК НДСВ (ДПС, ЗНС) 3; majority 6 |
| School | СУ „Никола Й. Вапцаров" — ДЗИ БЕЛ **2,00 / 12 зрелостници (2026)**; 2,00 / 10 (2025); country 4,33 |
| EU funds | 13 projects, €2,458,875 |

**Municipality (3,299 residents)**

| | |
|---|---|
| Education (base 3,091) | висше 7,4% · средно 48,8% · основно 26,4% · начално и по-ниско 17,3% |
| Employment | активност 41,1% · заетост 22,9% · **безработица 44,2%** |
| Ethnic | българи 2,687 (81,4%) · роми 504 (15,3%) · турци 7 · без отговор 101 (3,1%) |
| Religion | християни 2,413 (73,1%) · без религия 279 (8,5%) · **без отговор 605 (18,3%)** |
| EU funds | 26 projects, €4,154,690 — €1,259 per resident |
| Procurement | €35,250,478, 3 buyers seated in the obshtina — €10,685 per resident |

National context for the matura angle: schools with a БЕЛ mean of **exactly
2,00** — 8 in 2024, 17 in 2025, **16 in 2026** (computed from
`raw_data/indicators/mon/<year>.csv`). Confirmed publicly for 2025 by
[ИПИ](https://ime.bg/articles/v-nad-200-uchilishta-uspehyt-na-maturata-po-bel-e-slab-v-blizo-20-vsichki-sa-s-chista-dvojka/)
and Novinite (both report 17).

---

## The national matura average has two values — use ours, and say what it is

**Both are right; they are different statistics.** Resolved 2026-08-04.

| | statistic | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| ours | examinee-weighted mean of individual **GRADES** | 4,3008 | 4,2115 | **4,3268** |
| МОН headline | the grade attached to the national mean **POINTS** | 4,32 | 4,27 | **4,39** |
| gap | | +0,019 | +0,059 | +0,063 |

МОН leads with points and quotes the grade as its counterpart — 2026: "60 т. …
Добър 4,39"; 2025: "57,53 точки … 4,27". Ours aggregates the per-school
open-data table, which publishes `(Бр. БЕЛ, Ср.усп. БЕЛ)` and **no points
column at all** — so МОН's figure is not derivable from the dataset we ingest,
and ours is not derivable from their headline. `mean(grade) ≠ grade(mean points)`
for any nonlinear points→grade scale, and the ДЗИ scale is a band table.

Not a pipeline fault and not a population mismatch: `scripts/db/load_schools_pg.ts`
weights correctly (`sum += s * c`), reproduced independently from
`raw_data/indicators/mon/2026.csv` at 4,3268 over **49,034** examinees / 974
schools, against МОН's own ~50,000 — and the fetcher takes the май–юни resource
only, skipping the retakes and the "по желание" exams.

**The rule.** Quote **4,33** and name the basis — "средно за страната по данни
на МОН по училища". Never print 4,39 beside a school figure from this table:
the school numbers are grades, so a points-derived national grade is a different
scale on the same axis. Both support "far below the national average", so no
post is blocked by the choice.

## Known unresolved

- **974 vs 783 schools.** Our 2026 file lists 974 schools with a БЕЛ figure;
  one outlet reports 783 schools sitting the exam. Probably a different counting
  basis, not established. It does not move the average (examinee counts agree to
  ~2%), but do not quote a school COUNT from this table as "schools in Bulgaria".
- **The exact ДЗИ points→grade scale.** `mon.bg`'s scale page 403s and the
  published tables are images. Without it the gap cannot be decomposed into
  scale nonlinearity vs a residual population difference — only bounded, which
  the three-year table above does.
