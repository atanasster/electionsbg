# Energy sector audit — v1

Audit of the `energy` hub tile (`/governance/sectors`) + the `/sector/energy`
dashboard against the raw sources, following `.claude/skills/audit-sectors`.
Run 2026-08-13 against the local corpus (`electionsbg-pg` :5433).

## Verdict

The money is clean. The **physics tile is not**: `/sector/energy` publishes a
"Обща инсталирана мощност" of ~15.9 GW that includes a nuclear plant which does
not exist yet — on the same page whose next tile explains that it does not exist
yet.

## Phase 1 — hub headline reconciliation ✅ EXACT

`sector_stats.json` declares `{kind:'eur', basis:'procurement'}`. Reproduced
against `contracts` (`tag='contract'`, `awarder_eik IN ENERGY_SECTOR_EIKS`):

| scope | emitted | corpus | Δ |
|---|---|---|---|
| `all` | 10,218,019,565 | 10,218,019,565 | **0** |
| `y:2019` | 2,060,889,030 | 2,060,889,030 | **0** |
| `y:2020` | 52,745,798 | 52,745,798 | **0** |
| `y:2026` | 834,294,030 | 834,294,030 | **0** |

Every one of the 30 scopes carries a value; `ns:2005_06_25 = 0` is legitimate
(the corpus starts 2011). No `date IS NULL` rows, so no window silently drops
spend. The `y:2019` spike (€2.06bn) is Балкански поток capex inside
Булгартрансгаз — real, not a double-count.

**Basis is correct.** БЕХ is a commercial group whose real spend *is* its tender
flow, so procurement is the honest front (unlike a pass-through ministry). The
МЕ policy line is €5.9M and rightly excluded from the group.

## Phase 2 — EIK-set ✅ HONEST (no change)

Per-EIK, `tag='contract'`, all scope:

| EIK | body | contracts | € |
|---|---|---|---|
| 175203478 | Булгартрансгаз | 1,146 | 3.13bn |
| 175201304 | ЕСО | 7,848 | 2.22bn |
| 106513772 | АЕЦ Козлодуй | 4,014 | 1.97bn |
| 123531939 | ТЕЦ Марица изток 2 | 4,801 | 1.37bn |
| 833017552 | Мини Марица-изток | 2,889 | 1.09bn |
| 000649348 | НЕК | 2,266 | 438M |
| 175203485 | Булгаргаз | 100 | 7.1M |
| 106588180 | ВЕЦ Козлодуй | 11 | 1.3M |
| 1752013040 | ЕСО МЕР Благоевград (branch) | 10 | 74.6K |
| 831373560 | БЕХ (holding) | 0 | — |

- **Failure mode C (leakage): none.** Every member is genuinely state energy.
- **Failure mode D (omission): none material.** A name sweep over
  `енерг|тец|аец|топлофикац|газ|вец|мини|електро|ядрен` surfaces only bodies
  that are correctly out: the three ЕРП distributors and ЕВН (private),
  Топлофикация София (municipal), Овергаз (private), ContourGlobal (JV, 27% НЕК),
  ТЕЦ Варна / ТЕЦ Бобов дол / Проучване и добив на нефт и газ (privatised),
  the regulators, and the ПГ по ядрена енергетика „Курчатов" false positive the
  reference-data header already names. The only state body outside the set is
  Мини „Перник" /в ликвидация/ at €15.4M — 0.15% of the headline, in liquidation,
  not part of БЕХ. Leave out.
- **Branch sweep: complete.** No awarder shares a member's 9-digit prefix beyond
  the one ЕСО МЕР branch already listed.

## Phase 2 — the four EIK-set copies ✅ LOCKSTEP

`ENERGY_SECTOR_EIKS` (reference data) is the single source of truth; the
generator and the browse pack both import it. `SECTOR_DASHBOARDS.energy.members`
is `ENERGY_MEMBER_EIKS` — the same set minus the ЕСО branch, an intentional and
documented collapse worth €74,585 (0.0007%).

## Phase 2 — bespoke tiles

| tile | source | verdict |
|---|---|---|
| Generation | `data/energy/generation.json` | ✅ Σ byFuel = totalGen = 37.98 TWh exactly; all 9 Ember fuels mapped in `ENERGY_FUELS`, so the stacked bar fills 100% |
| Price | `data/energy/prices.json` | ✅ BG €0.1355 vs EU27 €0.2896 = 47% at the latest common period (2025-S2); "сред най-ниските в съюза" holds |
| Per-unit spend | group model | ✅ rides the shared `ENERGY_MEMBER_EIKS` fetch |
| Single-bid | group model | ✅ gated on `bidKnownN` |
| **Plants** | `data/energy/plants.json` | ❌ **see below** |

### Finding 1 — planned capacity counted as installed (Failure mode I)

`EnergyPlantsTile` computes `totalMw` / `stateMw` / the bar-scale `max` over
**every** row in `plants.json`, including `status: "planned"`. The file carries
one planned row: **АЕЦ Козлодуй 7 и 8 (AP1000), 2,300 MW, state**.

| tile figure | as shipped | built-only | error |
|---|---|---|---|
| "Обща инсталирана мощност" | **~15.9 GW** | ~13.6 GW | **+16.9%** |
| "държавна/смесена" | **60%** | 53% | **+7 pts** |
| bar scale `max` | 2,300 MW (a plant that does not exist) | 2,006 MW (АЕЦ Козлодуй 5–6) | every real bar shortened |

