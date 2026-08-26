# /sector/health — a fifth search group for the second-level МЗ bodies

**Status:** planned · **Date:** 2026-08-26 · **Owner:** —

## 0. The defect

A reader types „Национален център по обществено здраве и анализи" into
„Намери в здравната каса" on `/sector/health` and is told:

> Няма съвпадения в: болници, клинични пътеки, молекули (inn), лекарства

НЦОЗА **is in the corpus**: EIK `176094665`, **77 contracts / €3,625,637**,
2011-12-16 → 2026-07-08, seated in Sofia, four name spellings indexed in
`awarder_search`, with a live page at `/awarder/176094665`.

Two independent, deliberate exclusions produce the dead end, and neither is
wrong on its own:

1. **`NzokSearchBox` searches only the НЗОК corpus.** Its four groups are built
   from НЗОК payloads; the hospital group comes from `nzok_hospital_payments`,
   and `select count(*) … where eik='176094665'` is **0**. НЦОЗА is an МЗ
   institute funded from the state budget, not an НЗОК-contracted лечебно
   заведение, so it correctly matches nothing.
2. **It is not a sector member.** `HEALTH_SECTOR_EIKS` is exactly two EIKs
   (НЗОК + МЗ). `src/lib/healthReferenceData.ts` excludes the second-level МЗ
   family by name, and `sector_stats.data.test.ts` gates that exclusion.

With two members the health page is also below `MEMBER_SEARCH_MIN` (10), so it
gets no `SectorMembersSearch` — the НЗОК box is the **only** search on the page.

**The defect is the composition, not either half.** A body with €3.6m of
procurement and a live page one link away is unreachable from the page it
belongs to, and the empty state reads as _„this institution does not exist in
health"_ rather than _„it is not in the НЗОК corpus"_.

## 1. The decision

Add a **fifth group** to `NzokSearchBox` — „Ведомства на МЗ" — over the
second-level МЗ family, each row landing on its existing `/awarder/:eik`.

**This is a REACHABILITY change, not a roster change.** Nothing enters
`HEALTH_SECTOR_EIKS`, `SECTOR_DASHBOARDS.health.members`,
`SECTOR_BROWSE_PACKS.nzok.eiks` or the generator's `SECTOR_EIKS`. Every
destination already exists and is already served; only the route to it is new.

Rejected alternatives, with reasons:

- **Widen the roster to the family** — doubles the member count, crosses
  `MEMBER_SEARCH_MIN`, and puts €86.9m under a headline whose declared basis is
  НЗОК's €4.72bn payout. That is a separate decision about what the tile claims
  to cover, and `healthReferenceData.ts` already says so.
- **Only reword the empty state** — cheaper, and leaves 55 live pages
  unreachable from the sector that owns them.

## 2. The data — measured 2026-08-26 against local Postgres

`tag = 'contract'` throughout (the plain bucket differs by ~7%; a table mixing
the two bases is the `tag`-blindness trap CLAUDE.md documents).

| family                                 | EIKs   | institutions | contracts | €               |
| -------------------------------------- | ------ | ------------ | --------- | --------------- |
| ЦСМП (28 oblast centres + въздуха)     | 29     | 29           | 1,871     | €66,516,209     |
| РЗИ (incl. 2 retired predecessor EIKs) | 25     | 23           | 533       | €16,742,223     |
| НЦОЗА                                  | 1      | 1            | 77        | €3,625,637      |
| **total**                              | **55** | **53**       | **2,481** | **€86,884,070** |

Span 2011-01-05 → 2026-08-19. All **55 land**: `institution_identity()` resolves
for 55/55 and all 55 are awarders, so **no entry needs `noAwarderPage`**.

### 2.1 Two EIKs are retired predecessors, and both are kept

РИОКОЗ → РЗИ renamed the bodies and reissued BULSTAT in 2011. Two municipalities
have both halves in the corpus, with **non-overlapping** date ranges:

