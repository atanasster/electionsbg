# Води (water) sector audit — fixes v1

Audit of the `/governance/sectors` water tile + the `/water` screen against the
raw contracts corpus (2026-08-13, local Postgres). Run via `/audit-sectors water`.

## What reconciled

The hub headline reproduces from Postgres to the euro. `all` =
**€3,195,586,273** over the 38 `WATER_SECTOR_EIKS`, and every `y:<year>` entry
matches its per-year sum exactly. Basis `procurement` is right for this sector —
the ВиК operators' own tender flow *is* the sector, not a ministry line.

No wrong-EIK leakage (Failure mode C): all 38 members are genuine water
operators. The name-collision candidates a regex sweep surfaces — РИОСВ, the
Басейнови дирекции, Център за подводна археология, a school named „Жива вода" —
are correctly excluded, and the basins/РИОСВ belong to `environment`, so
including them would double-count across two sectors. No parent/child
double-count: the holding awards only €636,908 itself. `flood_maintenance.json`
internals reconcile (Σ byYear == header ±€1 rounding, contracts n == count).

The `y:2020` €24.5M trough is a corpus-wide feed gap (4,629 contracts nationally
against 24,443 in 2019), not a water defect.

## Findings this plan fixes

**F1 — the `/water` page's tiles counted 26 EIKs while the hub tile linking to it
counted 38.** `useVik(VIK_HOLDING_EIK)` aggregated
`[VIK_HOLDING_EIK, ...VIK_HOLDING_SUB_EIKS]` — a fourth EIK-set copy out of
lockstep with the three that do derive from `WATER_SECTOR_EIKS` (the generator,
the browse pack, `/water/operators`, the operator map, the search box).

| Surface | Set | Total |
|---|---|---|
| hub tile · browse pack · `/water/operators` · map · search box | 38 | €3,195,586,273 |
| `WaterScreen`'s five consolidated tiles | 26 | €2,331,432,052 |

€864.2M / 27% apart. Excluded from every tile: Софийска вода €627.6M (the single
largest water awarder in the country), Напоителни системи €212.7M, and ten
municipal operators €23.8M — while the map and the search box on the *same page*
rendered Софийска вода as a pin and a search row.

**F2 — three genuine oblast-level operators missing (€56.2M).** Bulgaria has 28
oblasti; the set carried 25 regional operators and exactly three gaps:

| EIK | Operator | € | Contracts | Span |
|---|---|---|---|---|
| `826043778` | Водоснабдяване-Дунав ЕООД — the **Разград** regional operator | 32,743,461 | 226 | 2011–2026 |
| `200167154` | Кюстендилска вода ЕООД — the **Кюстендил** regional operator | 8,751,158 | 56 | 2011–2026 |
| `205323041` | ВиК услуги ЕООД — the **live Пазарджик** operator | 14,691,865 | 73 | 2019–2026 |

Разград was represented only by ВиК Исперих and Кюстендил only by ВиК Дупница,
both municipal. Кюстендилска вода is independently confirmed by its НКИД division
36 «ВОДОСНАБДЯВАНЕ И КАНАЛИЗАЦИЯ». Пазарджик is the sharpest case: the set
carried only the predecessor `822106665` *в ликвидация*, whose last contract is
2019, so a dead shell represented the oblast while all live procurement was
absent.

Corroboration for the two regional additions: the screen's own copy says the
holding is principal of *~26* operators, and 25 existing `holding_sub` + these
two − the liquidated Пазарджик shell = 26 live.

**F3 — three municipal operators missing (€1.6M):** `822104714` ВКС Пещера
€1,399,157 / 12, `822106633` ВКТВ Велинград €158,731 / 3, `208403279` ВиК Елин
Пелин €51,000 / 1. Same class as the ten municipals already in the set.

**F4 — `205756975` ДП „Управление и стопанисване на язовири"** €15,944,916 / 129 /
2019–2026 — the state dam enterprise. Confirmed by the operator's owner decision
to include it on the same precedent as Напоителни системи, as a new `dams` type.

**F5 — no regression tests.** `sector_stats.data.test.ts` had zero water coverage.

