---
name: audit-sectors
description: Audit a government-sector dashboard (the /governance/sectors hub tile + its /sector/:id or bespoke screen) against the raw sources, on BOTH sides of the money. Buyer side: the hub headline KPI reconciles to its declared basis (budget/payout/procurement/headcount/score) at every scope, the sector's awarder EIK-set is honest (no wrong-EIK leakage like the МВР €370M-into-defense error, no missing sibling body, every EIK real and correctly attributed), the four EIK-set copies stay in lockstep (generator SECTOR_EIKS ↔ SECTOR_DASHBOARDS.members ↔ *_SECTOR_EIKS reference data ↔ SECTOR_BROWSE_PACKS), and the derived/bespoke tiles reconcile (category split sums to header, sum==100%, HHI denominator guard, no double-count). Beneficiary side: the „Топ изпълнители" leaderboard means what a reader takes it to mean — single-contract/contractor concentration, public bodies as contractors (intra-government transfers rendered as procurement), statutory sole-source awards misread as weak competition, consortium double-counting, EIK-vs-name fragmentation, intra-group circulation (one sector member buying from another, so the money never reached an external market), self-contracting register artifacts, and a leaderboard whose basis differs from the headline's. Then adds PG-backed regression tests and fixes the issues. Use when the user asks to audit / verify / fact-check a sector dashboard, its hub tile or its top-contractors list, after building a new sector, or when a sector's headline, awarder list or beneficiaries look off. Prefers generic-engine and generator fixes over per-sector hacks; treats a new basis / new sector-hub entry / an EIK-inclusion-boundary judgment / excluding a legitimate beneficiary as a design decision to confirm, and otherwise auto-fixes via /implement-plan.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - Agent
  - Skill
---

# Audit Sectors skill

A **government sector** (e.g. `defense`, `regional`, `water`) is presented in two
places that must both be honest:

1. **The hub tile** on `/governance/sectors` — a single headline € (or score /
   headcount) number with a one-word caption. The number is precomputed per scope
   into `data/procurement/derived/sector_stats.json` and carries a `basis`
   (`budget | payout | procurement | headcount | score`) that decides both the
   caption and which source it came from.
2. **The sector screen** — either the generic `/sector/:id`
   (`SectorDashboardScreen`, config in `src/screens/sector/sectorDashboards.ts`)
   which rolls a curated **awarder EIK-set** through `awarder_group_model`, or a
   bespoke vanity path (`/defense`, `/judiciary`, `/water`, `/culture`,
   `/pensions`, `/education`, `/sector/administration`) that mixes contract-derived
   tiles with curated JSON data files.

A sector is only as honest as (a) its headline reconciling to its declared basis,
(b) its EIK allowlist including exactly the right bodies, (c) those two views
agreeing, and (d) its **beneficiary** list meaning what a reader takes it to mean.
A wrong EIK inflates the total (the defense audit's near-miss: МВР directorates
ДУССД `129010157` €301M + ДКИС `129010698` €70M would have been a €370M error); a
missing sibling understates it; a moved JSON field silently zeros a tile; a budget
*function* mislabels unrelated spend as the sector; and a leaderboard can be right
to the euro while saying something false about who the money went to. This skill
audits all of that against the raw data and fixes it.

**(a)–(c) are the buyer side and (d) is the seller side, and they fail
differently.** A buyer-side defect is almost always a wrong number — fix the data.
A seller-side defect is usually a *correct* number that reads as a different
claim — fix the sentence. Phase 2 covers the first, Phase 2b the second; do not
resolve a Phase 2b finding by filtering rows out of a chart.

Worked precedents this skill is distilled from: the **Отбрана (МО) pack audit**
(3 adversarial agents — EIK-allowlist leakage, name-regex false positives, budget
function ≠ defense, per-platform aggregate not reconciling to header, alias-EIK
double-count); the **sectors-hub KPI-basis rework** (procurement-only headline
understated Култура €3k vs a €234M budget → per-basis honest headline); the
**transport audit** (headline exact throughout while a declared universe held only
the regulator, €3.7M shown for a real €348.2M); and the **energy audit**, which is
where Phase 2b comes from — the money was clean at all 30 scopes and both EIK
sweeps came back unchanged, yet the sector's top „изпълнител" was a police
directorate holding a third of the window, and the defect that *did* exist was in
a physical-asset tile counting a power plant that has not been built.

