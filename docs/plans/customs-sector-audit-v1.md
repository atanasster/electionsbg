# Customs (Агенция „Митници") sector audit — v1

Audit of `/governance/sectors` tile `customs` + the `/sector/customs` dashboard
(CustomsPack) + `/customs/warehouses`, run 2026-08-19 via `/audit-sectors`.
Sibling of `revenue-sector-audit-v1.md` (same day, same shape: a second-level
agency with a budget-basis headline and a collector-first pack).

## What reconciled (no action)

- **Headline.** `sector_stats.json[*].customs` = `data/budget/agencies/customs.json`
  `expenditure.amountEur` EXACTLY at all 30 scopes — 2021 €90,410,863 / 2022
  €101,135,597 / 2023 €102,850,691 / 2024 €126,935,890 / 2025 €183,112,782,
  `basis:'budget'`, `note:'adjusted'`, `unavailable` correctly set on y:2011–2020
  and y:2026. Verified live: `?pscope=y:2015` renders „НЯМА ДАННИ ЗА 2015" rather
  than a silent fall-back. BGN→EUR is the locked peg on every year (max residual
  €0.38).
- **EIK-set.** Митници is ONE legal person in this corpus — 1,222 contracts,
  €262,043,618 all-time. A `%митни%` sweep over every awarder returns exactly one
  EIK, and the territorial units award under it (`Агенция "Митници", ТМУ - Митница
  Югозападна, гр. Благоевград`; `Териториална дирекция Северна морска, гр. Варна`),
  so no sibling body is missing and nothing foreign is leaking in. No
  `000627597*` branch-EIK variants. Three copies (SECTOR_DASHBOARDS.customs.members,
  SECTOR_BROWSE_PACKS.customs.eiks, PACKS) all import one `CUSTOMS_EIK`; the
  generator correctly has no `SECTOR_EIKS.customs`, because the basis is budget.
- **Beneficiaries.** 0 self-deals, 0 NULL amounts, 14 consortium rows handled
  correctly (carrier holds the full value, every member row €0 — no double count).
  Intra-group circulation is structurally impossible on a single-EIK sector. The
  largest single-bid awards are Чл. 79, ал. 1, т. 3, б. „в" exclusive-rights IT
  maintenance, not competition failures.
- **Revenue composition.** 2024 reconciles to the euro (Σ parts == `total_collected`);
  2022 and 2023 to −€51k on €6.4–6.9bn. `customsByCountry` shares are a declared
  top-5, not a partition.
- **Warehouse map.** 355 warehouses across 294 active operators; 350 plotted and
  the caption says „Показани 350 склада" — it names the shown count, not the total.

## Findings

### F1 — the excise register's `procurementEur` counts contract AMENDMENTS (real bug)

`scripts/customs/excise_register.ts:316` reads `contracts_list` with **no
`tag = 'contract'` filter**. `contracts_list` is `SELECT c.*` over `contracts`
plus appeal/risk joins — it carries `contractAmendment` rows (3,488 corpus-wide).
Every other money surface in the repo filters the tag; `rollups.ts` excludes
amendments from every money rollup and every serving SUM filters it.

Measured over the register's 564 EIKs:

| basis | rows | € |
|---|---|---|
| what the file stores (all tags) | 6,054 | 2,258,140,841 |
| `tag='contract'` (correct) | 6,040 | 2,251,361,777 |
| **amendments wrongly included** | **14** | **6,779,063** |

Concentrated on one row of the rendered top-10:

| operator | shown | true | delta | contracts shown / true |
|---|---|---|---|---|
| Петрол АД | €516,507,722 | €512,950,100 | +€3,557,622 (+0.69%) | **2,199 / 2,191** |
| ЕКО БЪЛГАРИЯ ЕАД | €33,466,570 | €33,394,989 | +€71,581 | 63 / 62 |

Both surfaces render it — the pack's register band and `/customs/warehouses` —
and both captions say „Подредени по стойност на спечелените обществени поръчки".