| institution | retired EIK | span                    | current EIK | span                    |
| ----------- | ----------- | ----------------------- | ----------- | ----------------------- |
| Бургас      | `000053451` | 2011-01-06 → 2011-06-01 | `176032788` | 2012-02-29 → 2025-07-16 |
| Благоевград | `000022349` | 2011-01-21 → 2012-01-17 | `176030552` | 2015-12-03 → 2025-07-01 |

Both halves ship as separate rows — the `retiredEikOf` precedent in
`educationReferenceData.ts` (Стопанска академия, 126 EIKs = 125 institutions).
Dropping the retired row would strand its contracts on a page no search result
points at. The retired rows carry the historical name and a „до YYYY" marker in
the label so they cannot be mistaken for the current body, and reader-facing
prose quotes the **institution** count (53), never the EIK count.

### 2.2 Five РЗИ are absent, and that is the corpus, not the list

Разград, Сливен, Шумен, Ямбол and Софийска област have **no** РЗИ procurement in
the corpus (23 РЗИ institutions of 28 oblasts). They are omitted rather than
shipped as `noAwarderPage` rows: a row with nothing behind it is a dead end, and
`sector_members_land.data.test.ts`'s RULE 1 says every row must land. The gate in
T4 fails the day one of them awards a contract, so the omission self-retires.

### 2.3 ⚠ The list must be CURATED BY EIK — a name pattern fails in both directions

The sweep in `sector_stats.data.test.ts` is a name pattern, and it is right for
what it does (an anti-leak check that must catch a body which starts matching
after a rename). It is **not** a roster:

- **It misses.** `РИОКОЗ - Бургас` (`000053451`, 10 contracts / €58,038) matches
  none of the three ILIKEs. Благоевград's twin is caught only because its stored
  name happens to spell out „Старо наименование … РИОКОЗ".
- **It over-catches.** `ilike '%РЗИ%'` matches „с. Бъ**рзи**я" and „Злати
  Те**рзи**ев"; `ilike '%ЦСМП%'` matches „А**МЦСМП**" — private ambulatory
  clinics with no relation to МЗ.

So the roster is a hand-verified EIK list, and the sweep stays what it is.

### 2.4 The 55

Corpus name shown is the longest stored spelling; the shipped label is the
canonical form written in T1.

