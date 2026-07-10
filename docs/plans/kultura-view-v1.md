# Култура (Culture) view — v1 plan

**Status:** draft, post-audit + UI/UX + allowlist + choropleth + jury-data validation (rev 2.4). **Phase 0 complete — ready to build Phase 1.**
Reading order: §1 (what exists) → §3 (architecture) → §3.1 (UI/UX) → §5/§5.1 (data + tile
inventory) → §14 (phasing). §5.1 is the build list.
**Owner:** —
**Closest shipped precedent:** [judiciary-vss-v1.md](./judiciary-vss-v1.md) — copy its shape.
**Also read:** [defense-pack-v1.md](./defense-pack-v1.md), [water-view-v1.md](./water-view-v1.md) (draft),
[nzok-health-pack-v1.md](./nzok-health-pack-v1.md).

> **Rev-2 note.** A pre-implementation audit invalidated three assumptions in rev 1:
> (a) МК already has a full ministry budget page — the "budget bridge" hero was
> duplicative; (b) Култура is a *group* of awarder EIKs, not one; (c) the ВСС/judiciary
> pack — not the water draft — is the shipped precedent, and it ships with **zero new
> Postgres tables**. Everything below reflects the audit.

---

## 1. What already exists (do NOT rebuild)

Verified against the working tree and the local PG (`contracts_list`).

| Surface | State | Implication |
|---|---|---|
| **МК ministry page** `/budget/ministry/admin-ministerstvo-na-kulturata` | **Ships today.** 8 yrs (2018–2025) budget, program breakdown, personnel, trend, procurement tile (`contractCount 268`, `totalEur €57,223,207`) that already deep-links to `/awarder/000695160` | **Do not rebuild budget/programs/execution.** Deep-link to it. |
| **`/awarder/000695160`** | Generic awarder page, live | The pack decorates it; generic KPIs/top-contracts/CPV/money-flow/tenders/appeals already render above |
| `ministry_procurement` derived join | Ships (`data/budget/derived/ministry_procurement.json`) | ministry↔procurement already joined |
| `NzokRegionalChoroplethTile`, `ProcurementChoroplethTile` | Ship (two near-copies) | A generic `OblastChoropleth` does **not** exist — extract or clone |

**МК procurement is thin and lumpy** (contracts by year, `tag='contract'`):
`2022 €1.2M · 2023 €6.0M · 2024 €0.55M · 2025 €3.1M · 2026 €0.13M` (2020: €49k).
Against a **€269.4M** annual budget that is **~0.2–2%**. Consequences, both mandatory:
- The pack **must survive a near-empty procurement window** under the default
  `?pscope=ns`. Copy NZOK's `hasModel` nuance: gate each procurement-derived tile
  individually; never `return null` on the whole pack because a scope has no contracts.
- The "Поръчки на година" KPI is statistically noisy at this volume. Show it with the
  year-count hint, or omit it in favour of a subsidy KPI.

## 2. Култура is a GROUP of EIKs — FROZEN ALLOWLIST (rev 2.2)

The institutes that *receive* the subsidy are themselves awarders. МК administers **103
second-level spending units (74 are ДКИ**, per Дирекция СИХО). The allowlist below is the
**frozen, principal-classified** set; it is an explicit EIK list, never a name regex.

**Hard rule + why:** the substring `опера` matches `опер`**`атор`**/`опер`**`ации`** (pulls
in ЕСО, ДАТО, жандармерия); `куклен` matched **Община Куклен** (a municipality); a
word-boundary regex still returned 182 "culture" awarders including МО military museums and
БАН institutes. So each EIK is hand-classified by **principal** (МК / МО / БАН·МОН / община /
читалище). Store as `src/lib/kulturaReferenceData.ts` with a `principal` field per entity.

### Tier A — funders / agencies (principal = Minister of Culture) — VERIFIED
| Entity | EIK | Notes |
|---|---|---|
| Министерство на културата (МК) | `000695160` | principal; 268 contracts €57.2M; **`hasPack`** |
| **ИА „Национален филмов център" (НФЦ)** | **`000695833`** | **RESOLVED** (finansi.bg; admin under Minister of Culture, founded 1991). **Zero procurement** (0 awarder/tender/contractor) — it is a *subsidy payer*, a labelled roster entity, not a roll-up contributor |
| Национален фонд „Култура" (НФК) | `130418031` | grant payer; tiny procurement (€0.49M) |

These are **Bulstat** entities (регистър БУЛСТАТ), not Commerce-Registry — correctly absent
from `tr_companies`; do not "verify" them there.

### Tier B — state cultural institutes (principal = МК) — VERIFIED SUBSET
Stage & national institutes confirmed in `contracts_list` as state DKI:
`201570119` НДК · `000670748` Народен театър „Иван Вазов" · `000670805` Софийска опера и
балет · `000670794` Държавен сатиричен театър · `000670787` Младежки театър · `000670883`
Софийска филхармония · `000670890` Ансамбъл „Филип Кутев" · `117103220` Държавна опера Русе ·
`115314988` Държавна опера Пловдив · `102241054` Държавна опера Бургас · `000405995`
Плевенска филхармония · `000083665` Държавен куклен театър Варна · `176812208` Национална
галерия · `000673210` Национален исторически музей · `000670984` Национален музей на
изобразителното изкуство · `000675880` НМ „Земята и хората" · `000672293` Национална
библиотека · `124609886` ДКИ Културен център „Двореца" (Балчик) · `175932425` ТМПЦ Варна ·
`108505799` ТМЦ Кърджали.

