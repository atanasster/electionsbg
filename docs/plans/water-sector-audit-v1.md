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

The third is oblast-level by *coverage*, not by type: it ships as `municipal`,
because Пазарджик's services fragmented across municipal operators after the
liquidation, so the oblast genuinely has no regional monopoly. That is recorded as
a named exception to the completeness rule rather than papered over by promoting a
municipal row — see step 1.

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
€1,399,157 / 12, `822106633` ВКТВ Велинград €158,731 / 3 (all in Feb 2013 — it
ships marked `dormant`), `208403279` ВиК Елин Пелин €51,000 / 1. Same class as the
ten municipals already in the set.

**F4 — `205756975` ДП „Управление и стопанисване на язовири"** €15,944,916 / 129 /
2019–2026 — the state dam enterprise. Confirmed by the operator's owner decision
to include it on the same precedent as Напоителни системи, as a new `dams` type.

**F5 — no regression tests.** `sector_stats.data.test.ts` had zero water coverage.

Headline impact of F2+F3+F4: **+€73,740,287 (+2.31%)**, 38 → 45 operators. (The
seven per-EIK figures above sum to €73,740,288 — the €1 is each row's independent
rounding, not a discrepancy.)

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

**Liveness became a FIELD, which the plan did not anticipate.** Review established
that the completeness rule as first written was unsatisfiable by its own data —
the only trace that `822106665` was defunct lived inside the Bulgarian display
string „(в ликвидация)", and a gate that regexes a display name is not a gate. So
`WaterOperator` gained `status?: "liquidated" | "dormant"`, `successorEik`,
`national?: true` (the three nationwide rows are not any oblast's coverage) and
`aliases`. `822106665` is `liquidated` → `205323041`; `822106633` (ВКТВ Велинград,
last contract Feb 2013) is `dormant`. The rule now has two named exceptions —
София (столица), served by the concession, and Пазарджик — and both are asserted
in *both* directions, so an exemption that silently stops being true also fails.

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
- `VikSubsidiaryTile` — add the `dams` label. **The planned
  `variant?: "holding" | "sector"` prop was deliberately NOT built**: review
  established that this tile was ALREADY being handed the sector set on
  `/procurement/contracts?sector=water` under the group heading, so the live
  defect was a caller passing the wrong universe — and a `variant` prop is one
  more thing that same caller can get wrong. The framing is DERIVED instead. The
  caller passes `universeEiks` (the set it aggregated, a fact it cannot be wrong
  about) and the tile decides; deriving from the rendered rows alone was rejected
  in turn because rows are scope-filtered, so a narrow `?pscope` in which only
  holding members traded would silently flip `/water` back to the group claim.
- `WaterSearchBox` — add the `dams` label; correct the "38 operators" comments.

### Step 3 — regression tests

Extend `scripts/db/tests/sector_stats.data.test.ts` (PG-backed, auto-skips when
Postgres is down). Bands and inequalities for anything the corpus moves — with
**one deliberate exception**, the reconciliation, which is exact:

- `basis === "procurement"`, and the headline for `all` inside a band whose floor
  catches an over-trim or a zeroed source and whose ceiling catches EIK
  re-leakage;
- **the headline EQUALS a live Σ over `WATER_SECTOR_EIKS`.** This is what actually
  gates the generator's copy of the EIK-set: the generator *imports* the constant,
  so comparing the arrays is a tautology, whereas a sum moves if either side does
  — including a blob nobody regenerated, which is exactly what it caught;
- **the copies that CAN drift stay in lockstep** — `SECTOR_BROWSE_PACKS.water.eiks`
  vs `WATER_SECTOR_EIKS` (a tripwire: it compares an array to itself today and
  only becomes a real comparison if a copy stops importing), plus an assertion
  that `SECTOR_DASHBOARDS.water` stays absent, water being bespoke;
- each of the seven newly added EIKs is present and its per-EIK € exceeds a floor
  set at roughly half the measured spend;
- **every member LOOKS like a water body in the corpus, under every spelling** —
  the positive half, and the one the audit family is named for. A denylist only
  catches the wrong bodies somebody already thought of; a wrong-but-real EIK
  passes every other gate here, including the exact reconciliation, because both
  sides read the same constant and move together. Mutation-checked against МВР
  ДУССД `129010157`, the €301M directorate the defense audit nearly took;
- the known name-collision EIKs (a Басейнова дирекция, a РИОСВ, Център за подводна
  археология, the retired ВиК Свищов EIK) are absent;
- the sector and holding totals stay a band apart, so neither can be pointed at
  the other's EIK-set.

**The oblast-completeness rule lives in `src/lib/vikReferenceData.test.ts`, not
here, and that is deliberate**: it needs no database, so it still runs on a fresh
clone and in a database-less CI leg, where every gate in this file skips. Same for
the duplicate-EIK check, which has to run on the raw `WATER_OPERATORS` rows —
asserting `WATER_SECTOR_EIKS` is deduped can never fail, since it is built as
`[...new Set(...)]`.

### Step 4 — regenerate and publish

**The regeneration landed inside step 3, not after it**, because step 3's own
reconciliation gate fails against a stale blob — which is exactly what it is for,
and it caught the pre-audit €3,195,586,273 on its first run. The two are one
change: a test asserting the blob is current cannot be committed green while it
is not.

- `npm run db:gen-sector-stats` — **done**. Only water moved, +2.31% on `all`
  (€3,195,586,273 → €3,269,326,560) across 29 scopes; no other sector changed.
- `npm run db:load:water-operator-map:pg` — **done**: 45 operators, 40 with a
  pin. The five without one (ВиК Димитровград, ВиК Добрич ЕООД, ВиК Свищов, ВКС
  Пещера, ВиК Елин Пелин) are small municipal operators whose seat does not
  resolve through `awarder_seats`; the loader documents that degrade and the map
  omits them. Two of the five are newly added.
- Gates: `npx tsc -b` clean, lint clean on every touched file, 854 unit tests
  across 63 files, 10/10 in `sector_stats.data.test.ts`.
- Verified live on the dev server: `/water` renders „Дружествата във водния
  сектор", Софийска вода appears with its `концесия` chip (it was absent from
  every tile before), the new Пазарджик operator renders, the overflow reads
  „+ още 20 оператора", and no caption says „на групата". The
  `/governance/sectors` water tile reads €157 млн. for `ns:2026_04_19` — the
  regenerated value; the old blob would have shown €154 млн.

