# Sector entity search — v1 plan

Status: **PLAN ONLY — nothing built.** Research pass over all 19 sectors in `SECTOR_CLUSTERS`
(`src/screens/governance/sectorRegistry.ts`), measuring every entity universe a sector dashboard
lists, and proposing one shared search component + per-sector search criteria.

> Every count below is **MEASURED** — from local Postgres (`postgres://…@localhost:5433/electionsbg`,
> probed 2026-08-04), from the committed `data/**` payloads, or by counting the curated
> `src/lib/*ReferenceData.ts` arrays. No estimates.

---

## 1. The gap

A sector dashboard today is a stack of **top-N tiles**. Measured caps in the НЗОК pack alone:

| Tile | Shows | Universe |
|---|---|---|
| `NzokHospitalPaymentsTile` | `slice(0, TOP_N)` | **258** hospital EIKs (381 facility rows) |
| `NzokDrugReimbursementTile` | `data.top.slice(0, TOP_N)` | **610** INN molecules |
| `NzokDrugUnitPriceTile` | `data.overpay.slice(0, 12)` | **3,333** pack rows / 221 trade names / 135 INNs |
| `NzokActivityTile` | `topProcedures.slice(0, 12)` | **427** named procedures (571 codes in `nzok_activities`) |
| `NzokPathwayTreeTile` | `data.hospitals.slice(0, 25)` | 258 |
| `NzokHospitalRiskTile` | `slice(0, 15)` | 258 |

So a reader who wants **their** hospital, **their** medicine, or **their** clinical pathway has no
route to it — unless it happens to be in the national top 12. The destination pages already exist
and are already prerendered/served (`/company/:eik`, `/molecule/:inn`, `/molecule/:inn/pack/:nationalNo/:nzokCode`,
`/procedure/:code`, `/school/:id`, `/farm/:eik`, `/culture/film/:id`, `/awarder/:eik`) — they are
simply **unreachable from the dashboard that is about them**.

The same shape repeats across sectors: `/water` lists 38 operators but only renders the group
rollup; `/judiciary` maps 178 courts with no finder; `/culture` has 944 film awards behind a
"see all" link; `/sector/security` renders **73** МВР structures as an undifferentiated chip cloud.

`/education` is the **one** sector that already got this right — `searchSchools.ts` + a
`<Input>`-driven finder, folding both scripts through `skeletonMatches`. That is the model to
generalise, not to re-invent.

---

## 2. What already exists (reuse, do not rebuild)

**`src/lib/translitSearch.ts`** — the shliokavitsa folder. `latinSkeleton()` maps Cyrillic →
Streamlined-System Latin and collapses the ч/х ambiguity to `h`, then strips `[^a-z0-9]`.
`searchMatches()` adds the perf contract (literal check first, skeletal fast-path, memoised fold
with evict-half at 50k). This already makes "arh"/"arch"/"арх" one query. **It is the right
primitive and needs no rewrite** — only the additive extension in §4.

**`src/ux/data_table/DataTable.tsx`** — client-side tables already route their global filter
through `searchMatches` (line 111).

**`functions/db_table.js` + `translit_bg_latin()` / `fold_prefix_tsquery()`** — server-side
shliokavitsa is already solved for `DbDataTable` resources: gin_trgm-indexed fold columns,
`ILIKE '%' || translit_bg_latin($1) || '%'` with a `%>` similarity fallback. Both PG functions
confirmed present locally.

**`AwarderSearch.tsx`** — the debounced (200 ms) + `AbortController` typeahead pattern over
`/api/db/procurement-search`. The template for any server-backed group.

**`AwarderListSection.tsx`** — the one shared component every sector's member list renders through
(`chips` and `roster` variants). The natural host for a members filter.

### Four existing pickers are measurably wrong today (free wins)

Every cmdk mount in the app uses `<CommandPrimitive shouldFilter={false}>` and hand-rolls its own
filter — so there is **no** single wrapper-level fix. Audited, all 9 mounts:

