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

| Tile                        | Shows                         | Universe                                                  |
| --------------------------- | ----------------------------- | --------------------------------------------------------- |
| `NzokHospitalPaymentsTile`  | `slice(0, TOP_N)`             | **258** hospital EIKs (381 facility rows)                 |
| `NzokDrugReimbursementTile` | `data.top.slice(0, TOP_N)`    | **610** INN molecules                                     |
| `NzokDrugUnitPriceTile`     | `data.overpay.slice(0, 12)`   | **3,333** pack rows / 221 trade names / 135 INNs          |
| `NzokActivityTile`          | `topProcedures.slice(0, 12)`  | **427** named procedures (571 codes in `nzok_activities`) |
| `NzokPathwayTreeTile`       | `data.hospitals.slice(0, 25)` | 258                                                       |
| `NzokHospitalRiskTile`      | `slice(0, 15)`                | 258                                                       |

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

| Picker                                                                              | Filter                                                                    | Folds?              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------- |
| `CpvFilterCombobox.tsx:120`                                                         | `skeletonMatches(name, q)`                                                | ✅ the reference    |
| `NzokHospitalCompareTile.tsx:47`                                                    | `decodeEntities(o.name).toLocaleLowerCase().includes(q)` over 256 options | ❌                  |
| `NzokDrugQuarterlyTrendTile.tsx:78`                                                 | `o.toLocaleLowerCase().includes(q)` over 610 INNs                         | ❌                  |
| `NzokRevenueTrendTile.tsx:157`                                                      | `.includes(query.toLocaleLowerCase())`                                    | ❌                  |
| `CandidatePicker.tsx:36`                                                            | `haystack.toLocaleLowerCase().includes(needle…)`                          | ❌                  |
| `Search.tsx` / `SearchItems.tsx` / `AreaSniperButton.tsx` / `MyAreaEntryScreen.tsx` | Fuse index (`SEARCH_FUSE_OPTIONS`)                                        | n/a — separate path |

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
  label: string; // primary display text (already decoded / language-resolved)
  sub?: string; // secondary line: place, EIK, ATC, year, money
  href: string; // EVERY result navigates — see the decision in §9
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
  keysOf: (r: EntityRow) => string[], // name + code + place + aliases…
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
_largest_ matches first — meaningful truncation instead of arbitrary truncation, and O(cap) work
instead of O(n) for the common broad query on a 16k-row list.

Prefix hits still outrank contains-hits: collect into two buckets (`startsWith` / `includes`) in one
pass, stop when the prefix bucket alone fills the cap.

---

## 4. Shliokavitsa: what folds today, what does not

`latinSkeleton` handles the **Cyrillic → Latin** direction fully, plus the ч/х collapse. What it
does **not** handle is the _other_ half of real shliokavitsa — the Latin-side spelling variants a
Bulgarian actually types:

| Typed                  | Means       | Folds today to | Target folds to | Match?      |
| ---------------------- | ----------- | -------------- | --------------- | ----------- |
| `6umen`                | Шумен       | `6umen`        | `shumen`        | ✗           |
| `4erven`               | Червен      | `4erven`       | `herven`        | ✗           |
| `jelezopyten`          | железопътен | `jelezopyten`  | `zhelezopaten`  | ✗           |
| `plowdiw`              | Пловдив     | `plowdiw`      | `plovdiv`       | ✗           |
| `sofiq`                | София       | `sofiq`        | `sofiya`        | ✗           |
| `arh` / `arch` / `арх` | арх…        | `arh`          | `arh`           | ✓ (already) |

**Proposed fix — strictly additive, zero regression risk.** Do **not** change `latinSkeleton`.
Add a query-side normaliser and OR the two needles against the _same_ pre-folded haystack:

```ts
// src/lib/translitSearch.ts (new export)
const SHLYO: [RegExp, string][] = [
  [/6t/g, "sht"],
  [/6/g, "sh"],
  [/4/g, "h"], // 4 → ч → h (the ч/х collapse)
  [/9/g, "ya"],
  [/q/g, "ya"],
  [/j/g, "zh"],
  [/w/g, "v"],
  [/x/g, "h"],
  [/y(?![aeiou])/g, "a"], // ъ typed as y
];
export const shlyoSkeleton = (s: string): string => {
  let out = latinSkeleton(s);
  for (const [re, to] of SHLYO) out = out.replace(re, to);
  return out === latinSkeleton(s) ? "" : out; // "" ⇒ no second needle needed
};
```

Match becomes `fold.includes(n1) || (n2 && fold.includes(n2))`. Because the second needle is only
ever _added_, no query that matches today can stop matching. Cost: one extra `String.includes` per
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

| Sector          | Client-side rows                                      | Fold keys | One-off build    | Per keystroke                      |
| --------------- | ----------------------------------------------------- | --------- | ---------------- | ---------------------------------- |
| Здравна каса    | 258 + 610 + 3,333 + 427 = **4,628**                   | ~9,300    | ~15 ms, on focus | ≤8 rows scanned per group after R4 |
| Култура         | 944 + 26 = **970**                                    | ~2,900    | ~4 ms            | —                                  |
| Училища         | **994**                                               | ~3,000    | ~4 ms            | —                                  |
| Съдебна власт   | **178**                                               | ~530      | <1 ms            | —                                  |
| Митници         | 563 + 354 = **917**                                   | ~2,300    | ~4 ms            | —                                  |
| Води            | **38**                                                | ~150      | <1 ms            | —                                  |
| Сигурност (МВР) | **73**                                                | ~290      | <1 ms            | —                                  |
| Субсидии        | 16,702 → **server**                                   | —         | —                | 200 ms debounce                    |
| Администрация   | 2,669 → **server** (already a `DbDataTable` resource) | —         | —                | 200 ms debounce                    |

