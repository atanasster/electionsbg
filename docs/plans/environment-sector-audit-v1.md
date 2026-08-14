# Environment sector audit — fixes (v1)

Audit of `/governance/sectors` tile `environment` + `/sector/environment`, run 2026-08-13
against the live corpus (405,479 contracts). Method: `.claude/skills/audit-sectors`.

## What was already right (no action — pinned by the Tier 6 tests)

- **Phase 1**: the hub headline reproduces from PG **exactly at all 30 scopes**
  (`all` = €256,720,876 / 2,259 contracts; 16 year scopes; 13 parliament scopes). Tier 5
  then widens the group to €257,131,175 / 2,276 — the headline is budget-basis by then, so
  only the /sector/environment rollup moves.
- **Failure mode E**: all four EIK-set copies import `ENV_SECTOR_EIKS` — no copy
  hardcodes digits, so lockstep is structural.
- **C / D**: all 27 EIKs then in the set are real, correctly named and carry spend
  (28 after Tier 5 adds НДЕФ). A free-text sweep
  (`околна среда|екофонд|парк|басейнова|РИОСВ|метеорология|хидрология|отпадъц|екологи`)
  over every non-member awarder surfaced no misattributed body. The header's exclusions
  hold: the Шипка-Бузлуджа park-MUSEUM (000804161), the 9 природни паркове (ИАГ/МЗХ)
  and forestry are all correctly out.
- **O**: `awarder_group_model` total == the hub value exactly at `all`,
  `ns:2026_04_19`, `y:2025`; `byCpv` / `byUnit` / `byYear` reconcile to ±€5.
- **J**: top beneficiary 3.7% of `all` across 700 contractors — no dominated leaderboard.
- **K**: contracting-authority beneficiaries are 1.11% after the manual public/private
  pass (Топлофикация София 0.51%, БАН institutes). No state body near the top.
- **M**: consortium members sum exactly to `consortium_full_eur`; the 35 €0-member rows
  are correctly excluded from the supplier count by 061's guard.
- **P / Q**: intra-group circulation €197,615 = **0.08%** (МОСВ→НИМХ only); **0**
  self-contracting rows.

## Tier 1 — Basis: environment moves from `procurement` to `budget`  ✅ LANDED (b54514e8ac)

**Decision taken by the user 2026-08-13** (Phase 3 tier-3, editorial).

The procurement basis is arithmetically exact and materially misleading. On the DEFAULT
hub view (`ns:2026_04_19`) it renders:

| Sector | Headline | Basis |
|---|---|---|
| Енергетика | €274.0M | поръчки |
| Води | €157.0M | поръчки |
| Пътища | €115.7M | поръчки |
| **Околна среда** | **€1.81M** | **поръчки** |

against a €77,774,100 enacted МОСВ budget (2026) and a €3.19bn ОП „Околна среда"
grant envelope (€1.94bn paid). This is the Култура-€3k / МРРБ-pass-through shape
(Failure mode A). The ОПОС billions stay OUT of the headline deliberately — they are
disbursed by municipalities and ВиК, so crediting them here would double-count against
`/water` and the governance dashboards.

**Change** — `scripts/db/gen_procurement/sector_stats.ts`:
- remove `environment` from `SECTOR_EIKS`;
- add `environment: "admin-ministerstvo-na-okolnata-sreda-i-vodite"` to
  `BUDGET_SECTOR_NODE` (the constant already exists as `MOSV_BUDGET_NODE` in
  `src/lib/environmentReferenceData.ts` — import it, do not restate the slug);
- drop the now-unused `ENV_SECTOR_EIKS` import if nothing else in the file needs it.

`ENV_SECTOR_EIKS` stays the source of truth for the dashboard, the browse pack and the
group model — only the hub HEADLINE changes basis.

**Depends on Tier 2** (the МОСВ 2024 series is a different scope; without that fix the
`y:2024` scope publishes €104,230,071 instead of €60,325,488).

**What each of the 30 scopes publishes after the change** — three groups, not two:

- **Correct (23)**: `all`, all 13 `ns:*`, `y:2018`–`y:2023`, `y:2025`, `y:2026`. These
  resolve to a real МОСВ enacted year; `all` and every `ns:*` take the latest (2026 →
  €77,774,100).
- **`y:2011`–`y:2017` (7) — a real € becomes „няма данни за &lt;year&gt;".** The МОСВ node's
  series starts at FY2018 while the generator mints a `y:<year>` scope from 2011, so
  `annual()` sets `unavailable: true` and `formatSectorMetric` renders `"—"`. This is
  **not** a defect — `defense`, `culture` and `regional` already behave this way on those
  scopes, and a no-data notice beats a 2026 figure captioned 2011 — but it replaces the
  real per-year procurement € the tile shows today, so it is the one change a reader can
  notice, and it is now declared here and at the `BUDGET_SECTOR_NODE` call site.
- **`y:2024` (1) — ⚠️ KNOWN GAP, needs an operator action.** Tier 2's fix is INERT until
  `data/budget/ministries/` is re-minted: 0 of the 55 files carry `expenditureLaw` yet, so
  `ministryYearSeriesEur`'s `??` falls back to `expenditure` and this scope publishes
  **€104,230,071** instead of €60,325,488. It cannot be closed from this session —
  `npm run budget:ingest` dies at `data.egov.bg` with **HTTP 403** (the known egress-IP
  issue) — and prod reads the BUCKET copy regardless, so the close is:

```bash
npm run budget:ingest                                              # host with egov access — re-mints the tree
npm run budget:ingest -- --upload                                  # ministries/*.json → the bucket (the SPA reads it there)
npm run db:gen-sector-stats                                        # rewrites the committed sector_stats.json
npm run bucket:sync:paths -- procurement/derived/sector_stats.json # ⬅ the artifact is bucket-served, NOT hosted
npm run db:load:budget:pg                                          # (+ :cloud) picks up planned_law_eur
```

The fallback value is a real appropriation on a wider scope, not a fabricated one, so the
failure mode is "one scope reads consolidated" rather than a wrong number — but it is a
scope a reader can select, so it is a gap and not a nit.

## Tier 2 — The МОСВ budget SERIES mixes two scopes across years  ✅ LANDED (941bd2abce)