### Verify-principal before including (state vs municipal is ambiguous)
Regional drama theatres + regional museums are sometimes municipal: `000282756` Драм. театър
Ловеч · `000867998` Драм. театър Търговище · `000124037` МДТ „К. Кисимов" В.Търново ·
`000403802` ДКТ „Иван Радоев" Плевен · `000014352` Драм. театър Благоевград · `176362469`
РИМ София · `000083697` РИМ Варна · `126128563` РИМ Хасково · `000210397` Етър Габрово.
Resolve each against МК's ДКИ register before adding.

### EXCLUDE — the anti-allowlist (principal ≠ МК, or not an institute)
| Excluded | EIK | Reason |
|---|---|---|
| Национален военноисторически музей | `129009048` | principal **МО** |
| Рег. военноисторически музей Плевен | `114102692` | **МО** |
| Театър „Българска армия" | `129009016` | **МО** |
| Национален парк-музей „Шипка-Бузлуджа" | `000804161` | **МО** |
| Археологически институт с музей | `000670919` | **БАН** |
| Природонаучен музей | `000665612` | **БАН** |
| Институт за етнология и фолклористика | `175905773` | **БАН** |
| НАТФИЗ „Кр. Сарафов" | `000670723` | higher-ed, **МОН** |
| Дворец на културата и спорта ЕАД (Варна) | `103156991` | **municipal company** (confirmed in ТР) |
| ОКИ „Музейко" | `180849511` | **municipal** (ОКИ) |
| Малък градски театър „Зад канала" | `000677194` | **Столична община** |
| Градска художествена галерия Пловдив | `000455560` | **municipal** (градска) |
| Община Куклен | `115631816` | **false regex match** (`куклен`) — a municipality |
| Народни читалища (all `Народно читалище …`) | — | independent legal entities, municipal-delegated; the **читалища** category (Phase 3, reconstructed from ДВ standards), NOT per-EIK state institutes |

### Completeness & usage notes
- **This is a verified subset, not the full 103.** The corpus only surfaces МК units that ran
  ЗОП procurements. For full coverage, reconcile against МК's Дирекция-СИХО ДКИ register (74)
  / the State-Budget-Law second-level annex. Tracked in §15.
- **The allowlist does NOT gate Phase 1.** The НФЦ film register is keyed by *producer name*,
  not institute EIK (§6), so Phase-1 film tiles need only Tier A. The allowlist gates
  **Phase 2** (pack group roll-up) and the **awarder roster** (tile 6, §5.1).
- Roster surface: replicate VSS's `JudicialAwardersTile` — each entity deep-links to its own
  `/awarder/<eik>`, `hasPack` badge on МК; bodies with only a handful of contracts are
  **counted, not listed** (VSS convention).

## 3. Architecture — follow the ВСС/judiciary split

The judiciary is the shipped answer to "entity pack + dedicated view". Copy it exactly.

- **`/culture` (dedicated view) = the half money can't tell.** Per-recipient subsidies:
  НФЦ film awards, НФК grants, repeat-winner concentration, jury↔recipient conflict lens,
  per-capita-by-oblast map, theatre productivity. Plus the awarder roster (§2).
  **This is the product.** Data: `data/culture/*.json`.
- **`/awarder/000695160` (`KulturaPack`) = the money-as-buyer half.** Only the
  procurement-unique tiles (CPV→function category tile, statutory-supplier context).
  **No budget bridge** — link to the ministry page (§1) instead.
- Cross-link, never duplicate. The pack footnote links to `/culture`; the roster tile on
  `/culture` links into each `/awarder/<eik>`.

**Nav (corrected).** Per `sectorPacks.tsx` L39–43, VSS deliberately exports **no**
`VSS_AWARDER_PATH` because both nav surfaces point at the dedicated view. Do the same:
- `reportMenus.ts` `menu_group_state_entities`: `{ title: "culture_nav", link: "/culture" }`
  (hardcoded string, like `judiciary_nav` at L287).
- `ProcurementNav.tsx` `secondaryItems`: `{ to: "/culture", icon: Palette, key:
  "culture_nav", unscoped: true }` — `unscoped` because `/culture` has no `?pscope`.
- **Do NOT export `KULTURA_AWARDER_PATH`.** Still register `[KULTURA_EIK]: KulturaPack`
  in the `PACKS` map.

## 3.1 UI/UX — world-best implementation on the house grammar

The bar: be the best culture-money dashboard in the world, not just in Bulgaria (the
field is open — §5). That means adopting the house pack grammar **verbatim** and then
layering the handful of things the best arts-funders abroad do that no Bulgarian site does.

**Canonical grammar spec — do not reinvent.** The condensed, authoritative statement of
the shipped-pack UI vocabulary lives in [revenue-view-v1.md](./revenue-view-v1.md) §3
and [defense-pack-v1.md](./defense-pack-v1.md) "Shared UI skeleton". Read those first.
Copy `src/screens/components/procurement/vss/VssPack.tsx` wholesale as the pack skeleton
(it is the newest/cleanest: flex-column KPI grid, scope-window `procSpan` divisor,
per-tile `hasModel` gating, statutory callout, alias-EIK footnote). This section records
only the Култура-specific decisions and the world-best additions.

### a. Layout & the two surfaces (recap of §3)
- `/culture` **dedicated screen** — homepage width, **no `max-w` cap, NO tabs**, stacked
  `space-y-4` sections (`feedback_no_tabs_ux`). Owns the recipient/subsidy story.
- `KulturaPack` on `/awarder/000695160` — the money-as-buyer sliver, only domain-unique
  tiles (generic KPIs already render above). Cross-link, never co-render.
- Both open on a **visual, not a KPI row** — see (c).