| Picker | Filter | Folds? |
|---|---|---|
| `CpvFilterCombobox.tsx:120` | `skeletonMatches(name, q)` | ✅ the reference |
| `NzokHospitalCompareTile.tsx:47` | `decodeEntities(o.name).toLocaleLowerCase().includes(q)` over 256 options | ❌ |
| `NzokDrugQuarterlyTrendTile.tsx:78` | `o.toLocaleLowerCase().includes(q)` over 610 INNs | ❌ |
| `NzokRevenueTrendTile.tsx:157` | `.includes(query.toLocaleLowerCase())` | ❌ |
| `CandidatePicker.tsx:36` | `haystack.toLocaleLowerCase().includes(needle…)` | ❌ |
| `Search.tsx` / `SearchItems.tsx` / `AreaSniperButton.tsx` / `MyAreaEntryScreen.tsx` | Fuse index (`SEARCH_FUSE_OPTIONS`) | n/a — separate path |

The four ❌ rows are one-line fixes to `searchMatches`, and the two НЗОК ones additionally re-derive
their display string per row per keystroke (256 `decodeEntities()` calls on every character typed) —
exactly what the pre-folded index of §3 removes. Fix them while building T2, not as a separate task.

---

## 3. Architecture — one component, one index builder

### 3.1 `<SectorEntitySearch groups={…} />`

A single search box mounted **directly under the breadcrumb + `<ScopeControl>`**, above the first
tile — i.e. one insertion point in `SectorDashboardScreen.tsx` and one per bespoke screen
(`WaterScreen`, `JudiciaryScreen`, `CultureScreen`, `PensionsScreen`, `DefenseScreen`,
`AdministrationScreen`, `SubsidiesDashboardScreen`, `EducationScreen`).

It renders a Popover + cmdk list with `shouldFilter={false}` (we own the filter and the cap), one
labelled section per group, ≤8 rows per group. Grouped results, arrow-key nav, Enter navigates.

```ts
export interface EntitySearchGroup {
  /** Section heading, e.g. { bg: "Болници", en: "Hospitals" }. */
  label: { bg: string; en: string };
  /** Built once, memoised on the source payload. See buildEntityIndex. */
  index: EntityIndex | null;
  /** Rows/keystroke cap for this group (default 8). */
  limit?: number;
  /** Lazily fetched groups report loading so the list can say so. */
  loading?: boolean;
}

export interface EntityRow {
  id: string;
  label: string;          // primary display text (already decoded / language-resolved)
  sub?: string;           // secondary line: place, EIK, ATC, year, money
  href: string;           // EVERY result navigates — see the decision in §9
}
```

**There is no in-page "scroll and highlight" mode.** Per §9.1 every group's rows resolve to a real
page, so the component has exactly one selection behaviour. That removes the branch, the highlight
state and the `scroll-mt` bookkeeping — and it is what makes the two new page families in §7/T5
prerequisites rather than nice-to-haves.

### 3.2 `buildEntityIndex()` — pre-fold ONCE, never per keystroke

```ts
// src/lib/entitySearchIndex.ts
export interface EntityIndex {
  rows: EntityRow[];
  /** Parallel array — folded haystack per row, joined from every search key. */
  folds: string[];
}

export const buildEntityIndex = (
  rows: EntityRow[],
  keysOf: (r: EntityRow) => string[],   // name + code + place + aliases…
): EntityIndex => ({
  rows,
  // latinSkeleton, NOT latinSkeletonCached — see the perf contract R2 below.
  folds: rows.map((r) => keysOf(r).map(latinSkeleton).join(" ")),
});
```

Search is then a single pass of `folds[i].includes(needle)` over pre-folded strings — no folding of
targets at query time at all.

### 3.3 Ordering: sort the index once, scan-and-stop

The index is built **sorted by the sector's own money/size measure descending** (НЗОК spend, subsidy
total, contract value, examinee count). A linear scan that stops at the cap therefore returns the
*largest* matches first — meaningful truncation instead of arbitrary truncation, and O(cap) work
instead of O(n) for the common broad query on a 16k-row list.

Prefix hits still outrank contains-hits: collect into two buckets (`startsWith` / `includes`) in one
pass, stop when the prefix bucket alone fills the cap.

---

## 4. Shliokavitsa: what folds today, what does not

`latinSkeleton` handles the **Cyrillic → Latin** direction fully, plus the ч/х collapse. What it
does **not** handle is the *other* half of real shliokavitsa — the Latin-side spelling variants a
Bulgarian actually types:

| Typed | Means | Folds today to | Target folds to | Match? |
|---|---|---|---|---|
| `6umen` | Шумен | `6umen` | `shumen` | ✗ |
| `4erven` | Червен | `4erven` | `herven` | ✗ |
| `jelezopyten` | железопътен | `jelezopyten` | `zhelezopaten` | ✗ |
| `plowdiw` | Пловдив | `plowdiw` | `plovdiv` | ✗ |
| `sofiq` | София | `sofiq` | `sofiya` | ✗ |
| `arh` / `arch` / `арх` | арх… | `arh` | `arh` | ✓ (already) |