| EIK         | kind  | contracts |        € | span                    | corpus name                                                                                                                                                        |
| ----------- | ----- | --------: | -------: | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `817073167` | csmp  |        14 |   259578 | 2021-02-23 → 2026-07-13 | ЦЕНТЪР ЗА СПЕШНА МЕДИЦИНСКА ПОМОЩ - ГАБРОВО                                                                                                                        |
| `180958724` | csmp  |         7 |   360331 | 2023-08-30 → 2025-12-19 | ЦЕНТЪР ЗА СПЕШНА МЕДИЦИНСКА ПОМОЩ ПО ВЪЗДУХА                                                                                                                       |
| `101045985` | csmp  |       138 |  2730874 | 2011-07-05 → 2026-08-19 | Център за спешна медицинска помощ /ЦСМП/ - Благоевград                                                                                                             |
| `812000140` | csmp  |       141 |  4682977 | 2011-05-17 → 2026-08-11 | Център за спешна медицинска помощ /ЦСМП/ - Бургас                                                                                                                  |
| `813147200` | csmp  |        93 |  4716265 | 2011-01-06 → 2025-11-27 | Център за спешна медицинска помощ /ЦСМП/ - Варна                                                                                                                   |
| `814221002` | csmp  |       218 |  1051262 | 2017-09-18 → 2026-07-24 | Център за спешна медицинска помощ /ЦСМП/ - Велико Търново                                                                                                          |
| `105001089` | csmp  |        34 |   931034 | 2011-01-14 → 2026-05-21 | Център за спешна медицинска помощ /ЦСМП/ - Видин                                                                                                                   |
| `106003602` | csmp  |        41 |  1109124 | 2011-09-01 → 2026-06-29 | Център за спешна медицинска помощ /ЦСМП/ - Враца                                                                                                                   |
| `834052595` | csmp  |        19 |   558460 | 2014-11-19 → 2025-10-23 | Център за спешна медицинска помощ /ЦСМП/ - Добрич                                                                                                                  |
| `818035874` | csmp  |        40 |  1718959 | 2011-02-02 → 2026-07-02 | Център за спешна медицинска помощ /ЦСМП/ - Кърджали                                                                                                                |
| `109025529` | csmp  |        33 |   933389 | 2011-01-11 → 2026-08-14 | Център за спешна медицинска помощ /ЦСМП/ - Кюстендил                                                                                                               |
| `820183588` | csmp  |        96 |  2552857 | 2011-04-21 → 2026-07-22 | Център за спешна медицинска помощ /ЦСМП/ - Ловеч                                                                                                                   |
| `821179126` | csmp  |        18 |   751155 | 2011-01-06 → 2025-02-20 | Център за спешна медицинска помощ /ЦСМП/ - Монтана                                                                                                                 |
| `822114434` | csmp  |        58 |  1151345 | 2011-03-18 → 2026-05-18 | Център за спешна медицинска помощ /ЦСМП/ - Пазарджик                                                                                                               |
| `113010839` | csmp  |        49 |  1127922 | 2011-02-01 → 2026-02-26 | Център за спешна медицинска помощ /ЦСМП/ - Перник                                                                                                                  |
| `000411973` | csmp  |        79 |  2890923 | 2011-06-13 → 2026-07-24 | Център за спешна медицинска помощ /ЦСМП/ - Плевен                                                                                                                  |
| `825294069` | csmp  |       106 |  6855424 | 2011-01-10 → 2026-07-24 | Център за спешна медицинска помощ /ЦСМП/ - Пловдив                                                                                                                 |
| `116000896` | csmp  |        17 |   666806 | 2011-01-18 → 2026-04-22 | Център за спешна медицинска помощ /ЦСМП/ - Разград                                                                                                                 |
| `827205133` | csmp  |        11 |   226390 | 2011-12-06 → 2026-03-02 | Център за спешна медицинска помощ /ЦСМП/ - Русе                                                                                                                    |
| `118001185` | csmp  |        22 |   429149 | 2011-01-11 → 2023-05-03 | Център за спешна медицинска помощ /ЦСМП/ - Силистра                                                                                                                |
| `119002144` | csmp  |        40 |  1311211 | 2011-07-06 → 2026-05-18 | Център за спешна медицинска помощ /ЦСМП/ - Сливен                                                                                                                  |
| `830176065` | csmp  |        66 |  1328959 | 2011-01-12 → 2026-06-16 | Център за спешна медицинска помощ /ЦСМП/ - Смолян                                                                                                                  |
| `121312221` | csmp  |         4 |   887825 | 2013-01-23 → 2014-12-09 | Център за спешна медицинска помощ /ЦСМП/ - Софийска област                                                                                                         |
| `121292046` | csmp  |       203 | 16924403 | 2011-01-12 → 2026-08-19 | Център за спешна медицинска помощ /ЦСМП/ - София /София-град/                                                                                                      |
| `123004119` | csmp  |        95 |  3627021 | 2011-01-05 → 2026-06-04 | Център за спешна медицинска помощ /ЦСМП/ - Стара Загора                                                                                                            |
| `835030573` | csmp  |         9 |   293914 | 2017-01-10 → 2025-02-11 | Център за спешна медицинска помощ /ЦСМП/ - Търговище                                                                                                               |
| `836154410` | csmp  |       110 |  3607948 | 2011-01-18 → 2026-05-07 | Център за спешна медицинска помощ /ЦСМП/ - Хасково                                                                                                                 |
| `837077874` | csmp  |        38 |  1330356 | 2011-12-16 → 2026-05-20 | Център за спешна медицинска помощ /ЦСМП/ - Шумен                                                                                                                   |
| `128019541` | csmp  |        72 |  1500348 | 2011-04-26 → 2026-08-03 | Център за спешна медицинска помощ /ЦСМП/ - Ямбол                                                                                                                   |
| `176094665` | ncpha |        77 |  3625637 | 2011-12-16 → 2026-07-08 | Национален център по обществено здраве и анализи /НЦОЗА/                                                                                                           |
| `176032507` | rzi   |       105 |   991289 | 2021-01-14 → 2026-07-22 | Регионална здравна инспекция - варна                                                                                                                               |
| `176031063` | rzi   |         9 |   381888 | 2021-04-21 → 2026-08-02 | Регионална здравна инспекция - велико търново                                                                                                                      |
| `176031615` | rzi   |         3 |   206020 | 2021-04-21 → 2023-07-31 | РЕГИОНАЛНА ЗДРАВНА ИНСПЕКЦИЯ - ВИДИН                                                                                                                               |
| `176031444` | rzi   |        20 |   462374 | 2022-08-09 → 2026-06-02 | РЕГИОНАЛНА ЗДРАВНА ИНСПЕКЦИЯ - ВРАЦА                                                                                                                               |
| `176031095` | rzi   |         1 |       13 | 2022-11-30 → 2022-11-30 | РЕГИОНАЛНА ЗДРАВНА ИНСПЕКЦИЯ - ГАБРОВО                                                                                                                             |
| `176031070` | rzi   |        16 |    89169 | 2022-08-12 → 2026-08-10 | РЕГИОНАЛНА ЗДРАВНА ИНСПЕКЦИЯ - ДОБРИЧ                                                                                                                              |
| `176030381` | rzi   |         2 |   100473 | 2022-10-08 → 2024-11-20 | РЕГИОНАЛНА ЗДРАВНА ИНСПЕКЦИЯ - ЛОВЕЧ                                                                                                                               |
| `176030367` | rzi   |         9 |   227904 | 2021-04-14 → 2025-12-22 | Регионална здравна инспекция - монтана                                                                                                                             |
| `176032140` | rzi   |         4 |   169531 | 2021-04-20 → 2023-05-30 | Регионална здравна инспекция - пазарджик                                                                                                                           |
| `176030794` | rzi   |         5 |   163000 | 2022-09-28 → 2024-12-13 | Регионална здравна инспекция - перник                                                                                                                              |
| `176030972` | rzi   |        30 |   936217 | 2021-07-21 → 2026-06-25 | Регионална здравна инспекция - плевен                                                                                                                              |
| `000022349` | rzi   |         4 |    72013 | 2011-01-21 → 2012-01-17 | Регионална здравна инспекция /РЗИ/ - Благоевград - /Старо наименование - Регионална инспекция за опазване и контрол на общественото здраве /РИОКОЗ/ - Благоевград/ |
| `176032788` | rzi   |        69 |   888261 | 2012-02-29 → 2025-07-16 | Регионална здравна инспекция/РЗИ/ - Бургас                                                                                                                         |
| `176030552` | rzi   |        27 |   517234 | 2015-12-03 → 2025-07-01 | Регионална здравна инспекция /РЗИ/ гр. Благоевград                                                                                                                 |
| `176030723` | rzi   |        12 |  1577532 | 2011-12-07 → 2023-01-31 | Регионална здравна инспекция /РЗИ/ - гр. Кърджали                                                                                                                  |
| `176030673` | rzi   |        43 |  1913100 | 2012-09-27 → 2026-07-03 | Регионална здравна инспекция /РЗИ/ - гр. Пловдив                                                                                                                   |
| `176032028` | rzi   |         5 |   893894 | 2011-10-06 → 2025-11-20 | Регионална здравна инспекция /РЗИ/ гр. Смолян                                                                                                                      |
| `176031298` | rzi   |         9 |   273238 | 2016-02-02 → 2024-11-05 | Регионална здравна инспекция /РЗИ/ - Кюстендил                                                                                                                     |
| `176031120` | rzi   |        18 |   623462 | 2015-02-25 → 2025-10-01 | Регионална здравна инспекция/РЗИ/ - Русе                                                                                                                           |
| `176031978` | rzi   |        19 |   321416 | 2013-12-21 → 2026-04-17 | Регионална здравна инспекция /РЗИ/- Силистра                                                                                                                       |
| `176031316` | rzi   |         4 |   155703 | 2013-09-18 → 2025-06-27 | Регионална здравна инспекция /РЗИ/ - Хасково                                                                                                                       |
| `176030488` | rzi   |         8 |   607285 | 2024-11-14 → 2024-11-22 | Регионална здравна инспекция - стара загора                                                                                                                        |
| `176031729` | rzi   |         1 |     8130 | 2021-05-17 → 2021-05-17 | Регионална здравна ИНСПЕКЦИЯ-ТЪРГОВИЩЕ                                                                                                                             |
| `000053451` | rzi   |        10 |    58038 | 2011-01-06 → 2011-06-01 | Регионална инспекция за опазване и контрол на общественото здраве /РИОКОЗ/ - Бургас/                                                                               |
| `176034554` | rzi   |       100 |  5105039 | 2014-09-24 → 2026-05-29 | Столична регионална здравна инспекция /СРЗИ/                                                                                                                       |

