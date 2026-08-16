# Awarder → sector cross-link for non-lead members — v1

Analysis date 2026-08-16. Scope: `/awarder/:eik` for every EIK that is a member of
a `SECTOR_DASHBOARDS` sector but is **not** its `leadEik`.

The reverse direction already works — `SectorAwardersTile` on `/sector/:id` links
out to each member's awarder page. This is the missing return leg.

**Deliverable of this document is the plan only. Nothing here is implemented.**

## The defect

`/awarder/:eik` cross-links up to `/sector/:id` only when the EIK is the sector's
**lead**. The lookup is `sectorDashboardForLeadEik()`
(`src/screens/sector/sectorDashboards.ts`), a reverse index over `leadEik` alone.
Every non-lead member is a dead end: it belongs to a sector it cannot link to.

Trigger case: Министерство на здравеопазването (EIK `000695317`, €2,838,383,547
across 5,771 contracts) joined the `health` sector on 2026-08-16 (`18532938f1`) as
its non-lead member. `leadEik` stayed НЗОК because `getSectorPack` keys on it, so
the largest health-domain buyer in the corpus now has a landing page with no route
to `/sector/health`. Search sends readers straight there.
Context: `docs/plans/sector-health-audit-v1.md` (F4).

## What was measured (2026-08-16)

Re-derived from `SECTOR_DASHBOARDS` itself and from the local corpus, not taken on
trust. All figures below are reproducible from the appendix queries.

| sector | members | non-lead |
|---|---:|---:|
| security | 74 | 73 |
| regional | 31 | 30 |
| environment | 28 | 27 |
| transport | 15 | 14 |
| energy | 10 | 9 |
| social | 8 | 7 |
| health | 2 | 1 |
| **total (7 multi-member of 14 sectors)** | **168** | **161** |

The other seven sectors (`tourism`, `roads`, `revenue`, `customs`,
`administration`, `edu`, `agri`) are single-member — lead only, nothing to fix.

Three further facts, each of which changes the plan:

- **No EIK belongs to two sectors.** 175 distinct EIKs across 14 sectors, zero
  overlap. A membership lookup is unambiguous *today* — see F5.
- **No sector lead is a non-lead member of another sector.**
- **No non-lead member has a registered pack.** Checked against the live
  `getSectorPack` registry, not by eyeballing the key list — see F4.

## Findings

### F1 — one value drives two concerns; only one of them should move

At `CompanyDbScreen.tsx:466-467` a single `sectorDash` drives both:

```ts
const sectorDash = useMemo(() => sectorDashboardForLeadEik(eik), [eik]);
const showPack = SectorPack && !sectorDash;   // (1) pack suppression
```
```tsx
{sectorDash && ( <Link to={`/sector/${sectorDash.id}`}> … )}   // (2) the cross-link
```

Concern (1) is correct as-is and **must stay keyed on lead**: when an awarder IS a
sector lead its disbursement/delivery pack has moved to `/sector/:id`, so the
awarder page suppresses it and shows the institution's own ЗОП financials instead.
Concern (2) is the one that should key on **membership**.

Repointing the single `sectorDash` at a membership lookup would also suppress the
pack for non-lead members. Today that happens to be harmless (F4) — the plan still
splits the two values rather than resting on the coincidence.

### F2 — placement is the finding, not a detail: 98 of 160 pages would still show nothing

**This is the largest finding and it is invisible from the diff.** The existing
link renders inside `{awarderRollup && (<section>…)}` — the „Като възложител"
section (opens `CompanyDbScreen.tsx:1136`). `awarderRollup` derives from
`awarderProc`, the **scope-filtered** `/api/db/company` response. So the section,
and with it the link, disappears whenever the entity has no contracts **in the
selected window**.

The default landing scope is `ns` — the selected parliament's window, currently
[2026-04-19, …] for the 52nd NS. Measured against the corpus:

| sector | servable pages | link still hidden at default `ns` |
|---|---:|---:|
| security | 73 | 51 |
| environment | 27 | 22 |
| regional | 29 | 17 |
| transport | 14 | 5 |
| social | 7 | 2 |
| energy | 9 | 1 |
| health | 1 | 0 |
| **total** | **160** | **98 (61%)** |