The heaviest client index (health, 4.6k rows) is ~200 KB of retained folded strings — built lazily
under R6, and only after the reader has signalled intent by focusing the box.

---

## 6. Per-sector search criteria — the proposal

"Search criteria" = the fields folded into each row's haystack. Order within a row does not matter
(they are joined into one fold); order of _groups_ is the display order.

### Tier 1 — the four the operator named

#### `/sector/health` — Здравна каса (4 groups)

| Group                    | N                           | Criteria                                                                                                             | Source (already loaded)                                             | Destination                                 | Servable?                                          |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| **Болници**              | 381 rows / **266** with EIK | facility name **decoded** (`decodeEntities` — the raw rows carry HTML entities), EIK, РЗОК name, settlement, `regNo` | `/api/db/nzok-hospital-payments` + `hospital_eik.json` (settlement) | `/company/:eik`                             | ⚠ **115 rows carry no EIK** — §10.1               |
| **Молекули (INN)**       | 610                         | INN, ATC code (`L01FF02` — prefix-matchable), ATC group label bg/en, trade names of its packs                        | `/api/db/nzok-drug-quarterly` (`allInns`) + `drug_unit_prices`      | `/molecule/:inn`                            | ❌ **only 30 of 610 serve** — §10.1                |
| **Лекарства (опаковки)** | 3,333                       | trade name, INN, НЗОК code (`LH399`), national number (`15839`), pharmaceutical form                                 | `/api/db/nzok-drug-unit-prices` (`packStats`)                       | `/molecule/:inn/pack/:nationalNo/:nzokCode` | ✅ all 3,333 (no row has both id sides blank)      |
| **Клинични пътеки**      | 427 named / **571** codes   | procedure code (`A01.1`), name, `procType` (КП / АПр / КПр)                                                          | `/budget/nzok/procedures.json` (75 KB, via `useNzokProcedureNames`) | `/procedure/:code`                          | ⚠ **80 named codes have no activity row** — §10.1 |

Two criteria details that will otherwise bite:

- The hospital fold **must** be built from the decoded name. Folding the raw `&quot;`-bearing string
  injects `quot` into every haystack and makes "quo" match 258 hospitals.
- Procedure names are stored **UPPERCASE Cyrillic** (`ХРОНИОХЕМОДИАЛИЗА`). `latinSkeleton`
  lowercases, so this is already handled — but the _display_ label needs sentence-casing, not the
  fold.

#### `/water` — Води (1 group)

| Group             | N   | Criteria                                                                 | Source                                                                        | Destination                                                   |
| ----------------- | --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **ВиК оператори** | 38  | operator name, EIK, oblast, type label (холдинг / концесия / напоителни) | `WATER_OPERATORS` (`src/lib/vikReferenceData.ts`, static module — zero fetch) | `/company/:eik` (money) with a secondary `/awarder/:eik` chip |

#### `/education` — Училища (upgrade, 1 group)

Already built. Port `searchSchools.ts` onto the shared component and **widen the criteria** from
today's `name` + `obshtinaName` to: name, obshtina, **address/settlement** (`ГР.БАНСКО` — currently
unsearchable), oblast name, **school id** (`105201`, the НЕИСПУО number people quote). N = **994**.

#### `/sector/administration` — Администрация (1 group, server)

| Group                      | N     | Criteria                                             | Source                                                   | Destination                                |
| -------------------------- | ----- | ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| **Административни услуги** | 2,669 | service name, service id, tier (central / municipal) | `admin_services` via the existing `DbDataTable` resource | `/sector/administration/services?q=<term>` |

**Cheapest honest v1 here:** the box on the dashboard forwards to
`/sector/administration/services?q=…` rather than duplicating the index. Zero new endpoint, zero new
payload, and the destination already has server-side shliokavitsa via `translit_bg_latin`.

**One wiring gap to close first:** `DbDataTable` supports `initialSearch`, but
`AdminServicesBrowseScreen` does not read `?q` — unlike the contracts / tenders / persons browsers,
which is why the URL contract lists `?q` for those three only. Add
`initialSearch={params.get("q") ?? undefined}` there, or the forward lands on an unfiltered table.

### Tier 2 — sectors where the entity list is genuinely long