## 3. Tiers

### T1 — the data module (new file)

**`src/lib/mzSecondLevelBodies.ts`** — a new module, **not** an addition to
`healthReferenceData.ts`.

Two reasons it must be its own file:

- **Payload.** `healthReferenceData.ts` is imported by `sectorDashboards.ts` and
  `sectorPacks.tsx`, so 55 entries there would load on **every** sector
  dashboard — /sector/energy pays for /sector/health's finder. Imported only by
  `NzokSearchBox` (itself `lazy()`), the list lands in the search-box chunk and
  nowhere else. This is the `roadsAwarder.ts` „import-free module a nav surface
  may name" pattern; `src/entryGraph.test.ts` already forbids both registries
  from the entry chunk, so the entry budget is not at risk either way.
- **Meaning.** A 55-EIK export sitting in the file whose job is the two-EIK
  sector roster is an invitation to fold it in. Separate file, separate header,
  explicit „these are NOT sector members" rule.

Exports:

```ts
export type MzBodyUniverse = "csmp" | "rzi" | "national";
export interface MzSecondLevelBody {
  readonly eik: string;
  /** ONE canonical Bulgarian label, per `MO_ENTITIES` / `ENV_ENTITIES` /
   *  `EDU_ENTITIES` — no separate `en`. `latinSkeleton` transliterates
   *  Cyrillic→Latin, so an English name adds no search key; the consumer doubles
   *  it as `{ bg: b.name, en: b.name }`, exactly as `DefenseSearchBox` does. */
  readonly name: string;
  readonly universe: MzBodyUniverse;
  /** On the two РИОКОЗ predecessor EIKs — see §2.1. A POINTER to the successor,
   *  not a flag, following `retiredEikOf` in `educationReferenceData.ts`: it is
   *  what makes the institution count checkable rather than assumed. */
  readonly retiredEikOf?: string;
}
export const MZ_SECOND_LEVEL_BODIES: readonly MzSecondLevelBody[];
export const MZ_UNIVERSE_LABEL: Record<
  MzBodyUniverse,
  { bg: string; en: string }
>;
export const MZ_SECOND_LEVEL_INSTITUTION_COUNT: number; // 53 — never `.length` (55)
```