### b. Chart-type → job (dataviz method: pick the form before the color)
Read the `dataviz` skill before the first line of chart code. House lib is **Recharts**
(d3 only for maps). One axis ever — never dual-y. Assignments:

| Job / tile | Form | Notes |
|---|---|---|
| Culture € per capita by oblast | **choropleth**, single-hue **sequential** ramp | the hero map; §d |
| "Where the culture money goes" (film/theatre/grants/читалища split) | **horizontal composition bar** (hand-rolled Tailwind, the bridge idiom) | segments colored by category id, not rank |
| Function/discipline split of ЗОП spend | donut / `PieChart` | clone `RoadWorkGroupDonut` |
| Subsidies over time (by year / by cabinet) | stacked `BarChart` time-spine | reuse `RoadTimeSpineTile` shape; cabinet via `?cabinet=` |
| **Recipient concentration** ("who wins repeatedly") | ranked horizontal bars + a top-N-share callout | NOT a pie; clone `RoadRepeatWinnersTile` |
| **Success rate** (applied vs funded per program) | paired/stacked bar or a labelled ratio meter | world-best addition, §e |
| Awarder roster (each cultural body as buyer) | linked list with `hasPack` pill | clone `JudicialAwardersTile` |
| Single headline (e.g. €269.4M) | **stat tile, not a chart** | dataviz: sometimes the answer isn't a chart |