Secondary, same query: **48 consortium-MEMBER rows** join in. They carry
`amount_eur = 0`, so they move no money, but they inflate `contractCount` — an
operator that was one member of a consortium is credited a „обществена поръчка"
worth €0 to it.

**Fix (tier 1):** filter `tag = 'contract'` in the ingest query, decide the
consortium-member rows (exclude `consortium_role = 'member'`, matching the
site-wide rollup basis), re-run `scripts/customs/excise_register.ts`, commit the
regenerated `data/customs/excise_register.json`.

### F2 — `/sector/customs` renders a scope control that changes nothing (real bug, shared with `/sector/revenue`) — DECISION OPEN

`SectorDashboardScreen` renders `<ScopeControl mode="toggle" />` unconditionally,
above the pack. `CustomsPack` and `NapPack` are the **only two** packs in
`PACKS` whose component signature takes no props — both are
`FC<SectorPackProps> = () => {…}` and ignore `scopeWindow` entirely, driving off
their own year buttons instead (customs 2022–2025, НАП 2021–2026).

Verified live on the dev server:

| URL | pill reads | page reads |
|---|---|---|
| `/sector/customs` | „Този парламент · 2026-04-19" | „…митническите приходи (**2025**)" €7,4 млрд. |
| `/sector/customs?pscope=y:2022` | „**2022**" | „…митническите приходи (**2025**)" €7,4 млрд. |
| `/sector/revenue?pscope=y:2013` | „**2013**" | „Откъде идват данъчните приходи" **2026\*** €11,4 млрд. |

This is the case CLAUDE.md's URL-contract section forbids in as many words:
„What no page may do is show one window and count another." `?pscope` is in the
`usePreserveParams` allowlist, so any in-app link mints a scope on a page that
cannot serve it — and the pill then contradicts every number under it.

**DECIDED 2026-08-19 (operator): WIRE THE SCOPE IN.** One control, one value —
the pattern CLAUDE.md prescribes and `/culture` and `/subsidies` already use.

⚠️ **The control has to move INTO the pack, and that is forced by the data, not a
preference.** Neither pack's year list is static: `useCustoms()` returns only the
years whose breakdown file actually fetched, and `useNap()` derives its years from
`kfp.json`'s snapshots. `useScope(support)` clamps against `support.years`, so a
screen-level control would have to resolve against a year list it cannot know until
the pack's own query lands — which is exactly the "picker and numbers disagree"
state this fixes. So the pack owns the control and the screen suppresses its own,
leaving the page with exactly one.

`allowAll: false` on both: each year is a separate file (customs) or snapshot
(НАП) and there is no cross-year aggregate to render — the same reason the
judiciary caseload turns it off, per `ScopeControl`'s own header. `ns` has no
per-parliament slice here either, so it is relabelled „Последна година" /
"Latest year" via `nsLabelOverride`, the case that prop was added for.

Both packs already return a loading skeleton before any of this renders, so the
`years=[]` first pass cannot flash a clamped pill at the reader.

### F3 — the hub tile promises „договори" and the destination has none — DECISION OPEN

`sector_customs_desc` = „Акцизи · внос · **договори**" / "Excise · imports ·
**contracts**". Verified live, the tile renders exactly that under
„€183,1 млн. БЮДЖЕТ 2025 · ГУП".

`/sector/customs` renders no contracts at all. `SectorDashboardScreen`'s
pack branch (`Pack ? … : …`) skips the KPI row, `SectorTopContractorsTile`,
`SectorSpendByYearTile`, `SectorAwardersTile` **and** the
`/procurement/contracts?sector=customs` drill-down; `useAwarderGroupModel` is
disabled (`enabled: !Pack`). The pack's own header says so — „the small ЗОП
buy-side already sits on the generic awarder page below" — which is true of
`/awarder/000627597`, the page the pack was written for, and not of
`/sector/customs`, where the registry points.