Against the *previous* parliament's window ([2024-10-27, 2026-04-18]) it is still
44 of 160 — so this is not an artifact of a young window, it is what a long tail of
small buyers looks like under any per-parliament scope.

A fix that only swaps the lookup therefore delivers **62 of 160 pages** on the
scope readers actually land on, and leaves the majority of the dead ends exactly as
they are. Sector membership is an **identity** fact, not a money fact: it is true
whether or not the body awarded a contract this parliament, and it must render
independently of the scope control.

The lead link has the same latent hole and got away with it because leads are big:
13 of 14 leads have contracts in the default window. The exception is **energy**
(БЕХ `831373560`) — no contracts in the current window and no registered pack, so
`/awarder/831373560` today offers no route to `/sector/energy` either. Moving the
placement fixes the lead case at the same time.

### F3 — 160 servable pages, not 161

`regional` member `125043455` (Областна администрация — област Търговище) carries
`noAwarderPage: true` and has **zero all-time contracts** — the flag and the corpus
agree exactly, which is the `sector_members_land.data.test.ts` invariant holding.
Its page renders „Няма фирма с ЕИК … в базата.".

Decide deliberately rather than by accident. **Recommendation: let the banner
render there too.** The `AwarderBreadcrumb` already renders on that page, the
membership claim is still true, and it converts the single worst page in the set —
an outright „not in the database" dead end — into a navigable one. The placement in
Step 2 produces this behaviour naturally; no special case is needed either way.

### F4 — the pack coincidence holds today, and is not load-bearing after Step 1

Checked by calling `getSectorPack` over all 161 non-lead members: **zero hits**.
The registry's 15 keys are all either sector leads or the leads of the six bespoke
sectors (`pensions`/`judiciary`/`culture`/`water`/`defense`/`education`) that have
no `SECTOR_DASHBOARDS` entry — none is a non-lead member of a dashboard sector.

So a naive repoint would not in fact suppress any pack today. It would leave a trap
armed: register a pack under a non-lead member EIK — which is exactly what happens
when a sector grows a second packed body, as `health` just did — and that body's
pack silently vanishes from its awarder page with nothing failing. Splitting the
two values (Step 1) disarms it permanently, and Step 4 gates it.

### F5 — membership must refuse ambiguity, not resolve it

`DASHBOARD_BY_LEAD_EIK` is keyed on `leadEik`, which is unique by construction.
A membership index is keyed on member EIKs, which are **not** unique by
construction — nothing in the config or in any test prevents two sectors listing
the same EIK. `Object.fromEntries` over a colliding set silently keeps the last
writer, so one body would link to a sector it half-belongs to, chosen by object
key order.