Headline impact of F2+F3+F4: **+€73,740,272 (+2.3%)**, 38 → 45 operators.

## Steps

### Step 1 — reference data: the seven missing operators + the `dams` type

`src/lib/vikReferenceData.ts`:

- add `"dams"` to `WaterOperatorType` and `USYA_EIK = "205756975"`;
- add the seven operators above. `826043778` / `200167154` are `holding_sub`
  (oblast-wide regional monopolies, same shape as the other 25);
  `205323041` / `822104714` / `822106633` / `208403279` are `municipal`;
  `205756975` is `dams`;
- keep `822106665` (Пазарджик в ликвидация) — it is a different legal entity from
  its successor, so retaining it preserves €5.0M of real history with no
  double-count. Cross-reference the pair in a comment, the way the retired ВиК
  Свищов EIK is already documented;
- update the header: the new resolution date, the oblast-completeness rule that
  found F2, and the unverified-ownership caveat on `205323041`.

`VikSubsidiaryTile`'s `TYPE_LABEL` is a total `Record<WaterOperatorType, …>`, so
the new union member is a compile error there until labelled — intended.

### Step 2 — split the sector scope from the holding scope

The widening must NOT reach `/awarder/206086428`: `VikPack` is mounted there and
that page is *the holding*, so claiming Софийска вода (a Veolia concession) as a
group company would be a new wrong-attribution defect in place of the old one.

- `src/data/procurement/useVik.ts` — add an explicit EIK-universe override and a
  named `useWaterSector()` entry point that passes `WATER_SECTOR_EIKS`. `useVik`
  keeps its current meaning (holding group on the holding EIK, standalone
  elsewhere), so `VikPack` is unchanged. `useAwarderGroupModel` is ONE grouped
  call keyed on the joined EIK list, so 45 EIKs costs one longer query string,
  not a fan-out.
- `src/screens/water/WaterScreen.tsx` — call `useWaterSector()`; retitle the
  page's framing from the holding group to the sector, so the map, the search box
  and the five tiles all describe the same 45 operators.
- `VikSubsidiaryTile` — add the `dams` label and a `variant?: "holding" | "sector"`
  (default `"holding"`) that switches the tile heading. `VikBrowseSection` filters
  on `WATER_SECTOR_EIKS`, so it passes `"sector"` too.
- `WaterSearchBox` — add the `dams` label; correct the "38 operators" comments.

### Step 3 — regression tests

Extend `scripts/db/tests/sector_stats.data.test.ts` (PG-backed, auto-skips when
Postgres is down). Bands and inequalities only — the corpus grows fortnightly:

- the water headline for `all` inside a band whose floor catches an over-trim or a
  zeroed source and whose ceiling catches EIK re-leakage;
- **the EIK-set copies are equal** — `SECTOR_EIKS.water`, `WATER_SECTOR_EIKS` and
  `SECTOR_BROWSE_PACKS.water.eiks` are the same set (the drift tripwire; there is
  no `SECTOR_DASHBOARDS.water`, water being bespoke);
- each of the seven newly added EIKs is present and its per-EIK € exceeds a floor;
- the known name-collision EIKs (a Басейнова дирекция, a РИОСВ, Център за
  подводна археология) are absent from `WATER_OPERATORS`;
- every oblast has at least one non-liquidated operator (the invariant that would
  have caught F2 at the time it was introduced);
- `basis === "procurement"` for water.

### Step 4 — regenerate and publish

- `npm run db:gen-sector-stats` — diff old vs new `sector_stats.json`; only water
  may move, and by ~+2.3%.
- `npm run db:load:water-operator-map:pg` — `water_operator_geo` is built from
  `WATER_SECTOR_EIKS`, so the seven new operators need pins. Cloud twin
  `db:load:water-operator-map:pg:cloud` is a deploy step, nothing runs it
  automatically.
- Gates: `npx tsc -b`, `npm run lint`, the touched vitest suites, and
  `npx vitest run scripts/db/tests/sector_stats.data.test.ts`.
- Deploy: `sector_stats.json` is bucket-served —
  `npm run bucket:sync:paths -- procurement/derived/sector_stats.json`; the code
  changes need `npm run deploy`.
