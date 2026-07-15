# Съдебна власт (ВСС / judiciary) view — implementation plan v1

Status: **Phases 1 + 2 + 3a BUILT, code-reviewed, repaired and verified in dev; not committed** (2026-07-10). Mirrors the
**Води (water) plan** (`docs/plans/water-view-v1.md`) — shared infrastructure
(`OblastChoropleth`, `SectorBrowseSlot`) is designed once there and reused here; this
doc only calls out the judiciary specifics.

## 0. What shipped in Phase 1 (and what implementation changed)

The `VssPack` renders on `/awarder/121513231`: budget-bridge hero (per-body split +
self-financing bar), "Какво купува ВСС по функция" category tile, statutory-supplier
chip, both nav surfaces, OG card + sitemap + prerender, the AI `judiciaryBudget`
tool, README + `update-budget` skill docs. Verified in the browser (light + dark);
typecheck + lint clean.

Four things implementation taught us that the plan had wrong:

1. **Better budget source than planned.** The plan assumed slicing
   `izdrazhka_by_institution.json`. That field is **Текущи разходи** for the
   judiciary — the ЗДБРБ prints no Персонал line, so the residual formula subtracts
   nothing — which would have understated the budget *and* mislabelled it. Instead
   `scripts/budget/__write_judiciary.ts` parses the ЗДБРБ „Бюджет на съдебната власт"
   article directly. It carries **two** tables nobody publishes together: the
   judiciary's own revenue (съдебни такси) and the per-body expenditure split.
   2018–2025, Σ-reconciled at ingest (Σ bodies == total; Σ revenue == total).
   Cross-validated: the parsed `currentExpenditure` matches izdrazhka to the euro for
   all eight years, which confirms both parsers and the diagnosis.
   → This also gave the pack its differentiator: **self-financing** (2025: €707.8M
   expenditure, €77.7M own revenue = 11%, of which €70M court fees).