## The four EIK-set copies (keep in lockstep — Failure mode E)

The same sector's awarder allowlist is declared in up to four places. They must
match (modulo intentional single-member collapses):

| Copy | File | Shape |
|------|------|-------|
| **Reference data** (canonical) | `src/lib/<domain>ReferenceData.ts` | `<D>_ENTITIES[]` (per-entity name + universe + alias flag) → `<D>_SECTOR_EIKS` |
| **Hub generator** (procurement basis only) | `scripts/db/gen_procurement/sector_stats.ts` | `SECTOR_EIKS: Record<id, string[]>` — imports the `<D>_SECTOR_EIKS` |
| **Dashboard config** | `src/screens/sector/sectorDashboards.ts` | `SECTOR_DASHBOARDS[id].members[]` (+ `leadEik`) — maps `<D>_ENTITIES` |
| **Browse pack** | `src/screens/components/procurement/sectorPacks.tsx` | `SECTOR_BROWSE_PACKS[id].eiks` |

**Reference data is the single source of truth** — every other copy should derive
from `<D>_SECTOR_EIKS` / `<D>_ENTITIES`, never re-hardcode digits. A copy that
hardcodes its own list is the drift bug to fix (point it back at the export).
Curate the allowlist **by EIK, never by name regex** — a name sweep false-positives
(`7-МО Основно училище` matched "МО"; the town of Раковски matched the Раковски
military academy; EIK prefix `1290*` is the whole security-services range, mostly
МВР — two МВР directorates sit adjacent to МО and would be a €370M error).

## Basis → source of truth (what the hub headline must reconcile to)

`sector_stats.json[scope][id] = { kind, basis, value, year?, note? }`, generated by
`scripts/db/gen_procurement/sector_stats.ts` (`npm run db:gen-sector-stats`; reads
PG after `db:refresh` + the bespoke JSON files). Per basis:

| Basis | Sectors | Source the value MUST equal | Owner skill (to refresh the source) |
|-------|---------|-----------------------------|-------------------------------------|
| **procurement** (windowed Σ `contracts.amount_eur`) | roads, water, transport, energy, environment | PG `contracts` for `SECTOR_EIKS[id]` in the scope window | update-procurement |
| **budget** (annual приет expenditure) | defense, security, justice, culture, edu, tourism, social, regional | `data/budget/ministries/<node>.json` `years[].expenditure.amountEur` | update-budget |
| **budget** (annual, `note:'adjusted'`) | revenue (НАП), customs (АМ) | `data/budget/agencies/{nap,customs}.json` (own годишен уточнен план) | update-budget |
| **payout** (annual) | pension (ДОО), health (НЗОК), agri (ДФЗ CAP) | `budget/noi/funds.json`, `budget/nzok/execution_history.json`, `agri_payloads` (kind=overview) | update-noi / update-nzok / update-agri |
| **score** (annual) | schools | `data/indicators.json` `series.dzi` (unweighted oblast mean) | update-indicators |
| **headcount** (annual) | administration | `data/budget/personnel.json` `national[year].positions.filled` | update-administration |

The generator warns (not errors) when a bespoke source produces no data — an
all-zero or stale tile is a silent bug, not a legitimate 0. **The basis choice is
editorial:** a pass-through ministry (МРРБ controls ~€1.06bn but procures ~€100M)
must front its *budget*, not its thin procurement line. Never front a budget
*function* — "Отбрана и сигурност" bundles police+courts+prisons (~12%); use the
administrative ПРБ **node**, Eurostat COFOG, or the МО line for defense-only.