⚠️ **This is NOT a precedence bug in `reconcile.ts`.** Preferring the отчет's own „Закон"
column over `law_html.ts`'s ЗДБ value is deliberate, documented, and МОСВ 2024 is the
NAMED worked example (`scripts/budget/execution_facts.ts` header: „law_html €60M vs
отчет's „Закон" €104M"). Inside a reconciliation ROW it is correct — it keeps
law→amended→executed like-with-like.

The defect is that `MinistryRollup.years[].expenditure` is consumed as a **time series**,
and only the years with an ingested отчет carry the consolidated scope. Measured over the
whole facts tree, **МОСВ 2024 is the only ministry-year where the two scopes disagree**:

```
2024  ЗДБ 60,325,488 | отчет 104,230,071  (+72.8%)  ministerstvo-na-okolnata-sreda-i-vodite
```

Everywhere else they match to ≤€1 (МО 2024: 1,088,639,606 both sides). МОСВ's own отчет
programme rows sum to €60,325,488 — i.e. to the ЗДБ figure — so the ЗДБ scope is the one
the programme grain agrees with.

Consumers that read it as a series:
- `EnvironmentBudgetTile` — the 2024 bar is the chart's tallest, 34% above 2026;
- `BudgetMinistryScreen`'s year bars;
- `budgetSeries()` in the sector-stats generator — which Tier 1 turns into the headline.

**Change** — `scripts/budget/ministries.ts` `buildMinistryRollups`: carry the ЗДБ-scope
value alongside the restated one so a series consumer can stay single-scope, without
touching the reconciliation row's variance. Add `expenditureLaw: Money | null` to
`MinistryRollupYear` (`scripts/budget/types.ts`), populated from the `law-<year>`
document's admin-grain fact when it exists and differs; `expenditure` keeps today's
meaning so nothing else moves.

Then:
- `budgetSeries()` in `sector_stats.ts` reads `expenditureLaw ?? expenditure`;
- `EnvironmentBudgetTile` + `BudgetMinistryScreen`'s year bars plot the same,
  and the ministry screen keeps rendering `expenditure` in its reconciliation table.

## Tier 3 — Budget-law parser emits heading rows as programmes (systemic)  ✅ LANDED (0de88e2ad0)

`parseProgramTable` (`scripts/budget/law_html.ts`) accepts any row with a line code and a
name, so a GROUPING row is emitted as a sibling of its own children. When the group has
one child, the two carry an identical value and the programme list double-counts.

Measured across `data/budget/reconciliation/*/by-program.json` — 3 distinct heading
nodeIds, 32 rows:

| nodeId | rows | affected |
|---|---|---|
| `prog-drugi-byudzhetni-programi-obshto-v-t-ch` | 18 | МФ, МС, … |
| `prog-politika-…-darzhavnite-rezervi-…-obshto-v-t-ch` | 9 | ДА „Държавен резерв" |
| `prog-drugi-byudzhetni-programi` | 5 | **МОСВ 2022–2026** |

МОСВ 2026: Σprograms = €97,272,000 vs the €77,774,100 total → **+25.1%**, exactly the
duplicated метеорология line. ДА „Държавен резерв" is **+100.0%** every year 2018–2026
(a perfect double). Renders on `/budget/ministry/<node>` as both a list row and a band of
the stacked `ProgramTrendChart`, and lands in `budget_program_fact` (migration 153).

**Change, AS SHIPPED** — the name+amount rule this plan first proposed was dropped for a
purely STRUCTURAL one, which is exact rather than heuristic: the table is hierarchical
(`"3"` above `"3.1"`), so `parseProgramTable` emits only the LEAVES — any row with a
descendant is a subtotal. A name test cannot see a parent the law happened to name plainly,
and amount equality would keep a parent whose children fail to sum. Measured: 53
over-counting unit-years → 0, across every cached law.

Because the law's programme registry is ALSO the execution-report join key
(`execution_facts.ts` → `findProgramNode` matches by NAME and drops a miss with a bare
`continue`), dropping a subtotal deleted a name an отчет resolved through — МОСВ 2024
reports „Други бюджетни програми" at €14.31m executed and never names the leaf. So
`ParsedLawProgram` gained `aliases`: a subtotal with exactly ONE leaf beneath it folds its
name onto that leaf; a subtotal over SEVERAL leaves gets none, since its figure cannot be
attributed to one child.

Outputs are gitignored (`data/budget/{ministries,facts,reconciliation}` — 0 tracked
files each), so this commits CODE only; re-run `npm run budget:ingest` locally to verify
Σprograms == total.

## Tier 4 — Sector-screen fixes

**4a. CPV division 50 falls into the „Друго" sink** (`src/lib/environmentAttributes.ts`).
€8,338,646 / **3.25%** / 191 contracts — the largest CLASSIFIABLE block in `other`. (The
€8,638,383 of genuinely uncoded rows is larger still, but nothing can be done about it:
those contracts carry no CPV at all.) Div 50 is „Услуги по ремонт и поддръжка"; the
sibling transport classifier already maps it (`transportAttributes.ts:58`). Add `50` and
`48` (software, beside 72) to `services`, and mirror both into `CATEGORY_CPV_DIVS` so the
category deep-link keeps reproducing the split exactly. Cuts `other` 14.2% → ~10%.

**4b. Stale CPV-coverage comments** in two files —
`src/lib/environmentAttributes.ts:7` and
`src/screens/components/procurement/environment/EnvironmentCategoryTile.tsx:5`. Both state
coverage is ~40% of € and that „Друго" is "the LARGEST bucket by design". Measured
2026-08-13: **96.6% of € and 99.2% of rows carry a CPV; „Друго" is 14.2%**, the 5th bucket.
Nothing user-facing is wrong (the tile computes `cpvKnown` live) — but the comments now
argue against 4a and will mislead the next change. Restate with the measured figures and
the date.

**4c. Waste tile compares BG 2023 against EU 2024 with no year on the EU figure**
(`EnvironmentWasteTile.tsx`). `euLatest` takes the EU series' last point (2024, 48.1%)
while `latest` is BG's last (2023, 16.7%); both the „ЕС средно 48%" reference line and the
sentence „доста под средното за ЕС" carry no year. 0.2pp today; widens every year BG's
series lags. Fix: take the EU point at BG's latest year, falling back to the EU's own
latest **with the year rendered** when that year is absent.

## Tier 5 — Add НДЕФ to the EIK set  ✅ LANDED (this commit)

**Decision taken by the user.** `Национален доверителен екофонд` — EIK `121155866`,
17 contracts, €410,298, 2013-12-09 → 2026-02-09. An МОСВ-adjacent fund created by
ЗООС чл. 67. Add to `ENV_ENTITIES` with `universe: "fund"` (beside ПУДООС); it propagates
to all four copies through `ENV_SECTOR_EIKS`. Moves the group rollup +0.16% at `all` and
does not touch the hub headline (now budget-basis).

Note in the file header that ДП „Радиоактивни отпадъци" (`131218471`, €47.06M /
478 contracts) is deliberately NOT here — it sits under the Minister of Energy.

