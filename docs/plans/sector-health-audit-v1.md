# Sector audit — `health` (Здравна каса → Здравеопазване) — v1

Audit date 2026-08-15. Scope: the `/governance/sectors` hub tile + `/sector/health`,
on both the buyer and beneficiary side, per `.claude/skills/audit-sectors`.

## What reconciled (no action)

- **Basis is right.** `payout`, from `data/budget/nzok/execution_history.json`.
  НЗОК's own ЗОП line is €84,036,790 / 1,679 contracts over the whole corpus
  against a €4.72bn annual payout — a procurement headline would understate the
  sector ~56×. Failure mode A avoided.
- **`all` + all 13 `ns:` scopes** equal the month-12 2025 point, €4,715,308,021.
- **`y:2022`–`y:2024`** equal the pinned hand-verified backfill to the euro.
- **EIK-set** had no leakage and no missing sibling: a corpus-wide sweep for
  health-fund bodies (`%здравноосигурителна%`, `%РЗОК%`, `%здравеопазван%`)
  returns exactly НЗОК (121858220) and МЗ (000695317). МЗ has ONE EIK, no aliases.
- **Hygiene**: 0 rows with a missing contractor EIK, 0 null amounts, 0 consortium
  rows.
- **Lockstep** already gated and passing in `sector_stats.data.test.ts`.

## Findings

### F1 — `y:2026` publishes a four-month cumulative as the year's payout *(mode G)*