Naming convention (the corpus spellings are unusable — mixed case, `/РЗИ/`,
`гр.`, trailing slashes):

- ЦСМП → `Център за спешна медицинска помощ — <place>` / `Emergency Medical Care Centre — <place>`
- РЗИ → `Регионална здравна инспекция — <place>` / `Regional Health Inspectorate — <place>`
  (Sofia city keeps `Столична регионална здравна инспекция`)
- retired → `Регионална инспекция за опазване и контрол на общественото здраве (РИОКОЗ) — <place>, до <year>`
- НЦОЗА → `Национален център по обществено здраве и анализи` / `National Centre of Public Health and Analyses`

`MZ_UNIVERSE_LABEL`: `csmp` → „Спешна помощ" / `Emergency care`; `rzi` →
„Здравни инспекции" / `Health inspectorates`; `national` → „Национални центрове" /
`National centres`. It becomes the row's sub-line **and** a search key, so
„спешна", „инспекция" and `emergency` all find the family for free.

### T2 — wire the group

`src/screens/components/procurement/nzok/NzokSearchBox.tsx`:

- import `buildMembersIndex` from `@/screens/sector/membersIndex` and the new
  module; build the index with `useMemo` keyed on the language flag, mapping
  `{ eik, name, group: MZ_UNIVERSE_LABEL[universe] }` — the `DefenseSearchBox`
  shape exactly.
