# /sector/security (Сигурност / МВР) audit — v1

Audit run 2026-08-19 via `/audit-sectors sector/security`. Sector id `security`,
basis `budget`, route `/sector/security` (generic `SectorDashboardScreen` rendering
`MvrPack` via `leadEik = MVR_EIK`).

## What reconciled (no action)

- **Headline.** `sector_stats.json[*].security` equals
  `data/budget/ministries/admin-ministerstvo-na-vatreshnite-raboti.json`
  `years[fiscalYear].expenditure.amountEur` **exactly at all 9 fiscal years**
  (2018 €662,838,795 → 2026 €2,115,233,200), and each year's expenditure also
  equals the sum of that year's four programme lines. The 2024→2025 +49% jump is
  real — all four programmes rise together (×1.26–×1.67), the 2025 wage
  indexation. `y:2011`–`y:2017` correctly carry `unavailable`. The hub caption
  names the year ("бюджет 2026").
- **EIK-set.** 74 EIKs, no duplicates, every one a genuinely МВР body in the
  corpus (€2,205,602,921 / 7,498 contracts all-scope). No leakage: the МЮ
  penitentiary units, ДАНС, ДАТО, КПКОНПИ, ДКСИ and ЦППКОП named in the
  anti-allowlist are all out — ЦППКОП (176073030) surfaces in a name sweep and is
  correctly excluded. A free-text sweep for МВР-shaped names across every awarder
  in the corpus found **no missing sibling**.
- **Copy lockstep.** Every copy derives from `MVR_ENTITIES` / `SECURITY_SECTOR_EIKS`
  (`sectorDashboards.ts`, `sectorPacks.tsx`, `load_mvr_directorate_map_pg.ts`).
  The generator's `SECTOR_EIKS` correctly omits `security` — it is budget-basis.
- **Beneficiary side.** All-scope top supplier is 5.9% (healthy spread); no
  state-body dominance (the largest public-body contractor is Топлофикация София
  at 1.48%, i.e. МВР paying its heating bills); intra-group circulation is
  €14,941; no consortium double-count (061's `consortium_role <> 'member'` and
  `contractor_eik <> awarder_eik` guards both hold); ranking is by EIK.

## Step 1 — F1: a consortium carrier HAS a company page, and we stopped linking it

`isLinkableCompanyKey` is `/^(\d{9}|\d{13})$/`, so `CompanyLink` renders every
`obed-` / `ph-` / `np-` / odd key as plain text. Its stated premise — that
`/company/:key` renders „Няма фирма с ЕИК … в базата." — was **already six weeks
stale when it was written**: `8c8b9a9654` (2026-07-06) gave `/company/:eik` a
procurement-only body, and the dead-end branch now fires only on
`!company && !institution && !hasProcurement` (`CompanyDbScreen.tsx:867`), which a
key drawn from `contracts.contractor_eik` can never reach.

Verified live: `/company/obed-76634551a3a1` serves the supplier name, an explicit
„Няма запис от Търговския регистър…" notice, scoped procurement, top contracts,
top awarders, CPV rank, geography — **and a dedicated „Обединение — участници"
block naming the three member firms**, which is content no other key kind has.

Live consequence on `/sector/security` at the default scope: the two biggest
contracts of this parliament (€15,332,565 + €5,129,206, the Bulgarian-Turkish
border surveillance system — 38.5% of the window) show their contractor as dead
text in `MvrTopContractsTile`, while `VikContractorHhiTile` links the *same*
consortium successfully two sections below. One page, two answers about one
supplier.

**Decided 2026-08-19: widen to `obed-` only.** Consortium carriers get their link
back (1,626 keys, €6.21bn); `ph-` (filler registration number), `np-` (natural
person) and the 281 odd keys stay plain text — their page is thin, shows €0 in
several cases, and the key is not an identifier a reader can check anywhere. That
is a narrower rule than „whatever the page can serve", and deliberately so.

- `isLinkableCompanyKey` admits `isConsortiumCarrierKey(eik)` as well as the
  9/13-digit forms. Reuse the existing predicate rather than re-testing the
  prefix — it is already the one definition of „this row is several firms".
- Rewrite the header of `src/lib/companyKey.ts`: the „0 resolve" / „Няма фирма с
  ЕИК" claim is false for every one of the 2,085 and must not survive. State
  instead what the page actually does, why `obed-` is in and the other two
  namespaces are out, and cite `CompanyDbScreen.tsx`'s branch condition so the
  next reader can re-check it in one grep.