## Setup

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep postgres   # electionsbg-pg :5433 must be up
PG="postgres://postgres:postgres@localhost:5433/electionsbg"
SECTOR=<id>                                                   # e.g. defense, regional, water
```

Identify the sector's `id`, `to` route, `agency`, and cluster from
`src/screens/governance/sectorRegistry.ts`; its basis + source from the table
above; its EIK-set from the four copies. Never trust `sector_stats.json` as the
source of truth for *correctness* — it is the OUTPUT of the generator; regenerating
it cannot catch a wrong-EIK / wrong-basis / wrong-node bug on its own.

## Phase 1 — Reproduce the hub headline against its source

Pick a concrete scope (start with `all`, then the current parliament `ns:<election>`
and a `y:<year>`). Read the emitted value, then reproduce it from the declared
source and compare.

```bash
# What the tile shows (per scope). scopeKey = all | ns:<election> | y:<year>.
node -e "const d=require('./data/procurement/derived/sector_stats.json');console.log(JSON.stringify(d['all']['$SECTOR'],null,2))"
```

- **procurement basis** — reproduce the windowed sum for the EIK-set:
  ```bash
  psql "$PG" -tAc "
  select coalesce(round(sum(amount_eur)),0) eur
  from contracts
  where tag='contract' and awarder_eik in (<SECTOR_EIKS[id]>)
    and date >= '<from>' and date < '<to>';"   # ns/all/y bounds; all → no date filter
  ```
  Must equal `value`. If HIGHER, a wrong EIK is leaking (Failure mode C); if LOWER,
  a member is missing (Failure mode D).
- **budget basis** — `value` must equal the source file's `years[year].expenditure.amountEur`
  for the resolved `year` (the scope's year if present, else latest). Confirm the
  `<node>`/agency file is the right body and that `year` matches the caption.
- **payout / score / headcount** — reconcile `value` against the named source file's
  latest (or scope-year) point. A `0` here almost always means a moved field
  (Failure mode B) — grep the source JSON for the field the generator reads.

## Phase 2 — Validate the EIK-set and the tiles (the core audit)

### EIK-set membership (procurement/group sectors)

Per member EIK, ask "is this genuinely THIS sector, and is anything missing?"

```bash
# Per-EIK contract € + the awarder_name(s) the corpus knows it by — spot leakage
# (a wrong body) and name-variant EIK confusion.
psql "$PG" -F$'\t' -tAc "
select awarder_eik, min(awarder_name), count(*), round(sum(amount_eur))
from contracts where tag='contract' and awarder_eik in (<eiks>)
group by awarder_eik order by 4 desc nulls last;"
```

Then diff the four EIK-set copies (Failure mode E):

```bash
# Print each copy and confirm they're equal (or an intentional single-member collapse).
grep -n "SECTOR_EIKS\|<D>_SECTOR_EIKS" scripts/db/gen_procurement/sector_stats.ts
grep -n "eik:" src/screens/sector/sectorDashboards.ts        # SECTOR_DASHBOARDS[id].members
grep -n "$SECTOR" src/screens/components/procurement/sectorPacks.tsx
sed -n '/<D>_SECTOR_EIKS\|<D>_ENTITIES/p' src/lib/<domain>ReferenceData.ts
```

### Failure modes (each seen in a real audit)

| # | Symptom | Detect | Root cause / fix |
|---|---------|--------|------------------|
| **A** | Basis understates/mislabels the sector (Култура €3k; a pass-through ministry fronting its thin tender line) | Compare headline to the body's real budget/payout | Wrong `basis` — move to budget/payout in the generator. **Editorial → confirm.** |
| **B** | Tile is `0` / stale despite a live source | grep the source JSON for the field the generator reads (`expenditure.amountEur`, `series.dzi`, `positions.filled`, agri `headline.totalEur`) | Moved/renamed field or unloaded table; the generator only *warns*. Fix the field path or re-run the owner update-* skill. |
| **C** | Group total >> Σ(true members); a wrong body inflates it | per-EIK € + `awarder_name` (above) — an unexpected big-value body | Wrong EIK in `<D>_ENTITIES`. Remove it (defense near-miss: МВР ДУССД/ДКИС; ДА „Държавен резерв" 831913661). |
| **D** | Total < reality; a sibling body's spend absent | free-text the parent/ownership name across ALL awarders: `... where awarder_name ilike '%<term>%' group by awarder_eik order by 4 desc` — a big related buyer not in the set | Add the missing EIK to `<D>_ENTITIES` (Българска армия units, ВМА). |
| **E** | The four EIK-set copies disagree | diff them (above) | A copy hardcodes digits instead of importing `<D>_SECTOR_EIKS`. Repoint it at the export. |
| **F** | A dominant sub-entity distorts a category/HHI tile; a parent+child EIK double-count; €0 consortium members counted | segment by universe; check the HHI denominator is Σ suppliers WITH eik (not headline); look for parent EIK whose children are also listed | Add a universe Select (ВМА = 46% of the МО group → segmentable); keep the alias-EIK / consortium guards; never let both a parent and its own contracts' EIK sum twice. |
| **G** | Caption year/period ≠ the value's actual year | check `year` in the emitted stat vs the scope | `annual()` resolves to latest when the scope year is absent — confirm that's intended; procurement carries no year (scope window names it). |
| **H** | A budget *function* labelled as the sector | is the node an administrative ПРБ or a function? | "Отбрана и сигурност" ≠ defense. Use the admin node / COFOG. |
| **I** | A bespoke tile's parts don't sum to its header (aviation_sustainment €374.7M/195 ≠ header 376/219); category split ≠ 100% | recompute the tile's aggregate from its JSON; assert Σ==header, Σpct==100 | Add the missing bucket ("Двигатели и друго" €1.3M/24) / fix the parser; pin with an assert in the data file's generator. |

### Bespoke-screen data files

For a vanity-path sector (`/defense`, `/judiciary`, …), each curated JSON under
`data/<domain>/*.json` is owned by an `update-<domain>` skill. Reconcile each tile's
internal totals (Failure mode I), confirm no leva post-2026 (EUR only), and confirm
the file is fresh via its `source`/date. Don't hand-edit a scraped file — re-run its
skill; hand-fix only a genuine parser/aggregation bug.

## Phase 2b — Validate the BENEFICIARIES (who receives the money)

Everything above audits the **buyer** side: is this the right EIK-set, does the
headline reconcile. That leaves the other half of every sector page unexamined —
the „Топ изпълнители" leaderboard and the sentence a reader actually forms, which
is *"this is who the sector's money goes to"*. A sector can have a perfect
headline and a leaderboard that means something quite different from what it
appears to mean.

The energy audit is the worked precedent: the €274M current-parliament headline
reconciled to the euro, and its top „изпълнител" was **Областна дирекция на МВР —
Враца at €89.6M**. Nothing was wrong — АЕЦ Козлодуй pays the police to guard the
plant, CPV 79713000, and the register states the ground (Чл. 164, ал. 1, т. 5 ЗОП,
exclusive rights). But three facts only a beneficiary pass surfaces: the top
"supplier" is a **state body**, not a market vendor; the contract is a **statutory
monopoly**, so its single-bid flag is not a competition failure; and it is **32.7%
of the whole window** — a third of the sector's money in one row out of 363.

Run these against the same scope you used in Phase 1. **None of J–Q is
automatically a bug** — most are captioning and interpretation. Report them; fix
only what is actually wrong.

Two schema traps, both hit while writing these: `round()` on a `double precision`
needs a `::numeric` cast, and **`contracts.date` is TEXT** — compare it as text
(ISO-8601 sorts correctly, and it is what the generator does), never `::date`.

```bash
# Concentration + the top-20 beneficiary list. `pct` is the share of the scope
# total, which is the number that decides whether the leaderboard is a ranking
# or a single-row story.
psql "$PG" -F$'\t' -tAc "
with w as (
  select * from contracts
   where tag='contract' and awarder_eik in (<eiks>) <AND date window>)
select contractor_eik, min(contractor_name), count(*), round(sum(amount_eur)) eur,
       round((100.0*sum(amount_eur)/(select sum(amount_eur) from w))::numeric,1) pct
  from w group by 1 order by 4 desc nulls last limit 20;"
```

```bash
# CONTRACTING-AUTHORITY beneficiaries — a candidate list for "money that never
# left the state". Any contractor that is itself an awarder elsewhere.
#
# ⚠ THIS OVER-CAPTURES, and the label is deliberately not "public body". ЗОП's
# UTILITIES regime makes private regulated companies contracting authorities, so
# ЕРП distributors, gas distributors and electricity traders all appear as
# awarders and get matched here. The result needs a manual public/private pass
# before any share is quoted. Measured: of water's 2.60% only 1.44% is genuinely
# public — €37.8M of the €84.8M is ЕВН, ЕРП Запад, Овергаз, Ситигаз and
# Енерго-Про, i.e. 44% of the probe's own answer was wrong. On transport the same
# error is 0.16 of 15.59 points, so the size of the mistake is not predictable
# from the sector.
#
# On energy it returned the МВР guarding series (€158.8M all-scope) and, less
# obviously, the БАН archaeological institute at €63.3M across 94 contracts —
# rescue excavation for pipeline and plant construction, invisible from the
# buyer side.
psql "$PG" -F$'\t' -tAc "
select c.contractor_eik, min(c.contractor_name), count(*), round(sum(c.amount_eur))
  from contracts c
 where c.tag='contract' and c.awarder_eik in (<eiks>)
   and c.contractor_eik in (select distinct awarder_eik from contracts)
 group by 1 order by 4 desc nulls last limit 20;"
```

```bash
# INTRA-GROUP circulation — both sides of the contract are sector members. Money
# the page presents as "the sector spent X" that in fact moved between two of its
# own companies. Measured on energy: €141.5M, 1.38% of the headline (ТЕЦ Марица
# изток 2 buying coal from Мини Марица-изток, subsidiaries paying БЕХ).
psql "$PG" -F$'\t' -tAc "
select c.awarder_name, c.contractor_name, count(*), round(sum(c.amount_eur))
  from contracts c
 where c.tag='contract' and c.awarder_eik in (<eiks>) and c.contractor_eik in (<eiks>)
 group by 1,2 order by 4 desc nulls last;"
```

```bash
# Is a single-bid award actually a LEGAL monopoly? Join the tender by УНП.
psql "$PG" -F$'\t' -tAc "
select c.contractor_name, round(c.amount_eur), t.procedure_type, t.legal_basis
  from contracts c left join tenders t using (unp)
 where c.tag='contract' and c.awarder_eik in (<eiks>) and c.number_of_tenderers = 1
 order by c.amount_eur desc nulls last limit 20;"
```

```bash
# Contractor-side hygiene: unresolvable EIKs, NULL money, consortium rows, and
# the outright impossibility — a body contracting with ITSELF (29 rows / €3.87M
# corpus-wide, a register artifact where the buyer landed in the supplier field).
psql "$PG" -F$'\t' -tAc "
select count(*) filter (where contractor_eik is null or contractor_eik = '') no_eik,
       count(*) filter (where amount_eur is null)                            no_amount,
       count(*) filter (where consortium_eik is not null)                    consortium,
       count(*) filter (where awarder_eik = contractor_eik)                  self_deal
  from contracts where tag='contract' and awarder_eik in (<eiks>);"
```

Politically-connected beneficiaries are a fifth probe when `company_politicians`
is loaded — join it on `contractor_eik` to see what share of the sector's money
reaches an MP/PEP-linked company. Treat the result the way the person layer does:
**an EIK-keyed link, never a name match** ([[feedback_name_match_not_identity]]).

### Failure modes (beneficiary side)

| # | Symptom | Detect | Root cause / fix |
|---|---------|--------|------------------|
| **J** | One contract or contractor is a huge share of the scope; the "leaderboard" is really one row | `pct` in the concentration probe (energy: 32.7% from 1 of 363 rows) | Usually NOT a bug — a property of a short window. Fix the CAPTION, or surface the share, so a reader does not read a dominated total as a spread. Never silently drop the row. |
| **K** | The top „изпълнител" is a state body, so the money never leaves government | the contracting-authority probe, **then a manual public/private pass** — it over-captures private regulated utilities (МВР ← АЕЦ Козлодуй €89.6M is real; ЕВН in water is not) | Not a bug — an intra-government transfer rendered as procurement. Label it; do not exclude it, and do not let it read as a private vendor winning the sector. |
| **L** | A statutory sole-source award is counted as weak competition | `tenders.legal_basis` on the single-bid rows (Чл. 164, ал. 1, т. 5 ЗОП = exclusive rights) | Not a bug in the number, a limit on its meaning. The single-bid gauge is a count-based metric and cannot know this; say so rather than re-scoring it per sector. |
| **M** | Consortium members each credited the full contract value, or a parent and its own subsidiary both counted | `consortium_eik` / `consortium_role` / `consortium_full_eur`; look for a repeated `consortium_eik` across rows summing above the contract | Real double-count. Fix in the rollup, never per-sector — see the €0-consortium-member guard in Failure mode F. |
| **N** | One company split across several EIK spellings / name variants, so its true rank is understated | group by `contractor_name` and compare against the group-by-`contractor_eik` ranking; check `contractor_eik_full` | Keyed on the wrong column. Rank by EIK, show the name — the reverse fragments a real beneficiary. |
| **O** | The leaderboard's basis differs from the headline's | compare Σ of the leaderboard against the headline for the same scope | A tag / window / current-value mismatch (`tag='contract'` excludes amendments — [[reference_procurement_eur_sum_basis]]). The two must share one basis or the page contradicts itself. |
| **P** | Part of the "sector spend" never left the group — one member bought from another | the intra-group probe (energy: €141.5M / 1.38%, ТЕЦ ← Мини Марица-изток coal, subsidiaries → БЕХ) | Not a double-count — the headline sums awarder-side, so each row is counted once. But "the sector procured €X" implies an external market, and this part of X did not reach one. Surface the share; excluding it changes the sector's definition and is a tier-3 call. Cross-check against the parent/child guard in Failure mode F, which IS a real double-count. |
| **Q** | A body appears as its own contractor (`awarder_eik = contractor_eik`) | the `self_deal` count in the hygiene probe (29 rows / €3.87M corpus-wide) | A register artifact — the buyer landed in the supplier field. Small and cross-sector, so fix in the ingest/parser if anywhere, never per-sector; report it and leave the row alone if the source really says that. |

⚠️ **A beneficiary finding is rarely a data fix.** J, K and L above were all *correct
data* — what was missing was a sentence. Resist "fixing" them by filtering the row
out of the leaderboard: excluding a legitimate €89.6M contract to make a chart look
more like a market is the one response that turns an honest page into a false one.

## Phase 3 — Classify fixes

Prefer the highest tier that solves the **class** of problem — never a per-sector
hack for a systemic bug.

1. **Data-source / generator level** — the honest default for most findings:
   - fix a wrong/missing EIK in `src/lib/<domain>ReferenceData.ts` `<D>_ENTITIES`
     (propagates to all four copies if they import it);
   - repoint a hardcoded EIK-set copy back at `<D>_SECTOR_EIKS`;
   - fix the generator's `<node>`/agency file, basis assignment, or a moved
     source-field path;
   - re-run the owning `update-<domain>` skill to refresh a stale/zero bespoke source.
2. **Generic engine** — when the bug is a class shared by every sector, fix once +
   test: the `awarder_group_model` SQL (`scripts/db/schema/pg/061_awarder_group_model.sql`),
   `buildAwarderModelFromAggregates` / a pack classifier
   (`src/lib/awarderModel.ts`), the shared HHI/single-bid/caption helpers, or the
   generator's `annual()`/scope-window logic. Keep the SQL, the endpoint
   (`functions/db_routes.js`), and the client fold in lockstep; re-apply `061` to
   Cloud SQL when the SQL changes.
3. **Registry / editorial decision** — **STOP and propose to the user.** These are
   design calls, not bug fixes:
   - a **new basis** or changing a sector's basis (procurement ↔ budget ↔ payout);
   - **adding/removing a sector** from `sectorRegistry.ts` or a cluster;
   - an **EIK-inclusion boundary** judgment ("is ВМА part of *defense*?", "does
     transport include Метрополитен?") — where the answer changes the headline
     materially;
   - a **new universe segmentation** or a new hub-wide narrowing control;
   - **excluding or re-labelling a legitimate beneficiary** — suppressing a
     public-body contractor, splitting intra-government transfers out of a
     sector total, or exempting statutory sole-source awards from a competition
     metric. Every one of these makes the page say something new about who got
     the money, and each is defensible or indefensible only against a stated
     editorial line. Present the choice with its EUR and share impact.
   Present the specific choice + its EUR impact; don't hardcode it silently.

## Phase 4 — Regression tests (always)

Create/extend a PG-backed data test `scripts/db/tests/sector_stats.data.test.ts`
(model on `scripts/db/tests/procurement_dossiers.data.test.ts`; auto-skips when
Postgres is down). For the audited sector, pin with **bands and inequalities**
(never exact equality — the corpus grows fortnightly, budgets get new years):

- headline € **band** for a fixed scope (ceiling catches EIK re-leakage / re-expansion,
  floor catches an over-trim or a zeroed source);
- **the four EIK-set copies are equal** — assert `SECTOR_EIKS[id]`,
  `SECTOR_DASHBOARDS[id].members.map(m=>m.eik)`, `<D>_SECTOR_EIKS`, and
  `SECTOR_BROWSE_PACKS[id].eiks` are the same set (this is the drift tripwire);
- a **removed wrong EIK is absent** from `<D>_ENTITIES` (e.g. МВР `129010157` not in
  defense);
- a **signature true-member EIK is present** and its per-EIK € > floor;
- for a budget/payout sector: `sector_stats.json[scope][id].basis === '<expected>'`
  and `value` within a band of the source file's resolved year;
- a bespoke tile's `Σ(parts) === header` assert where Failure mode I bit;
- **beneficiary side**, when Phase 2b found anything worth keeping true:
  - the **top-contractor share ceiling** for a fixed scope, where a dominant row
    exists (energy: assert the top beneficiary stays under ~50% of the window, so
    a rollup change that starts crediting a consortium's full value to every
    member is visible as a share, not just as a total);
  - a **known public-body beneficiary is still classified as one** — pin the EIK,
    not the name, and assert it is still reached by whatever labels it. This is
    the beneficiary twin of the anti-allowlist: it stops a later "clean up the
    leaderboard" change from quietly turning a state transfer back into an
    apparent private vendor;
  - the **leaderboard basis equals the headline basis** — Σ of the per-contractor
    rollup for a scope == the hub value for that scope. Failure mode O is
    invisible to every other gate here, because both halves are individually
    correct.

⚠️ Do **not** pin a beneficiary's rank or a contractor's absolute €. Both move on
every fortnightly reload, and a leaderboard is supposed to reorder — that is the
one thing about it that is not a defect. Pin shares, classifications and
basis-agreement.

EIKs and node slugs are stable — use them as anchors.

## Phase 5 — Apply, regenerate, verify

- Regenerate the hub blob: `npm run db:gen-sector-stats` (needs PG up + `db:refresh`
  current). Confirm the audited sector moved the expected way and that no other
  sector shifted unexpectedly (diff old vs new `sector_stats.json`).
- Gates: `npx tsc -b` (NOT `tsc --noEmit -p tsconfig.json` — that compiles nothing),
  `npm run lint`, the touched vitest suites, and
  `npx vitest run scripts/db/tests/sector_stats.data.test.ts`.
- Live-check: `/governance/sectors` (the tile's number + caption) and the sector's
  screen (`to` route) on the dev server — KPI, awarders list, **the „Топ
  изпълнители" list** (read the top row as a sentence: is that who a reader would
  think the sector's money went to?), and any tile you touched. On a lazy-loaded
  tile a screenshot can come back blank at a scroll offset — read the rendered
  text and `getBoundingClientRect`/`visibility` via `javascript_tool` instead of
  concluding the tile is broken.
- `data/procurement/derived/sector_stats.json` is **bucket-served** (in the
  `bucket:sync` include-list alongside `hub_stats.json`), not Firebase-hosted.
  Deploy the blob with
  `npm run bucket:sync:paths -- procurement/derived/sector_stats.json`
  (plus any refreshed bespoke `data/<domain>/*.json`). Code changes (reference data,
  generator, screens) need the frontend deploy (`npm run deploy`); an engine/SQL
  change also needs the functions deploy (`firebase deploy --only functions`) and
  the `061` re-apply to Cloud SQL.

## Decision: auto-fix vs confirm

Produce a concise findings summary first (each issue: EUR + count impact, root
cause, proposed fix tier). Then:

- **If any fix is a Phase 3 tier-3 editorial/registry decision** — a new/changed
  basis, adding/removing a sector, an EIK-inclusion-boundary judgment, a new
  segmentation — **STOP and ask**, presenting the specific choice and its impact.
- **Otherwise** (clear bug fixes: a wrong/missing EIK, a hardcoded copy to repoint,
  a moved source-field, a lockstep drift, the regression tests) — **automatically
  proceed to fix via `/implement-plan`**, treating the audit's recommended fixes as
  the plan. Each fix is one step (implement → `/code-review` in a subagent →
  `/code-repair` → commit); the regression tests are their own step; regenerate +
  commit `sector_stats.json` alongside the code that produced it.

One sector fix = one focused change; keep the four EIK-set copies in lockstep and
commit the regenerated `sector_stats.json` with the code that changed it.