The buy-side is real and unreachable from this page: €262.0M over 1,222
contracts, and `/procurement/contracts?sector=customs` works (verified: 28 rows
in the current parliament, filtered to „Митници (АМ)").

`revenue` is identical („Събираемост · ДДС · **договори**", NapPack renders no
contract tiles either).

**DECIDED 2026-08-19 (operator): FIX THE PAGE.** Give the pack branch the
contracts drill-down it lost, so the caption becomes true by surfacing the
€262.0M rather than by deleting the word.

Scope of the change: the **drill-down link only**, not the 4-KPI row. The KPI row
needs `useAwarderGroupModel`, which the pack branch disables (`enabled: !Pack`) —
re-enabling it would add a group-model fetch to every one of the 12 pack-backed
sector pages to render four numbers the pack deliberately reframes. The link is
free, and `contractsTo` is already computed above the branch for the non-pack
side, so no new seam. Verified: all 14 `SECTOR_DASHBOARDS` entries have a
`SECTOR_BROWSE_PACKS` entry under their `browsePackId`, so `?sector=<id>` resolves
for every one of them; `/procurement/contracts?sector=customs` renders „са само
поръчките на: Митници (АМ)" with the expected 28 rows on the current parliament.

### F4 — the 2025 revenue file drops `fines_total`, and the residual is 2.6× it (small)

| year | `total_collected` | Σ(4 lines) | gap | `fines_total` |
|---|---|---|---|---|
| 2022 | 6,850,135,237 | 6,850,186,366 | −51,129 | 3,016,622 |
| 2023 | 6,392,273,357 | 6,392,324,487 | −51,130 | 5,112,919 |
| 2024 | 7,057,412,965 | 7,057,412,965 | **0** | 4,141,464 |
| 2025 | 7,427,792,804 | 7,417,055,674 | **+10,737,130 (0.145%)** | **null** |

`customsReferenceData.ts` already documents the missing fines line as graceful,
and it is — `RevenueCompositionBar` computes its percentages over Σ(shown
segments), so the bar reads 100% and nothing on screen is false. But €10.7M is
2.6× 2024's fines, so the residual is not only the fines line, and the newest
year is the one that no longer reconciles to its own headline.

Not fixed here: recovering it needs the 2025 Митническа хроника, which is a
hand-curated `update-budget` input with no ingest script in the repo. Recorded so
the next refresh of that file knows to look.

### F5 — `customs` appears in no data test

Same gap `revenue` carried until this morning. Nothing pins the basis, the
`note`, the year/`unavailable` resolution, the single-EIK lockstep, an
anti-allowlist, or the register's money basis.

## Reported, not a customs fix

- **Empty `contractor_eik` — 622 rows / €210,019,368 corpus-wide**, essentially
  all from the `eop-` flat feed. One is Митници's: **„Georgi hristozov",
  €2,556,459** (BGN 5,000,000 exactly), a 2025-08-01 „Вътрешен конкурентен избор
  по РС" for fuel — i.e. the **#4 beneficiary of y:2025 at 8.4%** and #5 of
  ns:2024_10_27 at 6.6%. A person's name, with no key, on a sector's top-5
  supplier list. `supplier_identity.ts` mints `np-`/`ph-` synthetic keys for
  exactly this shape and did not fire. Cross-sector ingest defect; fix belongs in
  the ЦАИС parse, never here.
- **Current-parliament concentration.** ns:2026_04_19 is €8,211,195 over 28 rows
  with А1 България at **68.3% in one contract**. A property of a four-month
  window. No leaderboard renders it today (F3), so there is no caption to qualify
  yet — but if F3 is fixed by showing contracts, this is the row that needs the
  share stated.
- **Category strip.** 94 + 25 + 205 + 38 = 362 against 294 active operators (51
  hold more than one category). A labelled count list under a „(294)" heading, no
  total claimed — acceptable, worth not turning into a percentage.
- **The 2025 АМ budget is +44% YoY** (BGN 248,265,021 → 358,137,473) against
  НАП's +17%. It reconciles to the committed file exactly; the file is
  hand-curated (no ingest script writes `data/budget/agencies/customs.json`) and
  the underlying форма Б-3 report is not verifiable from the repo. Worth an
  eyeball at the next `update-budget`.

## Plan

### Step 1 — money basis in the excise-register ingest (F1)

`scripts/customs/excise_register.ts`: add `and tag = 'contract'` and
`and coalesce(consortium_role,'') <> 'member'` to the enrichment query, with a
comment naming the two things `contracts_list` does NOT filter and the measured
size of each. Re-run the ingest, commit the regenerated
`data/customs/excise_register.json` with it.

### Step 2 — one honest scope control per pack page (F2)

- `src/screens/sector/sectorDashboards.ts`: add `packOwnsScope?: boolean` to
  `SectorDashboardConfig`, set on `customs` and `revenue`, with a comment naming
  why the years cannot live in config.
- `src/screens/sector/SectorDashboardScreen.tsx`: suppress the shared
  `<ScopeControl>` when `Pack && config.packOwnsScope`. Every other sector keeps
  the control in the same slot.
- `src/screens/components/procurement/customs/CustomsPack.tsx` and
  `.../nap/NapPack.tsx`: replace the local `yearOverride` state with
  `useScope({ years, allowAll: false })`, render `<ScopeControl mode="toggle"
  value={scope} onChange={setScope} years={years} allowAll={false}
  nsLabelOverride=… />` at the top of the section, and drop the bespoke year
  button rows. `scopeYear(scope) ?? years[0]` is the selected year, so „Последна
  година" and an explicit `y:<year>` are one code path.

### Step 3 — the contracts drill-down on pack pages (F3)

`src/screens/sector/SectorDashboardScreen.tsx`: render a compact link to
`contractsTo` (`/procurement/contracts?sector=<browsePackId>`, carrying the
current search) inside the `Pack` branch, under the pack. Wording names the
buy-side explicitly („Обществените поръчки на …") so it cannot be read as part of
the pack's revenue framing. No new fetch, no `useAwarderGroupModel`.

### Step 4 — regression net (F5)

`scripts/db/tests/sector_stats_customs.data.test.ts`, following the
`sector_stats_revenue` convention:

- BASIS — `basis === 'budget'`, `note === 'adjusted'`, EXACT reconcile against
  `agencies/customs.json` on value + year + `unavailable` across all 30 scopes.
- GENERATOR — `AGENCY_BUDGET_FILE` keeps its `customs` key (that map is what makes
  the tile budget-basis; drop it and the tile falls back to €262M of whole-corpus
  procurement against one year of budget — the Култура €3k failure in a new place).
- EIK-SET — lockstep across the three copies, `CUSTOMS_EIK` is a real awarder above
  a floor, plus an ANTI-allowlist pinning the bodies a name sweep would pull in
  (`101522447` МБАЛ „Югозападна болница" €10.7M, `175685416` the ЮНЕСКО centre) are
  NOT members.
- REGISTER MONEY BASIS — the gate on F1: for a sample of register operators, the
  stored `procurementEur` must equal the `tag='contract'`, non-member SUM, with a
  mutation check (the unfiltered SUM must differ) so the assertion cannot be
  satisfied by an implementation that dropped the filter.
- COMPOSITION — every `revenue_breakdown/customs/*.json`'s Σ(4 lines) is within
  0.2% of `total_collected`, so a future year losing a second line fails.
- BENEFICIARY — top-contractor SHARE ceiling on the `all` scope (currently 17.5%,
  assert < 45%), never a rank or an absolute €.

### Not doing

- No change to `sector_stats.json` — the headline is budget-basis and reconciles
  exactly; nothing in this audit moves it, so **no regeneration and no
  bucket-sync**.
- No change to the EIK set, the registry, or the basis.
- No `fines_total` backfill (F4) — needs the source document, not code.
- No per-sector handling of the empty-`contractor_eik` class.