- `companyKey.test.ts`: pin that an `obed-` key is linkable and that `ph-` / `np-`
  / a bare `1234` / a letter-bearing key are not — with the reason in the test
  name, so a later „simplify the regex" cannot silently re-collapse the three.
- `CompanyLink` needs no change; its non-link branch keeps stripping affordance.

## Step 2 — F2: the iceberg divides a scoped numerator by an unscoped denominator

`MvrBudgetBridgeTile` takes a scope-windowed `procEur` and always
`years[years.length - 1]` for the budget. At `?pscope=y:2018` it renders
„€77,5 млн. на година … ~4% от този бюджет"; against 2018's own budget
(€662,838,795) the true share is **11.7%** — understated 3.2×. The error always
runs one way: it understates the competed share, i.e. always exaggerates the
tile's own „iceberg" thesis.

- Add an optional `budgetYear` prop; select that year from the series and fall
  back to the latest when it is absent (2011–2017 have no МВР node data).
- `MvrPack` passes `budgetYear={procSpan?.to ?? null}` — the LAST year of the
  active scope window, clamped into the series. One rule for every scope: `y:2018`
  → 2018, a multi-year `ns:` window → its last year, `all` → latest (today's
  behaviour, which is what its copy already says).
- The caption already prints „общ бюджет на МВР, <year> г." and the growth bar
  already highlights `latest`; both must now follow the SELECTED year, or the
  fix moves the number and leaves the label behind.
- Accepted limitation, stated in the tile's header: on a multi-year scope the
  numerator is an annual average and the denominator is one year's budget. That
  is much smaller than the 3.2× it replaces, and the caption names the year.
- The four sibling bridge tiles (defense / nzok / social / vss) have the same
  shape. Out of scope here — noted so the next sector audit does not re-derive it.

## Step 3 — F3: `unitCount={74}` contradicts the page and the prop's own contract

`PackFootnote`'s prop is documented „How many units of the group actually have
contracts in scope." `MvrPack` passes the hardcoded roster size. Live at the
default scope the footnote reads „Консолидиран изглед по 74 структури … (€53,2
млн.)" while the KPI above it reads „Структури с договори: **23**" — the same page,
two counts, and the footnote's is beside the scoped €.

- `unitCount={units.length}`, matching transport / environment / regional.
- Drops the hardcoded 74 at the same time, so a roster edit cannot drift it.
- `DefensePack` has the same `unitCount={25}`; left alone (that tree has
  uncommitted work in it) and recorded here.

## Step 4 — F4: label the contractors that are the state paying itself

`MvrPack` passes neither `memberEiks` nor `stateBodyEiks` to
`VikContractorHhiTile`, so no „в групата" / „държавно" chip ever fires on
`/sector/security` and the market-only HHI line never appears. Water, transport,
environment and social all pass them.

- `memberEiks={SECURITY_SECTOR_EIKS}` — cheap and certain. Intra-group is only
  €14,941, so this changes no displayed row today; it is the tripwire for a future
  roster that folds in a state company.
- `SECURITY_STATE_BODY_CONTRACTORS` in `securityReferenceData.ts`, curated by EIK
  with the ownership named per row, covering the public bodies that actually reach
  a displayed rank: Топлофикация София ЕАД `831609046` (100% Столична община,
  €32.6M — #4 at the default scope), Български пощи ЕАД `121396123` (100% state,
  €6.87M), Информационно обслужване АД `831641791` (majority state, €4.07M).
- ⚠ It must stay a curated list. The „contractor is also an awarder somewhere"
  probe returns ЕВН, Овергаз, Софийска вода and the privately-operated
  Топлофикации alongside the genuinely public ones — measured on water, 44% of
  that probe's own answer was private. The list covers top-8 reach, not the whole
  contractor set, and its header says so.

## Step 5 — F5: the „~90%" payroll estimate exists twice on one page

`securityPersonnel.ts` documents `personnelShareEst` as „Shared with the iceberg
budget-bridge tile"; that tile declares its own `const PERSONNEL_SHARE_EST = 0.9`.
Two constants, one claimed estimate, two tiles on the same page.

