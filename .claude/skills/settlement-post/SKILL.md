---
name: settlement-post
description: Draft a Наясно social post about ONE Bulgarian settlement (село / град) — a place-profile card mixing the settlement's own latest figures (population, age, parliamentary vote, mayor, council, matura) with its municipality's context (education, employment, EU funds, procurement, ethnic/religion). Resolves the place, checks it clears the coverage floor, gathers every fact from the right grain, and hands off to naiasno-post for composition and saving. Use when the user asks to post about a village or town, a named school's place, "пост за с./гр. X", a My-Area / governance page, or turns a settlement-level finding (worst matura, highest turnout, fastest depopulation) into a shareable card.
allowed-tools:
  - Read
  - Grep
  - Glob
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
the МОН table. Any matura claim carries "сесия май–юни".

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
(`ОБЩИНА X · N ЖИТЕЛИ`): education+employment, EU funds, procurement.
**The band header is what makes mixing two grains honest** — the reader must
never be in doubt which grain they are reading.

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

### What exists today

`scripts/posts/cardKit.ts` has `renderStatCard`, `renderBarCard`,
`renderLineCard`, `renderTableCard`, `renderAnnounceCard`, `renderMapCard`.
**There is no composite `renderPlaceCard` yet.** Until there is, build a
settlement post from `renderBarCard` (age bands, party shares, council) plus
`renderStatCard`, per `naiasno-post`'s card rules — and prefer the bar card, as
that skill requires.

---

## Step 7 — Editorial guardrails

**Ethnic composition is available and is usually the wrong block.** It exists for
all 265 municipalities (`ethnic`: bulgarian / turkish / roma / other / unknown).
Putting a Roma share in the same frame as a failing school, a low turnout or a
crime figure makes an ethnic causal claim without writing a word of it — the
layout supplies the framing the caption avoids. Наясно's own rule is to let the
number be the point with no framing.

Use ethnic composition when it **is** the subject of the post. As ambient
context beside another finding, use **education + employment instead**: it comes
from the same census table, carries more explanatory weight (Ружинци: 44,2%
unemployment, 7,4% tertiary), and makes a claim the data actually supports.

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
the card spec shape, `post_tool.ts save`, and the review step. Deep link is
`/governance/<ekatte>` for the place, `/school/<id>` when the post is about the
school.

Pass it: every figure with its dataset path, the traps you resolved, and the
grain of each number.

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

## Known unresolved

**The national matura average has two values.** Our raw МОН file gives **4,33**
examinee-weighted over 49,034 examinees, and `/education` displays 4,33. МОН's
own press line and the outlets repeating it say **4,39**. The gap is not
explained — possibly a different session or examinee filter. `naiasno-post`
rule 2 requires confirming the headline against the primary source, so **resolve
this before any post that uses the national average as a reference**, and prefer
naming our figure and its basis over quoting a number we cannot reproduce.