**Proposed fix — strictly additive, zero regression risk.** Do **not** change `latinSkeleton`.
Add a query-side normaliser and OR the two needles against the *same* pre-folded haystack:

```ts
// src/lib/translitSearch.ts (new export)
const SHLYO: [RegExp, string][] = [
  [/6t/g, "sht"], [/6/g, "sh"], [/4/g, "h"],   // 4 → ч → h (the ч/х collapse)
  [/9/g, "ya"],  [/q/g, "ya"], [/j/g, "zh"],
  [/w/g, "v"],   [/x/g, "h"],  [/y(?![aeiou])/g, "a"], // ъ typed as y
];
export const shlyoSkeleton = (s: string): string => {
  let out = latinSkeleton(s);
  for (const [re, to] of SHLYO) out = out.replace(re, to);
  return out === latinSkeleton(s) ? "" : out;   // "" ⇒ no second needle needed
};
```

Match becomes `fold.includes(n1) || (n2 && fold.includes(n2))`. Because the second needle is only
ever *added*, no query that matches today can stop matching. Cost: one extra `String.includes` per
row, and only when the query actually contains an ambiguous character.

**Deliberately excluded:** `c → ts` (ц). It would fold every Latin trade name containing `c`
(`Keytruda`, `Abemaciclib`, `Concentrate`) into a different skeleton than the reader typed, and the
НЗОК med/molecule groups are majority-Latin. Bulgarian readers overwhelmingly type `ts` for ц
anyway. Note it in the code so nobody "fixes" it later.

---

## 5. Performance contract

These are the rules any sector's search must satisfy. They are the answer to "ensure high
performance".

**R1 — No new eager fetch.** Every group's source must be one of:
(a) a payload the dashboard already fetches; (b) fetched lazily on first focus of the search box;
(c) a debounced server typeahead. A search box must never add a request to page load.

**R2 — Fold at index-build, not at keystroke.** Use `latinSkeleton` (uncached) when building a
persistent index — **not** `latinSkeletonCached`. The shared memo has a 50k cap with half-eviction
sized for the DataTable's distinct-cell working set; pushing 9k index strings through it would evict
that working set and re-introduce the exact 50 ms/pass regression the cache comment documents.

**R3 — `useDeferredValue` + ≥2-char guard + per-group cap of 8.** Already the `/education` pattern.

**R4 — Scan-and-stop over a money-sorted index** (§3.3), so a broad query on a large group costs
O(cap), not O(n).

**R5 — Server typeahead above ~5,000 rows.** Measured universes that cross it: farms
(**16,702** distinct EIKs in `agri_subsidies`). Everything else fits client-side.

**R6 — Lazy index build.** Build a group's index inside the search component on first focus, not in
the screen's render path, so a reader who never searches pays nothing.

### Measured budgets

| Sector | Client-side rows | Fold keys | One-off build | Per keystroke |
|---|---|---|---|---|
| Здравна каса | 258 + 610 + 3,333 + 427 = **4,628** | ~9,300 | ~15 ms, on focus | ≤8 rows scanned per group after R4 |
| Култура | 944 + 26 = **970** | ~2,900 | ~4 ms | — |
| Училища | **994** | ~3,000 | ~4 ms | — |
| Съдебна власт | **178** | ~530 | <1 ms | — |
| Митници | 563 + 354 = **917** | ~2,300 | ~4 ms | — |
| Води | **38** | ~150 | <1 ms | — |
| Сигурност (МВР) | **73** | ~290 | <1 ms | — |
| Субсидии | 16,702 → **server** | — | — | 200 ms debounce |
| Администрация | 2,669 → **server** (already a `DbDataTable` resource) | — | — | 200 ms debounce |

The heaviest client index (health, 4.6k rows) is ~200 KB of retained folded strings — built lazily
under R6, and only after the reader has signalled intent by focusing the box.

---

## 6. Per-sector search criteria — the proposal

"Search criteria" = the fields folded into each row's haystack. Order within a row does not matter
(they are joined into one fold); order of *groups* is the display order.

### Tier 1 — the four the operator named

#### `/sector/health` — Здравна каса (4 groups)