**Color discipline (non-negotiable, from dataviz):** categorical hues in a **fixed order,
never cycled** — a 9th discipline folds into "Other," never a generated hue; **color
follows the entity, not its rank** (a filter that drops series must not repaint
survivors); sequential = one hue light→dark; **run `scripts/validate_palette.js` on any
categorical palette before shipping** (CVD ≥ 12; don't eyeball). Fills use the CSS-HSL
token system (`hsl(var(--muted))`, `bg-primary`, per-id `LINE_COLOR` maps); text wears
ink tokens, never the series color. Every number `tabular-nums`; EUR via
`formatEurCompact(v, lang)` reading `amountEur` (never re-convert). Dark mode is a
**designed** variant (every color has a `dark:`), verified in both themes.

### c. Landing / information scent (world-best)
The best arts dashboards (ACE) **open on a map + search**, not a stat grid — the citizen's
first question is "what about my area / who got funded near me." So:
- `/culture` opens with the **per-capita choropleth hero** (the striking share-card visual,
  §12 OG) with a **search box overlaid/above** it (recipient or place), THEN the KPI row,
  THEN the discipline composition. Information scent points at "find your area / your
  theatre," not at a national aggregate the reader can't act on.
- **Two-search split** (ACE Explorer): keep the *place* search and the *recipient* search
  visually distinct — they answer different questions ("my area" vs "this theatre/producer")
  and merging them into one box muddies both.
- The **pack** opens on the subsidy/budget bridge (its `data-og` hero).

### d. Maps & geo (choropleth-first)
- Any oblast-grained metric → **choropleth, never a ranked list** (water §4.1a).
- **Per-capita normalization is a first-class toggle** — raw € misleads (big oblasti spend
  more because they hold more people). Copy `NzokRegionalChoroplethTile`'s toggle.
- **Small-multiples over metric-toggle buttons** where >1 metric (e.g. film € · grants € ·
  per-capita) — `grid lg:grid-cols-3`, shared legend, "spatial story at a glance."
- **Pair the choropleth with a ranked bar list.** Absolute-€ shading conflates size with
  intensity (Creative Europe's map makes small high-intensity regions invisible); the
  per-capita toggle + an adjacent Top-N bar list fixes it. Never ship an absolute-€
  choropleth alone.
- **Click an oblast → filters the Top-N recipient table below** (`activeOblast`/
  `onSelectOblast` seam).
- Percentile color buckets computed per-oblast so Sofia's shards don't skew the scale;
  derive oblast from the **obshtina prefix, not `area.oblast`** (`project_oblast_code_shard_mismatch`).
- **DECISION (Phase 0, resolved): EXTRACT a shared `OblastChoropleth`; do NOT clone. And
  Култура *consumes* it — it does not own the extraction.**
  - *Why extract:* there are already **~11** oblast choropleths (prices, census, indicators,
    local, procurement, nzok, agri, regional, persistence, wasted-vote, funds), all on the
    shared `maps/` plumbing (`useSofiaMergedRegionsMap`, `getDataProjection`, `FeatureMap`,
    `useTooltip`). The *hard* parts are already shared; only a ~100-line wrapper (sizing,
    projection memo, percentile `colorFor`, Sofia-merge feature loop, tooltip, click-to-
    filter) is duplicated. A 12th clone deepens a debt **three plans already commit to
    paying down** (water §0b.8 / Phase 1b, judiciary, education). Cloning
    `NzokRegionalChoroplethTile` isn't cheaper — it's РЗОК-shaped (`data.byRzok`, teal ramp,
    its own toggle) and needs heavy edits regardless.
  - *Ownership (per "whoever ships first builds it", water §0b.8):* if Води/judiciary/
    education land `OblastChoropleth` first, Култура just imports it (zero cost). If Култура
    ships first, it builds the primitive to the water-plan API, migrates `ProcurementOblastMap`
    to consume it **with no behaviour change** (verify `ProcurementChoroplethTile`
    small-multiples render identically), and the other plans inherit it.
  - *API (align to water §4.1a so the plans don't diverge):* `OblastChoropleth({ values:
    Map<canon, number|undefined>, buckets?, ramp?, formatValue, tooltipExtra?, activeCanon?,
    onSelectOblast?, height?, ariaLabel })`. It owns ResizeObserver sizing, projection,
    per-oblast percentile `colorFor`, the Sofia-merged feature loop, the tooltip shell and
    `role="img"`. Култура's per-capita metric + comparator-by-default (§3.1e·6) ride
    `formatValue`/`tooltipExtra` ("€X/жит. · спрямо нац. средно").
  - *Risk:* extraction refactors the **live** procurement map — land it as its own
    behaviour-preserving commit **ahead of** the culture tiles, never buried in them.

### e. World-best accountability layer (what no BG site does)
These four, mapped onto our surfaces, are the differentiators — adopt them explicitly:
1. **Success rate — applied vs funded** per program/session (ACE, Creative Australia). A
   rare, powerful accountability metric. Source: НФК/НФЦ session results carry both.
2. **Decision-body transparency** — show the jury/художествена комисия per award (Creative
   Australia, ACE). **VALIDATED (§6): the data is published** (nfc.bg commission pages +
   appointment заповеди, the latter scanned→OCR). Split in two: **(9a)** a "кой решава"
   tile that just publishes each session's commission composition — cheap, safe, a real
   differentiator — ship it; **(9b)** the jury↔recipient overlap/conflict flag — Phase 3,
   name-match-gated, same-session-scoped, phrased "flagged for review," never asserted
   (defamation risk — jurors are working filmmakers who get subsidies by design).
3. **"Is my area under-funded?"** — the per-capita choropleth (ACE Culture & Place). This is
   the citizen hook and the hero (c/d).
4. **Recipient concentration / celebrity-vs-independent split** — the ranked-bar tile + a
   top-N-share number (the "банкомат за избрани" story, made standing and queryable).
5. **Narrative annotations on the charts** — the single biggest gap the best foreign tools
   leave (Creative Europe ships "ready-made charts" with **zero** annotation: the reader
   must assemble "up X% vs the previous programme" themselves). Beat it: a plain-language
   lede sentence per tile and explicit YoY / vs-cabinet delta call-outs **on** the visual —
   the house insight-chip + caption idiom already does this; use it deliberately.
6. **Comparator-by-default** — ACE's Culture & Place Explorer bakes **two comparators into
   every place figure (its oblast + national)**, so no number is shown context-free. This is
   the strongest structural "is my area under-funded?" answer — stronger than a per-capita
   toggle alone. On the oblast map/tooltips and any place drill-down, always show the value
   **vs the national per-capita mean** (and vs its region where meaningful), not the bare €.

### f. Search, filter, drill-down, deep-linking
- **Per-grant permanent records + a searchable browser** (NEA, Canada Council): every award
  a stable `/culture/grant/:id` (Phase 3), the browser a DbDataTable with facets
  **discipline × year × oblast × program × status** and free-text `?q=` on recipient/title.
- **Large lists never dump in a tile** — Top-N (8–10) in the tile → **"Виж всички / See all"**
  to the DbDataTable page; the link **preserves scope AND seeds `?q=`** (`useProcurementHref`
  + `p.set("q", …)`).
- Row → `/company/:eik` or `/awarder/:eik` (`truncate hover:underline`, `title` full name);
  scope (`?pscope`, `?cabinet`) survives every nav hop.
- **CSV export + methodology note** alongside the UI (Canada Council) — near-free off the
  committed JSON; a competitor/ИПИ differentiator and a trust signal.

### g. Empty / loading / thin-corpus (mandatory here — §1)
МК's procurement is tiny and lumpy, so the pack **must not blank out** on an empty scope:
- Loading: `<div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />`
  (screens use `h-[320px]`).
- **Per-tile `hasModel` gating**, not whole-pack `return null`: budget/subsidy tiles that
  don't need the contract corpus stay alive; only procurement-derived pieces hide.
- Dedicated screen adds an explicit `isError || !data` branch (React Query settles a failed
  fetch as `isLoading:false, data:undefined`).
- Self-hiding tiles + divide-by-zero guards (`Math.max(1,…)`, `|| 1`) are house style.
- **Never default a picker/scope to an empty result** (NEA defaults its year filter to the
  current FY and returns near-nothing — a silent dead-end). Default the year picker to the
  latest *populated* year resolved against the data, and default the map to the metric that
  actually has coverage; if the default `?pscope=ns` window is empty, the pack shows the
  subsidy story, not a blank procurement KPI.

### h. Trust, provenance, honesty (non-negotiable)
- **Provenance footnote closes every pack/screen** (`text-[11px] text-muted-foreground/80`),
  naming each source by acronym (НФЦ регистър, НФК класиране, Закон за бюджета, АОП/ЦАИС ЕОП);
  link the source where possible.
- **Every visual carries its own caption** stating formula/period/caveat.
- **Two-period honesty in the bridge:** the "per year" divisor is the scope-window length
  (name both periods in the hint so they can't disagree); ratios compare like years; residual
  line spelled out; "под 0,5%" rounding-floor honesty.
- **"Outside procurement" caveat** wherever subsidies dwarf the ЗОП ledger — culture subsidies/
  grants are paid outside ЗОП and are NOT the contracts shown (the НЗОК/ВСС чл.-45 analog).
- **`awarded ≠ received`** caveat on grant lists (Canada Council/NEA surface this): a recipient
  can decline or a tranche can be withheld — say so.
- **Municipal vs state** labelling: Sofia Програма „Култура" is municipal — label "извън
  държавния бюджет" (the Софийска-вода lesson).
- **"Last updated" stamp** on the dedicated view (ACE refreshes every 2–3 days and shows it);
  drive it off the ingest state.

### i. Bilingual & a11y
- Inline BG/EN ternary (`const bg = lang === "bg"`) inside tiles — **only the nav key**
  (`culture_nav`) goes through i18next. BG reads naturally, not word-for-word. No emojis.
- Charts are **labelled images** (`role="img"` + an `aria-label` enumerating values); metric
  toggles `role="group"` + `aria-pressed`. Identity never by hue alone (legend + labels +
  per-capita toggle); validate colorblind-safety with the dataviz script.
- Responsive: grids scale (`grid-cols-2 lg:grid-cols-3 …`), maps `h-[300px] md:h-[340px]`,
  headers `flex-wrap`. Not desktop-only (the Creative Australia cautionary case).

### j. Definition of done (UI checklist per tile)
Form chosen by job · palette validated (`validate_palette.js`, both modes) · one axis ·
color-by-entity · hover/tooltip present · `tabular-nums` + `formatEurCompact` · dark mode
designed & checked · `role="img"`/`aria-label` · own caption + period/formula · empty &
loading states · bilingual · scope-aware · deep-links preserve scope.

## 4. Storage decision — JSON first, PG only if forced

**The judiciary pack ships with zero new PG tables**: no `scripts/db/schema/pg/*.sql`,
no loader, no `recordIngestBatch`. Its artifacts are committed JSON under `data/`,
synced via `bucket:sync`, reusing the generic `/api/db/awarder-contracts` for procurement.
NZOK/agri *do* use PG — so PG is a **choice**, driven by whether row-level data must be
queried server-side.

**Decision for v1: JSON.** The НФЦ film register is on the order of thousands of rows
(2014–2025), well within a committed JSON artifact. Ship `data/culture/films.json`,
`data/culture/grants.json`, `data/culture/entities.json`.

**Escalate to PG only when** the grants browser needs server-side paging/search
(a `DbDataTable` over tens of thousands of award rows). At that point:
- Schema convention (corrected — there is **no migration framework**):
  add `scripts/db/schema/pg/048_kultura_subsidies.sql`, idempotent
  (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), and have the ingest
  script `readFileSync` + execute it directly (exactly as `scripts/agri/ingest.ts` does
  with `046_agri_subsidies.sql`). Next free number is **048**.
- Then, and only then, `recordIngestBatch` → `recent_updates` becomes mandatory
  (`feedback_pg_changelog_required`), and a `functions/db_table.js` REGISTRY entry.

If v1 stays JSON, **§9 (changelog) and the PG parts of §7 do not apply** — but the
dataset still needs a `data/updates` presence via the data map.

## 5. Data & ingest (ranked by value × ease)

1. **НФЦ Единен публичен регистър** — direct `.xls`, 2014–2025, no WAF. Schema:
   `Вид · Наименование · Рег.№ · Продуцент · Субсидия(лв) · Бюджет · Протокол`.
   **⚠ `Продуцент` is a NAME, not an EIK.** See §6.
2. **МК program-budget execution** `.xlsx` — *already ingested* into the ministry page.
   Reuse; do not re-parse. Only pull what the ministry page doesn't model.
3. **НФК grant results** — PDFs (Google-Sheets exports, extractable). Powers success rates.
4. **Sofia Програма „Култура"** — per-project HTML/PDF. **Municipal, not МК** — label it
   "извън държавния бюджет" wherever shown (the water plan's Софийска вода lesson).
5. **Читалища** — reconstruct €88.3M from ДВ per-unit standard × subsidized-unit counts.

## 5.1 Tile inventory (reconciles §3.1 viz · §5 data · §14 phase)

The single build list. Surface: **S** = `/culture` dedicated screen, **P** = `KulturaPack`
on `/awarder/000695160`, **B** = `/culture/grants` browser. Viz keys map to §3.1b.

| # | Tile | Surface | Viz (§3.1b) | Data (§5) | Phase |
|---|---|---|---|---|---|
| 1 | **Per-capita culture € by oblast** (hero) + search box overlay | S | choropleth, single-hue seq, per-capita toggle, **paired with Top-N bar**, click→filter | corpus × census/GRAO pop | 1 |
| 2 | KPI row — total culture €, N recipients, latest year | S | stat tiles (not charts) | corpus + МК budget | 1 |
| 3 | **Discipline composition** — where culture money goes (film/theatre/grants/читалища) | S | horizontal composition bar, color-by-category | corpus | 1 |
| 4 | **НФЦ film awards** (Top-N → "See all") | S→B | ranked list → DbDataTable | `films.json` | 1 |
| 5 | **Recipient concentration** — who wins repeatedly + top-N-share | S | ranked horizontal bars + call-out | corpus | 1 |
| 6 | **Awarder roster** — each cultural body as a buyer | S | linked list, `hasPack` pill (clone `JudicialAwardersTile`) | allowlist × contracts | 1 |
| 7 | Subsidies over time (by year / by cabinet `?cabinet=`) | S | stacked BarChart time-spine + YoY annotation | corpus | 1→2 |
| 8 | **НФК grants + success rate** (applied vs funded) | S | paired/stacked bar or ratio meter | НФК PDFs | 2 |
| 9a | **„Кой решава" — commission composition per session** (validated §6) | S | member list per заповед/session | nfc.bg HTML + заповед OCR | 2 |
| 9b | **Jury↔recipient conflict flag** — same-session only, "flagged for review" | S | roster + connections flag, name-match-gated | 9a × films × connections | 3 |
| 10 | Pack: CPV→function category tile | P | donut (clone `RoadWorkGroupDonut`) | contracts | 2 |
| 11 | Pack: KPI (subsidies/yr vs МК budget yr) + statutory-supplier callout | P | stat tiles + amber callout | contracts + budget | 2 |
| 12 | Grants browser — facets discipline×year×oblast×program×status, `?q=`, CSV export | B | DbDataTable | corpus (→PG if large) | 3 |
| 13 | Per-grant record `/culture/grant/:id` | — | detail page (clone `/procurement/contract/:id`) | corpus | 3 |
| 14 | **Theatre subsidy-per-ticket productivity** | S | ranked bars/table | ДВ standards + МК overspend lists | 3 |
| 15 | Sofia Програма „Култура" (municipal, labelled "извън държавния бюджет") + читалища | S | tiles / map | Sofia HTML · ДВ | 3 |

Notes: **no budget-bridge hero** — the МК ministry page already owns budget/programs/
execution (§1); the pack (11) is a thin sliver and must survive an empty scope. Tile 9
was the headline differentiator; §6 **validated** the data exists but is scanned→OCR + carries
defamation risk, so it splits: **9a** (commission composition — cheap, safe, ships in Phase 2)
and **9b** (conflict flag — Phase 3, name-match-gated, "flagged for review" only). Tile 1
depends on the `OblastChoropleth` decision (§3.1d, resolved) and tile 14 on per-institute data (§15).

Confirmed figures: МК 2026 budget **€269.4M**; читалища 2026 **€11,240/unit × 7,856 ≈
€88.3M**; НФК 2026 **18.3M лв ≈ €9.36M**; Sofia 2026 **€2.3M, 119/455 funded**.
All of mc.government.bg / nfc.bg / ncf.bg serve plainly (no WAF).

## 6. Entity resolution — the biggest data risk

The НФЦ register keys recipients by **producer name**, and НФК grants go to **individual
artists** as well as companies. Therefore:

- **Name→EIK matching is required** to join awards to the TR/connections graph. This walks
  directly into the namesake false-positive class already fixed once
  (`project_procurement_namesake_fix`). Reuse that matcher; do **not** hand-roll one.
- Follow the agri precedent: ДФЗ's СЕУ years also lack an EIK column and are "recovered by
  name-match" — copy that code path and its confidence gating.
- **Store the raw name verbatim** alongside any resolved EIK, and render the raw name when
  confidence is low. Never assert a person↔company link on a name alone.
- **Individuals are recipients.** Physical-person names appear in public grant registers,
  but decide explicitly whether to (a) publish them as published, (b) suppress a
  connections lookup for physical persons. Recommend (a) + no auto-linking to the
  connections graph without an EIK.
- **The jury↔recipient conflict lens — VALIDATED (2026-07-10): the data IS published, but
  not machine-readable, and the tile carries defamation risk.** Findings:
  - НФЦ has three национални художествени комисии (игрално / документално / анимационно кино),
    each ~7–9 members appointed by the Executive Director for a fixed mandate, drawn by
    **lottery (жребий)** from an expert register; a member cannot serve two consecutive
    mandates. Compositions are public via (i) per-commission **HTML "Членове" pages** on
    nfc.bg (current members) and (ii) **appointment orders (заповеди)** naming each composition
    (e.g. Заповед № 1/05.01.2026; № 59/12.03.2026) + lottery protocols (жребий).
  - **BUT the заповед PDFs are SCANNED images (CCITT Fax, no text layer)** → OCR required
    (the budget capital-programmes Gemini-Vision path). Only the *current* HTML page is
    directly parseable; the *historical* compositions needed to join past sessions are OCR-only.
  - **Temporal join:** commissions are per-mandate (annual/6-month); attributing an award to
    the right jurors means joining the award's `Протокол на ФК` (date/number, in the register)
    to the mandate active then. Per-session.
  - **Defamation trap:** jurors ARE working filmmakers who receive subsidies in *other*
    sessions by design — so "juror also got money" is near-universal and NOT wrongdoing. The
    only defensible signal is a juror on the **same session** that funded a project they are
    connected to (company / co-production / family), and even that is name-matched (PII, no
    EIK for persons). A loose definition defames.
  - **Verdict → split the tile.** (9a) A **"кой решава" commission-transparency tile** — just
    publish the compositions per session (who decided the money) — is cheap (HTML now, OCR for
    history), zero defamation risk, and already a differentiator nobody ships. Do this.
    (9b) The **overlap/conflict lens** is Phase 3, behind name-match confidence gating, scoped
    to same-session connections only, and phrased as **"flagged for review," never asserted**,
    always citing the заповед + protocol. It is the highest-risk, highest-cost tile — not a
    blocker, but not a v1 deliverable.

**Currency:** НФЦ amounts are historical BGN → convert at ingest (÷1.95583). Post
2026-01-01 sources are natively EUR — handle the mixed regime explicitly
(`feedback_bg_uses_eur`). Sum in EUR per row, never per-currency convert
(`reference_procurement_eur_sum_basis`).

## 7. Query performance

`EXPLAIN ANALYZE` every new/changed query on the worst-case entity (`feedback_db_query_perf`).

Corrections from the audit:
- **`contracts_list` is a VIEW; `date` is `text`** (ISO strings — `left(date,4)` and
  lexicographic range filters work). Not a `date` column.
- The pack's core query (`awarder_eik = '000695160'` + window) is **already covered** by
  `idx_contracts_awarder_date`. No new index needed for the pack.
- **Group roll-up** (`awarder_eik IN (<culture allowlist>)`) is the new worst case —
  verify it index-scans rather than seq-scanning the corpus.
- If PG lands (§4): index `(recipient_eik)`, `(program, year)`, `(discipline, year)`;
  precompute the corpus-wide repeat-winner group-by and the oblast map into a
  `kultura_payloads` blob (global-hot, >200ms live). jsonb builders follow
  `reference_pg_payload_determinism` (ROUND sums, rounded sort keys + eik tiebreaks,
  `COLLATE "C"` MINs). Derive oblast from the obshtina prefix, never `area.oblast`
  (`project_oblast_code_shard_mismatch`).

## 8. Watchers & process-watch-report

`WatchSource` (`scripts/watch/types.ts`): `id`, `label`, `url`, `cadence`,
`fingerprint()`, optional `describe(prev,curr)`. One file each under
`scripts/watch/sources/`, added to `SOURCES` in `scripts/watch/sources/index.ts`.
Follow the VSS precedent: put shared URLs/table maps in a single `scripts/culture/sources.ts`
consumed by BOTH the watcher and the parser.

| Source file | `id` | cadence | fingerprint |
|---|---|---|---|
| `nfc_film_register.ts` | `nfc_film_register` | monthly | hash of latest `Registar-finansirani-filmi-*.xls` link/date |
| `ncf_grant_results.ts` | `ncf_grant_results` | weekly | hash of класиране post list on ncf.bg/bg/novini |

**No `mc_budget_execution` watcher** — МК budget already rides `update-budget`'s existing
`budget_law` / `ministry_execution_reports` watchers (VSS's `__write_judiciary.ts` does
exactly this: piggyback on the cached law HTML, no new fetch).

Mapping rows in `.claude/skills/process-watch-report/SKILL.md` (canonical table):
`nfc_film_register → update-culture`, `ncf_grant_results → update-culture`.

Skill `.claude/skills/update-culture/SKILL.md` (shape on `update-judiciary`). Stamps
`state/ingest/update-culture.json` via
`npx tsx scripts/stamp-ingest.ts update-culture --summary "…"`. Backfills behind
`--backfill` (`feedback_one_off_backfills`).

## 9. Verification (VSS has no tests — copy its discipline instead)

No dedicated tests exist for the judiciary/VSS work. Its ingest scripts **self-verify**:
Σ-reconciliation asserts that **throw and write nothing on failure**. Adopt the same:
- Assert Σ(per-film subsidy) == the register's own reported total per year.
- Assert Σ(grant awards) == НФК's published session total.
- Assert every emitted `eik` resolves in the entity allowlist.
- Refuse to write a partial artifact.

If PG lands, add a `scripts/db/tests/` data test alongside `copy.data.test.ts`.

## 10. AI chat tools

Create `ai/tools/culture.ts`; edit `ai/tools/registry.ts` (imports + `ToolDef` in `TOOLS`),
`ai/orchestrator/router.ts` (keyword block), `ai/orchestrator/narrate.ts` (cases).
Tools return an `Envelope` and **never compute numbers in prose** — narrate pre-computed
`env.facts` only.

Tools (domain `fiscal`): `cultureOverview`, `topCultureGrantees`, `cultureForEntity`,
`filmSubsidyForProducer`, `culturePerCapitaByOblast`.

Router keywords: `култур|театр|филм|кино|опера|читалищ|музей|грант|субсид|culture|theatre|
film|grant`. **Disambiguation (VSS lesson):** gate on an explicit culture reference so bare
`опера` / `музей` doesn't misfire, and route "кой спечели поръчка на МК" to the awarder
**contract** tool, not `cultureOverview`.

Provenance: `culture/*.json` (or `db:culture-*` if PG). Any `/culture/*.json` path an ai/
tool reads MUST have an `AI_PATH_RULES` entry (§12) or the prebuild fails.

## 11. Data Map & README

`scripts/data_map/model.ts` — `npm run data:map`; **prebuild fails on an unplaced watcher
source or an unmapped ai/ path.** §8 and this section must land together.
- `SOURCE_GROUPS`: `src:culture` — `origin:"state"`, `members:["nfc_film_register",
  "ncf_grant_results"]`, `skills:["update-culture"]`, `tags:["fiscal","culture"]`.
- `DATASETS`: `ds:culture`, `path: "data/culture/"`.
- `FEATURES`: `f:culture`, `route: "/culture"`.
- `EDGES`: `["src:culture","ds:culture"]`, `["ds:culture","f:culture"]`, and the
  **cross-feed** `["ds:budget","f:culture"]` (mirrors `["ds:budget","f:judiciary"]` — the
  data-map expression of the budget fusion).
- `AI_PATH_RULES`: `{ pattern: /^\/culture\//, dataset: "culture" }`.

README: `data/culture/` row in the data-layout table; source-provenance entries for the
НФЦ register + НФК results (with gotchas + verified figures, as the judiciary entries do);
the `update-culture` CLI + `--backfill`.

**i18n reality:** only the nav key `culture_nav` goes in `src/locales/{bg,en}/translation.json`
(next to `judiciary_nav`). All rich tile copy is **inline BG/EN ternaries on `lang`** in the
components — that's the house style, not translation.json.

## 12. SEO surfaces — TWO of everything (dedicated view + pack)

Because Култура has both a dedicated view and an awarder pack, each surface needs two entries.

**Awarder pack** (`/awarder/000695160`):
- One `InstitutionPack` entry appended to `INSTITUTION_PACKS` in
  `scripts/prerender/institutions.ts` (`eik`, `slug: "kultura"`, bilingual title/desc/body,
  `ogAnchor`, `ogSettleMs`). This **one append** feeds sitemap + prerender + OG capture —
  `scripts/sitemap/index.ts` and `scripts/og/capture-screens.ts` both loop the array.
- OG: `[data-og="kultura-bridge"]` on the pack's hero tile → `public/og/awarder/kultura.png`.

**Dedicated view** (`/culture`):
- `scripts/prerender/routes.ts` — a route entry with a build-time `cultureFacts()` reader
  (mirror `judiciaryFacts` at L84–96, which reads real numbers out of the JSON at build time)
  and `ogImage: "/og/culture.png"`.
- `scripts/sitemap/route_defs.ts` — add `"culture"` + its path/screen file (mirror
  `"judiciary"` at L51 / L97–98).
- `scripts/og/capture-screens.ts` — a capture entry, anchor `[data-og="culture-hero"]`
  → `/og/culture.png`.
- `src/routes.tsx` — lazy import + `<Route path="culture">`.

**Give the two heroes distinct `data-og` anchors** (`kultura-bridge` vs `culture-hero`).

**OG hero choice — dependency RESOLVED (§3.1d).** The per-capita-by-oblast choropleth makes
the strongest card. It rides the shared **`OblastChoropleth`** primitive, which Култура
**consumes** (extract, don't clone — decision in §3.1d). If that primitive hasn't shipped
from Води/judiciary/education by the time Култура's map is built, Култура builds it first
(behaviour-preserving migration of `ProcurementOblastMap`) as its own commit, then the OG
card is captured off the rendered hero.

**Sitemap validity** (`project_sitemap_validity_audit`): every `<loc>` needs a real
prerendered `dist/<path>/index.html` — so sitemap and prerender ship together, never alone.

## 13. Deploy & launch

- Artifacts are committed JSON → `bucket:sync data/culture/`. GCS serves identity: use
  `cp -Z` (`reference_gcs_bucket_compression`); avoid `gsutil -m` on macOS
  (`reference_gsutil_macos_multiprocessing`).
- If a by-id shard tree is ever added for per-grant pages, check the **Firebase deploy file
  ceiling** (`project_firebase_deploy_ceiling`) — a 453k-file dist fails to deploy.
- Launch: a `naiasno-post` **DATASET** post when the corpus lands and a **FEATURE** post for
  `/culture`, pinned ~2 weeks.

## 14. Phasing

A phase isn't "done" until its data is watched (§8), self-verified (§9), on the data map
(§11), prerendered + in the sitemap with an OG card (§12), and its queries EXPLAIN-checked
(§7). The data-map validator fails the build if a source ships unplaced.

**Phase 0 (decide, ~1 day):**
- ~~Resolve the НФЦ EIK and freeze the culture EIK allowlist~~ **DONE** (§2, rev 2.2): НФЦ
  = `000695833`; tiered allowlist frozen with principal classification + exclusions. Only
  the full-103 reconciliation remains (§15), and it doesn't block Phase 1 or 2.
- ~~Choose `OblastChoropleth` extract-vs-clone~~ **DONE** (§3.1d): **extract, consume** —
  Култура imports the shared primitive; builds it (behaviour-preserving) only if it ships
  before Води/judiciary/education, else inherits theirs. Not a code task until the map tile.
- ~~Validate whether НФЦ jury membership is published~~ **DONE** (§6): it IS published
  (nfc.bg commission pages + appointment заповеди, the заповеди scanned→OCR). Tile splits
  into 9a (commission transparency — ship) + 9b (conflict flag — Phase 3, name-match-gated,
  "flagged for review" only). Not dropped; not a blocker.

**Phase 1 (the product):** `data/culture/films.json` from the НФЦ `.xls` (JSON, no PG) +
the `/culture` dedicated view — **tiles 1–7 in §5.1** (per-capita hero map + search,
KPI row, discipline composition, film awards, concentration, awarder roster, time-spine).
Nav → `/culture`. Both prerender entries, both OG cards, sitemap, data map,
`update-culture` skill + `nfc_film_register` watcher, AI tools `cultureOverview`/
`topCultureGrantees`/`filmSubsidyForProducer`, README, launch post.

**Phase 2 (the pack + grants):** `KulturaPack` on `/awarder/000695160` — CPV→function
category tile + statutory-supplier context, **no budget bridge** (link the ministry page);
`hasModel` gating for the thin corpus (§1). Plus НФК grants + success rates
(`ncf_grant_results` watcher, `cultureForEntity` tool). Escalate to PG (§4) only if the
grants browser needs server-side paging.

**Phase 3 (depth):** theatre subsidy-per-ticket productivity (МК's published 120%-overspend
lists + ДВ standards; may need ЗДОИ); Sofia program; читалища; per-grant `/culture/grant/:id`
records (clone the `/procurement/contract/:id` stack) if grant volume justifies it.

## 15. Open questions

1. ~~**НФЦ EIK**~~ **RESOLVED** = `000695833` (§2). Remaining: reconcile Tier B against МК's
   full 103-unit / 74-ДКИ register (Дирекция СИХО) for complete roster coverage, and resolve
   the "verify-principal" regional theatres/museums. Not a blocker for Phase 1–2.
2. ~~**Jury/commission data — sourceability**~~ **RESOLVED** (§6): published (nfc.bg pages +
   заповеди, scanned→OCR). Remaining product call: **9a** (commission transparency) is a
   clear ship; **9b** (conflict flag) needs a policy sign-off on the "flagged for review,
   same-session, name-match-gated" framing before build — a defamation-risk decision, not a
   data one.
3. **Theatre subsidy-per-ticket** — per-institute delegated budgets aren't published;
   МК's own overspend lists give a partial path without a ЗДОИ. Ship Phase 1 without it?
4. **Physical-person recipients** — publish names as published (recommended), and suppress
   auto-linking to the connections graph absent an EIK?
5. ~~**`OblastChoropleth`** ownership~~ **RESOLVED** (§3.1d): extract & consume; whoever ships
   first builds it. No open question — a coordination note, not a decision.

**Phase 0 is complete.** All three blockers resolved (НФЦ EIK + allowlist, `OblastChoropleth`,
jury data). Remaining items above are Phase-2/3 refinements + one policy sign-off (9b), none
blocking a Phase-1 start.