Zero overlaps today. `scripts/db/tests/sector_stats.data.test.ts:364` („МЗ is
claimed by exactly one sector") asserts this for МЗ **specifically**, on both
`SECTOR_BROWSE_PACKS` and `SECTOR_DASHBOARDS` — it does not generalise. Step 4
adds the global gate, in that file, on the all-packs idiom that test already argues
for.

## The plan

Four steps. Generic engine fix — no sector is special-cased, and no EIK set is
re-hardcoded: members keep coming from `src/lib/<domain>ReferenceData.ts` through
`SECTOR_DASHBOARDS`.

### Step 1 — split the lookup (`src/screens/sector/sectorDashboards.ts`)

Add a membership index beside the existing lead index. Keep
`sectorDashboardForLeadEik` exactly as it is — `showPack` keeps using it.

- Build `DASHBOARD_BY_MEMBER_EIK` from `Object.values(SECTOR_DASHBOARDS)` ×
  `sectorMemberEiks(c)` (the helper at `:484` already exposes every member EIK).
- Export `sectorDashboardForMemberEik(eik)`, same null-tolerant signature.
- **Build it collision-aware.** Do not use `Object.fromEntries`. On a duplicate
  member EIK, throw at module load with both sector ids named. This is config, it
  is evaluated at import time, and a wrong sector attribution on a €2.8bn body is
  worse than a loud boot failure — the same reasoning `resolve_persons` uses when
  it refuses a shared name rather than grading it. The Step 4 unit test then has
  something to assert against, and the PG gate covers the corpus side.
- Extend the comment block above `DASHBOARD_BY_LEAD_EIK` (`:469-472`) to say which
  index serves which concern, since that comment currently claims the lead index
  serves both (a) and (b).

Note the lead index stays a strict subset: every `leadEik` is also in `members`
(verified — all 14), so `sectorDashboardForMemberEik` returns the same config as
`sectorDashboardForLeadEik` for a lead. The two are not mutually exclusive and the
render must not assume they are.

### Step 2 — re-site and re-key the link (`src/screens/dev/CompanyDbScreen.tsx`)

1. At `:466`, keep `sectorDash` (lead) for `showPack`. Add a second memo —
   `sectorMembership` — from `sectorDashboardForMemberEik(eik)`.
2. **Move the link out of the `awarderRollup` section** (F2). Render it at page
   level, immediately after the `AwarderBreadcrumb` block (`:771-777`), which is
   the page's existing identity/context slot and renders unconditionally on the
   awarder route. Sector membership belongs with the breadcrumb trail, not with the
   money tiles.
3. Gate it on `isAwarderRoute && sectorMembership`. Not on `hadAwarder`, not on
   `awarderRollup` — that is the whole point of the move. The `/company/:eik` route
   keeps its own `SectorBreadcrumb` behaviour untouched.
4. Branch the copy on `sectorMembership.leadEik === eik` (see below). One component,
   two sentences — not two components.
5. Delete the old link block at `:1194` and its `ArrowRight`/`Link` usage there if
   nothing else in that section needs them.

Because the lead is also a member, this single site now serves both cases and the
lead's link gains scope-independence for free (the energy case in F2).

### Step 3 — copy

Repo convention: this component writes its bilingual strings as inline
`i18n.language === "bg" ? … : …` ternaries (it does so ~40 times); no new locale
keys. The sector name comes from `t(config.titleKey)` — the same call
`SectorDashboardScreen.tsx:142` makes — so the sentence names the sector rather
than saying „таблото" and leaving the reader to guess which.

**Lead (existing meaning — „your content moved here"), unchanged in substance:**

- BG: „Разпределените средства и детайлите по сектора са в таблото на сектора"
- EN: "The disbursed funds and sector detail are on the sector dashboard"

**Non-lead member (new — „this body is part of sector X"):**

- BG: „Тази институция е част от сектор „{title}“."
- EN: "This institution is part of the {title} sector."

CTA, both cases: BG „Към сектора" / EN "Open sector" — the existing „Към таблото" /
"Open dashboard" is retained only if the lead sentence is kept verbatim; prefer one
CTA for both, since both land on the same page.

Checked against all seven multi-member titles — Здравеопазване, Сигурност,
Регионално развитие, Околна среда, Транспорт, Енергетика, Социално подпомагане —
the BG template reads naturally with each, and so does the EN one. No emojis.

The distinction the copy must preserve: the lead's sentence says *content moved*;
the member's says *this is where this body sits*. Reusing the lead's sentence on a
member page would tell the reader МЗ's €2.8bn is on `/sector/health`, which is
false — that dashboard's body is НЗОК's budget-bridge pack.

### Step 4 — regression tests

**`src/screens/sector/sectorConfigLockstep.test.ts`** (registry↔dashboard
invariants — the natural home; add to the existing `describe`):

- No EIK appears in two sectors' `members`. Assert on a computed duplicate list and
  `toEqual([])` so the failure names the offenders, and assert the scanned EIK count
  is `> 150` first — without that floor the test is absence-equivalent, exactly as
  the existing „shared.length toBeGreaterThan(5)" guard in that file argues.
- Every `leadEik` is present in its own `members` (Step 1 relies on it).
- `sectorDashboardForMemberEik` returns the sector for a lead, for a non-lead
  member (pin `000695317` → `health`, the trigger case), and `null` for an
  unrelated EIK.
- **Mutation check**: the duplicate-detection assertion must flip to failing when
  fed a deliberately colliding fixture — otherwise it is satisfied by any config
  that happens not to collide, which is every config today.
- No non-lead member has a registered `getSectorPack` entry — i.e. F4's coincidence
  is asserted rather than assumed, so if it ever stops holding the failure names the
  EIK instead of silently blanking that body's pack.

**`scripts/db/tests/sector_stats.data.test.ts`** (PG-backed, auto-skips when
Postgres is down):

- Generalise the МЗ-specific „claimed by exactly one sector" test (`:364`) to the
  whole `SECTOR_DASHBOARDS` × `SECTOR_BROWSE_PACKS` space, on the all-packs idiom
  its own comment already advocates: *"unlike a hand-listed set it cannot silently
  under-cover, because a pack added tomorrow is checked the day it lands."* Keep the
  МЗ assertion as a named pin — it carries the €2.84bn double-count argument.
- Assert every non-lead member EIK either has contracts in `contracts` or carries
  `noAwarderPage: true` — the F3 invariant, in both directions, so the flag keeps
  retiring itself.

## Gates for the implementation

```bash
npx tsc -b && npm run lint && npm run test:unit
```

`tsc --noEmit` checks nothing here — the root tsconfig is a references stub.

Then verify in the browser via the preview tooling (`.claude/launch.json`'s
`vite-dev`, never a bare `npm run dev`), on all four cases:

| case | URL | expected |
|---|---|---|
| non-lead, has contracts in window | `/awarder/000695317` | banner → `/sector/health` |
| non-lead, **no** contracts in window (F2) | any of the 98, e.g. a security unit | banner still renders |
| lead | `/awarder/121858220` | lead sentence, pack still suppressed |
| non-member | `/awarder/000695089` (roads, single-member lead) | lead sentence, unchanged |

Confirm on the second row that the „Като възложител" section is genuinely absent
while the banner is present — that is the F2 fix, and it is the one thing a
lookup-only patch would not deliver.

## Out of scope

- Changing `leadEik` for `health` or any sector. `getSectorPack` keys on it and the
  hub headline basis argument (`18532938f1`) depends on it.
- Adding a pack for МЗ, or moving `/sector/health`'s body off НЗОК's budget bridge.
- The reverse direction (`SectorAwardersTile`) — already works.
- The six bespoke sectors with no `SECTOR_DASHBOARDS` entry. They have no member
  list here, so there is nothing to key on; if one grows a member set it joins this
  mechanism automatically.

## Appendix — reproducing the measurements

Member facts, from the config (no database). Write it to a `.mts` file and run it
with `npx tsx --tsconfig tsconfig.app.json <file>` — the `--tsconfig` flag is what
resolves the `@/` alias:

```ts
import { SECTOR_DASHBOARDS, sectorMemberEiks } from "@/screens/sector/sectorDashboards";
const owner = new Map<string, string[]>();
for (const c of Object.values(SECTOR_DASHBOARDS))
  for (const e of new Set(sectorMemberEiks(c)))
    owner.set(e, [...(owner.get(e) ?? []), c.id]);
console.log("EIKs in >1 sector:", [...owner].filter(([, s]) => s.length > 1));
```

⚠ Do **not** collapse this into `npx tsx -e '…'` with a dynamic `import().then()`.
Measured: the process exits before the promise settles and prints **nothing at
all** — no output and no error, which reads exactly like „no collisions found". The
one shape of this probe that must never fail quietly is the one that fails quietly.

Coverage, against local Postgres (`postgres://postgres@127.0.0.1:5433/electionsbg`,
`PGPASSFILE=/Users/atanasster/data-bg/.pgpass`) — load the 161 non-lead EIKs into a
temp table `nl(eik, sector, name)`, then:

```sql
with have as (select distinct awarder_eik e from contracts where tag='contract'),
     ns   as (select distinct awarder_eik e from contracts where tag='contract' and date >= '2026-04-19')
select nl.sector, count(*) members,
       count(*) filter (where h.e is not null) servable,
       count(*) filter (where h.e is not null and n.e is null) link_hidden_default_ns
from nl left join have h on h.e = nl.eik left join ns n on n.e = nl.eik
group by 1 order by 1;
```

Corpus vintage at measurement: `contracts` spans 2011-01-03 … 2026-08-13.