| Group | N | Criteria | Source (already loaded) | Destination |
|---|---|---|---|---|
| **Болници** | 258 | facility name **decoded** (`decodeEntities` — the raw rows carry HTML entities), EIK, РЗОК name, settlement, `regNo` | `/api/db/nzok-hospital-payments` + `hospital_eik.json` (settlement) | `/company/:eik` |
| **Молекули (INN)** | 610 | INN, ATC code (`L01FF02` — prefix-matchable), ATC group label bg/en, trade names of its packs | `/api/db/nzok-drug-quarterly` (`allInns`) + `drug_unit_prices` | `/molecule/:inn` |
| **Лекарства (опаковки)** | 3,333 | trade name, INN, НЗОК code (`LH399`), national number (`15839`), pharmaceutical form | `/api/db/nzok-drug-unit-prices` (`packStats`) | `/molecule/:inn/pack/:nationalNo/:nzokCode` |
| **Клинични пътеки** | 427 | procedure code (`A01.1`), name, `procType` (КП / АПр / КПр) | `/budget/nzok/procedures.json` (75 KB) | `/procedure/:code` |

Two criteria details that will otherwise bite:
- The hospital fold **must** be built from the decoded name. Folding the raw `&quot;`-bearing string
  injects `quot` into every haystack and makes "quo" match 258 hospitals.
- Procedure names are stored **UPPERCASE Cyrillic** (`ХРОНИОХЕМОДИАЛИЗА`). `latinSkeleton`
  lowercases, so this is already handled — but the *display* label needs sentence-casing, not the
  fold.

#### `/water` — Води (1 group)

| Group | N | Criteria | Source | Destination |
|---|---|---|---|---|
| **ВиК оператори** | 38 | operator name, EIK, oblast, type label (холдинг / концесия / напоителни) | `WATER_OPERATORS` (`src/lib/vikReferenceData.ts`, static module — zero fetch) | `/company/:eik` (money) with a secondary `/awarder/:eik` chip |

#### `/education` — Училища (upgrade, 1 group)

Already built. Port `searchSchools.ts` onto the shared component and **widen the criteria** from
today's `name` + `obshtinaName` to: name, obshtina, **address/settlement** (`ГР.БАНСКО` — currently
unsearchable), oblast name, **school id** (`105201`, the НЕИСПУО number people quote). N = **994**.

#### `/sector/administration` — Администрация (1 group, server)

| Group | N | Criteria | Source | Destination |
|---|---|---|---|---|
| **Административни услуги** | 2,669 | service name, service id, tier (central / municipal) | `admin_services` via `DbDataTable` — a `procurement-search`-shaped typeahead route, or simply deep-link `/sector/administration/services?q=<term>` (the browse screen already accepts a seeded search) | ИИСДА register row |

**Cheapest honest v1 here:** the box on the dashboard forwards to
`/sector/administration/services?q=…` rather than duplicating the index. Zero new endpoint, zero new
payload, and the destination already has server-side shliokavitsa via `translit_bg_latin`.

### Tier 2 — sectors where the entity list is genuinely long

| Sector | Group | N | Criteria | Destination |
|---|---|---|---|---|
| `/judiciary` | **Съдилища и прокуратури** | **283** (186 courts + 70 prosecutions + 27 investigation) | body name (`Административен съд — Пловдив`), `body_code`, tier (районен / окръжен / апелативен / административен / военен / специализиран), place, place_code, **532 rows of `judicial_body_alias`** | **`/court/:bodyCode`** (new — §7/T5) |
| `/culture` | **Филми** | 944 | title, producer, `regNo`, year, discipline label | `/culture/film/:id` |
| | **Културни институти** | 26 (5 bodies + 21 institutes) | name, EIK, acronym alias | `/awarder/:eik` |
| `/sector/security` | **Структури на МВР** | 73 | name, EIK, universe label, oblast (ОДМВР rows carry it in the name) | `/awarder/:eik` |
| `/sector/regional` | **Областни администрации + АГКК/ДНСК** | 30 | name, EIK, oblast, universe label | `/awarder/:eik` |
| `/sector/environment` | **РИОСВ / БД / паркове** | 27 | name, EIK, universe label, oblast | `/awarder/:eik` |
| `/defense` | **Структури на МО** | 24 | name, EIK, universe label, **acronym alias** (ВМА, ТЕРЕМ, БА) | `/awarder/:eik` |
| `/sector/customs` | **Акцизни оператори** | 563 | name, EIK, category (energy / alcohol / tobacco) | `/company/:eik` |
| | **Акцизни складове** | 354 | town, operator name, EIK | `/customs/warehouses` (anchor) |
| `/pensions` | **Пенсионни фондове** | 31 | fund name, management company (bg + en), pillar label (УПФ / ППФ / ДПФ) | **`/pension-fund/:slug`** (new — §7/T5) |
| `/subsidies` | **Земеделски стопани** | 16,702 | name, EIK, settlement, obshtina | `/farm/:eik` — **server typeahead** (R5) |
| `/sector/transport` | **Структури** | 11 | name, EIK, universe, acronym alias (НКЖИ, БДЖ, ИАЖА, ГД ГВА, ДАБДП) | `/awarder/:eik` |

