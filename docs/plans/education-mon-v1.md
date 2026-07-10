# Образование (МОН) — education entity + equity explorer (v1, moonshot)

**Status:** planning · **Owner:** —  · **Route:** `/awarder/000695114` (+ `/school/:id`, `/education*`)
**Goal:** the world's best public education-data view for Bulgaria — not a data dump. The
through-line of every world-class education dashboard is one rule: **never rank raw scores
nakedly.** Contextualize by socioeconomics, measure growth not just level, lead with equity
gaps, let people find *their* school on a map, and refuse the single seductive number.

This plan turns МОН into the equity-and-outcomes lens on Bulgarian schooling, riding the
existing sector-pack pattern (like НЗОК/НОИ/АПИ) plus a new school-level explorer.

---

## 0. Starting position (audited 2026-07-09 against the working tree)

Already in the repo (no new work):

| Asset | Path | Note |
|---|---|---|
| МОН budget law-vs-execution | `data/budget/ministries/admin-ministerstvo-na-obrazovanieto-i-naukata.json` | EIK `000695114`, 2018–2026, admin+program grain, €350M / 866 procurement contracts |
| МОН is a real awarder | `data/procurement/derived/flow.json` | `awarder:000695114`. **Single EIK, no ВСС-style alias split** — but its corpus label is the stale legacy name ("Министерство на образованието, младежта и науката /МОМН/…"); the pack must supply its own display name. |
| Per-school ДЗИ | `data/schools/index.json` (344 KB) | 978 schools · 242 общини. **See §2.0 — thinner than it looks.** |
| Schools hook | `src/data/schools/useSchools.tsx` | `SchoolRecord` *declares* `type?`/`loc?` but **0/978 rows populate them**. Sofia = one `SOF00` bucket of 156 schools, no per-район. |
| Per-obshtina ДЗИ indicator | `data/indicators/<obshtinaCode>.json` + `useIndicators` | a `dzi` series inside **every** obshtina file (alongside `unemployment`, `populationChange`, …). *(Earlier drafts wrongly cited `MON*.json` — `MON02` is **Montana**, an obshtina code, not МОН.)* |
| SES raw material | `data/census/`, `data/indicators.json`, `data/regional.json`, `data/grao_population.json`, `--local-problem-sections` risk-sections | enough to build a BG-ICSEA context index |
| Peer-compare UI | `/indicators/compare` `?peers=` | reuse verbatim for PISA/spend vs RO/GR/HR/EU |
| Money layers | budget · ИСУН EU-funds · procurement · `data/budget/municipal_transfers/` | the money-trail spine no education portal on earth has |

### The template to copy: ВСС / `/judiciary`, not НЗОК
There are now **five** sector packs (`sectorPacks.tsx`): roads, НОИ, НЗОК, ДФЗ, **ВСС**. The
judiciary is the newest and is the *exact* shape this plan proposes — a top-level screen **plus**
an awarder pack **plus** AI tools **plus** an ingest skill, fully SEO-wired:

| Layer | Judiciary (copy this) | Education (build this) |
|---|---|---|
| Pack | `src/screens/components/procurement/vss/VssPack.tsx`, `src/lib/vssReferenceData.ts`, `src/data/procurement/useVss.tsx` | `mon/MonPack.tsx`, `monBenchmarks.ts`, `useMonData.tsx` |
| Registry | `[VSS_EIK]: VssPack` | `[MON_EIK]: MonPack` |
| Top-level screen | `src/screens/judiciary/JudiciaryScreen.tsx`, route `judiciary` (`routes.tsx:1324`, inside `<LayoutScreen>`) | `src/screens/education/EducationScreen.tsx` |
| SEO | `INSTITUTION_PACKS` entry (`eik 121513231`, slug `vss`, `ogAnchor '[data-og="vss-bridge"]'`) + `routeDefs` + `ENGLISH_STATIC_PAGES` + an OG `captures[]` entry (`waitFor '[data-og="judiciary-caseload"] .recharts-surface'`) | same five touchpoints (§11) |
| AI | `ai/tools/judiciary.ts` | `ai/tools/education.ts` |
| Ingest | `.claude/skills/update-judiciary/`, `data/judiciary/*.json` | `.claude/skills/update-schools/` |

Read the judiciary implementation before writing a line of МОН code.

---

## 1. Competitive frame (what we're stealing, one line each)

- **Australia MySchool / ICSEA** — the #1 pattern: judge each school against ~SES-similar
  peers, colour cells green/red vs *similar* not vs national. "Над очакваното за средата си."
- **Stanford SEDA / Educational Opportunity Project** — the killer visual: two scatterplots,
  same x-axis (context). SES→*level* is a steep diagonal (wealth buys the starting line);
  SES→*growth* is a flat blob (wealth barely predicts how fast kids learn). Proves value-added
  without a word of statistics. Never collapse **ниво / растеж / тренд** into one number.
- **UK Progress 8 / FFT Datalab** — value-added + five plain bands + confidence intervals;
  ~a third of units land in "неразличимо от типичното" *by design*. "The data is the
  starting point, not the conclusion."
- **Chile MIME / Categoría de Desempeño** — ordinal category (над/близо/под очакваното),
  peer-group cohorting, disclosed recipe, proximity-first parent search.
- **India ASER** — the can-do sentence: "X% от завършващите не покриват задължителната
  матура по БЕЛ" beats a mean score.
- **India UDISE+ / Brazil QEdu** — standardized per-school report card; dual entry (browse
  national→oblast→община→school *or* jump by school code); traffic-light anchored to a named
  target; slugged shareable per-school URLs (helps our SEO-discovery gap).
- **ProPublica Miseducation / EdBuild** — lead with the *gap* (rural vs urban, Roma-neighborhood
  vs rest) as the headline choropleth; self-lookup is the virality lever.
- **Ethics cautionary tales** — Ofsted/Ruth Perry, LA Times teacher-VAM/Ruelas, Campbell's Law:
  no single word/number verdict; publish uncertainty; celebrate over-performers, don't shame
  poor-intake schools. Baking the ethics in *is* a marketing moat (the "responsible" explorer).

Incumbents we beat: **regionalprofiles.bg** (oblast-grain only, annual PDF), **rsvu.mon.bg**
(higher-ed, locked UI), **НСИ** (dry tables), **danybon/nvoresults/klasirane** (naked league
tables — the anti-pattern).

### 1b. UI/UX craft to steal (best-in-world, beyond the metric framing)
The features above are *what* to show; these are *how*, to make it feel best-in-class:

- **OWID chart/map/table triad** (`ourworldindata.org`) — one dataset, three views toggled top-left,
  each keeping only its own controls top-right; a separate "edit entities" picker; **deep-linked,
  shareable state where the social-card preview reflects the current selection/timespan/tab.** This
  is the core interaction shell for *every* education metric page; it's view-switching (compatible
  with `feedback_no_tabs_ux` — not section-navigation). Reuse and extend the site's `?`-URL contract.
- **SEDA / Hyperobjekt linked hover** — hover a dot in the SES scatter → its oblast lights on the
  map, and vice versa. The linked-highlight is the interaction that makes "level vs context" click.