- add `entityGroup("mz", "Ведомства на МЗ", "Ministry of Health bodies", index,
{ icon: Landmark })` to `groups`, and to the memo's dependency array.

Ordering: place it **last**, after „Лекарства". The four НЗОК groups are the
box's subject; this one is the „not here, but here is where it is" arm.

Perf: the index is static (no fetch, no `armed` gate) — 55 rows folded once,
against the ~4,600 the armed groups build. It adds **no request** to page load,
which is the file's R1 rule.

⚠ `useTranslation()` is not currently imported in this file — `buildMembersIndex`
needs the `bg` flag. Add the import; the box's own strings stay literal
bg/en objects as they are today (no `translation.json` change).

### T3 — the copy

The empty state is `HubSearch.tsx:228`, `Няма съвпадения в: ${searched.join(", ")}`,
built from the group labels — so T2 alone already changes the reported message to
name „ведомства на МЗ". Two further edits:

- **placeholder** — add the fifth subject:
  „болница, лекарство, молекула, пътека или ведомство на МЗ…"
- **hint** — say what the fifth group is and, explicitly, that it is not НЗОК
  money. Draft (bg):
  „…Включени са и 53 ведомства на МЗ (спешна помощ, здравни инспекции, НЦОЗА) —
  те не получават средства от НЗОК, а имат свои обществени поръчки."
  The existing sentence about facilities without an EIK stays.

Quote **53** (institutions), not 55 — §2.1.

### T4 — the gates

**a. `src/lib/mzSecondLevelBodies.test.ts`** (unit, no Postgres)

- no duplicate EIKs; every EIK is 9 or 13 digits;
- **disjoint from `HEALTH_SECTOR_EIKS`** — imports both and asserts the
  intersection is empty. This is the one that stops a later „tidy-up" folding the
  list into the roster;
- disjoint from `SECTOR_DASHBOARDS.health.members` and
  `SECTOR_BROWSE_PACKS.nzok.eiks` — the same assertion at the two other copies;
- every entry has a non-empty `name`, and every `universe` has a
  `MZ_UNIVERSE_LABEL` entry;
- exactly 2 entries carry `retiredEikOf`; each names a NON-retired row present in
  the list (otherwise `MZ_SECOND_LEVEL_INSTITUTION_COUNT` under-reports for an
  institution nothing else represents), and each retired label contains a year —
  otherwise a reader cannot tell it from the current body;
- `MZ_SECOND_LEVEL_INSTITUTION_COUNT === 53`, and the reader-facing copy in T3
  quotes that rather than the array length;