### Tier 3 — explicitly NOT worth a search box

`/sector/energy` (9 members), `/sector/social` (6), `/sector/revenue` (1), `/sector/customs` group
list (1 awarder), `/sector/tourism` (1), `/sector/edu` (1), `/sector/agri` (1), `/sector/roads` (1).
Their member chips already fit on one screen; a box over 9 items is noise. **Energy is the boundary
case** — 9 chips, but the subsidiary names (АЕЦ Козлодуй, ТЕЦ Марица изток 2, Булгартрансгаз) are
exactly what people type. Revisit only if the member list grows past ~15.

### The alias field — small and load-bearing

Curated entity lists spell the institution out ("Министерство на вътрешните работи") while readers
type the acronym ("МВР"). The fold strips punctuation, so an acronym **already embedded** in the name
(`ИА „Морска администрация“`, `…(НКЖИ)`) matches for free. What does **not** match is an acronym
absent from the name. Add an optional `aliases?: string[]` to `SectorMember` /
`*ReferenceData` entities and fold it in — perhaps 30 curated strings across all sectors.

---

## 7. Build order

**T0 — primitives (no UI change).**
1. `shlyoSkeleton` + tests in `src/lib/translitSearch.test.ts` (§4), including the regression
   assertion that every existing match still matches.
2. `src/lib/entitySearchIndex.ts` — `buildEntityIndex` + `searchIndex` (§3.2, §3.3) + tests.
3. The four non-folding cmdk filters in §2 → `searchMatches`. Four one-line edits, independent of
   everything else here, shippable on their own.

**T1 — the shared component.** `<SectorEntitySearch>` + its Popover/cmdk shell, `href` and `anchor`
selection modes, ≥2-char guard, `useDeferredValue`, per-group cap, lazy index build on focus.

**T2 — Здравна каса (4 groups).** The hardest and highest-value one; proves the multi-group shape.
Port `NzokHospitalCompareTile`, `NzokDrugQuarterlyTrendTile` and `NzokRevenueTrendTile` onto the
same pre-folded index while there (§2).

**T3 — Води, Училища, Администрация.** Water is trivial (static 38). Education is a port + criteria
widening. Administration is the `?q=` forward.

**T4 — Tier 2 sectors.** The `AwarderListSection`-backed ones (security / regional / environment /
defense / transport / culture-institutes) are one shared change: add an **optional** filter box to
`AwarderListSection` itself, auto-enabled above ~20 rows. That covers 5 sectors in one component.

**T5 — Субсидии (server typeahead)** plus the two new page families the §9.1 decision requires.
These are the only tier that adds routes, and both **gate** their search group: no page, no group.

#### `/court/:bodyCode` — 283 pages

**The slug already exists.** `judicial_body.body_code` is a stable, readable key (`as-plovdiv`,
`rp-yambol`, `vop-sliven`) — no new slug scheme, no `person_slug_retired`-style redirect table.
`judicial_body` is the spine (283 rows, and it is what the person layer already resolves roles
against); `court_load.json` (178 courts × 8 years) joins in where present.

What the page carries, all from data already ingested:
- **Workload trend** — judges, `personMonths`, filed / considered / resolved per month, 2018–2025
  (`court_load.json`). Absent for the 105 bodies with no load row (prosecutions, investigation) —
  the page must say so rather than render an empty chart.
- **The magistrates seated there** — drill to `/persons?court=<name>`. **Trap:** that filter carries
  the institution **NAME**, not `body_code` (CLAUDE.md, URL contract). Link off `judicial_body.name`,
  and let `judicial_body_alias` (532 rows) absorb the spelling variants.
- **Place + map pin** — `place`, `place_code`, `lng`/`lat` are already on the row (NULL for some
  prosecutions).