**The prerendered `/water` page was a FIFTH copy of the F1 claim, and the one that
matters most.** `scripts/prerender/routes.ts` carried „принципал на около 26
регионални дружества … поръчките на групата" and „Дружествата в групата" — plus
the English twins — in the `<title>`, the `<description>` and both bodies. So the
HTML a crawler indexes went on attributing Софийска вода and ДП УСЯ to the holding
after the SPA had stopped. **Verifying on the dev server could not see this: the
dev server never serves the prerender.** Fixed here, with the counts derived from
`WATER_SECTOR_EIKS` / `VIK_HOLDING_SUB_EIKS` (45 / 27) rather than hand-written a
fifth time.

**Deploy — nothing here is automatic, and `npm run deploy` does NOT build.** It is
`firebase deploy --only hosting:main`, which uploads whatever `dist/` already
holds. Skipping the build ships the map's 45 pins and the €3.27bn hub tile while
`/water` keeps serving the old bundle counting 26 EIKs — F1 re-created inverted,
on prod, silently. In order:

```bash
npm run db:load:water-operator-map:pg:cloud                        # the 7 new pins
npm run bucket:sync:paths -- procurement/derived/sector_stats.json # the hub tile
npm run build                                                      # ⚠️ NOT optional
npm run deploy                                                     # bundle + prerender
```

The operator map is a Cloud SQL table behind `/api/db/water-operator-map`, so
without the first command prod's map keeps 38 pins while every other surface
counts 45. `sector_stats.json` is bucket-served (not Firebase-hosted), so
`npm run deploy` alone does **not** move the hub tile. And the prerendered
`/water` HTML is emitted by `npm run build`, so without the third command the
indexed copy keeps the holding-group claim this step removed.