Two things make this worse than an ordinary rounding drift:

1. The caption says **"инсталирана"** / **"installed"**. A planned unit is by
   definition not installed, and ~13.6 GW is the figure that matches Bulgaria's
   actual fleet.
2. The **adjacent tile on the same page** (`InvisibleCapexTile`) exists purely to
   explain that Козлодуй 7/8 is a *planned* ~€14bn investment procured outside
   ЦАИС. The page therefore asserts, one tile apart, that the same 2,300 MW both
   does and does not exist yet.

The state share is inflated by the same row from both ends (it is state-owned, so
it lands in numerator and denominator), which is why 60% is directionally
flattering to the state's position as well as simply wrong.

`status: "retiring"` (Марица изток 2, ContourGlobal) must KEEP counting — those
plants are generating today. Only `planned` is excluded.

## Fixes

1. **Name the rule once, in `src/data/energy/types.ts`** — an exported
   `isInstalled(p)` / `installedPlants(list)` beside the existing
   `latestCommonPrice` helper, so the tile and the regression test read one
   definition rather than two copies of a `status !== 'planned'` filter.
2. **`EnergyPlantsTile`**: aggregate `totalMw`, `stateMw` and the bar `max` over
   installed plants only. Keep listing the planned row (it already carries a
   "планирана" badge) — the row is informative, the aggregate was the lie.
3. **Stale comments**: `EnergyThematicTiles` says "the €9.76bn group",
   `EnergyPriceTile` says "€8.96bn of state spending" — two different stale
   figures for one group now worth €10.22bn. Drop the hardcoded € from both
   rather than re-pinning a number that goes stale fortnightly.
4. **Regression tests** — energy has none today. Add an `ENERGY` describe-block
   to `scripts/db/tests/sector_stats.data.test.ts`.

Nothing here is a tier-3 editorial call: no basis change, no sector added or
removed, no EIK-inclusion boundary moved. The EIK-set and the headline are
untouched.

## Regression tests added

**`scripts/db/tests/sector_stats.data.test.ts`** — a new `energy` describe-block,
7 tests, PG-backed (auto-skips without Postgres):

1. headline **reconciles exactly** to a live sum over `ENERGY_SECTOR_EIKS`
   (water/transport shape — the generator imports the constant, so an
   array-identity check is a tautology and a sum is not), and stays
   `basis: 'procurement'` in a 9–16bn band;
2. **every scope reconciles, not just `all`** — three year windows (2019's
   Балкански поток spike, 2020's trough, an ordinary 2024) plus two parliament
   windows whose bounds come from `parliamentWindow`, the same function the
   generator calls. A local copy of that maths would agree with itself for ever
   and never see the dissolution off-by-one the test exists for;
3. the four EIK-set copies stay in lockstep, with the ЕСО-branch collapse
   asserted **exactly** (not merely tolerated) and the ministry asserted out;
4. that collapse stays immaterial (< €1M) — and asserts the branch is still
   *in* the set first, or dropping it entirely would pass at €0;
5. **every money-bearing universe carries real money** (gas/coal/grid/nuclear/
   hydro, floors at ~half measured), with `holding` asserted EMPTY — БЕХ is a
   pure holding that awards no ЗОП. Counted in contracts, not euros: 140 corpus
   rows have a NULL amount, so €0 is ambiguous. Also asserts БЕХ is still the
   holding entity, for the same absence-equivalence reason as (4);
6. the anti-allowlist stays OUT — 16 EIKs, every one surfaced by the audit's
   name sweep and rejected with a stated reason (ЕРП, ЕВН, Топлофикация София,
   Овергаз, ContourGlobal, ICGB, ТЕЦ Варна/Бобов дол, the „Курчатов" school,
   Община Козлодуй, the three regulators) — plus every member resolving to a
   real awarder, БЕХ exempted by name;
7. every member **looks like** an energy body under all 157 spellings the corpus
   carries. ⚠ The three-letter stems are Cyrillic-boundary-guarded: bare
   `аец|тец|вец` match Община Лясков**ец**, Прав**ец**, „О**тец** Паисий" and
   „Здрав**ец**" — the exact wrong-domain class the gate exists to catch. JS `\b`
   is ASCII-only and would silently do nothing here.

**`src/data/energy/types.test.ts`** — 11 pure tests, no PG:

- `isInstalled` / `isStateLinked` semantics, incl. `retiring` counting (2 528 MW
  and 7 share-points — the half an over-eager fix would break);
- `plants.json` totals exclude planned capacity, asserted as "the excluded
  capacity **is** the planned capacity" rather than by re-deriving a
  `!== "planned"` deny-list, which is the semantics `types.ts` documents as
  wrong and which would fail on a correctly-classified new status;
- the planned row is still present, so those tests cannot go vacuous;
- installed GW and state share in sane bands (ceiling 15.5 GW: it must catch the
  15.908 defect while leaving room for the growing distributed-solar aggregate);
- generation `Σ byFuel == totalGen` and every fuel key mapped in `ENERGY_FUELS` —
  the invariant that keeps the stacked bar at 100%. Not circular: `totalGen` is
  read from Ember's own Total Generation row, independently of the fuel rows.