- `MvrBudgetBridgeTile` imports `MVR_PERSONNEL.personnelShareEst` and deletes its
  local copy, making the docstring true.

## Step 6 — F6: the health category names an entity for a CPV bucket

`CATEGORY_LABEL.health` is „Медицина (Мед. институт)" but the row is CPV-33 across
the whole group. Live at the default scope the page shows the KPI „От което Мед.
институт **9%**" (€4,987,044, awarder basis) and the category row „Медицина (Мед.
институт) €1,2 млн. **2%**" (CPV basis) — same parenthetical name, 4× apart.
Measured: CPV-33 is 89.5% the Institute, but the Institute's own spend is only 21%
CPV-33 (€101.2M of €166.4M all-scope is CPV-33; it also buys construction, fuel
and IT). Every other row in that list is CPV-named.

- Rename to „Медицина и консумативи" / „Medical & consumables". Copy only; the
  classifier, the CPV divisions and the deep-link are untouched.

## Step 7 — regression tests

New `scripts/db/tests/sector_stats_security.data.test.ts`, modelled on
`sector_stats_environment.data.test.ts` (auto-skips when Postgres is down). Bands
and inequalities only — the corpus grows fortnightly and budgets gain years.

- The three EIK-set copies are the SAME SET: `SECURITY_SECTOR_EIKS`,
  `SECTOR_DASHBOARDS.security.members.map(m => m.eik)`,
  `SECTOR_BROWSE_PACKS.security.eiks`. This is the drift tripwire.
- The anti-allowlist holds: ГД „Изпълнение на наказанията" `129010029`, Фонд
  затворно дело `129009070`, ГД „Охрана" `129010011`, ДАНС `129009710`, ДАТО
  `129010090`, КПКОНПИ `129010997`, ЦППКОП `176073030` are each absent from
  `MVR_ENTITIES` — and each is asserted to be a real, sizeable awarder in the
  corpus, so the test cannot go vacuous if an EIK is retired.
- Signature true members are present and above a € floor: МВР `000695235`, ГДГП
  `129010125`, ДУССД `129010157`, Медицински институт `129007218`.
- `basis === 'budget'` at every scope, and the `all` value equals the budget
  node's resolved year to the euro (this one CAN be exact — it is a file lookup,
  not an aggregate).
- Group procurement € band for `all`, wide enough to grow: floor catches an
  over-trim or a zeroed roster, ceiling catches EIK re-leakage.
- **Beneficiary side:** the all-scope top contractor stays under 15% of the
  attributed total (it is 5.9% today) — so a rollup change that starts crediting
  a consortium's full value to every member shows up as a share, not just a total.
- **Beneficiary side:** the three `SECURITY_STATE_BODY_CONTRACTORS` EIKs are each
  still contractors to the group with € > 0 — the beneficiary twin of the
  anti-allowlist, so a later „clean up the leaderboard" cannot quietly turn a
  state transfer back into an apparent private vendor.
- **Beneficiary side:** at least one `obed-` carrier is among the group's top
  contractors AND `isLinkableCompanyKey` returns true for it — the pin that keeps
  Step 1 from being undone by a regex simplification.
- The leaderboard basis equals the group basis: Σ of the per-contractor rollup
  (under 061's two exclusion rules) plus the unattributed rows equals the group's
  windowed Σ `amount_eur`.

## Not fixed here (reported)

- **Corpus artifacts, cross-sector.** One self-deal row — СДВР's own EIK
  `129009938` in the contractor field of a „ТОП ЕЛАНА ООД" contract whose real EIK
  is `131555677`, €14,941; already excluded from `suppliers` by 061, still in the
  totals. Nine rows with no contractor EIK, €19.3M, including €7,669,378 booked to
  „Maja marković" (a person's name in the supplier field) and €10,225,838 to
  „Леонардо Белгия АД". Ingest-side if anywhere, never per-sector.
- **Consortium understatement.** Ссарм ЕООД shows €1.49M standalone at the default
  scope while its carrier positions add €20.46M — the e-gov shape recorded in
  `isConsortiumCarrierKey`'s header. Closing it needs `consortium_role` projected
  out of 061's `sup` CTE into `AwarderModel`; unchanged here.
- **The transparency tile's 45/55 bar** is a hardcoded, explicitly-labelled
  non-measured split. Left as is — the classified share has no published €, and
  the tile says so — but a fixed width is still a visual quantity claim.