- **Cost per case** — the `/judiciary` `CostPerCaseTile` basis, sliced to this body.

#### `/pension-fund/:slug` — 31 pages

Slug from `pillar` + fund name (`upf-doverie`), minted in the loader so it is stable.

**Honest limitation, and it needs a decision of its own:** `data/budget/kfn/funds.json` is a
**single-quarter snapshot** (2026 Q1) — 31 funds × {pillar, fundName, companyBg/En, insured,
netAssetsEur}, and there is no history file. So a v1 fund page can show its pillar, insured count,
net assets, share of pillar, and its management company's other funds — but **no trend**, which is
the thing a fund page most wants. The fix is small and belongs in the ingest, not here:
`scripts/budget/kfn/parse_kfn.ts` currently overwrites, and the `kfn_pensions` watcher already flags
each new quarterly — retaining quarters instead of replacing them accumulates a real series from the
next release onward. **Recommend doing that ingest change first**, so the page ships with at least a
two-point trend rather than a static card.

#### Both families are URL-contract work, not just routes

New `/court/**` and `/pension-fund/**` URLs mean: the **no-slash** form everywhere
(canonical / `og:url` / `hreflang` / sitemap `<loc>`); a real `dist/<path>/index.html` per URL or a
`functions/spa_page.js` handler; and sitemap entries. 314 pages total is far below the
Firebase file-count ceiling, so **prerender both** — no `spa_page.js` route needed, unlike
`/funds/contract/**` and `/company/**`.

---

## 8. Tests

- `translitSearch.test.ts` — `shlyoSkeleton` cases from the §4 table; the additive property
  (`searchMatches(h,q) === true ⇒ still true`) over a fixture corpus.
- `entitySearchIndex.test.ts` — fold-once contract (assert `latinSkeletonCached` is **not** called
  during index build, via the exported `skeletonCacheSize()` seam); scan-and-stop returns the
  money-largest matches; prefix hits outrank contains hits.
- Per-sector pure-filter tests mirroring `searchSchools.test.ts` — one per group, no screen mount.
- One component test per screen asserting the box is present and a shliokavitsa query
  (`6umen`, `4erven`, `plowdiw`) reaches the right href.
- A `sector_search_coverage` test: every sector in `SECTOR_CLUSTERS` either declares a search group
  set or is in an explicit `NO_SEARCH` list with a reason — so a new sector cannot silently ship
  without the decision being made (same shape as `refresh_coverage.test.ts`).
- **A landing gate for §9.1**: every `EntityRow.href` a group can emit must resolve to a declared
  route. A group whose destination family is unbuilt must fail the test, not 404 at runtime — that
  is the whole risk the "full pages, no anchors" decision creates.
- `tests/seo.spec.ts` coverage for the two new families: no-slash canonical, `og:url` and `hreflang`
  that do not redirect, and a real `dist/court/<bodyCode>/index.html` per sitemap `<loc>`.

---

## 9. Decisions (settled 2026-08-04)

**9.1 — Every search result goes to a full page.** No anchor / scroll-highlight mode. Courts and
pension funds therefore need real destinations: **`/court/:bodyCode`** (283) and
**`/pension-fund/:slug`** (31), specified in §7/T5. Consequence to hold onto: those two groups are
**blocked on their page family** — do not ship a search group whose results have nowhere to land.

**9.2 — One box at the top, all groups in it.** Not per-tile filters. Matches the `/education`
precedent and keeps one component to maintain. `EntityRow.href` is therefore required, not optional.

**9.3 — No contracts / contractors / tenders in v1.** Entity-only, so the box costs zero requests on
every sector page except the two that are explicitly server-backed (subsidies, administration).
`/api/db/procurement-search` stays reachable from the header search and `AwarderSearch`; revisit for
v2 only if readers are observed searching contract subjects from a sector page.

### Still open (smaller, and downstream of 9.1)

- **KFN quarter retention** — `parse_kfn.ts` overwrites its snapshot, so `/pension-fund/:slug` ships
  trendless unless the ingest starts accumulating quarters (§7/T5). Recommended before the page.
- **`judicial_body` non-court bodies** — 70 prosecutions + 27 investigation services have no
  `court_load` row. Ship them as pages with a stated "no workload series published" (they still
  carry magistrates, place and cost), or restrict `/court/**` to the 186 courts and leave the other
  97 unsearchable? Recommend the former: they are exactly what someone types.