- **GOV.UK "Compare school performance"** — the a11y + search floor: multi-modal finder (name OR
  settlement OR oblast OR EKATTE), keyboard/screen-reader-first, no-JS fallback, plain language.
- **Chile MIME** — parent-first warmth: **proximity-first default ("училища близо до мен")** + a
  **saved shortlist** to compare candidates. A counterweight to the analyst-grade scatter.
- **NYT Upshot "Money, Race and Success"** — the within-entity gap as a *connector line* (e.g.
  град vs село, or 7-клас НВО vs 12-клас ДЗИ) — but heed the critique: always pair the pretty
  scatter with a **list/compare mode** so it isn't one-entity-at-a-time.
- **EdReports traffic-light report card** (`edreports.org`) — a per-item scorecard with a memorable
  headline badge ("all-green"); **make the rating a noun people cite, and publish the rubric openly**
  (its credibility gap is the cautionary tale — show sub-scores, not just the aggregate light).
- **Cross-cutting:** traffic-light + a plain-language label on every index (never a raw number);
  "learn about this data" provenance overlay one click from every chart (matches the source-first
  brand); animated tweens between metrics so users track entities; **mobile as the primary viewport**
  (empty/loading/mobile are designed states, not afterthoughts).

---

## 2. Data foundation (the hard part; everything downstream is a query)

### 2.0 Reality check — what the schools index actually contains
Measured, not assumed:

| Fact | Value | Consequence |
|---|---|---|
| Schools · общини | 978 · 242 | fine |
| Years **in the built index** | 2024, 2025 only | a parser artifact, **not** a source limit — see §2.0b |
| Years **available upstream** | **2022, 2023, 2024, 2025, 2026** (verified 2026-07-09) | a 5-year ДЗИ series is within reach, incl. an un-ingested **2026** |
| `dzi_bel` rows | 1,928 | the only broadly-covered metric |
| `dzi_math` rows | **195** | ДЗИ математика is an elective 2nd matura — too sparse for a math lens |
| `nvo_bel` / `nvo_math` rows | **0 — never ingested** | the subject slots exist; the data does not |
| `loc` populated | **0 / 978** | no map is possible today |
| `type` populated | **0 / 978** | the level/type facet cannot work today |
| enrollment | absent from the index | no dot-size, no €/ученик |
| Sofia | one `SOF00` bucket, 156 schools | no per-район drill |

### 2.0b Why the index has 2 years when 5 exist (root-caused 2026-07-09)
Not the cache corruption. Two parser limits in `scripts/schools/build_index.ts`:
1. **`YEARS = [2023, 2024, 2025]` is hardcoded (L34)** → 2022 and 2026 are never read.
2. **Header drift defeats `parseYearCsv`.** It requires `/код по неиспуо/`, but
   **2022 and 2023 label that column `"Код по Админ"`** → `schoolIdIdx = -1`. 2023 additionally
   uses a **three-row header** (row 1 = subject, row 2 = `З`, row 3 = `Бр.`/`Ср.усп.`), and 2022
   has a **double space** in `"Ср.усп.  БЕЛ(ООП) З"`. All three variants return `[]` → the year is
   skipped with only a `console.warn`.

**Fix (P1):** widen `YEARS` and normalize the header variants (`Код по Админ|НЕИСПУО`,
whitespace-collapse, three-row header flattening). That alone **unlocks 2022–2026 = five years of
ДЗИ БЕЛ**, which makes a legitimate multi-year trend and school-level growth rate computable from
ДЗИ alone. Guard: `build_index` aborts on a *total* parse failure (`years.length === 0` →
`exit(1)`), but a *partial* failure only warns — so a silently degraded index is possible. Add a
per-year expected-row-count assertion.

**Three consequences that reshape the plan:**

1. **The SEDA двойна scatter is gated on §2.0b, not on the SES index.** With the header fix it
   becomes computable from a 5-year ДЗИ series (growth = trajectory vs context). НВО remains the
   gold standard for *true* prior-attainment value-added, but is no longer the only path to a
   growth axis.
2. **НВО ingest is still load-bearing** — the only route to a second broadly-covered subject *and*
   to the Progress-8-style prior-attainment baseline (§2.1). Just not the sole blocker.
3. **Ethics guardrails (confidence intervals, small-N suppression) had no data source named** —
   until §2.2 below. Without cohort size they are unimplementable, and they are the whole moral
   spine of the product.

### 2.1 НВО ingest — now the critical path, and the door to real value-added
Reuse the proven ДЗИ pipeline (`scripts/schools/build_index.ts`, `scripts/indicators/sources/mon_dzi.ts`);
same data.egov.bg org, same formats, and the `nvo_bel`/`nvo_math` slots already exist.

**The prize the earlier draft missed:** НВО is sat in **7th grade**, ДЗИ in **12th** — a 5-year
lag. That is structurally identical to the UK's KS2→KS4 baseline behind **Progress 8**. Ingest
НВО back ≥5 years and we can compute a genuine **school-level value-added** score — *"this school's
ДЗИ result versus what its cohort's НВО five years earlier predicted"* — instead of the poor-man's
"movement vs oblast" proxy. That single measure is what separates a world-class explorer from a
league table, and it is *available to us*.

- Historical НВО backfill goes behind `--backfill` (per `feedback_one_off_backfills`), never in
  the watcher/CI.
- **Caveat to state in the UI:** pupils move schools between 7th and 12th grade, so this is a
  *school-level cohort* comparison, not pupil-level tracking. Label it honestly; the UK measure
  has the same limitation and says so.

### 2.2 Persist the cohort count — a ~1-line change that unlocks the ethics layer
`scripts/schools/build_index.ts` **already parses examinee counts**: the МОН CSV stores each
subject as an adjacent `(count, score)` column pair (see the `findPairedColumns` helper, ~L92–100),
and the builder reads `count` only to filter `count > 0` (L160–171) — **then throws it away.**

Persist it as `school_scores.n` and we get, for free:
- **small-N suppression** ("недостатъчно данни" instead of a false-precise rank),
- **confidence intervals** (the honesty device the whole ethics section depends on),
- an **enrollment proxy** for SEDA-style dot-sizing and €/ученик, deferring §2.4.

This is the single highest-leverage fix in the plan. Do it in P1, before anything visual.

### 2.3 Geocode the school registry — gates the map entirely
`loc` is empty for all 978 schools; the only locational field is a free-text `address`
("ГР.БАНСКО"). Two paths, in order of preference:
- **EKATTE settlement-centroid match** on `address` — realistic, reuses existing ГРАО/census
  EKATTE joins, gives settlement-accurate pins. Ship this.
- **МОН institution register** (`ri.mon.bg` / `neispuo.mon.bg`) for true per-school coordinates +
  `type` + director contact. Better, but a scrape; WAF friction expected on mon.bg.

Sofia needs explicit handling: `SOF00` is one bucket of 156 schools with no район split, so the
finder map must place them by address, not by obshtina centroid, or they all stack on one pin.

