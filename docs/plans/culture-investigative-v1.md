# /culture as an investigative hub + new procurement datasets — v1 plan

**Status:** research complete, nothing built. EXTENDS `docs/plans/kultura-view-v1.md`
(which shipped Phases 1–2: the НФЦ film-subsidy story) with the accountability half that plan
deferred, converts `/culture` to the house hub pattern, and adds a general procurement-ingest
roadmap.

**Trigger:** the ACF „Милиони зад кулисите" I+II fact-check (2026-08-13). Of 44 claims, 9 were
unanswerable *not because the data does not exist* but because we do not ingest it — and the
whole story is invisible on `/culture`, which is a subsidy dashboard with no procurement
layer, no EU-funds layer, and an EIK register that omits its largest buyer.

**Decisions taken (2026-08-13, user):**
1. The contracts browser gets a **generic `?sector=` filter**, not a bespoke culture route.
2. **Ingest everything in Part 2** that serves investigative work and generalises beyond culture.
3. `/culture` becomes a **dashboard-hub** with a four-subject finder.

---

## 0. Every figure below was measured, with its denominator

Per the hub skill §0. Measured 2026-08-13 against local PG (`contracts` 408,967 rows).

| Figure | Value | Denominator / basis |
|---|---|---|
| Culture group contracts (current 21 EIKs) | **674** | `tag='contract'`, 2011-01-19 → 2026-08-11 |
| Culture group money | **€145,966,111** | Σ `amount_eur`, post-annex current value |
| Culture single-bid rate | **40.2%** | 179 of **445 contracts where `number_of_tenderers IS NOT NULL`** — not of 674 |
| **National single-bid baseline** | **40.9%** | 108,413 of 264,837 bid-known, whole corpus |
| Art-school tier single-bid | **53.0%** | 71 of 134 bid-known |
| Distinct suppliers | 336 | distinct `contractor_eik`, consortium members excluded |
| Risk grades | A 387 / B 199 / C 78 / D 10 | `contract_risk_cache.grade`; €87.8m / €28.9m / €23.1m / €6.2m |
| Annex uplift | €758,745 over 71 contracts | `procurement_annexes.value_diff_eur` |
| КЗК appeals | 13 across 7 buyers, 1 upheld | `kzk_appeals` on the culture buyer set |
| **ИСУН grants to culture bodies** | **€474,276,649 / 1,866 projects / 1,527 beneficiaries** | `fund_projects`, beneficiary NAME matched on the culture regex |
| — of which читалища | €22,140,281 / 1,332 projects / 1,196 beneficiaries | same |
| — to the 26 named institutions | €56.2m (МК €37.6m, НДК €10.2m, НХА €3.3m …) | `beneficiary_eik` exact |
| **ДФЗ subsidies to читалища** | **€18,341,814 / 264 rows / 197 beneficiaries**, 2015–2025 | `agri_subsidies`, name-matched **with the `култури` exclusion** |
| **Interreg — culture BODIES as partners** | **€10,990,255 / 77 rows / 67 partners** | `interreg_partners`, `country='Bulgaria'`, name-matched |
| **Interreg — culture/heritage-THEMED operations** | **€89,551,792 / 420 rows / 340 BG partners**, only **100 (24%) carry an EIK** | join via `interreg_operations.title_en ~* 'cultur\|heritage\|museum\|theatre\|festival\|art'` |
| Culture-institute directors in the person layer | **198**, all public figures, all with declarations | `person_role source='public_sector' role='cultural_institute'` |
| Procurement officers („Упълномощено лице по ЗОП") | **782 people / 2,848 filings**, 2018–2025, all resolved to `person_id` | `declaration.category='procurement_officer'` |
| Cached officials declaration XMLs | **44,142** (1.8 GB), **17,389 distinct `<Work>` employers** | `raw_data/officials/**/*.xml` |
| **Grant → contract lineage** | **260 of 263** ПИИ codes in tender subjects match a `fund_projects` row — **98.9%** | see §1.6 |
| ПИИ-coded procurement | 1,829 tenders · 2,703 contracts · 262 distinct codes | `subject`/`title ~* 'BG-RRP-[0-9]'` |
| `fund_projects` with a BG-RRP `contract_number` | 14,180 | exact |

> ⚠️ **The single-bid figure is the trap on this page.** Culture is **40.2%** against a
> national **40.9%** — *typical*, not alarming. A tile showing 40.2% alone asserts something
> false. The real signal is the art-school tier at **53.0%** (+12 points). Any single-bid tile
> ships with the baseline as its `metricSecondary` or it does not ship.

> ⚠️ **€474m vs €146m.** ИСУН grants to culture bodies are **3.2× the procurement**. Both are
> absent from `/culture` today. The EU figure is name-matched (1,527 beneficiaries, mostly
> читалища) so it is a *floor with a fuzzy edge*; the EIK-exact subset is €56.2m. **Never
> publish the €474m without naming which matching produced it** — the two differ by 8×.

> ⚠️ **The `култури` false positive is a €148m error waiting to be published.** The naive
> culture regex over `agri_subsidies` returns **€166.3m**; the real figure is **€18.3m**. The
> difference is „Институт по полски **култури**", „Институт по фуражните **култури**",
> „Агро **култури** 77 ЕООД" — agricultural *crops*. `kulturaReferenceData.ts` already carries
> exactly this class of trap in `EXCLUDED_EIKS` („Община Куклен — FALSE regex match on
> „куклен""). Any agri arm ships with the `!~* 'култури'` guard **and a test that asserts the
> guard changes the number**, or it does not ship.

> ⚠️ **Interreg answers two different questions and they are 8× apart.** "Culture institutions
> doing Interreg" is €11.0m / 67 bodies. "Interreg culture-and-heritage money reaching
> Bulgaria" is €89.6m / 340 partners — and those partners are overwhelmingly общини and NGOs,
> not culture institutes. **Only 24% of them carry an EIK**, so an EIK-keyed sector filter
> silently drops three quarters of the second answer. Pick one per surface and label it; the
> thematic arm must be joined through `interreg_operations`, never through a beneficiary set.

---

# Part 1 — /culture

## 1.1 What it is today, and why it cannot serve an investigation

`CultureScreen.tsx` renders eleven tiles and **ten are НФЦ film subsidy**: KPI row, discipline
composition, time spine, funding-stream scale, municipal/читалища, concentration, biggest
awards, commissions, НФК grants, oblast map. The eleventh — `CultureAwardersTile` — is a
**static roster of names** linking to `/awarder/<eik>`, with no counts, no money, no risk.

The page answers "who gets film money" (€94.9m over 2014–2025) and cannot answer "who buys
what, from whom, with how much competition" (€146m) or "what EU money arrived" (€474m). The
sector headline in `sector_stats.json` is `basis: "budget"` (€269,051,700), so it is not there
either. Film subsidy is **13% of the money on this page's subject** and 100% of its content.

## 1.2 Tier 0 — the EIK register (blocks everything else)

`src/lib/kulturaReferenceData.ts` freezes a 21-EIK allowlist. Measured coverage:

| Tier | Buyers | Contracts | Money | Single-bid | Status |
|---|---|---|---|---|---|
| A — funders + verified institutes | 21 | 674 | €145.97m | 40.2% (179/445) | **in the roll-up** |
| B — national art schools incl. **НУКК** | 10 | 196 | €9.48m | **53.0% (71/134)** | **absent from the file entirely** |
| C — verify-principal (theatres/museums) | 9 | 75 | €14.22m | 37.1% | listed, excluded |
| D — Шипка-Бузлуджа, НХА, НАИМ | 3 | 94 | €31.96m | 27.1% | absent |
| E — народни читалища | 86 | 134 | €18.05m | 20.0% | out of scope by design |
| **Universe** | **129** | **1,173** | **€219.68m** | | **66% of the money in scope** |

- **T0.1 — Add Tier B (10 EIKs).** МК-principal national art schools, in none of the file's
  three lists. **НУКК `831154303`** is the largest buyer in the ACF story (€3.20m) and appears
  in no roll-up, roster, map or search box. Highest single-bid tier in the universe.
- **T0.2 — Resolve Tier C (9 EIKs, €14.22m).** Pending since v1 §15; now the difference
  between a €146m and a €160m sector. Resolve from the МК ДКИ register (T3.1).
- **T0.3 — Settle МГТ „Зад канала" `000677194`.** ACF says principal = МК; our
  `EXCLUDED_EIKS` says Столична община. Record the **evidence**, not just the verdict.
- **T0.4 — `awarder_seats` row for `000677194`.** It has none, so the theatre is invisible to
  `/procurement/by-settlement`, the settlement payloads and every place surface.
- **T0.5 — Decide Tier E (читалища).** €18.05m of procurement, **€22.1m of EU grants across
  1,196 beneficiaries**, and the largest culture stream (€88.3m/yr). Recommend: a labelled
  sub-group, excluded from the headline, reachable from it.

**Gate:** a data test enumerating buyers matching the culture regex, subtracting the three
declared lists, failing on any unclassified buyer above a money floor.

## 1.3 The generic `?sector=` filter — **DECIDED**

One filter, ~20 sector surfaces, no bespoke routes.

- **Registry.** A single `SECTOR_EIKS: Record<SectorKey, readonly string[]>` assembled from the
  existing per-sector reference modules. **One declaration**, imported by both `src/` and
  `scripts/` (hub skill §1).
- **SQL.** A `sector_eik(sector_key, eik, role)` dimension loaded from that registry, so
  `db_table.js` resolves `?sector=culture` to an indexed `= ANY(...)` predicate rather than a
  literal array in the route.
- **`role` is load-bearing.** The same EIK is a BUYER on `contracts`/`tenders` and a
  BENEFICIARY on `fund_projects`/`agri_subsidies`/`interreg_partners`. One column
  (`awarder` | `beneficiary` | `both`) keeps a filter from joining a buyer set to a
  beneficiary corpus and reporting zero.

**It must span all four money corpora, not just contracts.** Migration 127
(`company_public_money`) already unions exactly these four arms —
`contracts ∪ agri_subsidies ∪ fund_beneficiaries ∪ interreg_partners` — so the four-corpus
union is an established repo pattern with a canonical spec and a data test pinning it. The
sector filter follows it:

| Corpus | Key | Culture coverage | Caveat |
|---|---|---|---|
| `contracts` / `tenders` | `awarder_eik` / `buyer_eik` | €146m (21) → €219.7m (129) | — |
| `fund_projects` (ИСУН) | `beneficiary_eik` | €56.2m exact / €474.3m name-matched | state which matching |
| `agri_subsidies` (ДФЗ) | `eik` | €18.3m, **читалища only** | `!~* 'култури'` guard mandatory |
| `interreg_partners` | `eik` | €11.0m bodies / €89.6m thematic | **only 24% of thematic partners have an EIK** |

- **Surfaces.** `?sector=` on `/procurement/contracts`, `/procurement/tenders`,
  `/procurement/contractors`, and the funds/subsidies browsers; validated on read like every
  other filter (`useUrlProcurementFilters`) — an unknown key is dropped, never passed through.
- **Reciprocity gate** (hub skill §4): every sector key a tile links with must be read by the
  destination. A `?sector` landing on an unfiltered browser is the exact failure the see-all
  rule exists to prevent.
- **Coverage must be declarable per corpus.** An EIK-keyed filter over Interreg answers 24% of
  the thematic question. The filter returns its own coverage so a surface can say so, the way
  `/api/db/tender-search-coverage` already does.
- **Why it beats a bespoke route:** the culture set is 21→40 EIKs today and moves with
  T0.1/T0.2/T3.1. A route bakes a set; a filter reads one — and ~19 other sector surfaces get
  it free.

## 1.4 Tier 1 — the procurement layer

Everything here runs on primitives that **already exist**. No new migration.

`awarder_group_model(text[], from, to)` (migration 061) returns, for any EIK set: head totals,
bid-known/single-bid counts, a **complete** per-contractor rollup and per-CPV buckets. It is
what the six sector packs run on. Point it at the culture set.

- **T1.1** — `useCultureProcurement` over `awarder_group_model` with the resolved set. Reuse
  `buildAwarderModelFromAggregates`; never fetch contract rows client-side.
- **T1.2** — The aggregates land on `/culture/procurement` (§1.7), not on the hub. The hub gets
  only the two or three headline numbers from the hub blob.
- **T1.3** — The **cross-buyer supplier** view, which no current surface offers: measured,
  **ДИНАКОРД-БЪЛГАРИЯ ЕООД serves 9 of the culture buyers (€5.38m)**, А1 5 (€14.26m), Форс
  Делта 4, **Д & Д ООД 3, Крипто енерджи ЕООД 3**. One supplier across many small independent
  buyers is the shape an investigation starts from.

## 1.5 Tier 2 — the people bridge (the part nobody else has)

We hold **198 culture-institute directors**, every one a public figure with a declaration, and
**we cannot link one to the institution they run.** `person_role.ref` is the officials slug,
`source_row` is NULL, `official_roster` has no EIK, and `declaration.institution` is the
register's **group label** — "Културни институти и институции" for all 380 filings,
"Процедури по ЗОП" for all 2,848.

The employer is in the data and always has been. `<Personal><Work>` names the actual
institution; `scripts/officials/slug_identity.ts` already parses it (`workOf()`) **only to
disambiguate slugs, and never persists it.** Measured: **44,142 XMLs on disk, 17,389 distinct
`<Work>` values.**

- **T2.1 — Persist `<Work>` as `declaration.employer`.** A column plus a backfill from the
  existing cache. No network. Highest-leverage cheap change in this plan, and **not
  culture-specific**: it gives an employer to school heads (4,527), hospital heads (2,693),
  state enterprises (5,826) and procurement officers (2,848).
- **T2.2 — `employer → awarder_eik` resolution.** Free text typed by the declarant (the
  officials code documents `ОУ' Д-Р ПЕТЪР БЕРОН"` with stray quotes): fold + trigram match
  against `contracts.awarder_name` ∪ `tr_companies.name`, **store a confidence, publish only
  exact/high**, keep the unresolved visible rather than silently dropped. Per
  `feedback_name_match_not_identity`, show the declared string; never assert the match below
  the bar.
- **T2.3 — „Кой ръководи"** on `/culture/institutions`: each institute with its director,
  their `/person` link, and whether a current declaration exists.
- **T2.4 — The procurement-officer layer (general).** 782 named „Упълномощено лице по ЗОП",
  2,848 filings, 2018–2025, all resolved to `person_id`. With T2.1 they gain an institution,
  making "who was authorised to run procurement at this buyer, in this year" a queryable fact
  on every `/awarder/:eik`. Nothing comparable is published in Bulgaria, and it is the closest
  our data gets to the external-expert/committee angle the ACF story turns on.

## 1.6 ⭐ The money spine — grant → contract lineage (NEW, and general)

The strongest capability the research turned up, and it is not culture-specific.

`fund_projects.contract_number` **is** the ПИИ code, and the same code is written into the
procurement subject:

```
fund_projects  BG-RRP-4.020-0003  Драматичен театър Ловеч   grant €1,167,391  paid €1,095,826
tenders        06257-2024-0002/3  "…ПИИ BG-RRP-4.020-0003: Устойчиво енергийно обновяване…"
contracts      Крипто енерджи €35,279 (авторски надзор) · Нитов инженеринг €824,801 (СМР)

fund_projects  BG-RRP-4.020-0001  Държавен сатиричен театър grant €1,078,149  paid €1,074,305
tenders        00829-2024-0001    авторски надзор  →  Крипто енерджи €34,512
               00829-2025-0002    СМР              →  Д & д ООД €897,058 (1 bidder, grade C)
```

**Measured join feasibility: 260 of 263 ПИИ codes extracted from tender subjects match a
`fund_projects` row — 98.9%.** 14,180 fund_projects carry a BG-RRP `contract_number`; 1,829
tenders and 2,703 contracts carry a code in their text.

- **T1.6a — A `grant_contract_link` table**: `(pii_code, unp, contract_key, confidence,
  basis)`, built by regex over `tenders.subject` + `contracts.title`, joined to
  `fund_projects.contract_number`. Extraction is a regex over free text, so **store the basis
  and never present a link as authoritative below exact-code confidence.**
- **T1.6b — Coverage must be published, like `tender-search-coverage`.** This covers the RRF
  slice only. A "money spine" tile that silently omits ЕФРР/ЕСФ contracts reads as "this grant
  bought nothing".
- **T1.6c — Surfaces**: a spine strip on `/funds/contract/:key`, on `/awarder/:eik`, and as the
  signature tile of the culture hub. Extend to ЕФРР/ЕСФ codes once the RRF slice is proven.

## 1.7 `/culture` becomes a hub — the restructure

**Route plan.** `/culture` keeps its URL (it is prerendered and indexed) and changes content.

| Route | Today | After |
|---|---|---|
| `/culture` | film-subsidy dashboard | **the hub** — intro, finder, four bands |
| `/culture/subsidies` | — | **NEW** — today's `CultureScreen` body, moved verbatim |
| `/culture/procurement` | — | **NEW** — the group-model dashboard (§1.4) |
| `/culture/funds` | — | **NEW** — EU money into culture + the spine |
| `/culture/institutions` | — | **NEW** — the register: who they are, who runs them, what they buy |
| `/culture/films`, `/culture/film/:id` | browser + record | unchanged |

⚠️ **SEO decision required.** `/culture` currently carries the film-subsidy copy and whatever
it ranks for. Moving that body to `/culture/subsidies` needs: a `staticPage` prerender entry
and sitemap `<loc>` for every new sub-page, `dist/<path>/index.html` verified after build, and
the hub intro retaining the subsidy vocabulary. Per `project_seo_discovery_gap`, broader-data
pages already earn ~0 impressions — do not assume the hub inherits the dashboard's traffic.

**Bands** — named for what is in them, each with a one-line `descKey` (hub skill §3). Grid is
4 columns at `xl`; counts are 4/4/4/3 so no tile is stranded.

**Band 1 — „Парите" · where culture money comes from, in one place**

The full picture, measured. Six streams on five different bases — which is precisely why each
tile carries its basis as its `metricSecondary` rather than in a footnote.

| Stream | Amount | Basis |
|---|---|---|
| Бюджет на МК | €269.1m / yr | 2026, by law |
| ИСУН (name-matched) | €474.3m | 1,527 beneficiaries — EIK-exact subset €56.2m |
| Обществени поръчки | €146.0m (21 EIKs) / €219.7m (universe of 129) | post-annex current value |
| НФЦ филмови субсидии | €94.9m | 2014–2025, 944 projects |
| Interreg — тематично | €89.6m | 340 BG partners, 24% EIK-resolved |
| ДФЗ — читалища | €18.3m | 197 читалища, `култури` excluded |
| Interreg — културни организации | €11.0m | 67 partners |

| Tile | Destination | Headline · secondary |
|---|---|---|
| Еврофондове | `/culture/funds` | €474m ИСУН · „по име на бенефициент; €56m по ЕИК" |
| Обществени поръчки | `/culture/procurement` | €146m · „674 договора, 336 доставчици" |
| Филмови субсидии | `/culture/subsidies` | €94.9m · „944 проекта, 2014–2025" |
| Бюджет на МК | `/budget/ministry/…` | €269.1m · „2026, по закон" |

**Where ДФЗ and Interreg go.** Neither earns a band-1 tile — €18.3m and €11.0m against a
€269m budget line would over-weight them, and both are читалища/общини stories rather than
institute stories. They ride as **named arms inside `/culture/funds`**: a „Всички публични
пари" stacked view with one row per corpus, each labelled with its basis and its coverage.
That view is the four-corpus union of §1.3 rendered once, and it is the reusable piece —
every sector gets the same six-row breakdown from the same query.

**Band 2 — „Кой получава" · the recipients, ranked and cross-referenced**
| Tile | Destination |
|---|---|
| Изпълнители на културата | `/procurement/contractors?sector=culture` |
| Доставчици на повече от един възложител | `/culture/procurement#network` |
| Продуценти | `/culture/films` |
| Читалища и общини | `/culture/funds#chitalishta` |

**Band 3 — „Как се раздава" · the award mechanics, with the national baseline beside each**
| Tile | Destination |
|---|---|
| Конкуренция | `/procurement/contracts?sector=culture&single=1` |
| Риск | `/procurement/contracts?sector=culture&grade=C,D,E,F` |
| Анекси и обжалвания | `/culture/procurement#changes` |
| Кой решава (комисии) | `/culture/subsidies#commissions` |

**Band 4 — „Кой отговаря" · the people**
| Tile | Destination |
|---|---|
| Институциите | `/culture/institutions` |
| Директори и декларации | `/culture/institutions#people` |
| Проследи парите (спината) | `/culture/funds#spine` |

Rules that apply: **one accent per tile, unique across all four bands** (19 tokens exist in
`TILE_ACCENTS`, 15 needed); **every tile id has a scene** or the page white-screens; **no
seeded `:param` destinations** — `/culture/institutions` is the picker that replaces them.

**One hub blob**, `data/culture/derived/hub_stats.json` — the ~15 headline numbers, coverage
flags and nothing else. Generated **from the objects the pipeline already holds in memory**,
byte-budgeted and gated, in the `--upload` list. No tile fetches an artifact.

## 1.8 The finder — four subjects on `HubSearch`

Built on `src/ux/search/HubSearch.tsx` + `hubSearchSources.ts`. **Do not build a new box.**
Declared in `src/screens/culture/cultureSearch.ts` beside the tile registry.

**The scope axis here is the SECTOR, not the year.** `/culture`'s `?pscope` is a year picker,
but a reader searching „Динакорд" wants culture hits first and everything else below — not
2024 hits above 2023. The split maps exactly onto the new `?sector=culture` predicate, so one
mechanism serves both the finder and the browsers.

| # | Subject | Kind | In-scope group | Out-of-scope group | See-all (in-scope only) |
|---|---|---|---|---|---|
| 1 | Procurement (contracts + tenders) | server, `/api/db/procurement-search` + `?sector` | „Поръчки в културата" (5) | „Поръчки в други сектори" (3) | `/procurement/contracts?sector=culture&q=` |
| 2 | Public money — ИСУН + Interreg + ДФЗ | server, `search_fund_projects` (086) + `search_interreg_operations` (138) | „Проекти на културни организации" (5) | „Проекти в други сектори" (3) | verify a page reads `?q` first — **no see-all if none does** |
| 3 | Awarders + companies | **index** (culture roster, instant) + server `/api/db/company-search` | „Културни институции" (6) | „Други фирми и възложители" (3) | `/procurement/contractors?sector=culture&q=` |
| 4 | Persons | server, `/api/db/person-search` | — | — | `/persons?q=` |

Three things this design commits to, each because the skill records the failure:

- **`scopedSources()` mints each pair as TWO INDEPENDENT SOURCES**, own corpus, own cap. A
  partition over one ranked result set silently becomes a filter.
- **Subject 4 ships as ONE group with `outSource: null`** until T2.2 lands. There is no
  "culture person" subset before the employer bridge exists, and inventing one would make the
  in-scope group empty and the split meaningless. When T2.2 lands it becomes a pair.
- **Subject 2 ships without a see-all unless a funds page reads `?q`.** `/funds/calls` and
  `/funds/procedure/:code` do not; grep before linking. A link advertising a filtered
  destination and delivering an unfiltered one is the declarations-hub defect.
- **Subject 2 is ONE group, not three.** ИСУН, Interreg and ДФЗ are three corpora answering
  one reader question („кой е взел публични пари"), and three groups of two rows each is a
  dropdown nobody scans. Union them server-side, ordered by amount, and put the corpus in each
  row's `sub` line — the label is „Проекти", the provenance is per row. **ДФЗ enters only via
  the читалища arm** and only behind the `култури` guard; a subsidy search returning „Институт
  по полски култури" on the culture hub is the false positive rendered as a feature.

The culture roster stays a **client index** (~40 rows, already static) so the box answers on
the first keystroke even while every server source is in flight, and works when they fail.
Shliokavitsa comes free via `shlyo_query_fold` on the server sources; the client index goes
through `translitSearch.ts`.

## 1.9 Best-in-class UI — what would make this the reference implementation

Grounded in what the corpus can actually support. Ordered by how much each changes what a
journalist can do.

**1. The money spine as a first-class object, not a chart.**
A horizontal flow — `EU грант / бюджет → институция → процедура → договор → изпълнител →
собственик` — where every node is a link, every edge carries a number **and its basis**, and
the whole strip has a permalink. This is the investigative object; nothing on the Bulgarian
web renders it end to end. Built once in `src/ux/`, it serves `/culture/funds`,
`/funds/contract/:key`, `/awarder/:eik` and every future sector. The Lovech theatre is a
complete worked example today (§1.6).

**2. No terminal numbers.** Every figure drills to the rows behind it. A number that cannot be
opened is an assertion; a number that opens is evidence. This is the single discipline that
separates a dashboard from a source.

**3. A receipts footer on every tile**, as a shared component rather than prose: *basis ·
source · corpus vintage · what is excluded*. The repo already writes these by hand in
comments and captions; promote it to a component so it cannot be forgotten, and so "as of"
dating is uniform.

**4. Journalist affordances, explicitly.**
   - **Permalink reproduces the view** — scope and filters already live in the URL; extend
     that to the new sub-pages so a link in an article renders what the author saw.
   - **Export** — CSV/JSON per table, stamped with the corpus vintage and the query.
   - **Cite this** — one line: figure, basis, source, retrieved-on. Removes the commonest
     misquote (a scoped figure reported as a total).

**5. Entry by suspicion, not by browsing.** A „Сигнали" strip above the bands: single-bid
above the national baseline, near-ceiling awards, annex uplift, repeat cross-buyer suppliers,
cancelled-and-relaunched procedures. Each is **a filter into the browser, never a verdict** —
the wording is „за проверка", and each carries its own base rate so a reader can see whether
the signal is unusual.

**6. Two new risk checks the ACF story exposed**, both general and both currently absent from
the 13 in `contract_risk_cache`:
   - **`nearCeilingAward`** — contracted ÷ estimated ≥ ~0.99. Measured: the НУКК façade
     contract came in **€0.29 under a €454,611.59 ceiling**. Needs a base rate before it ships
     as a signal — six of the eight ACF procedures sit between 98.8% and 100%, which suggests
     it is common for small buyers and must be scored against a peer group, not absolutely.
   - **`cancelledAndRelaunched`** — same buyer, same folded subject, estimate within ε,
     relaunched within N days. Measured: `06257-2024-0002` cancelled 2024-10-21,
     `06257-2024-0003` published 2024-10-29 with an identical subject and an identical €35,535
     estimate.
   
   ⚠️ 112's bit order is **a contract — append only, never renumber**, or historic masks
   silently re-map. These become bits 13 and 14.

**7. Compare two institutions side by side.** Culture is 129 buyers of wildly different size;
a figure means nothing without a peer. Pin two, diff every KPI.

**8. A sector wire — „какво се промени".** New contracts, new annexes, new appeals, new
grants for the sector since a date. `funds_wire()` (144) is the existing pattern and
`ingest_first_seen` the existing basis. This is what brings a journalist back.

**9. Scenes that draw the real structure** (hub skill §2): a spine for the money tile, a
bipartite supplier↔buyer graph for the network tile, a ceiling-ratio dot strip for
competition. Generic bars are not worth the file.

**10. Honest thin-corpus states.** Culture procurement is lumpy — most institutes have single
digits of contracts, and a year filter empties tiles. Named empty states („няма договори в
този период"), never a grid of zeroes, and never a percentage over a denominator below a
floor.

## 1.10 Tier 3 — culture-specific ingests

- **T3.1 — МК's ДКИ register (~74 institutes).** Closes T0.2/T0.3 permanently, turns the
  frozen allowlist into a maintained one. Watcher + a gate failing when register and file
  disagree.
- **T3.2 — читалища subsidy per unit.** €88.3m/yr, currently one line on a scale tile.
  `Единен разходен стандарт × subsidised units` per община joins it to the 86 читалища buyers,
  the 1,196 EU beneficiaries and the governance dashboards.
- **T3.3 — Commission ↔ recipient overlap** (the deferred 9b). Name-match join between the
  commissions artifact and the person layer. Ship **only** as "flagged for review"; the
  original defamation policy gate stands.

---

# Part 2 — new procurement datasets (all approved for ingest)

Ranked value × ease. "Ease" accounts for a crawl being an operator action, not a pipeline step.

### P1 — Finish the ЦАИС ЕОП dossier crawl. **A decision, not a project.**

`tender_dossier` + six siblings (migration 146) and the crawler exist and are probe-verified.
Run on **1,861 of 237,321 procedures (0.78%)**. `tender-dossier-ingest-v1.md` §5.1 measures the
full tier-A run at **~1.4 h at 100 Mbit** via the export-ZIP bulk route.

Unlocks, measured against the claims we could not answer: `contact_name`/`contact_email`/
`contact_phone` per procedure; `tender_document` + `tender_document_text` (documentation,
specifications, and per §10 the протоколи — the committee trail); the award-stage
announcements. Note document search is **already live** and answering from 0.78% of the corpus.

### P2 — ЦПРС (Централен професионален регистър на строителя). **Zero references in the repo.**

Which companies are licensed for which construction category and group, since when, with what
declared staff and turnover. It is the **eligibility check on every works contract**: "did this
contractor hold the required licence class on the award date?" — answerable nowhere on the
Bulgarian web today. Small (tens of thousands of rows), joins on `contractor_eik`.

### P3 — ГФО financial statements from ТР. **Mechanism already proven.**

`reference_tr_gfo_documents` records the route (`/CR/api/Documents/{ActID}` → PDF, код 18000 =
revenue); `scripts/nzok/write_hospital_revenue.ts` uses it for private hospitals and it has
never been generalised. Per-EIK per-year turnover / equity / employees gives the
financial-capacity test, the shell-winner detector ("won €X against €Y of turnover"), and a
real denominator for `company_public_money`. Restrict to EIKs with contracts to keep it finite.

### P4 — АОП register of external experts (чл. 229, ал. 1, т. 17 ЗОП).

The state's public list of experts available to run procedures. Zero references in the repo.
Small, exact; joined to T2.4's procurement officers it makes "the same expert wrote the
documentation and sat on the committee" a query rather than an investigation.

### P5 — BULSTAT ДЗЗД / consortium registry.

We infer composition from contract rows (migration 087) and it works — the Зад канала winner is
correctly a two-member Д&Д + Мулти Строй Комерс consortium. What we cannot do is **name** it
(„Театрал" and „Примо Град" do not exist in our data) or say who filed it. BULSTAT carries the
name, the filer and the members, turning a repeated anonymous "Обединение: A, B" into a named
recurring vehicle.

### P6 — Действителни собственици (beneficial owners, ЗМИП).

`tr_person_roles` carries officers and shareholders of record; the ЗМИП filings are separate
and we hold none. This is the layer under `person_role` that `/connections` is missing.

### P7 — АДФИ inspections + Сметна палата audit reports.

Both publish findings on procurement legality. We already crawl `bulnao.government.bg`
(`smetna_palata` watcher), so the access pattern is familiar; audit reports are a separate
register. АДФИ is the body ACF says it will refer this case to — "has this buyer ever been
inspected, with what finding" is a cheap, strong column on `/awarder/:eik`.

### P8 — Subcontractors (подизпълнители).

Declared in ЦАИС ЕОП, partially surfaced in `ProjectFileScreen`, not a corpus-wide table. The
money on a contract is not the money that reaches the work.

### P9 — ИСУН нередности / financial corrections.

Which EU-funded contracts were later corrected or recovered. Joins to `fund_projects` and
`contracts` and is the **only outcome signal in the whole funds corpus** — it pairs directly
with the §1.6 spine: grant → contract → *and whether it was clawed back*.

### P10 — TED (Tenders Electronic Daily).

Identified in `tender-dossier-ingest-v1.md` §9.4 as an open bulk alternative for the
EU-threshold subset. Cross-check for above-threshold completeness plus EU comparators.

**Cross-cutting requirement for every one of P1–P10:** a watcher in `state/watch/`, a
`db:load:<x>:pg:cloud` command, a `recent_updates` changelog row, an entry in the Data Map, and
a line in the relevant watch skill — per `reference_migrated_family_watch_reload`, a migrated
family without a cloud loader goes stale on prod with every row count reconciling.

---

## 3. Sequencing

| Step | Contents | Depends on |
|---|---|---|
| **1** | T0.1–T0.5 (register, seat, gate) | — |
| **2** | §1.3 the `?sector=` registry + filter + reciprocity gate | 1 |
| **3** | T2.1–T2.2 (`declaration.employer` + resolution) — parallel, no external source | — |
| **4** | T1.6a–c (grant→contract lineage + coverage route) | — |
| **5** | The hub: routes, registry, scenes, blob, finder (§1.7–1.8) | 1, 2, 4 |
| **6** | `/culture/procurement` + `/culture/funds` + `/culture/institutions` bodies | 5 |
| **7** | T2.3–T2.4 (directors, procurement officers) | 3, 6 |
| **8** | P1 (full dossier crawl) — operator decision | — |
| **9** | T3.1 ДКИ register, re-run step 1's gate | 8 optional |
| **10** | P2, P3 — the two that change what procurement can assert | — |
| **11** | P4–P10, each with its watcher + cloud loader | — |
| **12** | **Write the `sector-dashboard` skill** (Part 3) | 1–7 shipped |

Steps 1–7 need **no new external source**. Everything is already on disk or in Postgres.

---

# Part 3 — LAST STEP: write the `sector-dashboard` skill

**Do this after steps 1–7 have shipped, not before.** The skill's value is the defect list,
and a defect list written from a plan rather than from what actually broke is advice. The
`dashboard-hub` skill says this about itself: every section exists because something shipped
wrong once, and the value is in the reason being concrete.

## 3.1 Why it needs to exist

There are **~20 sector surfaces** and they were each built by hand:

- 14 generic `/sector/<key>` dashboards (`sectorDashboards.ts`): tourism, health, roads,
  transport, regional, social, revenue, customs, administration, edu, agri, energy, security,
  environment
- 6 bespoke views: `/culture`, `/judiciary`, `/defense`, `/pensions`, water, `/subsidies`
- 6 awarder sector packs (`sectorPacks.tsx`): Roads, NOI, NZOK, VSS, MON, Kultura, Vik,
  Defense, MVR

`dashboard-hub` covers the tile grid and `docs/testing-standards.md` the tests. **Nothing
covers the sector layer**: the EIK register, the four-corpus union, the coverage declarations,
the risk/competition baselines, the buyer↔beneficiary role split. This plan had to rediscover
every one of them, and three were found only by measuring.

## 3.2 What it must carry — the findings, with their evidence

Each of these is a rule *plus* the measurement that produced it. That pairing is the skill's
whole value.

**A. The EIK register is the foundation, and it silently under-covers.**
Culture's frozen 21-EIK allowlist covered **66% of its own sector's money** (€146m of €219.7m)
and omitted its largest single buyer. Rule: three explicit lists (in / verify / excluded), a
gate enumerating candidates by regex and failing on any unclassified buyer above a money
floor, and a `role` column because the same EIK is a buyer in one corpus and a beneficiary in
another.

**B. Name regexes produce sector-scale false positives.** „култур" over `agri_subsidies`
returns €166.3m; the truth is €18.3m — the rest is „полски **култури**". „операц" pulls ЕСО,
ДАТО and жандармерия into a culture query. Rule: every regex ships with its exclusion list and
a test asserting the exclusion **changes the number**; `EXCLUDED_EIKS` documents each
false match so a later sweep cannot re-admit it.

**C. Every headline needs its baseline, or it asserts something false.** Culture single-bid is
**40.2%** against a national **40.9%** — typical. Shown alone it reads as an indictment. Rule:
a sector rate renders beside the national rate from the same query, and the skill names this
as the sector-dashboard instance of the hub skill's "arithmetically right, false as a
sentence" class.

**D. One question, several corpora, several bases.** Culture money is six streams on five
bases spanning €11.0m to €474.3m. Rule: follow migration 127's canonical four-arm union, put
the basis in the label not the footnote, and never sum across bases.

**E. Coverage is a first-class field.** Only **24%** of Bulgarian partners on culture-themed
Interreg operations carry an EIK, so an EIK-keyed filter answers a quarter of the question at a
200. `tender_search_text` is the precedent: **0.78%** coverage behind a live search. Rule: a
corpus arm returns its own coverage and the surface states it — the pattern is
`/api/db/tender-search-coverage`.

**F. Two questions that look like one.** "Culture bodies doing Interreg" (€11.0m) vs "Interreg
culture money reaching Bulgaria" (€89.6m): 8× apart, different join, different partner
population. Rule: a thematic arm joins through the operation, an institutional arm through the
beneficiary set, and a surface picks one and labels it.

**G. The people layer is where sector dashboards stop.** Every sector has directors who file
declarations and procurement officers who run its tenders, and none of them are linked to
their institution because `declaration.institution` is a group label. Rule: use
`declaration.employer` (T2.1) and the confidence bar; never assert a name match as identity.

**H. The money spine generalises.** Grant → institution → procedure → contract → contractor →
owner, at **98.9%** ПИИ-code join coverage. Rule: it is a shared `src/ux/` object, not a
per-sector chart.

**I. Sector-specific risk needs a peer group.** `nearCeilingAward` looks damning at €0.29 under
a €454,611.59 ceiling and turns out to be *common* for small buyers — six of eight ACF
procedures sat at 98.8–100%. Rule: score against a sector/size peer group, publish the base
rate beside the flag, and word every signal „за проверка".

**J. Deployment.** Every sector table needs a `db:load:*:pg:cloud`, a watcher, a
`recent_updates` row and a Data Map entry, per `reference_migrated_family_watch_reload`.
`REFRESH_GENERATORS`/`ORDER_PAIRS` membership for anything derived.

## 3.3 Shape

`.claude/skills/sector-dashboard/SKILL.md`, sibling to `dashboard-hub` and **explicitly
deferring to it** for the tile grid, bands, scenes, accents, search and gates — this skill owns
the *data layer under* a sector surface, not the layout. Sections mirroring the house style:
§0 measure the register first · §1 the EIK register and its gate · §2 the four-corpus union ·
§3 baselines and bases · §4 coverage declarations · §5 the people layer · §6 the money spine ·
§7 sector risk · §8 deploy · §9 gates · §10 keeping it current.

It should carry a **retrofit checklist** so it can be run against an existing dashboard, and
the first three retrofits are the test of whether it is any good: `/judiciary`, `/defense`,
`/sector/energy`. If running the checklist on those three surfaces produces no findings, the
skill is a description rather than a tool and should be cut back to the parts that did.

**Open:** whether the 14 generic `/sector/<key>` dashboards should converge on the hub pattern
too, or stay a distinct, lighter shape. Decide from the retrofits, not in advance.

## 4. Gates to write (hub skill §8)

- Every culture buyer above a money floor is in exactly one declared list.
- Every tile id has a scene; every `to` is absolute and in the routed list; every sub-page is a
  hub destination; no accent repeats.
- The hub blob is under its byte budget and every written file is in the `--upload` list.
- The single-bid tile renders the national baseline, both numbers from one query, baseline not
  hard-coded.
- Every figure recomputed from its declared basis, with the **rejected** bases asserted as
  `notEqual` (179/674 = 26.6% is one word away from 179/445 = 40.2%).
- Every `?sector` value a tile emits is read by its destination; every see-all param likewise.
- The `култури` exclusion **changes** the agri number (€166.3m → €18.3m) — a guard that does
  not move the figure it guards is a guard nobody will keep.
- Every corpus arm returns its own coverage, and no surface renders an EIK-keyed Interreg
  figure without it (24%).
- `sector_eik.role` is honoured: no buyer set is joined to a beneficiary corpus.
- A scoped search source returns out-of-scope rows for a query that has them — the test that
  catches scope silently filtering.
- Each search group's cap is independent.
- `declaration.employer`: distinct-value count and unresolved share reported; the loader
  refuses to publish a resolution below its confidence bar.
- `grant_contract_link`: coverage published, and no link presented above its stored confidence.
- **Then break each gate's clauses and watch them fire** (hub skill §8).

## 5. Open questions

1. **SEO** (§1.7) — moving the film dashboard off `/culture` to `/culture/subsidies`. Needs a
   redirect decision if anything links the old anchors, and prerender entries for four new
   sub-pages.
2. **T0.5** — читалища in or out. Recommend a labelled sub-group.
3. **P1** — authorisation to run the full dossier crawl (~1.4 h against a shared public register).
4. **§1.9-6** — `nearCeilingAward` needs a measured base rate before it can be called a signal.
5. **T3.3** — the 9b conflict-flag policy sign-off is still outstanding from the v1 plan.
6. **§1.3** — whether ДФЗ enters `sector_eik` at all, or stays a читалища-only arm resolved by
   name. It is the one corpus where no state culture institution appears (0 rows for all 26
   named EIKs), so an EIK dimension for it may be empty by construction.
7. **Part 3** — whether the 14 generic `/sector/<key>` dashboards converge on the hub pattern.
   Decide from the three retrofits, not in advance.