**RESOLVED 2026-08-13 — the energy-side gap is closed, and the citation above was
wrong.** ДП РАО is created under **ЗБИЯЕ чл. 78, ал. 1** (not чл. 71) as a чл. 62,
ал. 3 ТЗ state enterprise. The substantive reading held: its принципал is the
Minister of Energy, verified against the Правилник за устройството и дейността на
ДП РАО — the minister утвърждава its устройствен правилник and the УС working
rules, appoints the substitute representative and receives the annual отчет, and
both funding funds (фонд РАО, фонд ИЕЯС) are „към министъра на енергетиката".

It is now in `ENERGY_SECTOR_EIKS` **and** `ENERGY_MEMBER_EIKS` (`universe: "waste"`),
so it belongs to exactly one sector. Three notes for anyone re-reading this:

- **Both sides, deliberately.** Hub-only would have put a €47M wedge between the
  hub headline and the /sector/energy dashboard — 47x the €1M materiality line the
  existing "hub/dashboard gap stays immaterial" gate enforces. It is excluded from
  `ENERGY_ALIAS_EIKS`, which is the narrower БЕХ *holding* fan-out: ДП РАО is under
  МЕ directly and is not a БЕХ subsidiary.
- **The sector was relabelled БЕХ → МЕ**, in both `SECTOR_DASHBOARDS.energy.agency`
  and `sectorRegistry.ts` — a fifth copy that no gate held, found only by grepping
  the literal. `src/screens/sector/sectorConfigLockstep.test.ts` now pins the pair.
- **Impact is immaterial by design**: 0.46% at `all`, 0.18%–1.86% in every year, so
  it moves no headline. It was added because a €47M state energy buyer belonged to
  no sector at all — not to change a number.

Two side effects worth knowing: energy crossed `MEMBER_SEARCH_MIN` (9 → 10 members)
and so gained a member search box, which is the auto-mount behaving as designed; and
the sector's name-plausibility gate needed the „радиоактивн" stem, because ДП РАО is
the one member whose energy membership is **not legible from its name** — the
attribution is by principal, which no name regex can confirm.

## Tier 6 — Regression tests

Write them in a **NEW** file, `scripts/db/tests/sector_stats_environment.data.test.ts`,
rather than extending `sector_stats.data.test.ts` — a concurrent session had uncommitted
work in that file when this was written (the ДП РАО energy attribution, since committed as
dbff131d02), and a path-scoped commit would have carried it under this change's message.
A separate file also keeps the environment gates readable as one block. Bands and inequalities only: the corpus reloads fortnightly
and budgets gain years.