### 2.4 Enrollment per школа — deferrable if §2.2 lands
With `n` (examinee count) persisted, dot-size and a rough €/ученик are computable without a
separate ingest. A true headcount from НСИ / the register remains the accurate version.
**Effort: medium; not on the critical path.**

### 2.4 BG-ICSEA — "Индекс на средата" (the socioeconomic context index)
The engine behind every fair comparison. Build a per-school (fallback per-obshtina/район)
context index from data we already ingest:
- census education attainment (share with tertiary / share with ≤ primary) — `data/census/`
- oblast/община wage + registered unemployment — `data/indicators.json`, `data/regional.json`
- ГРАО population / urban-rural flag — `data/grao_population.json`
- Roma-neighborhood risk-section share — `--local-problem-sections`
Standardize to mean 0 (national-average община = 0), disclose the recipe and weights on a
methodology page (Chile's trust move). This is an *area-level proxy* — weaker than MySchool's
parent-level ICSEA; label it honestly as "средата на общината/района", not a per-family index.
**Effort: medium (pure computation over existing data).**

### 2.5 Eurostat / E&T Monitor decline-narrative series
National + oblast time series for the story numbers, via the Eurostat API already in-project
(`update-macro`/`update-regional`): PISA underperformance (math 53.6% below baseline — worst in
EU), early-leavers (8.2% nat'l; **17.7% rural vs 3.4% cities**), teacher aging (31.4% are 55+),
tertiary attainment (40.5%), per-student spend vs EU (~4.8% GDP). **Effort: low-medium.**

### 2.6 Deferred (scrape/PDF, not v1)
Per-school делегирани бюджети (mon.bg PDF/XLSX behind orders, WAF-blocked), rsvu university
ratings, НАЦИД registers. Wire later as their own tiles.

> Per project rules: any published DATA card number must be confirmed against the primary
> source (not a search summary), figures displayed in EUR, ПГ-migrated datasets wired into
> `recent_updates`. New tables (school SES, enrollment, geocodes) follow the Postgres-first
> convention if they become serving data; static JSON stays the ingest output.

---

## 3. Product surface

Two front doors, one data spine.

### 3.1 `/awarder/000695114` — МОН entity page (sector pack)
Follows the НЗОК template exactly. New files:
- `src/lib/monBenchmarks.ts` — `MON_EIK="000695114"`, CPV→category (it / infrastructure /
  curriculum / services / other), labels, statutory-supplier context.
- `src/screens/components/procurement/mon/MonPack.tsx` + tiles.
- `src/data/procurement/useMonData.tsx` — budget + indicators + schools rollup + contracts.
- register in `sectorPacks.tsx` (`[MON_EIK]: MonPack`, export `MON_AWARDER_PATH`).
- nav item in `reportMenus.ts` → `menu_group_state_entities` → `procurement_mon_nav`
  ("Образование (МОН)"), under "Държавни структури".
- i18n keys.

Pack tiles (sector-unique; generic KPIs/contracts/risk already render above):
1. **Бюджет: закон срещу изпълнение** — МОН budget bridge (data exists).
2. **Къде отиват парите** — делегирани бюджети (ЕРС per-student formula) → EU desegregation
   funds (ИСУН) → procurement. The money-trail spine.
3. **Резултати накратко** — decline-narrative strip (§2.5) as can-do sentences + sparklines,
   each cross-linked to a община.
4. **Училищата в България** — entry card into the school explorer (map + finder).

### 3.2 `/education` — the school equity explorer (the moonshot)
A dedicated view (dashboard shell, homepage-width, no `max-w` cap, no tabs — stacked
sections/tiles per house UX). Sections:

**A. Намери своето училище** — geolocated Leaflet map (stack already has Leaflet) + focus-gated
typeahead (mirror the procurement company-search pattern). Cluster pins; filter by level/type;
click → `/school/:id`. Dual entry: browse map *or* jump by school code.

**B. Картата на неравенството** — the ProPublica-Miseducation headline: oblast/община choropleth
of the ДЗИ/НВО (and dropout where available) **gap** — rural vs urban, Roma-risk-section share
vs rest. Toggle metric. This is the shareable data-journalism artifact and our differentiator.

**C. Ниво срещу среда** — the SEDA двойна scatter. Two charts, same x-axis (Индекс на средата):
left = резултат vs среда (steep diagonal), right = растеж vs среда (flat blob). Each school a
dot sized by enrollment, with the expectation (regression) line drawn. "Над линията = постига
повече от очакваното за средата си." One glance proves the value-added point.

**D. Сравнение с ЕС** — reuse `/indicators/compare` `?peers=` for PISA + per-student spend vs
RO/GR/HR/EU.

### 3.3 `/school/:id` — per-school report card (UDISE+/MIME + MySchool)
Slugged, shareable, prerendered for SEO. Refuses one grade — shows **three verdicts that may
disagree**:
- **Профил** — name, type, обшина/oblast, enrollment, map pin, director contact.
- **Ниво** — raw ДЗИ/НВО, national percentile + "you are here" on the distribution.
- **Постижение спрямо средата** — the ICSEA move: result vs SES-similar cohort (~N nearest by
  Индекс на средата), colour-coded над/близо/под очакваното, with a **confidence interval** and
  **small-N suppression** (grey "недостатъчно данни" for tiny cohorts; never a false-precise rank).
- **Тренд** — 4-year `scoresByYear` sparkline + signed "движение спрямо oblast" chip (poor-man's
  growth until true prior-attainment linkage exists).
- **Контекст** — links out to the община dashboard, census, wages, EU-funds, procurement —
  the cross-linking no education portal has.

Band thresholds anchored to a *named* standard (QEdu/Chile style), shown to the user, not
arbitrary quantiles. Methodology link on every verdict.

---

## 3b. The textbook-publisher concentration pack ("Учебникарската концентрация")

The strongest differentiator, and it needs **almost no new ingest** — the market lives in the
`contracts` table we already have. This is the "concentration of providers by school / by grade /
by government / by locality" ask, grounded in verified numbers.

### 3b.0 What the corpus already proves (queried live 2026-07-09, CPV `22112%` „Учебници")
| Fact | Value |
|---|---|
| Market (all years) | **€50.9M**, live series **2022–2026**, peaked **€27M in 2024** (the 1–7 → **1–12** free-textbook expansion) |
| Structure | **duopoly** — Клет България (Анубис+Булвест) **37.5%** + Просвета-group **36.2%** = **73.7%** |
| Concentration | **HHI ≈ 2,562** → "highly concentrated" on the DOJ scale (>2,500); ~24 tail publishers share 4.9% |
| Who buys | **606 distinct schools = 95% of spend.** МОН does **not** buy centrally |
| Per-school | a two-horse race (e.g. СУ „Васил Левски": Просвета €839k vs Клет €731k) |

All four requested cuts are computable **from the corpus today**: **by publisher** (national HHI),
**by government/buyer** (school vs община vs министерство), **by locality** (awarder oblast herding).
Only **by grade/subject** needs the МОН approval-list scrape (§3b.3).

### 3b.1 The framing trap that must be handled first
Textbooks are awarded under **чл. 79, ал. 1, т. 3 ЗОП — "договаряне без предварително обявление"**:
a school legally *must* direct-award to the single copyright-holder of the title its teachers chose.
So **every textbook contract is single-bidder by law.** The site's existing single-bid red flag
would fire on ~100% of these and be actively misleading. **Suppress/override the single-bid flag
for CPV 22112%.** The real concentration signal is **upstream of the award**:
1. **Market share / HHI** by publisher — national, oblast, subject.
2. **How few publishers МОН actually approves per subject×grade** — is "choice" real or two names?
   (КЗК ruled in **2011** that the old max-3-per-subject cap created "an oligopolistic market
   structure.") This is the sharpest, most novel metric.
3. **Herding** — do all schools in an oblast cluster on one publisher (РУО steering)?
The consolidation story is concrete: **Klett rolled up Анубис + Булвест 2000 (2013→2017)**,
turning a fragmented field into Просвета-vs-Клет.

### 3b.2 Publisher-group consolidation is mandatory (the SIGMA "union entity" problem)
Raw contractor rows fragment the same group across legal entities and spellings — "Клет българия
ООД", "ПРОСВЕТА-СОФИЯ АД", "Просвета Плюс АД", "Просвета плюс ЕАД". Honest concentration requires a
**publisher-group dimension** (same issue as `project_procurement_sigma_parity_audit`):
- **Клет group** = Клет България ООД (**ЕИК 130878827**) ⊃ Анубис + Булвест 2000 + Изкуства + PONS.
- **Просвета group** = Просвета-София АД (**ЕИК 131106522**) + Просвета Плюс АД/ЕАД.
Store the EIK→group map in `monBenchmarks.ts` (or a `textbookPublishers.ts`); the remaining
publisher EIKs derive from the CPV-22112 contractor set. Show **both** the group HHI (the honest
headline) and the legal-entity breakdown (auditable), per the union-vs-split-share note.

### 3b.3 The approval-register scrape (the second, expensive layer — unlocks "by grade")
МОН's "Списък на одобрените учебници и учебни комплекти" (per Наредба № 10/2017, published by
31 Jan each year) carries **subject × grade × publisher × title × order № РД09- × year** — but as
per-заповед HTML + attached DOC/PDF/XLS, no register, no API, and **mon.bg 403s bots** → a **headed
Playwright scrape + multi-format parse** (reuse the existing headed-scrape patterns, e.g.
`update-kzk-appeals`). This is the only path to the **"how much choice does МОН grant per subject"**
metric and the Texas-IMRA-style **Approved register**. Annual cadence. Defer to a fast-follow; the
procurement-only cuts ship first.

### 3b.4 The "who dominates" component (reusable across procurement/subsidies too)
Per the world-best concentration-viz grammar — build one component, reuse it site-wide:
1. **HHI gauge** with **DOJ threshold bands** (<1500 competitive · 1500–2500 moderate · >2500 highly
   concentrated) **+ a plain-language label** ("силно концентриран пазар") — never a bare number
   (Internet Society *Pulse* is the reference look).
2. **CR-N bar** — "топ 2 издателя = 73.7%" is more legible than HHI; show top-N vs "всички други".
3. **Market-share treemap** for a single market snapshot (one subject's textbooks).
4. **Publisher→school Sankey** — reuse the existing procurement `flow.json` grammar; a few thick
   ribbons = concentration.
5. **Concentration choropleth** — HHI or #1-publisher share by oblast (the map that makes it local).
6. A **"monopoly cell" flag** — subjects/oblasti where one group ≈ 100% (the honest replacement for
   the suppressed single-bid flag).

### 3b.5 Where it surfaces + wiring
- A **"Учебникарският пазар" tile group** on the МОН pack (`/awarder/000695114`) and a standalone
  **`/education/textbooks`** page (the treemap + HHI gauge + publisher→school Sankey + oblast
  choropleth + a `DbDataTable` of contracts filtered to CPV 22112, following the §6 browse pattern).
- **Data model:** no new source table for the procurement cuts — a `textbook_market_payloads`
  (kind = `national|oblast|publisher|subject`) precomputed from `contracts WHERE cpv LIKE '22112%'`,
  joined to the publisher-group map; index already covers `contracts(cpv)` / `(awarder_eik)` — but
  `EXPLAIN ANALYZE` the CPV-prefix scan and add a `cpv` index if it seq-scans. The approval-list
  layer (§3b.3) adds a `textbook_approvals` table (subject, grade, publisher, order №, year).
- **AI tool:** `textbookConcentration` (domain `procurement`/`indicators`) — national + by-oblast +
  by-publisher-group HHI and top-N; add to `ai/tools/education.ts`, router keywords
  `учебник|издател|просвета|клет|анубис|булвест|концентрац|textbook|publisher`.
- **Watcher:** `mon_textbook_approvals` source → `update-schools` (annual; §3b.3 scrape).
- **SEO:** `/education/textbooks` gets its own `routeDefs` + `ENGLISH_STATIC_PAGES` entry + an OG
  `captures[]` card anchored on the treemap or the HHI gauge (`data-og="textbook-treemap"`).
- **First social card (already in the data):** "Два издателя държат 74% от пазара на учебници за
  €51 млн. — а всеки договор е пряко възлагане по закон."

### 3b.6 Publish-safety caveats
- **Reframe, don't accuse:** чл.79 direct award is lawful; the story is *upstream concentration +
  guaranteed demand*, not "rigged tenders." State the legal basis on the tile.
- The circulating **"Просвета 152 млн лв profit 2023"** figure is implausible — **do not publish
  without a TR check** (likely conflates revenue).
- Reconcile the free-textbook budget three ways (press ~€93–122M lv ≈ €47–62M · the МОН budget line
  we already ingest · summed CPV-22112 contracts) before any DATA card.
- The КЗК "oligopoly" wording is a **2011 advisory opinion**, not a cartel ruling — cite it as such.

## 4. Ethics guardrails (product, not decoration)

Bake these in from day one — they're the moat and they prevent real harm (Ruth Perry, Ruelas):
1. **No single composite "best school in Bulgaria" rank.** Ever. Multiple non-composite measures.
2. **Level, growth, trend stay separate** — one toggle, three verdicts allowed to disagree.
3. **Confidence intervals + small-N suppression + outlier capping** — uncertainty is the most
   honest part of the number; most schools honestly labelled "типично за средата си".
4. **Context-adjusted framing celebrates over-performers**, never shames poor-intake schools;
   show raw AND context-adjusted side by side and explain the gap (the CVA lesson — don't force
   one contested "fair" number).
5. **Visible methodology + "данните са начало на разговор, не присъда"** copy.

---

## 5. Data model & SQL performance

Today `data/schools/index.json` is a **static 344 KB file** served as-is (`useSchools` fetches
it whole). That's fine for a top-3 tile, but the moonshot needs server-side paginated browse,
similar-cohort queries, and precomputed scatter/report-card blobs. Migrate schools to Postgres
following the **PG-only convention of the agri/funds packs** (no `build*FromRows`/`db:gen-*`;
ingest writes PG directly; dashboard served from a precomputed blob table). Keep the static JSON
as the ingest artifact for the tiny `useSchools` tile / offline verification net.

### Tables (new)
- `schools` — dim: `id PK` (МОН institution code), `name`, `obshtina`, `oblast`, `type`
  (primary|secondary|mixed|vocational), `lat`, `lng`, `settlement_ekatte`, `awarder_eik`
  (schools ARE awarder EIKs in the contracts corpus — the ЦАИС feed adds ~900 school/kindergarten
  buyers), `enrollment`.
- `school_scores` — fact: `(school_id, year, subject) PK`, `value numeric`, `n int` (cohort size,
  for small-N suppression). subject ∈ `dzi_bel|dzi_math|nvo_bel|nvo_math`.
- `school_context` — the **Индекс на средата** (BG-ICSEA): `(school_id) PK` (fallback obshtina/
  район grain), `ses_index numeric` (mean 0 = national-average община), plus the disclosed
  component columns (`pct_tertiary`, `pct_low_edu`, `wage`, `unemployment`, `roma_risk_share`,
  `urban bool`) so the methodology page can show the recipe.
- `school_payloads` — `(kind, key) PK`, `payload jsonb` — precomputed dashboard blobs, mirroring
  `agri_payloads`/`fund_payloads`. kinds: `report_card` (per `school_id`, the full `/school/:id`
  view incl. its ~N similar cohort + verdict + CI), `scatter` (the `/education` двойна-scatter
  point cloud + regression line + national percentiles), `gap_map` (oblast/обшина choropleth
  values). Serve via `/api/db/education-*` routes.

Budget, EU funds and procurement are **NOT** new tables — joins onto the existing МОН ministry
budget artifact / `fund_*` / `contracts` by `awarder_eik`.

### SQL performance verification (per the "always check DB query perf" rule)
Every new/changed query gets `EXPLAIN ANALYZE` on the **worst-case entity** before shipping, and
an index if it seq-scans (part of "done"). Concretely:
- Index `school_scores(school_id, year, subject)`, `school_scores(subject, year)` (for the
  national scatter / percentile pass), `schools(obshtina)`, `schools(oblast)`,
  `schools(awarder_eik)` (for the report-card procurement join — both sides indexed per the PG
  perf playbook).
- **Worst case = the similar-cohort lookup** (for each school, the N nearest by `ses_index`) and
  the **national scatter build** (all 978 schools × latest-year score × context). Both are
  global-hot and O(n) or O(n·N) — **precompute into `school_payloads` at ingest**, not per page
  load (>200ms if live). The `/education` scatter and every `/school/:id` verdict read one
  `school_payloads` row.
- jsonb builders follow the **payload-determinism rules**: `ROUND` the SES/score numbers, rounded
  sort keys with `school_id` tiebreaks, `COLLATE "C"` for any MIN/label; run the parity-audit
  recipe against a JSON dump of the same query.
- The report card's "училищни поръчки" tile joins `contracts WHERE awarder_eik = <school>` —
  verify the existing `contracts(awarder_eik)` index covers it (it already backs `/company/:eik`).
- Any EUR sums (per-student spend, school procurement) use `totalEur = Σ per-row amountEur` (PG
  basis), never per-currency convert (per `reference_procurement_eur_sum_basis`).

## 6. Browse pages — the "contracts custom pack" pattern

Reuse the server-side `DbDataTable` browse-screen pattern (`ContractsBrowserDbScreen` /
`TendersBrowserDbScreen` in `src/screens/dev/`: a `DbDataTable` with `resource` + `fixedFilters`
+ `extraFilters` + custom `columns`/`toolbar`/`renderAggregates`, backed by a `/api/db/table`
REGISTRY entry — the column whitelist is the security boundary). No pack tile dumps a long list;
each ends in a **"Виж всички"** link to a dedicated server-paginated page.

| Dataset | Top-N tile (in pack/explorer) | Standalone page (route) | DbDataTable registry key |
|---|---|---|---|
| 978 schools (score/context/verdict) | explorer finder + Top-N | `/education/schools` | `schools` (NEW) |
| МОН's own contracts | `MonPack` category/top | `/procurement/contracts?sector=education` | existing `contracts` |
| All school-buyer contracts | (education sector-browse) | `/procurement/contracts?sector=education` | existing `contracts` |

- **`SchoolsBrowserDbScreen` + `/education/schools`** — new screen mirroring
  `ContractsBrowserDbScreen`: columns = училище (→`/school/:id`), обшина/oblast, тип, matura/НВО,
  **постижение спрямо средата** (the над/близо/под verdict chip), тренд sparkline; facet toolbar =
  oblast + type; `renderAggregates` = school count + median score. New `schools` REGISTRY entry in
  `/api/db/table` (whitelist `obshtina`, `oblast`, `type`, `year`, `subject`), `EXPLAIN ANALYZE`d.
- **Education sector-browse pack** — if the Water plan's `SECTOR_BROWSE_PACKS` seam lands first,
  add an `education` entry (`eiks` = МОН + all school-buyer EIKs) so `/procurement/contracts?sector=
  education` shows the whole education procurement slice with an enrichment strip above the table.
  Otherwise the МОН awarder page's own contracts suffice for v1. Reuse, don't fork a bespoke page.

## 7. AI chat tools

Add an education tool family mirroring the place/fiscal tools (per the ai/ tool recipe,
`project_ai_chat_tools`). Files: create `ai/tools/education.ts`; edit `ai/tools/registry.ts`
(import + `ToolDef` entries in `TOOLS`), `ai/orchestrator/router.ts` (keyword block),
`ai/orchestrator/narrate.ts` (cases). Tools follow the Envelope→narrate→UI pipeline — they NEVER
compute numbers in prose, only narrate `env.facts`; data via `fetchDb("education-*", …)` for PG
blobs or `fetchData("/schools/index.json")`.

- `schoolProfile` (domain `place`) — one school: matura/НВО, verdict vs средата, trend, top
  contracts. Resolves by name or МОН code.
- `schoolsNearMe` (domain `place`) — schools in an обшина/oblast ranked, with the над/под-средата
  verdict (not a naked score rank).
- `maturaByPlace` (domain `indicators`) — ДЗИ/НВО averages by обшина/oblast + national trend;
  drill from the existing `dzi` indicator.
- `educationGaps` (domain `indicators`) — the equity headline: rural-vs-urban / Roma-risk gap in
  outcomes; dropout, teacher-aging, per-student spend vs EU.
- `monFiscal` (domain `fiscal`) — МОН budget law-vs-execution + делегирани бюджети + EU-funds +
  procurement (the money-trail spine).

Router keywords: `училищ|матур|дзи|нво|образован|учител|отпаднал|среден успех|school|matura|
education|dropout|pisa`. Provenance strings: `db:education-*` / `schools/index.json`. **Note:**
`/schools/*` is already whitelisted in `AI_PATH_RULES` (`model.ts:106` → dataset `indicators`);
if tools read a new `/education/*.json` path, add an `AI_PATH_RULES` entry or the prebuild fails.

## 8. Watchers & process-watch-report wiring

The ДЗИ path is **already wired**: `scripts/watch/sources/indicators_mon_dzi.ts` → maps to
`update-indicators` in `.claude/skills/process-watch-report/SKILL.md`, which already re-runs
`scripts/schools/build_index.ts` (reuses the МОН per-school CSVs into `data/schools/index.json`).
Extend, don't duplicate.

New watcher sources (`scripts/watch/sources/*.ts`, `WatchSource` shape: `id`,`label`,`url`,
`cadence`,`fingerprint()`,`describe()`; add to `SOURCES` in `scripts/watch/sources/index.ts`):
- `mon_school_register.ts` — cadence `monthly`; fingerprint = latest ri.mon.bg/NEISPUO register
  export date (drives geocodes + enrollment + type).
- `mon_nvo.ts` — cadence `annual` (check monthly); fingerprint = hash of the НВО data.egov.bg
  resource list (7th-grade external assessment; same portal as ДЗИ).
- `eurostat_education.ts` — reuse the existing Eurostat watcher mechanism if one exists
  (`indicators`/`macro` already poll Eurostat); add the education series (early-leavers, tertiary,
  PISA-adjacent, spend %GDP) as a fingerprinted source.

New skill `.claude/skills/update-schools/SKILL.md` (shape on `update-nzok`/`update-indicators`)
owning geocode + enrollment + НВО + **Индекс на средата** compute + the PG load. Mapping rows to
add to the process-watch-report table (all fan out; orchestrator dedupes):

| Watcher source id | Skill |
|---|---|
| `indicators_mon_dzi` | `update-indicators` **+ `update-schools`** (extend the existing fan-out) |
| `mon_school_register` | `update-schools` |
| `mon_nvo` | `update-schools` |
| `eurostat_education` | `update-schools` (or `update-macro` for the national series) |

After a successful run the skill stamps `state/ingest/update-schools.json` via
`npx tsx scripts/stamp-ingest.ts update-schools --summary "…"`. Per the one-off-backfill rule,
the geocode + historical-НВО backfills go behind a `--backfill` flag, never in the watcher/CI;
document in README.

## 9. recent_updates / changelog

Every new PG table wires into `recent_updates` via `recordIngestBatch`
(`scripts/db/lib/ingest_changelog.ts`), called INSIDE each loader's BEGIN/COMMIT txn with a stable
natural key that survives TRUNCATE+reload (per `feedback_pg_changelog_required`):
- scores: `{ source: "school_scores", table: "school_scores", keyExpr: "t.school_id || ':' ||
  t.year || ':' || t.subject", nameExpr: "(SELECT name FROM schools s WHERE s.id=t.school_id)",
  detailExpr: "t.year || ' · ' || t.subject || ' ' || t.value", amountExpr: "NULL", rowsTotal }`
  (day-coalesced + auto-summary >500/day is the default).
- context: `{ source: "school_context", keyExpr: "t.school_id", detailExpr: "'индекс на средата '
  || t.ses_index", … }`.

## 10. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — prebuild fails on an unplaced source
Schools already ride the `indicators` dataset (`model.ts:106` AI_PATH_RULES; `indicators_mon_dzi`
is an `indicators` source member ~L224). For a top-level Образование view, promote it:
- `SOURCE_GROUPS`: add a `mon_education` member set (`origin:"state"`, `members:
  ["indicators_mon_dzi","mon_school_register","mon_nvo","eurostat_education"]`, `skills:
  ["update-indicators","update-schools"]`, `tags:["indicators"]`, label/detail/url = МОН).
- `DATASETS`: add `education` (`path:"data/schools/"` or note it's PG-served via `school_payloads`,
  matching how agri/funds are represented). Point `/education` and `/school/` at it (extend the
  `model.ts:106` route pattern or add a new AI_PATH_RULES entry).
- `EDGES`: `["src:mon_education","ds:education"]` + `["ds:education","f:<feature>"]` (a feature node
  for the МОН pack + `/education` explorer). The budget link stays on the fiscal group.
- Verify with `npm run data:map`; the build errors "watcher source(s) not placed on the data map"
  if a source is missing from a group.

### README.md
- "Data sources" (~L472) — add НВО (data.egov.bg МОН), the МОН institution register (geocodes +
  enrollment), Eurostat education series, and note ДЗИ is already listed.
- "Data layout" (~L205) — document the new `school_*` PG tables (+ `data/schools/` JSON artifact).
- Document the `update-schools` CLI flags (`--backfill`, geocode/enrollment steps) alongside the
  other `update-*` skills.

## 11. Sitemap, static pages & OG cards

The pack's whole SEO surface flows from ONE source of truth: `INSTITUTION_PACKS` in
`scripts/prerender/institutions.ts`. Adding a single МОН entry there wires three consumers
automatically (prerender static HTML+meta, sitemap `/awarder` URLs, OG-card capture). The new
`/education*` and `/school/:id` routes then need their own prerender + sitemap + OG entries. This
is the fix for the `feedback_static_seo` gap — without it a no-JS crawler hits the SPA rewrite and
sees the homepage meta (a soft-duplicate).

### a. МОН awarder pack — one `InstitutionPack` entry does everything
```
{
  eik: "000695114", slug: "mon",           // → public/og/awarder/mon.png
  nameBg: "Министерство на образованието и науката",
  nameEn: "Ministry of Education and Science (МОН)",
  titleBg/titleEn, descriptionBg/descriptionEn,   // <title>/<meta>
  bodyBg/bodyEn,   // crawlable <h1>+<p>: matura crisis + per-school + money-trail framing,
                   // with internal links to /education, /budget, /procurement
  ogAnchor: '[data-og="education-scatter"]',   // the signature visual — see (c)
  ogCenter: true,        // scatter/map read from the middle
  ogSettleMs: 3500,      // give the scatter + regression line time to render
}
```
For free, this yields:
- **Prerender** (`scripts/prerender/dynamicRoutes.ts`) — static `/awarder/000695114` (+`/en`)
  with the crawlable body, `<title>`, `<meta description>`, `og:image → /og/awarder/mon.png`.
- **Sitemap** (`scripts/sitemap/index.ts`) — `/awarder/000695114` (+`/en`) enumerated straight
  from `INSTITUTION_PACKS` (per the `route_defs.ts:233` note); no `route_defs` edit needed.
- **OG capture** — the capture loop already iterates `INSTITUTION_PACKS` (`capture-screens.ts:344`),
  so the card is produced automatically once the pack hero exposes the `data-og` anchor.

Keep `INSTITUTION_PACKS` ↔ the `PACKS` registry (`sectorPacks.tsx`) ↔ app-side `MON_EIK` in sync
(the `institutions.ts` header calls this out).

### b. /education explorer, /education/schools browse, /school/:id cards
These are NOT institution packs — add explicit entries like the other static screens:
- **Sitemap** (`scripts/sitemap/route_defs.ts`):
  - `{ path: "education", file: "src/screens/EducationScreen.tsx" }`
  - `{ path: "education/schools", file: "src/screens/dev/SchoolsBrowserDbScreen.tsx" }`
  - `{ path: "school/:id", file: "schools-list" }` — dynamic, one URL per school; a new
    `schools-list` enumerator in `dynamicRoutes.ts` reads the schools index / PG. 978 URLs is
    well within the Firebase file ceiling (`project_firebase_deploy_ceiling`).
  - add `"education"` + `"education/schools"` to `ENGLISH_STATIC_PAGES` (needs matching
    `english:` blocks in `scripts/prerender/routes.ts`, else the `/en` entry resolves only via
    runtime i18n).
- **Static page generation** (`scripts/prerender/dynamicRoutes.ts`): `buildSchoolRoutes()` emits,
  per school, a thin crawlable page — `<h1>{name}</h1>`, обшина/oblast, latest matura/НВО, the
  над/под-средата verdict in plain HTML, and internal links to the обшина dashboard + `/education`.
  Per the SEO-discovery memo the win is **crawlable HTML + internal links, not screenshots**.
  Per-school `og:image` reuses the shared `mon.png` (don't screenshot 978 pages; a per-oblast card
  is a later nicety). `/school/:id` is canonical; any обшина-tab surfacing of a school sets
  `<link rel=canonical>` back to it (mirrors the candidate sub-tab pattern).

### c. Beautiful OG cards — lead with a chart or map, never a KPI header
`institutions.ts` is explicit: each card should "lead with the roads map / fund-flow bar / budget
bridge chart rather than a plain KPI header." For МОН, frame the strongest data-journalism image:
- **Pack card (`/og/awarder/mon.png`):** the **SEDA двойна scatter** — tag the pack's hero tile
  `data-og="education-scatter"`; a point cloud + regression line reads beautifully centered
  (`ogCenter:true`). Fallback hero: the **inequality choropleth** (`data-og="education-gap-map"`)
  if the map is the stronger top tile.
- **`/education` explorer card:** add a `captures[]` entry (slug `education`, routePath
  `education`, `waitFor`/`anchor` = `.leaflet-container` for the school-finder map *or* the
  scatter's `.recharts-wrapper`, `centerOnAnchor:true`, `settleMs:3000`) — same recipe as the
  `persistence` (map) and `indicators-compare` (chart) captures.
- **`/education/schools` browse card:** a `captures[]` entry anchored on the table `section`
  (like `procurement-contracts`), leading with the summary strip + verdict-chip column.
- **Render requirements:** the hero exposes a stable `data-og` selector and finishes rendering
  inside the settle window (Recharts `.recharts-surface` / Leaflet `.leaflet-container` present);
  capture runs against the dev server with `/api/db` up (schools served from PG), locale bg,
  1200×630 @2x. Commit the PNGs (`public/og/awarder/mon.png` + `public/og/education*.png`) —
  the other `public/og/awarder/*.png` are committed artifacts.

## 11a. Unshipped dependencies (verified absent — do not assume)

| Thing the plan references | Actual state | Resolution |
|---|---|---|
| `OblastChoropleth` | **does not exist.** Only `ProcurementOblastMap.tsx` (procurement-specific, reads `useProcurementByOblast`) | The Води plan proposes extracting a generic `OblastChoropleth`. Education must **either extract it itself** (making procurement the first caller, water the third) **or** sequence P4 behind Води. Decide before P4; don't silently depend. |
| `SECTOR_BROWSE_PACKS` | **does not exist** (0 matches in `sectorPacks.tsx`) | Already treated conditionally in §6. v1 = МОН's own contracts on the awarder page; the education sector-browse pack is a fast-follow *after* the seam lands. |
| `schools.awarder_eik` | **no EIK anywhere in the schools index** — the МОН institution code (`105201`) is not an EIK | The report card's "школски поръчки" tile and the education sector-browse both need a school→EIK join. Requires fuzzy name+address matching against the awarder corpus (the ЦАИС feed does carry ~900 school/kindergarten buyers). **Treat as an unresolved join; drop the tile from v1** rather than ship a bad match. |
| `raw_data/indicators/mon/*.csv` | **RESOLVED 2026-07-09.** 2022–2025 were the egov *homepage* (174,604 b each, differing only by CSRF token). Live re-fetch verified healthy: all 5 resources return `text/csv` with the expected `Бр./Ср.усп. БЕЛ` pairs. Cache repaired (gitignored; no repo change). | **Two latent bugs remain in `scripts/indicators/sources/mon_dzi.ts` — fix in P1:** (1) `fetchBuffer` (L49) validates only `res.ok`, so a 200-with-HTML redirect is written verbatim as `.csv`; add a content-type + `<!doctype` sniff and throw. (2) `ensureCsv` (L136) treats any file `size > 1024` as a valid cache, so a 174 KB HTML page is **never re-downloaded without `--force`**. Validate cached content, not just size. Same pattern likely affects other egov ingests — audit them. |

## 11b. Verification, quality & operations

The plan had no answer for "how do we know the numbers are right." Fill it:

- **Golden files / parity.** Follow the existing `scripts/db/__golden__/` + `tests/fixtures/`
  convention. The SES index, the similar-cohort assignment, and every verdict band get a golden
  fixture; the `school_payloads` jsonb builders get the payload-determinism parity audit (dump the
  same query to JSON and diff) per `reference_pg_payload_determinism`.
- **Static-JSON ↔ PG parity.** `data/schools/index.json` stays the ingest artifact (per
  `feedback_no_json_from_pg`) while browse/scatter serve from PG. Add a check that both agree on
  school count and latest-year scores, or they will drift.
- **Charts.** Read the `dataviz` skill **before** writing any chart code (palette, mark specs,
  legend/axis/tooltip rules, light+dark). SEDA explicitly required a **colour-blind-safe diverging
  ramp** shared between map and scatter — inherit that requirement.
- **Mobile / a11y.** A 978-point scatter must degrade on a ~380px viewport (bin or sample, keep the
  regression line and the user's own school highlighted). Verdict colours need a non-colour channel
  (label/shape) — never colour alone for над/близо/под.
- **Performance budget.** `useSchools` currently fetches the whole 344 KB index on any page that
  mounts it; adding fields will grow it. Keep the tiny-tile hook on a slim payload, serve the
  browse table + scatter from PG (`school_payloads`), and lazy-load the pack (the `PACKS` registry
  already lazies).
- **i18n.** Every new key in `src/locales/{bg,en}/translation.json`: `procurement_mon_nav`,
  `education_nav`, the three verdict labels (над/близо/под очакваното), `education_insufficient_data`,
  band names, methodology copy. BG copy follows `feedback_bg_language` (natural, not calqued) and
  `feedback_bg_uses_eur`.
- **Prod deploy checklist.** New PG tables ⇒ Cloud SQL publish (`apply_functions.ts` + a
  `db:load:school:pg:cloud`-style loader wrapper that applies the DDL and reloads rows against the
  proxy — **`db:dump` is only an outward GCS snapshot and creates nothing**) + functions redeploy +
  `/api/db` registry live, *before* the OG capture (which reads the DB via the dev server) and
  before launch. Both the agri and tenders migrations sit at "DEPLOY PENDING" — do not repeat that.
- **Rollout.** Ship the pack (P0) publicly; keep `/education` behind the dev gate until the verdict
  layer (P3) is golden-tested, because a wrong "под очакваното" on a real school is the one error
  with human cost.
- **Attribution & identifiability.** Credit МОН + data.egov.bg on every tile. Tiny cohorts make
  pupils identifiable — small-N suppression (§2.2) is a privacy control, not just a statistical one.
- **Success metric.** Not pageviews: *does a parent/journalist find their school and correctly read
  "above expectations for its context"?* Track `/school/:id` entries from search + the share rate of
  the scatter card.

## 12. Build sequence

| Phase | Deliverable | Wiring done in-phase | Depends on |
|---|---|---|---|
| **P0 Skeleton** | МОН sector pack (`sectorPacks.tsx`, `MonPack`) + nav + budget bridge + decline strip. Ships alone; beats regionalprofiles.bg on grain. | i18n `procurement_mon_nav`; data-map feature node; **`INSTITUTION_PACKS` МОН entry → prerender + sitemap `/awarder/000695114`** | none |
| **P0.5 Textbook concentration** (early win — no new ingest; §3b) | publisher-group map + "who dominates" component (HHI gauge · CR-N · treemap · publisher→school Sankey · oblast choropleth) · `/education/textbooks` + CPV-22112 `DbDataTable` · **suppress the single-bid flag for CPV 22112** | `textbook_market_payloads` (EXPLAIN ANALYZE the CPV scan, add `contracts(cpv)` index if needed); AI `textbookConcentration`; `/education/textbooks` routeDefs + OG card; TR check on the 152M figure; first FB card | P0 |
| **P1 Data** | **(a) persist cohort `n` (§2.2 — ~1 line)** · **(b) widen `YEARS` + normalize header variants → unlock 2022–2026 (§2.0b)** · **(c) harden the egov fetch (content-type sniff + real cache validation)** · **(d) НВО ingest + `--backfill`** · geocode via EKATTE (§2.3) · Eurostat E&T · **Индекс на средата** · **schools→PG** | new watcher sources; `update-schools` skill; `stamp-ingest`; `recordIngestBatch`; data-map source group; README; per-year row-count assertion | P0 |
| **P2 Explorer + report card** | `/education` map + finder + `/school/:id` card (**level + suppression/CI only — no growth verdict yet**); `SchoolsBrowserDbScreen` + `/education/schools` | `schools` `/api/db/table` REGISTRY (EXPLAIN ANALYZE); AI `schoolProfile`/`schoolsNearMe`; `/education*` + `school/:id` routeDefs + `buildSchoolRoutes` prerender; golden fixtures | P1a geocode+PG |
| **P3 Equity engine** | similar-cohorts · SEDA двойна scatter (growth from the 5-yr ДЗИ series) · **true НВО→ДЗИ value-added once P1d lands** · band/CI verdicts · `school_payloads` precompute | payload-determinism parity audit; AI `maturaByPlace`/`educationGaps`; `data-og="education-scatter"`; **dev-gated until golden-tested** | **P1b** (5-yr series) + SES index; P1d for value-added |
| **P4 Journalism + spine** | inequality choropleth · money-trail spine · `?peers=` PISA panel | **extract `OblastChoropleth` from `ProcurementOblastMap` (or sequence behind Води — §11a)**; AI `monFiscal`; `data-og="education-gap-map"`. School-procurement tile **only if** the school→EIK join is resolved | P2,P3 |
| **P5 Ship** | ethics/methodology page · **OG capture (`mon.png` + `education*.png`) + `ENGLISH_STATIC_PAGES` + `/en` prerender mirrors** · `bucket:sync` · Cloud SQL publish (`apply_functions.ts` + `db:load:*:cloud`) · README/data-map final · `naiasno-post` FEATURE launch | changelog verified; sitemap + data-map build clean; docs updated | all |

## 13. Open questions / risks
- **Geocoding coverage** — if the МОН register isn't cleanly scrapable, fall back to EKATTE
  centroid by `address` (coarser pins but shippable). Gates the whole map.
- **SES index is area-level, not per-family** — label it honestly ("средата на общината/района");
  over-claiming invites the "you're just re-ranking rich vs poor" critique.
- **НВО vs ДЗИ cohorts differ** (7th grade vs graduating) — separate lenses, never averaged.
- **Static-JSON vs PG dual life** — keep `data/schools/index.json` as the tiny-tile artifact +
  verification net while the browse/scatter serve from PG; don't let them drift (parity check).
- **Firebase file-ceiling** (`project_firebase_deploy_ceiling`) — 978 prerendered `/school/*`
  pages is fine; watch total dist file count.
- **Prod deploy** — new PG tables need their DDL applied to Cloud SQL (`apply_functions.ts`
  against the proxy) + a `db:load:school:pg:cloud`-style loader wrapper (write one; `db:dump`
  is only an outward GCS snapshot and creates nothing) + functions redeploy (like the procurement/funds
  migrations); `school_*` excluded from `bucket:sync` if PG-served.
- **Deferred data** (делегирани бюджети per school, rsvu, НАЦИД) — real gaps; wire as later tiles.
- **Textbook single-bid flag (§3b.1)** — CPV 22112 is 100% чл.79 direct award; suppressing the flag
  there must not break the site-wide single-bid metric. Scope the override to the CPV, not globally.
- **Textbook publisher-group map drift** — new imprints/renames (like the Klett roll-up) will appear;
  the EIK→group map needs a maintenance path, and unmapped EIKs must fail-loud, not silently fragment.
- **Approval-register scrape brittleness** — mon.bg 403s bots + per-заповед DOC/PDF/XLS; the "by
  grade/subject" layer is the expensive, breakable part. Ship the procurement cuts without it.

## 14. Sources (verify before publishing any DATA card)
**Schools/outcomes:** data.egov.bg МОН org `a57a2273-…`; ДЗИ dataset `066b4b04-…`; МОН institution
register (ri.mon.bg / neispuo.mon.bg); EU E&T Monitor 2024 (BG)
`op.europa.eu/webpub/eac/education-and-training-monitor/en/country-reports/bulgaria.html`.
**Textbooks:** МОН approved-lists `mon.bg/dyasno-menyu/uchebnitsi/` (403s bots); Наредба № 10/2017;
КЗК 2011 oligopoly opinion (dnevnik.bg); Просвета-София АД EIK 131106522, Клет България ООД EIK
130878827; АОП CPV 22112000 (already in-corpus). **UI/UX:** MySchool ICSEA (myschool.edu.au);
Stanford EOP `edopportunity.org`; UK Progress 8 DfE; Chile MIME (mime.mineduc.cl); OWID Grapher;
EdReports (edreports.org); Internet Society Pulse (pulse.internetsociety.org) + OpenTender
(opentender.eu) for concentration viz. Full URL set in the research thread.