`sector_stats.json['y:2026'].health = { value: 1_720_537_150, year: 2026 }`, with
no `unavailable`. But `execution_history.json` is cumulative-YTD by its own
`source.description` („Кумулативно от началото на годината") and its last 2026
point is **month 4**. The tile therefore renders „€1,7 млрд · изплатено 2026"
beside its own `y:2025` of €4,715,308,021 — a reader sees health-fund payouts
down 63.5%.

The generator states the opposite intent one line above the defect (the comment
on the `out.health` branch in `scopeStats` — *"latest is the last FULL year
(month 12), not the partial current YTD"*). The fallback branch enforced month 12
via `nzokLatestYear`; the explicit-year branch keyed off `nzokByYear`, which is
the last point of the year whether or not that year is over. (Anchored on symbols
rather than line numbers: this document outlives the edit it describes, and the
fix moves every line it would have cited.)

Health is the **only** sector doing this. At `y:2026` every other annual sector
without a complete datum flags `unavailable` and renders „—" + „няма данни за
2026": pension, agri, administration, revenue, customs. The nine budget sectors
and `schools` carry real 2026 data.

It also contradicts the page the tile links to: `NzokExecutionPaceChart` plots
this exact number as April's cumulative against a full-year plan. And 2026 is
directly selectable — the hub's `ScopeControl mode="toggle"` offers every
calendar year through the current one.

**This is the same class that already bit this sector.** The existing test
*"full-year (December) backfill locks the y:2022-2024 payout scopes"* exists
because an 11-month cumulative once shipped as those years' figures. The current
year cannot be backfilled, so the fix is the `unavailable` flag, not a sidecar.

**Fix (tier 1).** Derive `nzokFullYear` (year → `expenditureEur` where
`month === 12`) beside `nzokByYear`; the explicit-year branch keys off
`nzokFullYear`, so a year with no December point falls through to the existing
latest-full-year + `unavailable` path. `y:2022`–`y:2025` are unaffected (all
carry a month-12 point); only `y:2026` moves, to „—" + „няма данни за 2026",
matching pension/agri/administration.

### F2 — top „изпълнител" is a state company via a statutory in-house award *(J+K+L — report only)*

All-scope #1 is **Информационно обслужване АД (831641791), €18,338,963 = 21.8%**
of НЗОК's entire €84.0M / 1,679-contract corpus. 99.98% of it is ONE contract
(2025-03-28, €18,334,927), `number_of_tenderers = 1`, rationale **„чл. 7с от
ЗЕУ"** — the statutory designation of ИО АД as the state's systems integrator.
At `y:2025` it is 87.8% of the year; at `ns:2026_04_19` the top row (Печатница на
БНБ, also state-owned) is 49.9%.

Correct data, three interpretation traps at once: the top supplier is a state
body (money never leaves government), the award is a legal monopoly (its
single-bid flag is not a competition failure), and one row dominates the window.
Genuinely-public beneficiaries ≈ 23.3% after the manual public/private pass the
skill mandates — the contracting-authority probe also returned Аресгаз, Овергаз
and Ситигаз, which are private regulated utilities and were excluded.

**No fix.** `/sector/health` renders the NzokPack, which skips the generic
top-contractors chart, so this leaderboard is not on the sector page — it is on
`/awarder/121858220` and the contracts browser. Pinned as a share ceiling in the
tests so a rollup change that starts crediting consortium value to every member
is visible.

### F3 — one self-deal register artifact *(mode Q — report only)*

2021-03-04, „Столична здравноосигурителна каса", €191, A/C servicing, with
`awarder_eik = contractor_eik = 121858220`. The РЗОК are branches sharing НЗОК's
Булстат, so the row is faithful to the source. 1 row / €191. Leave it.

### F4 — Министерство на здравеопазването had no tile anywhere in the hub *(tier 3 — RESOLVED by the user: widen)*

МЗ (000695317) is **€2,838,383,547 across 5,771 contracts** all-time (€47,036,204
in the current parliament) — 34× НЗОК's whole ЗОП line — with a 2026 enacted
budget of €646,423,200 and its node file (`admin-ministerstvo-na-zdraveopazvaneto.json`)
already present. It appeared in no sector's EIK-set, so there is no double-count
risk in adding it.

The user chose to **widen the health sector to МЗ + НЗОК** (over a separate МЗ
tile). Recorded concern, and how the design answers it: widening the EIK-set
without widening the headline would leave the two halves describing different
bodies. That is resolved by (a) retitling the sector so its name matches what the
page covers, and (b) noting that this is the established house pattern —
`environment`, `regional`, `security` and `social` all pair a single-node budget
headline with a multi-EIK group.

**The headline stays `payout` / НЗОК.** Summing НЗОК cash execution with МЗ's
enacted budget would mix bases AND double-count the state transfer that part-funds
НЗОК — the same trap the МОСВ comment already documents for the ОПОС billions.
НЗОК at €4.72bn also dwarfs МЗ's €646M, so it remains the sector's dominant money.

## Steps

### Step 1 — F1: never publish a partial year as an annual payout

`scripts/db/gen_procurement/sector_stats.ts`
- Build `nzokFullYear: Record<number, number>` from points with `month === 12`.
- The explicit-year branch of `out.health` keys off `nzokFullYear`, not
  `nzokByYear`; anything else falls through to the `unavailable` path.
- Keep `nzokByYear` for the `bespoke` completeness table in `main()` (it should
  still report the partial year as data that arrived), and add `nzokFullYear`
  beside it — the two fail apart, and only the second is on the publish path.
- Extend the `out.health` comment to say the rule is enforced in BOTH branches
  and why — the current year is the case a backfill can never cover.
- Regenerate `data/procurement/derived/sector_stats.json`; diff to confirm only
  `y:2026.health` moved.

### Step 2 — F4: widen the sector to МЗ + НЗОК

- **New `src/lib/healthReferenceData.ts`** (house pattern, cf.
  `tourismReferenceData.ts`): `MZ_EIK = "000695317"`, `HEALTH_ENTITIES`
  (НЗОК lead + МЗ, each with bg/en name), `HEALTH_SECTOR_EIKS`. Header carries:
  - why the headline stays НЗОК payout (double-count + mixed-basis, above);
  - the **anti-allowlist**: the second-level МЗ family — ЦСМП, РЗИ, НЦОЗА — is
    **54 bodies / 2,467 contracts / €86,626,512** and is deliberately OUT. Each
    is its own legal person; widening to them is a separate, informed decision.
- `src/screens/sector/sectorDashboards.ts` — `health.members` ← `HEALTH_ENTITIES`.
  `leadEik` stays `NZOK_EIK` so `getSectorPack` keeps rendering the NzokPack.
- `src/screens/components/procurement/sectorPacks.tsx` — `nzok.eiks` ←
  `HEALTH_SECTOR_EIKS`. **The pack id stays `nzok`** — it is a URL value
  (`?sector=nzok`) and renaming it breaks live deep links. Widen the label only.
- Locales (`src/locales/{bg,en}/translation.json`):
  - `sector_health_title` „Здравна каса" → „Здравеопазване" / "Health fund" → "Health"
  - `sector_health_desc` widen to cover both bodies
  - browse-pack label „Здравна каса (НЗОК)" → „Здравеопазване (МЗ + НЗОК)"

No engine change: `SectorAwardersTile` already switches to
„Възложителите на сектора (2)" + a whole-group link at >1 member, and the
`contractorsTo` single-member drill-down sits in the non-Pack branch health never
renders.

### Step 3 — regression tests

`scripts/db/tests/sector_stats.data.test.ts`:
- **F1 tripwire**: every emitted `health` value equals a **month-12** point in
  `execution_history.json`; no `y:<year>` health scope may report `year: Y`
  unless Y has a December point. Mutation-check it — restore the old
  `nzokByYear` selection in-test and assert the gate flips red, so it cannot go
  vacuous the moment 2026 closes.
- **Widened lockstep**: `HEALTH_SECTOR_EIKS` == `SECTOR_DASHBOARDS.health.members`
  == `SECTOR_BROWSE_PACKS.nzok.eiks` as sets, both EIKs present,
  `leadEik === NZOK_EIK` (the NzokPack's registration key).
- **МЗ is a real signature awarder**: `awarder_name` matches
  /министерство на здравеопазването/i and its € clears a floor well under today's
  €2.84bn.
- **Anti-allowlist**: no ЦСМП/РЗИ EIK is in `HEALTH_SECTOR_EIKS`.
- **Basis unchanged**: `stats['all'].health.basis === 'payout'` and health is
  still absent from the generator's procurement `SECTOR_EIKS`.
- **F2 share ceiling**: the top all-scope beneficiary of the НЗОК EIK stays under
  a band ceiling, and 831641791 is still reached by the contracting-authority
  classification (pin the EIK, never the rank or the absolute €).

### Step 4 — gates + deploy note

`npx tsc -b`, `npm run lint`, the touched vitest suites,
`npx vitest run scripts/db/tests/sector_stats.data.test.ts`. Live-check
`/governance/sectors` at `?pscope=y:2026` (health must read „—" / „няма данни за
2026") and `/sector/health` (title, 2-member awarders tile, NzokPack intact).

Deploy: `sector_stats.json` is bucket-served —
`npm run bucket:sync:paths -- procurement/derived/sector_stats.json`; the code
changes need `npm run deploy`. No functions/SQL change, so no `deploy:db` and no
061 re-apply.