| Sector                | Group                                  | N                                                         | Criteria                                                                                                                                                                                             | Destination                                                                                                                                                         |
| --------------------- | -------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/judiciary`          | **Съдилища и прокуратури**             | **283** (186 courts + 70 prosecutions + 27 investigation) | body name (`Административен съд — Пловдив`), `body_code`, tier (районен / окръжен / апелативен / административен / военен / специализиран), place, place_code, **532 rows of `judicial_body_alias`** | **`/court/:bodyCode`** (new — §7/T5)                                                                                                                                |
| `/culture`            | **Филми**                              | 944                                                       | title, producer, `regNo`, year, discipline label                                                                                                                                                     | `/culture/film/${filmId(f)}` — the id is **derived** (`@/data/culture/filmId`); `regNo` is a search key but **not** an identity, the register's рег.№ is not unique |
|                       | **Културни институти**                 | 26 (5 bodies + 21 institutes)                             | name, EIK, acronym alias                                                                                                                                                                             | `/awarder/:eik`                                                                                                                                                     |
| `/sector/security`    | **Структури на МВР**                   | 73                                                        | name, EIK, universe label, oblast (ОДМВР rows carry it in the name)                                                                                                                                  | `/awarder/:eik`                                                                                                                                                     |
| `/sector/regional`    | **Областни администрации + АГКК/ДНСК** | 30                                                        | name, EIK, oblast, universe label                                                                                                                                                                    | `/awarder/:eik`                                                                                                                                                     |
| `/sector/environment` | **РИОСВ / БД / паркове**               | 27                                                        | name, EIK, universe label, oblast                                                                                                                                                                    | `/awarder/:eik`                                                                                                                                                     |
| `/defense`            | **Структури на МО**                    | 24                                                        | name, EIK, universe label, **acronym alias** (ВМА, ТЕРЕМ, БА)                                                                                                                                        | `/awarder/:eik`                                                                                                                                                     |
| `/sector/customs`     | **Акцизни оператори**                  | 563                                                       | name, EIK, category (energy / alcohol / tobacco), **+ the towns of its 354 warehouses**                                                                                                              | `/company/:eik`                                                                                                                                                     |
| `/pensions`           | **Пенсионни фондове**                  | 31                                                        | fund name, management company (bg + en), pillar label (УПФ / ППФ / ДПФ)                                                                                                                              | **`/pension-fund/:slug`** (new — §7/T5)                                                                                                                             |
| `/subsidies`          | **Земеделски стопани**                 | 16,702                                                    | name, EIK, settlement, obshtina                                                                                                                                                                      | `/farm/:eik` — **server typeahead** (R5)                                                                                                                            |
| `/sector/transport`   | **Структури**                          | 11                                                        | name, EIK, universe, acronym alias (НКЖИ, БДЖ, ИАЖА, ГД ГВА, ДАБДП)                                                                                                                                  | `/awarder/:eik`                                                                                                                                                     |

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

**T1 — the shared component.** `<SectorEntitySearch>` + its Popover/cmdk shell, one `href`
selection behaviour, ≥2-char guard, `useDeferredValue`, per-group cap, lazy index build on focus.

**T2a — make the health destinations serve what the search finds (§10.1).** Blocking, and it is
backend work, not UI: widen `nzok_drug_molecule_detail()` so all 610 INNs resolve (today 30 do),
settle the 80 rollup procedure codes, and exclude the 115 EIK-less facilities with a stated
footnote. The function change is `CREATE OR REPLACE` + a hand-applied
`scripts/db/apply_functions.ts` run against Cloud SQL — no loader carries a function body, so local
would be green and prod would keep the old one indefinitely.

**T2 — Здравна каса (4 groups).** The hardest and highest-value one; proves the multi-group shape.
Port `NzokHospitalCompareTile`, `NzokDrugQuarterlyTrendTile` and `NzokRevenueTrendTile` onto the
same pre-folded index while there (§2).

**T3 — Води, Училища, Администрация.** Water is trivial (static 38). Education is a port + criteria
widening. Administration is the `?q=` forward.

**T4 — Tier 2 sectors.** The member-list sectors (security 73 / regional 30 / environment 27 /
defense 24 / transport 11 / culture-institutes 26) are one shared change — but **not** the one an
earlier draft of this plan proposed. Adding a filter box inside `AwarderListSection` would put a
second search input on the page and contradict §9.2. Instead these become a **`members` group in the
top box**, built from the same `SectorMember[]` the tile already renders. One `membersGroup(config)`
helper covers all six sectors, `AwarderListSection` is untouched, and there is exactly one input per
page.

**T5 — Субсидии (server typeahead)** plus the two new page families the §9.1 decision requires.
These are the only tier that adds routes, and both **gate** their search group: no page, no group.

#### `/court/:bodyCode` — all 283 bodies (§9.4)

**The slug already exists.** `judicial_body.body_code` is a stable, readable key (`as-plovdiv`,
`rp-yambol`, `vop-sliven`) — no new slug scheme, no `person_slug_retired`-style redirect table.
`judicial_body` is the spine (and it is what the person layer already resolves roles against);
`court_load.json` (178 courts × 8 years) joins in where present.

**The route covers every body, not just the courts** — 186 courts + 70 prosecutions + 27
investigation services (measured). The name `/court/**` is therefore slightly narrower than its
contents; keep it anyway (short, guessable, and "съд" is what a reader types) but make the page
title carry the real `kind`.

What the page carries, all from data already ingested:

- **Workload trend** — judges, `personMonths`, filed / considered / resolved per month, 2018–2025
  (`court_load.json`).
- **The magistrates seated there** — drill to `/persons?court=<name>`. **Trap:** that filter carries
  the institution **NAME**, not `body_code` (CLAUDE.md, URL contract). Link off `judicial_body.name`,
  and let `judicial_body_alias` (532 rows) absorb the spelling variants.
- **Place + map pin** — `place`, `place_code`, `lng`/`lat` are already on the row.
- **Cost per case** — the `/judiciary` `CostPerCaseTile` basis, sliced to this body.

**Three of those four degrade on the ~97 non-court bodies, and the page must say so rather than
render empty.** `court_load` has no row for prosecutions or investigation services, so no workload
series and no cost-per-case; `lng`/`lat` are NULL on many prosecutions, so no pin. What every body
does carry is its magistrates, place, tier and kind — which is why they are worth publishing. A
"няма публикувана натовареност за този орган" line is a required part of the page, not a fallback:
the empty-chart version is how this ships looking broken.

#### T5a — КФН quarter retention (§9.5), BEFORE the fund page

`data/budget/kfn/funds.json` is a **single-quarter snapshot** today (2026 Q1) — 31 funds ×
{pillar, fundName, companyBg/En, insured, netAssetsEur}. `__write_funds.ts` picks the **newest** ZIP
under `raw_data/budget/kfn/` and `writeFileSync`s the parse straight over the file, so each ingest
destroys the previous quarter. `parseKfnZip` itself is fine — it already returns exactly one
`(period, periodLabel, funds[])` and the grain comment already says "one row per (fund, period)".

**The retained series must live in the committed JSON, not in the ZIP cache.** `raw_data/budget/` is
gitignored (`.gitignore:182`) and the ZIPs are untracked, so "re-parse every ZIP on disk" makes the
history a property of _this machine_ — a fresh clone would silently restart from one quarter.
`data/budget/kfn/funds.json` IS tracked, so it is the durable store.

Shape change — from one period to a keyed set:

```jsonc
{ "generatedAt": "…", "source": "…",
  "latestPeriod": "2026-03-31",
  "periods": [ { "period": "2025-06-30", "periodLabel": "2025 Q2", "funds": [ … ] },
               { "period": "2026-03-31", "periodLabel": "2026 Q1", "funds": [ … ] } ] }
```

Writer becomes **merge, never replace**: read the existing file, upsert the parsed period by its
`period` key, sort, write. Re-running the same quarter is then idempotent, and a bad parse can only
corrupt one period instead of the whole file. Add a shrink guard in the spirit of the other loaders
— refuse to write a file with fewer periods than it read, unless `--allow-shrink`.

**Seeding:** two ZIPs are already on disk (`statistics_2025_q2.zip`, `statistics_2026_q1.zip`), so a
one-time run over both yields a **two-point** series immediately — the page ships with a real
delta, not a static card. Deeper backfill is manual: the КФН URL carries the WordPress upload month
and a `-1`-style suffix (`…/2025/08/statistics_2025_q2-1.zip`), so older quarters are not
mechanically enumerable — the `update-noi` skill already documents that the `kfn_pensions` watcher is
what discovers each URL.

**Two downstream edits this change requires**, neither of which the ingest will fail without:
`KfnFundsTile` reads the flat `funds[]` and must move to `latestPeriod`; and the `update-noi` skill
(`.claude/skills/update-noi/SKILL.md` §КФН) documents the overwrite behaviour and must say "merges".

#### `/pension-fund/:slug` — 31 pages

Slug from `pillar` + fund name (`upf-doverie`), minted in the writer so it is stable across
re-parses. Carries: pillar, insured count, net assets, share of its pillar, its management company's
other funds, and — post-T5a — the quarterly trend in insured and net assets.

#### Both families are URL-contract work, not just routes

New `/court/**` and `/pension-fund/**` URLs mean the **no-slash** form everywhere, a real
`dist/<path>/index.html` per URL, sitemap entries, and the AIO surfaces. Full implementation in
**§11** — it is the larger half of T5.

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
- **A landing gate for §9.1 — and it must assert COVERAGE, not just route shape.** §10.1 is exactly
  the bug a route-shape-only gate would pass: `/molecule/PEMBROLIZUMAB` matches the declared route
  and still renders not-found for 580 of 610 INNs. So this is a `*.data.test.ts` against Postgres:
  for each group, every id the index can emit must resolve to a **non-null** payload from the
  serving function the destination screen calls, with an allowed-exclusion list (the 115 EIK-less
  facilities) that the test prints so it cannot quietly grow.
- `tests/seo.spec.ts` coverage for the two new families: no-slash canonical, `og:url` and `hreflang`
  that do not redirect, and a real `dist/court/<bodyCode>/index.html` per sitemap `<loc>`.
- A `/court/:bodyCode` test over a **prosecution** (no `court_load` row, NULL coords), not only a
  court — §9.4's whole risk is that the ~97 degraded bodies ship as empty charts, and a fixture
  built from `as-plovdiv` alone would never catch it.
- `kfn_funds.test.ts` — merge is idempotent (re-parsing the same quarter leaves the file unchanged),
  a new period appends rather than replaces, and the shrink guard refuses a period-count drop.

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

**9.4 — `/court/**`covers all 283 bodies**, not just the 186 courts. The 70 prosecutions and 27
investigation services get pages too. They have no`court_load` row and often no coordinates, so
the page must **name the absence** ("няма публикувана натовареност за този орган") rather than draw
an empty chart — see §7/T5. They still carry magistrates, place, tier and kind, and they are exactly
what a reader types.

**9.5 — КФН retains quarters.** `__write_funds.ts` moves from overwrite to merge-by-period, with the
series living in the **tracked** `data/budget/kfn/funds.json` rather than in the gitignored ZIP
cache — otherwise history becomes a property of one machine. Sequenced as **T5a, before the fund
page**, and seeded from the two ZIPs already on disk so `/pension-fund/:slug` ships with a real
two-point trend. Full shape, guard and downstream edits in §7/T5a.

### Still open

Nothing blocking. The remaining judgement calls are inside T5a's implementation (shrink-guard
threshold, whether the page shows insured or net assets as its headline series) and are better made
against real output than decided here.

---

## 10. Audit rev 1.0 (2026-08-04) — gaps found

Full pass over §§1–9 against the codebase and local Postgres. **The plan as written would have
shipped a search box whose most valuable group sends 95% of its results to a not-found page.**
Everything below is measured.

### 10.1 BLOCKING — three destinations do not serve what the search would find

Decision §9.1 ("every result goes to a full page") is only as good as the destination's coverage,
and the plan never checked it. It should have: this is the exact failure mode the decision was meant
to prevent, arriving through the back door.

| Group               | Search finds                         | Destination actually serves                                                                                                                | Gap                                                                                                                                                  |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Молекули**        | **610** INNs (`nzok_drug_quarterly`) | **30** — `nzok_drug_molecule_detail()` returns `NULL` unless the INN has a row in `nzok_drug_overpay_by_inn` (30 rows, year 2025)          | **580 / 610 = 95%** land on `MoleculeDetailScreen`'s `!data` branch                                                                                  |
| **Клинични пътеки** | 427 named codes                      | 571 codes have activity rows, but **80 of the 427 names are not among them** (`A01`, `A01.2`, `A10`, `A38.1`, `A43` — parent/rollup codes) | **80 / 427 = 19%** not-found. Inverse also true: **144** activity codes have no name, so they are findable only by code and render as a bare `A17.2` |
| **Болници**         | 381 facility rows                    | **266** have an EIK; `FacilityLink` already renders the other 115 as plain text precisely because they have nowhere to go                  | **115 / 381 = 30%** have no `/company/:eik`                                                                                                          |

**The molecule one is not a data problem — it is a function-scope problem.** The spend data for all
610 INNs is present (`nzok_drug_quarterly`), and 135 have pack rows; the detail function simply
keys on the _overpay_ aggregate, which is a top-30 leaderboard. So the fix is to widen
`nzok_drug_molecule_detail()` to fall back to quarterly spend + pack rows when no overpay row
exists, i.e. **the molecule page is thin by accident, not by design**. That is a `CREATE OR REPLACE`
on the owning migration, applied to Cloud SQL by hand per CLAUDE.md's "applied, never loaded" rule —
no loader ships a function body, and local would be green while prod kept the old one.

Sequencing consequence: **T2 (health) grows a T2a** — widen the molecule function, decide the
procedure rollup-code behaviour, and settle the EIK-less hospitals — **before** the search groups
ship. Three options for the last one, in preference order: (a) route EIK-less facilities to
`/awarder/121858220#nzok-hospital-map` scrolled to their pin — rejected, §9.1 forbids anchors;
(b) exclude them from the group and say so in the footnote ("115 лечебни заведения без ЕИК не се
търсят"); (c) mint `/facility/:regNo` pages. **(b) for v1** — it is honest, cheap, and 30% is a
footnote, not a feature.

### 10.2 Self-contradiction between §9.2 and the old T4

The original T4 proposed adding a filter box **inside** `AwarderListSection`, which would put a
second search input on six sector pages — directly against §9.2 ("one box at the top"). Fixed in
§7/T4: those sectors get a `members` group in the top box instead, and `AwarderListSection` is not
touched. Flagging it here because the contradiction was introduced _by_ the 9.2 decision and would
otherwise have been discovered mid-build.

### 10.3 Four cross-cutting behaviours the plan never states

None are hard; all are the kind of omission that gets decided badly under time pressure.

- **Scope (`?pscope`) — the box must IGNORE it.** Every sector dashboard carries the scope pill, so
  the obvious-looking choice is to restrict results to entities with activity in the window. That is
  wrong: a finder must find, and "your hospital does not exist" is a much worse failure than "your
  hospital has no contracts in this window". State it, or someone will "fix" it later. The
  destination page keeps its own scope handling; the search does not filter on scope.
- **Language.** `SectorMember.name` carries `{bg, en}`, but `judicial_body.name`, `WATER_OPERATORS`,
  procedure names and film titles are **Bulgarian only**. Folding makes them _findable_ from a Latin
  query either way, so v1 renders the BG label on the EN site rather than blocking on translation —
  but the label, not the fold, is what needs saying out loud.
- **Prerendered HTML.** `scripts/prerender/dynamicRoutes.ts` emits a static shell; the search box is
  client-only, so the prerendered page ships an inert input that hydrates. Acceptable and invisible,
  but it means the box contributes nothing to SEO and must not be counted as discovery.
- **Empty state.** One line, per group, naming what was searched — not a bare "no results".

### 10.4 The existing destinations are not prerendered either

`dynamicRoutes.ts` prerenders `/school/:id` (gated on `hasCrawlableId` + a latest БЕЛ score),
`/awarder/:eik` for packed institutions, `/person/:slug`, `/procurement/settlement/:ekatte` and the
funds families. It does **not** prerender `/molecule/**`, `/procedure/**`, `/farm/**`, `/company/**`
or `/culture/film/**`.

Search is precisely what makes those pages reachable, and reachable-but-unprerendered is the shape
of `project_seo_discovery_gap`. Sized and sequenced in **§11.5**; the two new families are
implemented in §11.1–11.4.

### 10.5 Two earlier claims already corrected in place

Recorded so the corrections are not re-litigated: the shared `<Command>` wrapper has no default
filter to fix (all 9 cmdk mounts pass `shouldFilter={false}` and hand-roll — §2), and
`AdminServicesBrowseScreen` does not read `?q` today, so the administration forward needs a one-line
`initialSearch` wiring first (§6).

### 10.6 What the audit did NOT find

- The performance contract holds. Every "already loaded" claim in §6 was verified against the tiles
  that fetch it: `useNzokActivities`, `useNzokDrugQuarterly`, `useNzokDrugUnitPrices`,
  `useNzokHospitalFinancials` and `useNzokProcedureNames` are all already mounted by the НЗОК pack,
  so no health group adds a request.
- `judicial_body.body_code` is genuinely unique and URL-safe across all 283 rows.
- `nzok_drug_pack_stats` has **zero** rows with both `national_no` and `nzok_code` blank, so the
  `PACK_BLANK` sentinel never has to encode a doubly-blank identity — all 3,333 packs are
  addressable.

---

## 11. Prerender + SEO/AIO implementation

Folds the static-generation half of T5 into the plan. Every file path below is real and was read;
the two new families follow **two different existing templates**, because their sources differ.

### 11.1 Prerender — two new builders in `scripts/prerender/dynamicRoutes.ts`

Both emit `PrerenderRoute` (`scripts/prerender/routes.ts:7`):

```ts
{ path, title, description, ogImage?, jsonLd?, bodyHtml?, canonicalUrl?, english? }
```

`path` carries **no leading or trailing slash** (`school/105201`, not `/school/105201/`); the
emitter derives `/{path}` and `/en/{path}` from it, which is what keeps the family on the no-slash
contract for free. Register both in `buildDynamicRoutes()` (`dynamicRoutes.ts:3687`) alongside
`...buildSchoolRoutes(projectRoot)`.

#### `/court/**` — PG-backed, template = `buildProcurementSettlementRoutes`

`judicial_body` lives **only in Postgres**, so this cannot be a file-reading builder. The pattern
already exists: `scripts/db/lib/seo_settlements.ts` is a build-time PG reader shared by the
prerender builder _and_ the sitemap enumerator, returning `[]` on any failure (Postgres unreachable,
function absent) so a build without Docker degrades to "no such pages" instead of crashing.

Add **`scripts/db/lib/seo_courts.ts`** in exactly that shape — one query over `judicial_body` left
-joined to the latest `court_load` year, returning `{ bodyCode, name, kind, tier, place, placeCode,
judges?, filedPerMonth?, resolvedPerMonth? }[]`.

**Why the graceful `[]` matters here specifically:** the sitemap enumerator reads the _same_
function, so a Postgres-less build emits neither the pages nor their `<loc>` entries. That is what
makes this pattern safe against the sitemap-validity rule (every `<loc>` needs a real
`dist/<path>/index.html`) — the two cannot drift, because there is one source, not two.

**No committed manifest is needed** — unlike `/person/**`, which mints
`data/person/prerender_slugs.json` from the _serving_ database because `person_slug_lock` accumulates
per database and two databases hand the same people different slugs. `judicial_body.body_code` is
deterministically derived by `db:load:judicial-bodies:pg` from `magistrate.court ∪ court_load.name`,
so local and cloud agree and a local mint is safe. Say so in the builder's header, or someone will
copy the person machinery here for no reason.

#### `/pension-fund/**` — file-backed, template = `buildSchoolRoutes`

Its source `data/budget/kfn/funds.json` is a **committed** file (§9.5 makes it the durable series
store), so this is a plain `fs.existsSync` → parse builder, exactly like schools. Reads
`latestPeriod` for the headline figures and the full `periods[]` for the trend sentence.

#### Both builders

- **BG + EN**, via the `english: { title, description, bodyHtml, jsonLd }` field. Court and fund
  names are Bulgarian-only (§10.3), so the EN page carries the BG proper noun inside English
  sentence furniture — the same thing `buildSchoolRoutes` does with school names.
- **`escapeHtmlMinimal()`** on every interpolated name. Court names carry `—` and quotes; fund names
  carry `"` (`УПФ "ДОВЕРИЕ"`).
- **A gate function exported once and used by both the builder and the sitemap** — the precedent is
  `isCrawlableSchool` / `hasCrawlableId` in `@/data/schools/schoolBel`, imported by
  `dynamicRoutes.ts` and `sitemap/index.ts` alike. For courts the gate is trivially `true` (all 283
  `body_code`s are URL-safe — verified), but it must still exist as a named export, because a gate
  that lives in two copies is how a sitemap grows `<loc>`s with no file behind them.
- **`ogImage`**: omit → `DEFAULT_OG_IMAGE`. `tests/seo.spec.ts:503` only asserts `og:image` matches
  `^https?://`, so the default passes. A generated card per court (`scripts/og/cardRenderer.ts`) is a
  later nicety, not a launch requirement.

### 11.2 Sitemap — `scripts/sitemap/index.ts`

Add two enumerators next to the per-school block (`sitemap/index.ts:796`):

```ts
pushUrl(`/court/${bodyCode}`, lastmod);
pushUrl(`/en/court/${bodyCode}`, lastmod);
```

`scripts/sitemap/route_defs.ts` gets **no** entries — schools are enumerated directly in `index.ts`
and its comment says so explicitly (`route_defs.ts:165`); these two follow suit. Courts read
`seo_courts.ts` (same call the prerender makes); funds read `funds.json`'s mtime for `lastmod`.

**File-count budget:** 283 × 2 + 31 × 2 = **628** files added to a dist already holding ~248k. The
observed Firebase failure was at 453k files, so this is not close — which is exactly why these two
families get prerendered while `/funds/contract/**` and `/company/**` (~256k more) had to go through
`functions/spa_page.js` instead.

### 11.3 SEO contract for the new families

- **No-slash form** in canonical, `og:url`, `hreflang` and sitemap `<loc>`. The `path`-without-slash
  convention above gives this automatically; the trap is only ever hand-written URLs in `bodyHtml`.
- **`/en` is not `/en/`** — the one asymmetry CLAUDE.md calls out. Only matters if a `bodyHtml`
  hard-codes the EN root.
- **hreflang** bg + en + x-default, bidirectional, emitted by the `english:` field.
  `tests/seo.spec.ts:511` requires bg + x-default on every route, en when an EN variant exists.
- **Canonical must not redirect** — the newer half of the seo spec, and the reason the 2026-08-03
  trailing-slash inversion went unnoticed for so long.
- **JSON-LD** via `scripts/prerender/jsonLd.ts`: `buildWebPageLd` + `buildBreadcrumbLd` on both
  families (the settlement builder's exact pairing). Courts additionally deserve a
  `GovernmentOrganization` node — `jsonLd.ts` has no builder for it yet (it exports Organization,
  WebSite, WebPage, Dataset, DataCatalog, Person, FAQ, Breadcrumb, Article), so add
  `buildGovernmentOrganizationLd({ name, url, areaServed, parentOrganization })`. Funds map to
  `Organization` with the management company as `parentOrganization`.
- **Breadcrumb**: `Начало → Управление → Съдебна власт → <court>` and
  `Начало → Пенсии → <fund>`, matching the in-app `SectorBreadcrumb`.

### 11.4 AIO — the four surfaces, in order of leverage

**1. `bodyHtml` is the AIO surface, and it already exists.** Per the `PrerenderRoute` doc comment,
it renders into a hidden `#ssg-content` element that humans never see and non-JS crawlers — "most
AI/LLM bots" — do. This is where the answer lives, so write it as **prose containing the numbers**,
not as a nav stub:

> „Административен съд — Пловдив разгледа X дела на месец при Y съдии през 2025 г. …"

with internal links out to `/persons?court=<name>` and `/judiciary`. The settlement and school
builders are the tone reference. This single field does more for AI answerability than the other
three combined.

**2. `buildFaqLd`** (`jsonLd.ts:207`) — two or three Q/A pairs per page, phrased as the questions
people actually ask ("Колко съдии има в Софийски районен съд?", "Кой управлява УПФ „Доверие"?").
Answer engines lift these directly.

**3. `scripts/llms/buildFull.ts` → `/llms-full.txt` + `/llms-full.en.txt`.** Add one compact
**table block per family** — courts (name · tier · place · judges · filed/resolved per month) and
funds (fund · pillar · company · insured · net assets). Both are small (283 and 31 rows) and
tabular, which is the shape an LLM answers from most reliably. This is the highest-value AIO
addition after `bodyHtml`, and it is a pure append to an existing corpus builder.

**4. `scripts/llms/buildIndex.ts` → `/llms.txt`.** This is the short **overview** an AI crawler
fetches first — 283 courts do not belong in it. Add two `KEY_URLS` entries only: `/judiciary`
("съдилища и прокуратури — натовареност, бюджет, магистрати") and `/pensions`, each pointing at the
corpus in `llms-full.txt` for the detail.

**One AIO caveat to state, because it is easy to over-claim:** the search box itself contributes
nothing here. It is client-only, so the prerendered page ships an inert input (§10.3). Discovery
comes from the prerendered pages, the sitemap and the corpora — the box is what makes the site
usable for a human once they arrive.

### 11.5 The unprerendered existing destinations (§10.4) — sized, not scheduled

Search makes these reachable, which is when their invisibility starts to cost. Sized here so the
decision is a decision and not a surprise:

| Family              | Pages (BG+EN)           | Source                                                | Verdict                                                                                                                                                                               |
| ------------------- | ----------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/procedure/:code`  | 571 × 2 = **1,142**     | `nzok_activities` (PG → a `seo_procedures.ts` reader) | **Do it** — highest value per page: named medical procedures with national case counts are exactly what people search, and the corpus is already aggregated                           |
| `/molecule/:inn`    | 610 × 2 = **1,220**     | `nzok_drug_quarterly` (PG)                            | **Do it, after T2a** — pointless before the function widening in §10.1, since 580 of them render not-found                                                                            |
| `/culture/film/:id` | 944 × 2 = **1,888**     | `films.json` (file)                                   | **Do it** — cheapest of the lot (committed file, `filmId()` already exists)                                                                                                           |
| `/farm/:eik`        | 16,702 × 2 = **33,404** | `agri_subsidies` (PG)                                 | **Defer** — 33k files for thin per-recipient pages is the `/company/**` shape, and `route_defs.ts:397` already records the deliberate choice to leave `/farm/:eik` out of the sitemap |
| `/company/:eik`     | ~256k                   | —                                                     | **Never static** — already served by `functions/spa_page.js` for exactly this reason                                                                                                  |

The first three total **4,250** files — trivial against the ceiling, and each is a same-shaped
builder. Recommend them as a **T6**, after the search itself ships, so the search's own value is not
gated on an SEO backlog.

### 11.6 Sequencing and the deploy order

Prerender and sitemap are **build-time** steps, so they ride `npm run build` + `npm run deploy` with
no separate migration — with one exception that follows CLAUDE.md's standing rule: `seo_courts.ts`
reads `judicial_body`, so **`npm run db:load:judicial-bodies:pg:cloud` must have run against the
target database before a build that expects court pages**. It will not fail if it hasn't — it will
silently emit zero court pages and a sitemap with no court `<loc>`s, which is the good failure but
an invisible one. Add the loader to the release checklist next to the existing
"`db:load:judicial-bodies:pg:cloud` before `db:resolve:persons:cloud`" note.

Order within T5: `seo_courts.ts` → prerender builders → sitemap enumerators → llms corpora → the
search groups that point at them. The search group is last in every case, because §9.1 means a group
whose pages do not exist yet is a group that 404s.

### 11.7 Tests

- `tests/seo.spec.ts` — add one court **and one prosecution** (`kind='prosecution'`, no `court_load`
  row) plus one fund to the sampled route list. §9.4's whole risk is the degraded body, and a sample
  of `as-plovdiv` alone would never see it.
- A sitemap↔dist parity assertion for both families: every emitted `<loc>` has a
  `dist/<path>/index.html`. The shared gate function of §11.1 is what makes this pass; the test is
  what proves the gate did not get forked.
- `seo_courts.test.ts` — the reader returns `[]` (not a throw) when Postgres is unreachable, which is
  the property the whole degrade-gracefully design rests on.
- A `bodyHtml` non-emptiness assertion per family. An empty `#ssg-content` is invisible in every
  human check and is the entire AIO surface.

---

## 12. Deploy runbook for what has shipped so far

As of commit `64e4c6247d` (T0.1 → T5c). **Nothing here is safe to deploy piecemeal** — three
of the five steps carry changes no loader ships, and two of them are silently wrong rather than
broken if skipped. Run in this order.

### The order, and why each step is where it is

```bash
# 1. PG function bodies. No db:load:* carries these — "applied, never loaded".
#    066 MUST precede 054: 054 calls nzok_drug_quarterly_by_inn() and sets
#    check_function_bodies = false, so a missing 066 does not fail the apply —
#    it fails on the first CALL with 42883, which missingMigrationEmpty turns
#    into a truthy [], and every molecule page then renders "no above-median
#    prices, the normal case" at a 200.
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg \
  npx tsx scripts/db/apply_functions.ts \
  066_nzok_drug_quarterly.sql 054_nzok_risk.sql \
  052_nzok_drug_unit_prices.sql 053_nzok_activities.sql

# 2. The judicial dimension. This loader APPLIES 116 itself and populates
#    judicial_body_source_name, so it is both the migration and the data.
#    Skipping it does not 500: judicial_body_detail() returns load: null for
#    every body, which is shape-identical to a real prosecution office — so all
#    283 /court pages assert at a 200 that the ВСС publishes no workload for
#    them, including Софийски районен съд. `sourcesBuilt` is what keeps the page
#    honest in the interim, but the fix is this command.
npm run db:load:judicial-bodies:pg:cloud

# 3. The Cloud Function — three new routes (/api/db/court,
#    nzok-procedure-index, nzok-drug-pack-index). Before hosting, per the
#    standing rule: hosting first would ship a bundle calling routes that do not
#    exist yet.
npm run deploy:db

# 4. Hosting — the new /court and /pension-fund SPA routes, and the bundle that
#    reads the new КФН shape.
npm run deploy

# 5. The КФН archive. LAST, and the order is load-bearing in one direction only.
#    data/budget/kfn/funds.json changed shape (single period → {latestPeriod,
#    periods[]}). New bundle + old JSON degrades cleanly — useKfnLatest returns
#    null and the tile self-suppresses. Old bundle + new JSON iterates
#    data.funds on undefined, and with no ErrorBoundary anywhere in src/ that
#    blanks the whole of /pensions.
npm run bucket:sync:paths -- budget
```

### What each step makes true

| Step         | Without it                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| 1 (054+066)  | `/molecule/:inn` serves 30 of 610 INNs; the other 580 render not-found                                      |
| 1 (052, 053) | the medicines and pathways search groups are absent from `/sector/health` (they degrade, they do not crash) |
| 2            | all 283 `/court` pages claim no published workload — **wrong, not empty**                                   |
| 3            | `/court/**` and both new search groups have no endpoint                                                     |
| 4            | the new routes 404 through the SPA fallback                                                                 |
| 5            | `/pension-fund/**` shows one quarter and no trend                                                           |

### Not yet deployable, and deliberately so

`/court/**` and `/pension-fund/**` are in **neither the prerender nor the sitemap**, and
`/judiciary` does not link its courts — that is T5d (the search groups) and §11.1–11.2. Both
families are reachable by URL and, for pension funds, from the `/pensions` tile. Shipping them
before §11 is safe but leaves them undiscoverable, which is the SEO-gap shape §11.4 exists to
close. Prefer to deploy once §11 lands.

### Verification after deploy

```bash
# every findable entity resolves to a servable page
npm run test:data -- sector_search_landing judicial_body_detail
```

Then spot-check one of each on prod: a tail molecule (`/molecule/ABROCITINIB` — should show a
quarterly series, not "no data"), a prosecution office (`/court/rp-yambol` — should NAME the
absent workload, not show an empty chart), and a fund (`/pension-fund/upf-doverie` — should show
more than one quarter).