2. **2025 parse gotcha:** the per-body table is paragraph `(2)` up to 2024 and `(3)`
   from 2025, when a functional-area („програмен бюджет") table was inserted before
   it. Match the paragraph by wording, never by number.
3. **SQL perf — no precompute needed.** `EXPLAIN ANALYZE`: the pack's
   awarder-contracts query is **5.0 ms** (index scan, `idx_contracts_awarder_date`);
   the 58-EIK sector roll-up is **15.8 ms** (`idx_contracts_awarder`, 1,337 rows).
   Both far under the 200 ms precompute threshold — so the `judiciary_payloads` blob
   table and the new indexes proposed in §5 are **not warranted** at this scale.
   Revisit only if Phase 2 lands per-court caseload joins.
4. **No new watcher source.** The judiciary budget parses the *same cached law HTML*
   the budget ingest already fetches, so it rides the existing `budget_law` watcher →
   `update-budget` skill (a step was added there). That is why `npm run data:map`
   stayed clean: there is nothing new to place on the map, and §7's two new watcher
   sources belong to Phase 2/3, not Phase 1.

## 0b. What shipped in Phase 2 (the `/judiciary` screen)

The ВСС statistics ingest turned out to be **far cheaper than the plan feared** — the
annual PDFs carry a real text layer, so there is no OCR step at all.

- `scripts/judiciary/sources.ts` — curated `VSS_ANNUAL_TABLES` URL map (filenames are
  NOT uniform across years, same trap as the CIK bundle URLs) + the six court tiers.
- `scripts/judiciary/__write_caseload.ts` — fetches each year's PDF into (gitignored)
  `raw_data/judiciary/`, finds Приложение № 1, and reconstructs its two tables with
  pdfjs text positioning (rows bucketed by y, cells merged by x-gap — the same
  technique as the investment-annex parser). → `data/judiciary/caseload.json`,
  **2018–2025**.
- `/judiciary` screen: KPI row (filed · resolved · clearance · within-3-months ·
  pending · judge posts), the **caseload-flow hero** (filed vs resolved lines against
  the pending-backlog area), the **workload tile** (both official measures per tier),
  the per-tier league table, and a "Съдебната власт като възложител" tile linking
  each of the 6 central judicial bodies to its `/awarder/:eik` dashboard (the ВСС
  badged as carrying the budget breakdown; the other 50 courts counted, not listed —
  most have 1-3 contracts ever). Year selection uses the shared "Обхват" scope control
  (see §0d), not bespoke pills.
- SEO: `route_defs` (sitemap + prerender, BG + EN), a `staticPage` entry in
  `scripts/prerender/routes.ts` with `ogImage: /og/judiciary.png`, and an OG capture
  centred on the caseload chart. Nav: BOTH the governance menu and the procurement
  sector pill point at `/judiciary` under one label (`judiciary_nav`, unscoped —
  `/judiciary` has no `?pscope` dimension); the screen's "Съдебната власт като
  възложител" tile links out to each judicial body's `/awarder/:eik` page, so the
  ВСС buyer page is one click away rather than a competing nav destination.
- Watcher `vss_court_statistics` (fingerprints the listing page's PDF-link set; verified
  live: 33 PDFs, latest year 2025) → `update-judiciary` skill → stamps `state/ingest/`.
  Placed on the data map as source group `vss` + dataset `judiciary` + feature
  `f:judiciary`; `AI_PATH_RULES` maps `/judiciary/`.
- AI tools `judiciaryCaseload` + `judiciaryWorkload` (router + narrate, both languages);
  9 routing cases pass including the "съдът реши…" and НЗОК/НОИ regression guards.

### The finding the view exists to show
Clearance hovers at ~100% every single year (2018: 98.2% … 2025: 99.9%), so the courts
finish almost exactly what arrives — and the ~130k-case backlog is therefore
**structural**: it never drains, whichever way the inflow moves. 2025: 544,541 filed,
544,035 resolved, 129,536 pending, 81% inside the 3-month deadline, 2,260 judge posts.

### Parser gotchas (now documented in the skill + README)
1. **The decimal separator drifts** — a dot up to 2021 (`8.74`), a comma from 2022
   (`7,14`). Thousands are always a space, so accepting either as the decimal mark is
   unambiguous. This silently produced 0 workload rows for 2018–2021 until caught.
2. **Rows are keyed by order + numeric-cell count, never by label.** The wrapped
   "Районни съдилища извън / областните центрове" label leaves its data row
   *label-less* in section I, and "Окръжни съдилища + СГС" carried "+ СНС" until the
   specialised criminal court closed in 2022.
3. **Section II is sliced from both ends** (first three + last three numeric cells) —
   the civil/criminal middle block is absent for tiers whose bench doesn't split.
4. **Coverage caveat, surfaced in the UI:** Приложение № 1 excludes ВКС, ВАС and the
   prosecution, which report separately. The totals are *the courts*, not "the whole
   judiciary".

Reconciliation is asserted at ingest, so a bad parse throws rather than shipping: Σ
tiers == total per column, the stock-flow identity `pendingEnd == pendingStart + filed
− resolved`, and the printed "% в срок" == `round(withinDeadline / resolved)`.
Independently cross-checked: the PDF's own separate "СРАВНИТЕЛЕН ОТЧЕТ" page prints
2023 identically, and the ВСС's published 2021 headline (546,530 / 550,209 / 80%)
matches the parsed row.

## 0c. What shipped in Phase 3a (the declarations register — INDEX, not contents)

The ИВСС register is plain HTML on a Joomla site at a bare IP over HTTP
(`http://62.176.124.194`, linked from inspectoratvss.bg as "Публикувани декларации").
No WAF, no JS. Indexed by year × first letter of the given name: 9 years × 29 letters
= 261 pages.

- `scripts/judiciary/__write_declarations.ts` crawls those 261 pages plus the ИВСС's
  four non-compliance lists → `data/judiciary/declarations.json` (~12 KB).
  **46,528 declarations from 5,556 magistrates, 2017–2025.**
- `/judiciary` gains two tiles: the **filing calendar** and the **ИВСС
  non-compliance lists**, reproduced verbatim with their ЗСВ reference and a source
  link. AI tool `judiciaryDeclarations` (domain `people`) + router + narrate.
- Watcher `ivss_declarations` (verified live: 261 letter pages, 4 lists) fingerprints
  BOTH the register's year set and the visible text of each list, so a name added or
  cleared flips it. Wired into the `vss` source group + `update-judiciary`.

### The finding
**65.8% of all annual declarations are filed in May**, peaking on the **14th and 15th**
— the statutory 15 May deadline itself (4,212 declarations in those two days). Nobody
had measured this: the ИВСС publishes 46k PDFs and no index.

### Deliberate scope line: index, not contents
Each declaration is a 12-page multi-table form (v3.0 since 2022) with a real text
layer, so extracting assets **is** feasible — but it is 46k PDFs / **~37 GB** and a
separate project. The full per-declaration index with PDF paths is written to
`raw_data/judiciary/declarations_index.json` (gitignored) as its input.

### Framing rules baked into the code and the skill
Magistrates are **not elected officials**. Only what the ИВСС itself publishes is
reported: that a declaration was filed, when, and whom the Inspectorate names.
- Filing gaps across years mostly reflect entering or leaving the corps, **not**
  misconduct, so no per-magistrate compliance score is derived or displayed.
- An **empty** non-compliance list is shown as empty (green "няма" badge) rather than
  hidden — hiding it would let a reader assume the worst. Two of the four lists are
  currently empty; `change_late` names 32 people and `left_office_late` names 3.
- The filing-calendar caption states plainly that filing on the last day is lawful.

### Register quirks (documented in the skill)
Each year has **two** PDF directories — `/declaracii/<year>/` (annual, due 15 May) and
`/declaracii/<year>-1/` (change declarations under чл. 175в, ал. 5, filed through the
autumn); the year heading is wrapped in `<strong>`, so the heading regex must tolerate
tags; dedupe on the PDF path (a hyphenated surname can be listed under two letters);
and two входящи номера carry a typo'd date (`15.50.2024`, `13.15.2019`) — reported and
excluded from the calendar, never silently dropped.

Asserts: ≥8 years; ≥3,000 magistrates and BOTH batches per year; Σ years ==
declarations; and >40% May clustering (its loss means the входящ-номер date parsing
broke).

**Phase 3b (asset extraction) is NOT built** — see the scope line above.
`SECTOR_BROWSE_PACKS` (§4.3) also remains unbuilt; it is a shared prerequisite with the
water plan.

## 0d. Review + repair pass (2026-07-10)

A full code review (`CODE_REVIEW_REPORT.md`, annotated with outcomes) produced 14
findings + 3 duplication items + 2 doc gaps. All were implemented. The ones that
changed *behaviour or numbers*, not just style:

- **The ИВСС „(1)" footnote was being stripped.** Its legend is „лицето е подало
  декларация извън срока" — the person DID file, late. A name *without* it never
  filed. Both were rendering identically under a header that says "failed to file".
  Now carried through as `filedLate` → chip + reproduced legend. (Today all 35 named
  people carry the marker, which is exactly what made the bug invisible.)
- **The discrepancy list has five columns**, not four; „Вид декларация" was being
  truncated. Column counts are now declared per page and **asserted** — a shape change
  throws instead of silently dropping a field.
- **Two writers could ship a partial artifact.** A failed year set `process.exitCode`
  and wrote anyway, silently regressing `latestYear`. Now they refuse to write, with an
  explicit `--allow-partial` escape hatch.
- **The PDF cache was keyed on the year**, so a corrected re-publication was never
  re-fetched (the ВСС does re-publish — the 2021 file is named `…-2021_new.pdf`). Now
  keyed on the URL hash, plus `--refetch` for same-URL re-uploads.
- **The declarations ingest would have failed every spring.** Change declarations
  arrive through the autumn, so `change === 0` on the open year is the truth. The
  completeness asserts now skip the newest year and warn.
- **The budget-bridge share was computed across mismatched periods.** `procYears`
  counted years *with contracts* (a gap year inflated the average by 50%) and the
  ratio silently compared a scope window to an unrelated fiscal year. Now it divides by
  the window span and the sentence names both periods. **The headline moved 0,6% →
  0,5%** — the old number was wrong.
- **The prerendered SEO figures were hardcoded.** The prerendered HTML is the only
  thing crawlers see, so a stale number there is a stale number in search results. They
  are now interpolated from the committed artifacts at build time (verified by
  perturbing `caseload.json` and watching the emitted HTML follow).
- **AI tools silently answered the wrong year.** "бюджетът през 2015" returned 2025.
  They now return a scalar envelope naming the available range.
- **`ivss_declarations` hashed whole page text** (nav, banners, timestamps), so any
  unrelated site edit triggered a 261-page re-scrape. It now hashes only the table rows.

### Two corrections to the review itself
1. It listed 12 dead exports in `vssReferenceData.ts`; only **5** were dead — six had
   become live via `JUDICIAL_BODIES` / `COURT_COUNT`. Deleted the dead ones and wired the
   alias arrays into `COURT_LEVEL` so the merge is enforced rather than duplicated.
2. It called `"приключваем"` a redundant `has()` substring. It is not: the two
   occurrences sit in separate calls under different guards, and the second is the only
   path for a bare "приключваемост". Only `"съдиите"` and `"делата"` were shadowed.

### A gate that wasn't a gate
`npx tsc --noEmit -p tsconfig.json` type-checks **nothing** — the root config is a
solution file (`"files": []` + project references). The real gate is `tsc -b`, which
`npm run build` runs. Use that.

### UI alignment
`/judiciary`'s bespoke year pills were replaced by the shared `ProcurementScopeControl`
in the standard "Обхват" slot, matching `/subsidies` and the awarder pages. The control
gained an `allowAll?: boolean` prop (default `true`, so all six existing call sites are
unaffected) because the judiciary caseload is a per-year snapshot with no cross-year
aggregate — offering "Всички години" would select a scope the page cannot render.

## 1. Goal & thesis

Add a "Съдебна власт" government-entity view covering Bulgaria's judiciary, mirroring
the АПИ / НОИ / НЗОК sector packs. The reader-facing thesis no existing site tells:
the **backlog + натовареност dissonance** — cases pile up while courts sit at wildly
uneven load (Sofia District Court ~2× the national average, military courts idle),
and the money-and-integrity layer (judicial budget per case, magistrate asset
declarations) lives only in scattered ВСС PDFs and the Инспекторат register.
We are the only place that *joins* caseload, money, geography, and integrity.

Home surface: a **VssPack** on `/awarder/121513231` (Висш съдебен съвет) plus a
dedicated `/judiciary` screen for the caseload/map story, and a "Съдебна власт (ВСС)"
entry under **Държавни структури** in the управление menu (next to Пътища/АПИ,
Осигуряване/НОИ, Здравна каса/НЗОК, Води).

## 2. Entities — the judicial sector set (RESOLVED)

Unlike a single fund, the judiciary is a **multi-body sector** (like water's holding
+ 26 subsidiaries). Procurement is heavily centralised on the ВСС (it procures
buildings + IT for ВСС/ВАС/Прокуратура jointly — confirmed in a КЗК decision in our
corpus), but the sibling bodies are separate awarder EIKs.

**Resolved from local PG** (`contracts` ∪ `tenders`, 2026-07-09):
**58 judicial EIKs · 1,337 contracts · €174,713,773 · 2011-01-28 → 2026-06-02.**
Note the two bases: the headline **1,337** and every € figure are **contracts only**;
the per-body row counts below are **contracts ∪ tenders** (e.g. ВСС = 171 + 142 = 313).
ВСС alone is €78.2M = **45% of the sector**. 56 EIKs carry contracts; 2 appear only
in `tenders` (РС Лом `000321038`, РС Луковит `000291787`).

### Core bodies

| Body | EIK | Rows (contracts + tenders) | € (contracts only) | Note |
|---|---|---|---|---|
| **Висш съдебен съвет (ВСС)** | **121513231** | 313 | €71.1M | Pack anchor; administers the съдебна власт budget |
| ВСС — съдийска колегия (interim mandate) | **181092349** | 12 | €7.2M | "Съдийската колегия…изпълняваща функциите на ВСС" (2024, пар. 23 ПЗР ЗИД КРБ). **Alias to ВСС** |
| Прокуратура на РБ (ПРБ) | **121817309** | 998 | €50.5M | **One EIK for the WHOLE prosecution** — see caveat below |
| Главна прокуратура (legacy) | **000695064** | 10 | €0.5M | 2011 only. **Alias to ПРБ** |
| Върховен административен съд (ВАС) | **121267370** | 109 | €19.0M | |
| Върховен касационен съд (ВКС) | **121268006** | 45 | €4.3M | |
| Инспекторат към ВСС (ИВСС) | **175451413** | 21 | €0.7M | Also the **declarations register** source (§3, §7) |
| Национален институт на правосъдието (НИП) | **131177220** | 96 | €3.5M | Judiciary-system body, funded via the ВСС budget → **include** |

### Courts (50 EIKs)
- **Апелативни (2)**: `121654463` Апелативен съд **София** (name in corpus is bare
  "Апелативен съд"; disambiguated via `awarder_locality='гр.София'`/BG411), `102180174` Бургас.
- **Административни (11)**: Пловдив `160078385`, Силистра `118581706`, Перник `113586518`,
  София-град `175200279`, Благоевград `101749078`, Варна `148076820`, В. Търново `104681629`,
  Русе `117675942`, Ст. Загора `123739574`, Кюстендил `109600905`, Сливен `119667813`.
- **Окръжни + Софийски градски (14)**: СГС `000696532`, Русе `000530739`, Бургас `000057389`,
  Ямбол `000970521`, Добрич `000852989`, Ст. Загора `000818150`, Варна `000093741`,
  Благоевград `000025078`, Пазарджик `000351953`, Шумен `000931760`, Хасково `126004302`,
  В. Търново `000134056`, Перник `000386833`, Сливен `000590768`.
- **Районни (23)**: СРС `831462482`, Пловдив `000471778`, Варна `000093759`,
  Г. Оряховица `000134070`, Гоце Делчев `000025092`, Козлодуй `816076609`, Дряново `000216037`,
  Нова Загора `000590794`, Разград `000506065`, Карлово `000471792`, В. Търново `000134063`,
  Трявна `000216215`, Севлиево `000216044`, Ст. Загора `000818168`, Хасково `126133788`,
  Казанлък `000818175`, Добрич `000852996`, Свиленград `000904037`, Нови пазар `000931785`,
  Ардино `108001913`, Благоевград `000025085`, Лом `000321038`*, Луковит `000291787`*
  (*tenders only).

### Structural findings that shape the design
1. **ПРБ is a single legal entity.** EIK `121817309` covers *every* prosecution unit —
   районни / окръжни / апелативни / военно-окръжни прокуратури **and the НСлС**
   (Национална следствена служба). A per-unit prosecution breakdown is therefore
   possible **only via `awarder_name`, never via EIK**. Same "union entity vs
   split-share" trap as the SIGMA parity audit — label the tile accordingly.
2. **Two alias pairs** must be merged before any roll-up: `181092349`→ВСС and
   `000695064`→ПРБ. Otherwise the ВСС headline understates by €7.2M.
3. **Конституционен съд (`000698605`) is EXCLUDED.** Per чл. 147 КРБ it sits outside
   съдебна власт as a separate constitutional body. It appears in `tenders` only.
   Mention it nowhere in sector totals; if surfaced, label "извън съдебната власт".
4. **Executive bodies EXCLUDED** (commonly confused with the judiciary): Министерство
   на правосъдието `000695349`, ГД "Охрана" `129010011`, ГД "Изпълнение на наказанията"
   `129010029` — these are МП / executive branch, not съдебна власт.
5. **No специализиран наказателен съд or military-court awarders** (СНС closed 2022;
   military courts don't procure separately).
6. **Coverage is thin at the bottom.** Most районни съдилища have 1–3 contracts ever —
   the judiciary procures centrally through the ВСС. Per-court *procurement* tiles will
   be sparse; per-court **caseload** (§3 Tier B) is the dense, interesting grain.

Store in `src/lib/vssReferenceData.ts`: `VSS_EIK="121513231"`, `VSS_ALIAS_EIKS`,
`PRB_EIK` + `PRB_ALIAS_EIKS`, `JUDICIAL_EIKS` (the 58), `COURT_LEVEL[eik]`, and a
court-code→EIK crosswalk. The consolidated-group rule applies: sector-wide procurement
tiles aggregate across the whole EIK-set, not just the ВСС parent.

## 3. Data source inventory (tiered by ingest cost)

Three sources are **already in our data** — the Tier-A MVP renders before any new ingest.

### Tier A — already ingested, zero new pipeline
- **Procurement** across the judicial EIK-set (`contracts` / `tenders`, keyed by
  awarder EIK). Consolidated group roll-up. ВСС alone: 142 procedures in the tenders
  index.
- **Judicial budget** — the съдебна власт is a distinct first-level spending body in
  the state budget we already ingest (`data/budget/`). Slice it out → budget-per-case,
  salary share, capital.
- **EU funds (ИСУН / ОПДУ „Добро управление")** — ВСС + ИВСС are named beneficiaries
  (justice-system reform projects). Join by beneficiary EIK.

### Tier B — structured, official, backfillable (one parser each)
- **ВСС statistical tables** (vss.justice.bg, XLS / „машинночетим формат", 2005–2025):
  cases filed / resolved / pending, within-3-month-deadline %, judge/prosecutor/
  investigator headcount, by court and court level (ВКС / ВАС / ПРБ / НСлС). The spine
  of the caseload + натовареност + duration story. Needs a **stable court-ID crosswalk**
  (courts get reorganised across the span — same class of problem as the oblast-code
  shard mismatch).
- **SINS натовареност** — complexity-weighted judge workload (publicly contested
  methodology — show raw + weighted).

### Tier C — new scrape (integrity differentiator)
- **Magistrate asset declarations** — Инспекторат към ВСС register (inspectoratvss.bg;
  **separate from the cacbg register** we already scrape for MPs/officials; ~25k
  declarations 2017–2024). Feeds the integrity tile (wealthiest magistrates, cars,
  apartments) cross-linked into the **Връзки** graph — a distinguishing capability of
  this view.

### Tier D — benchmarks (reuse existing)
- **EU Justice Scoreboard / CEPEJ** — clearance rate, disposition time, budget/capita,
  judges/100k, digitalization, trust; BG vs peers via `/indicators/compare`.
- **Trust in judiciary** — reuse the existing Eurobarometer table.

## 4. Architecture

### 4.1 The shared sector-pack grammar (extracted from АПИ/НОИ/НЗОК)
All three shipped packs share one 10-part skeleton; VssPack reuses it verbatim.
Reference `src/screens/components/procurement/{roads,noi,nzok}/*Pack.tsx` and the full
grammar table in the water plan §4. In brief:

| # | Element | Reuse | Vss usage |
|---|---|---|---|
| 1 | Section shell | `<section className="space-y-4">` | verbatim |
| 2 | Icon + title | `flex items-center gap-2 pt-2` + lucide icon + `<h2 text-lg font-semibold>`, bilingual | `Scale`, "Съдебна власт (ВСС)" |
| 3 | Domain-only KPI row | `grid gap-3 grid-cols-2` of `StatCard`, `text-2xl font-bold tabular-nums` | "Поръчки на година" + "Бюджет на съдебната власт" |
| 4 | Auto insight chips | `{text,warn?}[]`, `rounded-full`; `warn`→`WARN_CHIP_COLORS`; ≤5 | peak year, top category, direct-award % (warn >10%) |
| 5 | Hero "bridge" tile | fuse contract ledger with the bigger money | **budget bridge**: procurement as % of the judicial budget (clone `NzokBudgetBridgeTile`); tag its hero `data-og="vss-bridge"` for the OG card (§10.1) |
| 6 | "What X buys, by function" | CPV→function `categoryLabel(id,lang)` | IT/сгради/охрана/услуги |
| 7 | Domain visuals | `Card/CardHeader/CardTitle/CardContent` (`@/ux/Card`), `text-[11px]` caption | budget/procurement/funds tiles |
| 8 | Optional local control | shared Radix `Select` only | budget-year picker (clone NZOK) |
| 9 | Static explainer | roads' "what drives cost/km" | "Как се измерва натовареността" (SINS caveat) |
| 10 | Provenance footer | `text-[11px] text-muted-foreground/80` | "бюджет — ЗДБРБ; поръчки — АОП/ЦАИС ЕОП; статистика — ВСС" |

Gating: `isLoading` → `h-[280px] animate-pulse rounded-xl border bg-card`; empty →
`return null`, but keep budget/statistics tiles alive with zero contracts in scope
(NZOK nuance).

### 4.2 Why the judiciary also needs a dedicated screen
The three packs are **procurement-centric** (everything hangs off
`useAwarderContracts`). That fits the judiciary's money story but not caseload flow,
натовареност map, duration, or declarations. So: **Phase 1 = pack** (money, fast,
on-pattern); **Phase 2 = dedicated `/judiciary` screen** built from the same primitives
(Card, StatCard, insight chips, `OblastChoropleth`, DbDataTable), homepage shell, no
tabs. The pack becomes the screen's "Пари" section (or links to `/awarder/121513231`).

Screen tiles, each mapped to a reused primitive:
- **Headline KPIs** — `StatCard` row (cases resolved, clearance rate, %-within-deadline,
  backlog, active magistrates, budget).
- **Каселоад flow** (signature) — filed/resolved/pending area chart 2005–2025 +
  clearance gauge. New Recharts tile.
- **Натовареност съдебна карта** — `OblastChoropleth` small-multiples (raw case count ·
  SINS-weighted load · clearance), click-to-filter the league table. Reuse the water
  plan's `OblastChoropleth` extraction (§4.1a there).
- **Court league table** — DbDataTable "See all" page `/judiciary/courts` (sortable by
  load/clearance/duration/staffing/vacancies, deep-links to court pages).
- **Продължителност** — duration distribution + within-deadline %.
- **Интегритет** — magistrate declarations tile (MpAvatar rows) → `/judiciary/magistrates`
  DbDataTable, cross-linked into Връзки.
- **EU compare + trust** — reuse `/indicators/compare` radar + Eurobarometer.

### 4.3 Contracts custom pack (sector browse pack — shared prerequisite)
The judicial bodies are multiple awarder EIKs, so — exactly like water — the "see all
судебна власт contracts" surface is the **sector browse pack** on `/procurement/contracts`,
NOT a bespoke fork. This seam is **designed in the water plan §4.3 but not yet built**
(`grep SECTOR_BROWSE_PACKS` → nothing today), so whoever ships first builds it:

- New registry `SECTOR_BROWSE_PACKS` in `sectorPacks.tsx`, keyed on a **sector id →
  EIK-set** (vs `getSectorPack(eik)`'s single entity). Add a `{ id: "judiciary", eiks:
  JUDICIAL_EIKS /* the 58, §2 */, fixedFilters → awarder_eik IN eiks, Section?, columns? }`
  entry. A derived `court level` column comes free from `COURT_LEVEL[awarderEik]`
  (client-side, no backend change) — except for ПРБ, whose units only separate by
  `awarder_name` (§2 finding 1).
- `SectorBrowseSlot` mounted in `ContractsBrowserDbScreen` / `TendersBrowserDbScreen`
  reads `?sector=judiciary`, merges the EIK filter into the existing scope/CPV/method
  filters, and renders a judiciary enrichment strip above the table.
- The "Съдебна власт (ВСС)" nav pill links `/procurement/contracts?sector=judiciary`.
- **Backend prerequisite:** `contracts` `/api/db/table` registry must whitelist
  `awarder_eik` as a filter column (likely already — `/company/:eik` filters by it;
  verify). EXPLAIN-ANALYZE the `awarder_eik IN (…)` + window filter (§5).

### 4.4 Nav (two surfaces) + files
- **управление menu** — `src/layout/header/reportMenus.ts`, `menu_group_state_entities`
  group: add `{ title: "procurement_vss_nav", link: VSS_AWARDER_PATH }`.
- **Procurement sub-nav** — `ProcurementNav.tsx` `secondaryItems`: add
  `{ to: VSS_AWARDER_PATH, icon: Scale, key: "procurement_vss_nav" }` (uses
  `useProcurementHref` so scope survives).
- i18n: `procurement_vss_nav` = "Съдебна власт (ВСС)" / "Judiciary (ВСС)" in
  `src/locales/{bg,en}/translation.json`.
- Frontend files (mirror NZOK): `src/lib/vssReferenceData.ts` (NEW: EIK + sibling set +
  court crosswalk + category labels), `src/lib/vssAttributes.ts` (NEW: CPV→function
  classifier), `src/data/procurement/useVss.tsx` (NEW: contracts + budget + funds →
  `VssModel`), `src/data/budget/useBudget.tsx` (EDIT: `useJudicialBudget`,
  `useJudicialStats`), `src/screens/components/procurement/vss/` (NEW:
  `VssPack.tsx`, `VssBudgetBridgeTile`, `VssCategoryTile`), register `121513231`→`VssPack`
  + export `VSS_AWARDER_PATH` in `sectorPacks.tsx`. Phase 2 adds the `/judiciary` screen
  + `src/screens/dev/JudicialCourtsDbScreen.tsx` / `JudicialMagistratesDbScreen.tsx`.
- SEO files (§10): `scripts/prerender/institutions.ts` (EDIT: add the `vss` catalogue
  entry — drives prerender + sitemap + OG at once), `scripts/sitemap/route_defs.ts`
  (EDIT Phase 2: `judiciary` + `judiciary/courts` + `judiciary/magistrates` routes),
  `scripts/og/capture-screens.ts` (EDIT Phase 2: the `/judiciary` map/chart capture),
  `scripts/prerender/dynamicRoutes.ts` (EDIT Phase 2: the `/judiciary` static-route OG
  branch → `/og/judiciary.png`). Phase-1 needs only the catalogue entry.

## 5. Data model & SQL performance

PG-only convention (like agri/funds — no build*FromRows/db:gen; ingests write PG
directly; dashboard served from a precomputed blob table).

### Tables (new — Phase 2/3)
- `court_dim` — `eik PK`, `court_code`, `name`, `level` (районен|окръжен|апелативен|
  административен|ВКС|ВАС), `oblast`, `active_from/to` (the crosswalk for reorganisations).
- `court_caseload` — fact: `(court_code, year, half) PK`, `filed`, `resolved`, `pending`,
  `within_deadline`, `load_raw`, `load_sins`.
- `court_staffing` — `(court_code, year) PK`, `judges`, `vacancies`.
- `magistrate_declarations` — `(magistrate_id, year) PK`, `name`, `court_code`, `apartments`,
  `cars`, `assets_eur`, … (Tier C).
- `judiciary_payloads` — `(kind, key) PK`, `payload jsonb` (kind = `overview` | `court` |
  `sector_map` | `magistrates`), mirroring `agri_payloads` / `fund_payloads`; served via
  `/api/db/judiciary-*`.

Budget, EU funds, procurement are **joins onto existing** `budget` / `fund_*` /
`contracts` by EIK — not new tables.

### SQL performance verification (per the "always check DB query perf" rule)
Every new/changed query gets `EXPLAIN ANALYZE` on the **worst-case entity** before
shipping; add the index if it seq-scans (part of "done"):
- Index `(court_code, year)` on `court_caseload`, `court_staffing`; `(magistrate_id,
  year)` on `magistrate_declarations`; `court_dim(oblast)`, `court_dim(eik)`.
- **Worst case = the consolidated group roll-up** — `contracts WHERE awarder_eik IN
  (<58 judicial EIKs>)` (1,337 rows out of the full corpus) and the funds join on
  `fund_beneficiary_eik IN (…)`. Verify
  `contracts(awarder_eik)` and the funds beneficiary FK are indexed on **both sides** of
  the join (PG perf playbook); the `IN` list must be an index scan, not a seq scan over
  the whole corpus. This is the exact query the §4.3 sector browse pack fires.
- **Precompute** the group roll-up + натовареност sector-map into `judiciary_payloads`
  at ingest (global-hot, >200ms if live), not per page load. jsonb builders follow the
  payload-determinism rules: `ROUND` sums, rounded sort keys with eik tiebreaks,
  `COLLATE "C"` MINs; run the parity-audit recipe against a JSON dump of the same query.
- **DbDataTable** "See all" pages: register `/api/db/table` REGISTRY entries (a registry
  row each, not new endpoints; the column whitelist is the security boundary) —
  `judiciary-courts` (court × caseload/staffing, oblast+level+year filters),
  `judiciary-magistrates` (magistrate × declarations). Contracts "See all" reuses the
  existing `contracts` registry with the judicial EIK filter (§4.3). EXPLAIN-ANALYZE each.
- EUR sums use `totalEur = Σ per-row amountEur` (PG basis), never per-currency convert.

## 6. AI chat tools

Add a judiciary tool family mirroring the procurement/awarder tools (per the ai/ tool
recipe): create `ai/tools/judiciary.ts`; edit `ai/tools/registry.ts` (import + `ToolDef`
entries in `TOOLS`), `ai/orchestrator/router.ts` (keyword block),
`ai/orchestrator/narrate.ts` (cases). Tools NEVER compute numbers in prose — they only
narrate `env.facts`; data via `fetchDb("judiciary-*", …)` for PG blobs or
`fetchData("/…")`.

- `courtCaseload` (domain `indicators`) — filed/resolved/pending + clearance, national
  or per-court.
- `courtWorkload` (domain `indicators`) — натовареност (raw + SINS) by court/oblast;
  most/least loaded.
- `judicialBudget` (domain `fiscal`) — судебна власт budget, budget-per-case, procurement
  share, EU funds drawn.
- `courtProfile` (domain `place`) — one court: caseload, duration, staffing, top contracts.
- `magistrateDeclarations` (domain `connections`) — wealthiest magistrates / cars /
  apartments (Tier C), with Връзки cross-links.
- `judiciaryEuCompare` (domain `compare`) — clearance/duration/budget/trust vs EU peers.

Router keywords: `съд|съдилищ|съдебн|прокуратур|магистрат|дела|натоварен|правосъд|ВСС|
court|judge|caseload|judiciary|prosecut`. Provenance strings: `db:judiciary-*` /
`vss.justice.bg`. Any `/…json` path an ai/ tool reads MUST have an `AI_PATH_RULES` entry
(§9) or the prebuild fails.

## 7. Watchers & process-watch-report wiring

Watcher sources (`scripts/watch/sources/*.ts`, `WatchSource` shape: `id`, `label`, `url`,
`cadence`, `fingerprint()`, `describe()`), imported and added to `SOURCES` in
`scripts/watch/sources/index.ts`:
- `vss_court_statistics.ts` — cadence `monthly` (annual + I-полугодие tables, check often);
  fingerprint = hash of the latest statistics-table link/date on vss.justice.bg.
- `ivss_declarations.ts` — cadence `monthly`; fingerprint = latest declaration-register
  publication on inspectoratvss.bg (Tier C).

(Budget / EU-funds / procurement changes already flow through the existing
`data.egov.bg бюджет`, `ИСУН EU funds`, `data.egov.bg АОП` watchers — no new source.)

Process-watch-report mapping — add rows to the table in
`.claude/skills/process-watch-report/SKILL.md` (all fan out to one skill; the
orchestrator dedupes):

| Watcher source id | Skill |
|---|---|
| `vss_court_statistics` | `update-judiciary` |
| `ivss_declarations` | `update-judiciary` |

Skill: create `.claude/skills/update-judiciary/SKILL.md` (shape on `update-nzok`). After a
successful run it stamps `state/ingest/update-judiciary.json` via
`npx tsx scripts/stamp-ingest.ts update-judiciary --summary "…"` (`IngestState` =
`{skill, lastSuccessfulIngest, summary}`). Follow the one-off-backfill rule: the 2005–2025
historical table backfill goes behind a `--backfill` flag, never in the watcher/CI;
document in README.

## 8. recent_updates / changelog

Every new table wires into `recent_updates` via `recordIngestBatch`
(`scripts/db/lib/ingest_changelog.ts`), called INSIDE each loader's BEGIN/COMMIT txn with a
stable natural key that survives TRUNCATE+reload:
- caseload: `{ source: "court_caseload", table: "court_caseload", keyExpr:
  "t.court_code || ':' || t.year || ':' || t.half", nameExpr: "t.court_code", detailExpr:
  "t.year || ' · ' || t.resolved || ' решени'", amountExpr: "NULL", rowsTotal }`
  (day/period-coalesced + auto-summary >500/day per the changelog rule).
- declarations: `{ source: "magistrate_declaration", keyExpr: "t.magistrate_id || ':' ||
  t.year", … }`.

## 9. Data Map & README docs

### Data Map (`scripts/data_map/model.ts`) — the prebuild fails on an unplaced source
- `SOURCE_GROUPS`: add one `judiciary` group (`origin: "state"`, `members:
  ["vss_court_statistics", "ivss_declarations"]`, `skills: ["update-judiciary"]`, `tags:
  ["indicators"]`, `label/detail/desc/url` → ВСС / ИВСС).
- `DATASETS`: add `judiciary` (`path: "data/judiciary/"`, or note PG-served via
  `judiciary_payloads` — check how agri/funds are represented on the map).
- `EDGES`: `["src:judiciary", "ds:judiciary"]` + `["ds:judiciary", "f:<feature>"]` (feature
  node for the Vss pack / `/judiciary` screen).
- `AI_PATH_RULES`: add `{ pattern: /^\/judiciary\//, dataset: "judiciary" }` if any ai/ tool
  reads a static judiciary JSON.
- Verify with `npm run data:map`; the build errors "watcher source(s) not placed on the data
  map" if a source is missing from a group. The `/data`, `/data/sources`, `/data/updates`
  pages render from this model — no separate edit needed.

### README.md
- "Data sources" (~L472) — add ВСС court statistics, ИВСС magistrate declarations, judicial
  budget slice (reuse), ОПДУ EU-funds reuse.
- "Data layout" (~L205) — document `data/judiciary/` (or the `court_*` / `judiciary_payloads`
  PG tables).
- Note the `update-judiciary` CLI flags (`--backfill` etc.) alongside the other `update-*`
  skills.

## 10. Sitemap, static prerender & OG screenshots (SEO)

The Vite SPA + Firebase rewrite hides React `<meta>` from crawlers, so every new
public route needs a prerendered static HTML shell + a sitemap entry + an OG card, or
it's a homepage soft-duplicate (per the SEO / sitemap-validity notes). The packed
awarder pages already have a **single source of truth** — `INSTITUTION_PACKS` in
`scripts/prerender/institutions.ts` — that drives all three at once. Reuse it.

### 10.1 Phase-1 pack (`/awarder/121513231`) — one catalogue entry does everything
Add an `INSTITUTION_PACKS` entry; it auto-drives:
- `scripts/prerender/dynamicRoutes.ts` → the static `/awarder/121513231/index.html`
  with crawlable `bodyBg/En`, `<title>`/`<meta description>`, and
  `ogImage: /og/awarder/vss.png` (no dynamicRoutes edit — it consumes the catalogue).
- `scripts/sitemap/index.ts` → the `/awarder/121513231` (+ `/en`) sitemap URLs (the
  packed-awarder block, ~L701; also consumes the catalogue).
- `scripts/og/capture-screens.ts` → the per-institution OG capture (the loop over
  `INSTITUTION_PACKS`, ~L344).

```ts
{
  eik: "121513231", slug: "vss",
  nameBg: "Висш съдебен съвет", nameEn: "Supreme Judicial Council (ВСС)",
  titleBg: "Съдебна власт (ВСС) — бюджет и обществени поръчки | electionsbg.com",
  titleEn: "Judiciary (ВСС) — budget and public procurement | electionsbg.com",
  descriptionBg: "Бюджетът на съдебната власт и обществените поръчки на ВСС (ЕИК 121513231) …",
  descriptionEn: "The judiciary's budget and the ВСС's public procurement …",
  bodyBg: `<h1>…</h1><p>…</p>`, bodyEn: `<h1>…</h1><p>…</p>`,
  ogAnchor: '[data-og="vss-bridge"]',   // the budget-bridge chart — a CHART, not a KPI header
  ogSettleMs: 2500,
}
```
**Beautiful screenshot requirement:** the OG card must frame a chart, not a plain KPI
row. So `VssBudgetBridgeTile`'s hero element carries `data-og="vss-bridge"` and the
capture anchors on it (wide card → default `leftAlign`; the loop already pins the
clip's left edge). Same convention as `noi-flow` / `nzok-bridge` / `roads-map`.

Capture (dev server + `/api/db` backend up, since the awarder page reads from PG):
`npx tsx scripts/og/capture-screens.ts awarder/vss` → `public/og/awarder/vss.png`.

### 10.2 Phase-2 screen (`/judiciary` + "See all" pages) — route defs + a map OG card
The dedicated screen and its DbDataTable pages are ordinary SPA routes, so:
- **Sitemap + prerender** — `scripts/sitemap/route_defs.ts`: add `"judiciary"` to
  `STATIC_ROUTES` and `RouteDef` entries `{ path: "judiciary", file:
  "src/screens/JudiciaryScreen.tsx" }`, `{ path: "judiciary/courts", file:
  "src/screens/dev/JudicialCourtsDbScreen.tsx" }`, `{ path: "judiciary/magistrates",
  file: "…" }`. The prebuild emits `dist/judiciary/index.html` etc. (each must be a
  real file — a sitemap `<loc>` without one is a soft-duplicate).
- **OG card with a MAP** — add a `captures[]` entry in `capture-screens.ts` anchored on
  the натовареност choropleth, centered like the map pages (`persistence` /
  `wasted-vote`):
  ```ts
  { slug: "judiciary", routePath: "judiciary",
    waitFor: ".leaflet-container", anchor: ".leaflet-container",
    centerOnAnchor: true, settleMs: 2500 }
  ```
  → `public/og/judiciary.png`, framing the съдебна-карта choropleth. (Alternative
  anchor: the caseload-flow Recharts via `data-og="judiciary-caseload"` +
  `.recharts-wrapper`, if the map isn't in Phase 2's first cut — either way it leads
  with a chart/map.) Point the screen's `ogImage` at `/og/judiciary.png` in
  `dynamicRoutes.ts` (the static-route OG branch, like `governance` / `budget`).

### 10.3 Firebase deploy file-ceiling guard
Prerendering per-court pages (`/judiciary/court/:code`, ~150 courts) is fine, but do
**NOT** prerender a page per magistrate (thousands) — that blows the ~84k-file dist
budget (the deploy file-ceiling note). Magistrate rows stay inside the DbDataTable
route only; gate them the way candidate sub-tabs are gated.

## 11. Phasing

- **Phase 1 — money pack (Tier A, renders today, no new ingest):**
  `vssReferenceData.ts` (EIK 121513231 + sibling set), register the pack,
  `VssBudgetBridgeTile` (procurement as % of the judicial budget), `VssCategoryTile`, auto
  chips + KPI, budget-year picker, both nav links + `procurement_vss_nav` i18n. Shared
  prerequisite: build the §4.3 `SECTOR_BROWSE_PACKS` seam (or wait for the water plan to)
  and add the `judiciary` sector entry + `/procurement/contracts?sector=judiciary` pill.
  SEO (§10.1): add the `vss` `INSTITUTION_PACKS` entry (auto sitemap + prerender + OG),
  tag `VssBudgetBridgeTile` `data-og="vss-bridge"`, capture `public/og/awarder/vss.png`.
- **Phase 2 — the `/judiciary` screen (Tier B):** `update-judiciary` skill + ВСС statistics
  parser (caseload/duration/staffing + court crosswalk) → caseload-flow hero, натовареност
  `OblastChoropleth` triptych, `/judiciary/courts` DbDataTable, duration tile. Wire watcher,
  changelog, data map, README, AI tools. SEO (§10.2): add `judiciary` + `judiciary/courts`
  to `route_defs.ts` (sitemap + prerender) + the `/judiciary` OG capture anchored on the
  натовареност choropleth → `public/og/judiciary.png`.
- **Phase 3 — integrity + benchmarks (Tier C/D):** ИВСС magistrate-declaration scrape →
  integrity tile + `/judiciary/magistrates` (DbDataTable route only — NOT per-magistrate
  prerender, §10.3) + Връзки cross-links; EU Justice Scoreboard / CEPEJ compare on
  `/indicators/compare`; Eurobarometer trust.

## 12. Open questions / risks
- ~~Resolve the full judicial EIK-set~~ **DONE (§2)** — 58 EIKs, €174.7M. Remaining
  judgement calls baked in: Конституционен съд excluded (чл. 147 КРБ), МП/ГД Охрана/ГД ИН
  excluded (executive), НИП included (ВСС-funded).
- **ПРБ is one EIK for the whole prosecution + НСлС** (§2 finding 1) — per-unit
  prosecution analysis needs `awarder_name` parsing, and any "prosecution vs courts"
  split must not imply per-unit EIK grain.
- Merge the two alias pairs (`181092349`→ВСС, `000695064`→ПРБ) before any roll-up, or the
  ВСС headline understates by €7.2M. **Shipped for ВСС**: `useVss` fans out over
  `[VSS_EIK, ...VSS_ALIAS_EIKS]` and the pack carries a footnote reconciling its €66.4M
  against the €59.2M per-EIK header above it. The ПРБ pair is resolved but unconsumed —
  it becomes live with the first prosecution roll-up.
- Court reorganisations (съдебна карта) shift unit boundaries 2005–2025 — the court-ID
  crosswalk (`court_dim.active_from/to`) is the hard part.
- SINS натовареност methodology is publicly contested — show raw + weighted with a
  one-line "why these differ".
- Magistrate declarations are public and precedented, but magistrates aren't elected —
  mirror the MP-declaration framing, don't sensationalize; ИВСС register may need OCR (reuse
  the Gemini Vision pattern from council/capital-programmes).
- `SECTOR_BROWSE_PACKS` is unbuilt — coordinate with the water plan so it's built once.

## 13. Why this view is valuable
Public judiciary data exists but is scattered — government-CMS PDFs (vss.justice.bg,
2005–2025), the ИВСС declaration register, and assorted one-off analyses — with no single
interactive, longitudinal, geographic, integrity-linked dashboard. The value this view
adds: geographic + longitudinal + cross-linked (magistrate ↔ declarations ↔ Връзки ↔
procurement) + EU peer compare, all on infrastructure already built.

## Phase 5 — improvement analysis & suggestions (2026-07-15)

A review of the judiciary view produced a ranked set of improvement ideas, each
resolved for feasibility against our own data:

### SHIPPED this pass
- **Разход на свършено дело** (`CostPerCaseTile` + `data/judiciary/costPerCase.ts`).
  Courts' ЗДБРБ appropriation (`bodies[id=courts].amountEur`) ÷ Приложение № 1 resolved
  total — **scope-matched** (both exclude прокуратура/ВКС/ВАС), so we do NOT fold the
  ~€252M prosecution line into a per-court-case cost the way a naive "total judiciary
  budget ÷ court cases" figure does. Series 2018–2025: **€255 → €663, ×2.6**, resolved
  volume flat. Rendered on `/judiciary`, typecheck+lint clean, verified in dev.

### Improvement 1 (flagship) — per-court натовареност map — SHIPPED (2026-07-15)

A Leaflet map of **178 individual courts** (Районен 113 = rs_oblast 27 + rs_izvan 86,
Окръжен 28, Административен 28, Апелативен 6, Военен 3),
**2018–2025**, filter by year (page scope) / indicator / court type, dot size+colour = cases
per judge per month. `CourtLoadMap.tsx` + `useCourtLoad.tsx`, rendered as the signature
visual atop `/judiciary`. Verified in dev; typecheck + lint clean.

**Source:** **Приложение № 2 „Таблица за натовареността на магистратите"** — per-court
ДЕЙСТВИТЕЛНА натовареност (постъпили / за разглеждане / свършени на съдия месечно).
Parser `scripts/judiciary/__write_court_load.ts` → `data/judiciary/court_load.json`.

**Parser design that made it robust** (the table is a nightmare — unspaced counts weld into
the name cell, trailing administration columns vary by tier, section headers wrap):
- each row is reduced to its numeric sequence; the load block is anchored on the
  действителна triple (за разглеждане is the largest of the three) + the judge count after it;
- the anchor is **locked to the ВСС's own identity** `load = case_count ÷ person-months` — a
  backing integer count must exist in the row — which is what rejects the admin ratios
  (`5, 3, 2 …`) that otherwise mis-anchor the tiny районни;
- tiers assigned by **name prefix** (АС/ВС/ОС/СГС/АдмС/РС/СРС + the defunct АСНС/СНС for
  2018–2021), NOT the wrapping section headers; районни split by an oblast-capital set;
  a `cleanName` trim handles a header phrase that bleeds onto a row (2018 РС-Перник);
- **NB `\b` is ASCII-only** and does not fire after Cyrillic — bare abbreviations are matched
  by prefix, not `\b` (this cost a debugging cycle).
- **Reconciliation (hard gate, per tier):** Σ person-months and the pm-weighted действителна
  load == `caseload.json` (the ВСС's own definitions, exact to rounding). This gates exactly
  what the map shows and is independent of the judge-count щат-vs-заети/младши accounting,
  which differs from caseload by a few posts. **All 8 years reconcile; all 178 geocoded.**
- Geocoding: join court town → `settlements.json` `loc` (case-insensitive; Sofia pinned, as
  it is absent from that file).

**Markers (2026-07-15):** the map renders through the reusable
`src/screens/components/maps/SectorPointMap.tsx` — **one marker per CITY** (all courts in a
town merge, since they share the settlement centroid). The badge shows the **total judges**
in the city (Sofia = 633 across 8 courts); the colour is the **busiest court's** load band
(Sofia = amber, its СРС at 36.2), so an overloaded city stays visible. Multi-court cities
open a **paginating card** (header "N съдилища · M съдии", busiest court first, chevrons),
single-court towns a plain hover card — both in the polling-section look (`.sector-point-icon`
/ `.sector-tooltip`, smart placement + edge-clamp). NB: the earlier "#N rank" badge was
rejected — the number is a meaningful count, not a rank. `CourtLoadMap` owns the controls,
banding and legend and passes `SectorMapPoint[]` (value ranks within a city + colours the
marker; `badge` sums to the number). **SectorPointMap is generic** — МВР / other regional
dashboards reuse it (e.g. Варна's ОДМВР + РДПБЗН + … merge into one marker; `badge`/`value`
/`groupNoun`/`badgeNoun` are theirs to define).

**The finding the map shows:** the load is wildly uneven and *inverted* — the smallest районни
courts carry the heaviest per-judge load (2025: РС-Омуртаг 56, Малко Търново 55, Кула 54
resolved cases/judge/month) while appellate benches sit light. Rides the existing
`vss_court_statistics` watcher; `update-judiciary` skill gained Step 1b.

**Still open — the money join** (not yet built): €/case per court, or a procurement
column per court.

### Improvement 2 (EU justice-%GDP) — BLOCKED on clean source, deliberately not shipped
An EU comparison of justice spend as a share of GDP would need CEPEJ court-isolated spend.
Our only EU-peer source is COFOG division **03 „Public order & safety"**, which conflates
police + prisons + courts — using it would introduce exactly the case-mix/scope confound we
otherwise avoid. BG's own justice-%GDP is computable (`budget.totalExpenditure` ÷
`macro.nominalGdp`) but is benchmark-less without peers, so deferred until a CEPEJ pull.

### Improvements 3/4 — candidate net-new ingests (not built)
- **(Само)отводи** (recusals) and **командироване** (secondment): novel, strong analytical
  angles (recusals have risen sharply in recent years; secondment often bypasses the
  конкурс). Both are net-new sources (likely further ВСС appendices / decisions) → their
  own ingest.
- **Prosecution coverage**: we deliberately excluded ВКС/ВАС/прокуратура (Приложение № 1
  scope). Reconsider at least a prosecution-activity summary tile.

## Phase 6 — magistrates as connection nodes (declared holdings) — v1 slice BUILT (2026-07-15)

Extends the "money/connections join" to the judiciary: parse the ИВСС asset/interest
declarations (чл. 175а ЗСВ) for the companies each magistrate declares, resolve to EIK,
and surface as a first-class magistrate→company link. Deep-implementation analysis and
the deliberately narrow first slice below.

### Source (verified against a real declaration)
The v3.0 PDF form (since 22.11.2022) has a real text layer, 12 pages. Connection-relevant
sections: Таблица 16 (дялове в ООД/КД — company, %, seat, value), Ценни книги (акции —
emitter АД), ЧАСТ II Таблица 22 (управител/член на орган на управление/контрол),
Таблица 23 (участие в търговски дружества), Таблица 21 (ЕТ), Таблица 29 (свързани лица).
Filled values are positionally clean (same y-bucket/x-order technique as the court map),
but the fillable-form text layer **interleaves template labels with values**, so a
per-table column reconstruction is fragile.

### Design — company-name harvesting, not per-table parsing
Connections only need the company SET, so instead of reconstructing each table we harvest
cells that are company names (start with a capital, end in a legal-form token ООД/ЕАД/АД/…),
excluding template labels ("Наименование на ЕТ", "дялове в ООД", "акции"), from the two
pages that carry declared links. Attach a stake % when the row has one. Validated on a
13-declaration sample: Аглика Адамова → Елана Агрокредит АД / Градус АД / ГГС АД / Еуросис
ООД (25%); 11/13 declare nothing (sitting magistrates are barred from management — **the
output is sparse by design**).

### Reuse — the officials pipeline is the template
`scripts/declarations/build_officials_company_links.ts` already does name→EIK resolution
(`normCompany` strips legal-form tokens, matches `raw_data/tr/state.sqlite` `companies`,
UIC only on a UNIQUE match) with namesake confidence rules. The magistrate parser reuses
that verbatim. The one genuinely new component is the ИВСС PDF harvester.

### Built (this slice)
- `scripts/judiciary/__write_magistrate_holdings.ts` → `data/judiciary/magistrate_holdings.json`.
  Latest-year annual declarations only; streams PDFs (fetch→parse→discard, ~4 GB corpus
  never stored), resumable via `raw_data/judiciary/holdings_cache.json`. EIK resolved once
  against TR. Ownership + participation company names only.
- `useMagistrateHoldings.tsx` + `MagistrateHoldingsTile.tsx` on `/judiciary`: lists
  magistrates with a declared company; resolved companies link to `/company/:eik`;
  unresolved/ambiguous shown as text (never invented into a link).

### Framing (baked in, non-negotiable)
Magistrates are NOT elected officials. Reproduce only what the ИВСС publishes (a company
name in a filed declaration), name-matched to the registry — a LEAD, not proof. No stake
is inferred that is not printed; ambiguous names stay text.

### Key constraints / risks (from the analysis)
- **No EGN/ID** — 5,556 magistrates keyed by name only; namesake risk at scale (the same
  problem officials have, with no institutional slug). Confidence gating is essential.
- **No reconciliation ground-truth** — each declaration is unique, so parse errors are
  silent (unlike the court map, which asserts Σ vs caseload). Mitigated by internal markers
  ("Нямам нищо за деклариране") + a hand-checked sample; NOT yet a hard gate.
- **Partial EIK coverage** — name→UIC only on a unique match, so some declared companies
  stay unresolved. Honest, shown as text.

### Company-page surface — BUILT (2026-07-15)
The parser also emits `data/judiciary/magistrate_company_index.json` (inverse index
eik → magistrates who declared it; 235 companies, 7 declared by >1 magistrate — e.g.
Синергон Холдинг АД by 3). `useCompanyMagistrates(eik)` + `CompanyMagistratesTile`
render on `/company/:eik` next to `CompanyConnectionCheck`, showing nothing unless there
is a match. Verified on Синергон Холдинг АД (121228499). Skill wiring done (rides
`ivss_declarations`).

### Person-page surface — BUILT (2026-07-15)
`usePersonMagistrateHoldings(name)` + `PersonMagistrateHoldingsTile` on `/person/:name`:
if the person's name matches a magistrate with declared companies, the tile shows them
(resolved → `/company/:eik`, unresolved → text). Name-matched (normalized), framed as a
lead. Verified on Аглика Адамова-Петкова (3 resolved + 1 text). **All three connection
surfaces now shipped: `/judiciary`, `/company/:eik`, `/person/:name`.**

### Combined-search surface — BUILT (2026-07-15)
The parser emits a slim `data/judiciary/magistrate_search.json` roster (name · court ·
company count, ~33 KB). `useMagistrateSearchRoster(enabled)` + a **"Магистрати"** group in
the procurement `ProcurementSearchTile` match it client-side (same bilingual Cyrillic +
transliterated token match as the political roster), gated to first search interaction,
linking to `/person/:name`; deduped against the political and Commerce-Registry groups so a
name appears once. Verified: "Аглика Адамова" → the magistrate under МАГИСТРАТИ, the
namesake TR officer under ЛИЦА. All FOUR surfaces now shipped: `/judiciary`, `/company/:eik`,
`/person/:name`, procurement search.

### Not yet built (follow-ons)
- **Declared financials — a RANKING is not viable, but INFORMATIONAL per-page display SHIPPED
  (2026-07-15).** The parser now also extracts three validated figures per magistrate into
  `magistrate_holdings.json` `financials{bankCashLv, securitiesLv, realEstateCount}`, shown on
  the magistrate's `/person/:name` tile as SPECIFIC labelled amounts (converted лв→EUR), NOT a
  net-worth total and NOT a cross-magistrate ranking — framed "ориентировъчни, извлечени
  автоматично; следа, не доказателство". 203/208 have data; Аглика exact, Атанасов €496.8k +
  5 имота. Only the reliable dimensions are extracted: **bank/cash** (Tables 10+11, лв value =
  равностойност-after-currency else размер-before; bounded before Вземания), **securities**
  (лв after emitter), **real-estate COUNT** (Table 1 owned only, bounded before agricultural/
  transferred). **Income and liabilities are deliberately NOT extracted** — the prototype
  showed them unreliable, and a wrong figure on a named judge isn't worth it.
  - A **cross-magistrate RANKING remains not viable** — the earlier prototype showed the
    fillable form is filled inconsistently across declarations:
  - **Structure varies** — some fill the равностойност-в-лв column for BGN rows (Аглика,
    redundant), others leave it blank so размер IS the лв value (Vladimir Kovachev: the
    currency-anchored read caught only his 104 293 EUR row = 203 979 лв and **missed** two
    BGN rows totalling 63 395 лв → a 24% undercount).
  - **False positives** — NADEZHDA Shutova declared no bank accounts >10k, yet the bounded
    read still returned 6 854 лв from stray cells.
  - **No reconciliation ground-truth** (each declaration is unique), so good and bad
    extractions can't be told apart, and Table 10 (cash-on-hand) vs 11 (bank) vs 12
    (receivables) vs 13 (liabilities) all sit under one section III with drifting layouts.
  A wrong "declared wealth" on a NAMED judge is a serious integrity/liability risk, so this
  is **deferred**. If ever revived: needs per-declaration structure detection + a hand-checked
  validation set, or scope to a robust COUNT (not a лв total). The MP ranking
  (`build_assets_rankings.ts`) works only because its source is structured CAC XML, not this PDF.
- Related-persons (Таблица 29) and the TR-side name match (magistrate name → company_persons).
- Historical years / change declarations (only latest-annual current-holdings snapshot now).
- Magistrates without declared companies are not in the roster (only the 208 with a company).

### Tile UX (2026-07-15)
`MagistrateHoldingsTile` no longer scrolls a 208-row list: it shows the **top 8** (ranked by
declared-company count) with a **"Виж всички (208)"** expand toggle. House rule — no long
scrolling lists in tiles; top-N + see-all.

## Phase 7 — Postgres migration + perf + responsive (2026-07-15)

**Perf (data loading):** `/judiciary` shipped court_load.json (531 KB) + magistrate_holdings
(123 KB) + company_index (67 KB) + search (33 KB). Migrated to Postgres:
- **court_load** → schema `069_court_load.sql` (table + `idx_court_load_year` + serving fns
  `court_load_year(year)` / `court_load_years()`), loader `load_court_load_pg.ts`. The map
  now fetches **one year (~34 KB)** via `/api/db/court-load?year=` — a **94% cut** — and
  re-fetches on year change (`useCourtLoad(year)`, `CourtLoadMap` takes `{year, courts}`).
  EXPLAIN: 1.1 ms.
- **magistrate** → schema `070_magistrates.sql` (`magistrate` + `magistrate_company` tables;
  indexes on `name_norm`, `company_count DESC`, `magistrate_company(eik)`), loader
  `load_magistrates_pg.ts`. Serving fns: `magistrate_by_name` (person page, **492 B / 0.05 ms**
  vs the 123 KB file), `magistrate_by_company` (company page, 0.12 ms), `magistrate_search`
  (roster), `magistrate_overview(limit)` (the /judiciary tile — top-8, fetches all on "see all").
  Routes in `functions/db_routes.js`; the four hooks (`useMagistrateOverview`,
  `useCompanyMagistrates`, `usePersonMagistrateHoldings`, `useMagistrateSearchRoster`) now hit
  `/api/db`. `magistrate_company_index.json` / `magistrate_search.json` are no longer emitted
  (PG-derived). Both loaders wired into `db:refresh`.

**Responsive:** audited `/judiciary`, `/company/:eik`, `/person/:name` at 375 px — no
horizontal page overflow; KPIs are 2-col, the map + controls fit, the tier table scrolls in
its own `overflow-x-auto` wrapper, tiles wrap. No fixes required.