1. **EIK-set lockstep** — `SECTOR_DASHBOARDS.environment.members.map(m => m.eik)`,
   `SECTOR_BROWSE_PACKS.environment.eiks` and `ENV_SECTOR_EIKS` are the same set.
   ⚠️ The generator's `SECTOR_EIKS` **cannot** be asserted directly: it is module-private,
   and `sector_stats.ts` self-executes `main()` (Postgres + `process.exit(0)`) on import,
   which would kill the vitest worker. Assert the OUTPUT instead — item 4's
   `basis === 'budget'` is that guard, and it also catches a stale artifact, which a
   source-level check would not.
2. **Anti-allowlist** — `131218471` (ДП РАО), `000804161` (Шипка-Бузлуджа museum) and
   `121486802` (ИА по горите) are absent from `ENV_ENTITIES`.
3. **Signature members present with spend > floor** — `MOSV_EIK`, `IAOS_EIK`,
   `PUDOOS_EIK`, and the new НДЕФ `121155866`.
4. **Basis + value band** — `sector_stats.json.all.environment.basis === 'budget'`
   **unconditionally** (it reads only the committed artifact, and an unregenerated
   artifact is exactly the state it exists to catch), plus `value` within a band of the
   МОСВ node's resolved-year `expenditureLaw ?? expenditure`. The band half reads the
   GITIGNORED ministries tree, so gate that half with `existsSync` → `test.skipIf`, the
   same absent-tolerance `loadBudgetSeries` uses.
5. **Failure mode O** — Σ of `awarder_group_model`'s per-contractor rollup for a scope
   equals its `totalEur` (both halves are individually correct, so no other gate sees a
   basis split).
6. **Beneficiary side** — top-contractor share at `all` stays under 15% (today 3.7%; a
   rollup change that credits a consortium's full value to every member shows up as a
   share, not just a total), and intra-group circulation stays under 2% of the group.
7. **Budget programme integrity** (Tier 3) — for every ministry-year, Σ`programs` does
   not EXCEED the year's total. Inequality, not equality: ДФЗ legitimately publishes a
   partial programme list (−91%), so only the over-count direction is a defect.

Do NOT pin a beneficiary's rank or a contractor's absolute €.

## Tier 7 — Regenerate + verify

- `npm run budget:ingest` (Tier 3 output) → confirm Σprograms ≤ total everywhere and
  that МОСВ 2024 carries both scopes.
- `npm run db:gen-sector-stats` → then a SEMANTIC diff. A textual one is useless here:
  the artifact is written with `JSON.stringify(out, null, 0)`, so all 46 KB is one line,
  and moving `environment` between the procurement and budget blocks reorders keys in all
  30 scope objects even where values are identical. Compare per (scope, sector):

  ```bash
  git show HEAD:data/procurement/derived/sector_stats.json > /tmp/ss_before.json
  npm run db:gen-sector-stats
  node -e '
    const a=require("/tmp/ss_before.json"), b=require("./data/procurement/derived/sector_stats.json");
    for (const scope of Object.keys(b))
      for (const s of Object.keys(b[scope]))
        if (s !== "environment" && JSON.stringify(a[scope]?.[s]) !== JSON.stringify(b[scope][s]))
          console.log("UNEXPECTED", scope, s, a[scope]?.[s], "->", b[scope][s]);
    console.log("done");'
  ```

  Expect `environment` to move on every scope (procurement € → budget €, `basis`/`year`
  appear, and `unavailable: true` on `y:2011`–`y:2017`) and nothing else — **except** the
  `energy` entries, if the concurrent ДП РАО change is still uncommitted when this runs.
- Gates: `npx tsc -b`, `npm run lint`, the touched vitest suites,
  `npx vitest run scripts/db/tests/sector_stats.data.test.ts`.
- Live-check `/governance/sectors` (the tile's number + caption reads „бюджет 2026") and
  `/sector/environment` (KPI row, category tile's coverage %, waste tile's years, the
  „Топ изпълнители" list read as a sentence).
- `data/procurement/derived/sector_stats.json` is bucket-served — deploy with
  `npm run bucket:sync:paths -- procurement/derived/sector_stats.json`. Code changes need
  `npm run deploy`.