- **disjoint from the НЗОК hospital corpus.** The three roster copies above are
  the governance question; this is the RENDER question, and nothing else asserts
  it. Two groups of the same dropdown draw from `nzok_hospital_payments` and from
  this roster, so an EIK in both would render twice under two headings with two
  different hrefs (`/company/:eik` and `/awarder/:eik`). Measured 0 of 266 today
  — assert it stays 0. (This one needs the payments payload, so it belongs in
  T4b if T4a is to stay Postgres-free.)
- **the search keys still reach the queries a reader actually types.** Build the
  index the way T2 does and assert hit counts for „център за спешна медицинска
  помощ" (the register's own singular — 29), „инспекция" (25), „София" (2, both
  Sofia bodies) and „МЗ" (55). Every one of those returned 0 or 1 on the first
  cut: the labels are acronym-led, so the universe label is the ONLY key carrying
  the family noun, and `latinSkeleton` does not fold singular into plural.
  Mutation check: revert either universe label to a single grammatical number and
  the first two assertions must fail.

**b. `scripts/db/tests/mz_second_level_bodies.data.test.ts`** (Postgres)

- **every row lands** — reuse `LANDS_SQL` from
  `sector_members_land.data.test.ts` (`institution_identity()` / `tr_companies` /
  awarder / contractor). 55/55 measured today;
- **corpus ↔ roster reconcile, BOTH directions**, over the §2.3 sweep plus the
  РИОКОЗ arm:
  - a swept EIK missing from the roster → fail, naming it (this is what fires
    when a Разград РЗИ awards its first contract, or a body is renamed);
  - a roster EIK with zero contracts → fail (a body that left the corpus);
- **non-vacuity floor** — `>= 40` swept bodies, the same reasoning
  `sector_stats.data.test.ts` states for its own floor: a `> 10` floor would still
  pass after a reload that lost most of them;
- **the anti-leak still discriminates** — assert the roster is disjoint from
  `HEALTH_SECTOR_EIKS` _and_ that the existing second-level sweep still finds
  ≥40, so this file cannot go green by the sweep silently emptying.

**c. component test** — `NzokSearchBox.test.tsx` (new): typing „обществено
здраве" yields a row whose `href` is `/awarder/176094665`; typing „НЦОЗА" does
too (the acronym is in the canonical label). Mutation check: with the fifth group
removed both assertions fail.

**d. `sector_stats.data.test.ts` must stay green untouched.** Its
„second-level МЗ family is deliberately out of the EIK-set" test is the contract
this change must not break; do not edit it.

## 4. Deliberately out of scope

- **Widening `HEALTH_SECTOR_EIKS`** — §1.
- **A sixth group for the 234 state/university hospitals** (€10.6bn). They are
  НЗОК's payees and already reachable through the hospital group and the map;
  a „bodies" group listing them would blur payer and payee, which is the
  double-count `healthReferenceData.ts` warns about.
- **The 5 missing РЗИ** — §2.2, self-retiring via T4b.
- **Any change to the hub tile, the KPI band or `sector_stats.json`.** No figure
  on `/sector/health` moves; the headline stays НЗОК's payout on its declared
  basis.

## 5. Verification

```bash
npm run test:unit -- src/lib/mzSecondLevelBodies.test.ts src/screens/components/procurement/nzok/NzokSearchBox.test.tsx
npx vitest run scripts/db/tests/mz_second_level_bodies.data.test.ts scripts/db/tests/sector_stats.data.test.ts scripts/db/tests/sector_members_land.data.test.ts
npm run test:unit -- src/entryGraph.test.ts src/screens/sector/sectorConfigLockstep.test.ts
npm run lint && npx tsc -b
```

Then on the dev server: `/sector/health`, type „обществено здраве" → one row,
„Национален център по обществено здраве и анализи", sub-line „Национални
центрове", landing on `/awarder/176094665`.

No migration, no loader, no `deploy:db`, no bucket sync — this is bundle-only.
`npm run deploy` ships it.
