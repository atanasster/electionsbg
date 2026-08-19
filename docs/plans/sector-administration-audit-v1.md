# /sector/administration audit — v1

Audit of the `administration` sector (hub tile on `/governance/sectors` + the
bespoke `/sector/administration` screen) against the raw sources, both sides of
the money. Run 2026-08-19 against local PG (`electionsbg-pg` :5433) and the live
dev server.

## Status

Implemented across single-step commits on 2026-08-19; each tier below carries its
own marker. Update the marker in the same commit as the step, so this document
never asserts a finding the tree beside it has not acted on.

| tier / step | state |
|---|---|
| T1 · add ЕСМИС | ✅ shipped |
| T1 · `MINISTRY_NAMES` `-то` | ✅ shipped (folded into the ЕСМИС commit by review) |
| T1 · `ADMIN_EIK` repoint | ✅ shipped (same) |
| T2 · `stateBodyEiks` + `ADMIN_STATE_BODY_CONTRACTORS` | ✅ shipped (7123b688eb) |
| T2 · money band scoped to the year | ✅ shipped |
| T2 · `parseStructureCounts` label strip | ✅ shipped (inert until the ingest re-runs) |
| T4 · `sector_stats_administration.data.test.ts` | ✅ shipped |
| T4 · `administrationReferenceData.test.ts` | ✅ shipped |
| T5 · add МДААР (re-audit, F1) | ✅ shipped |
| T6 · consortium note on the shared tile (re-audit, F3) | ✅ shipped |

## What reconciled (no change)

⚠ **Vintage.** Everything in this section was measured on the PRE-audit
**three**-EIK set (`180680495`, `180742160`, `177098809`), which is the universe
the audit was auditing. Re-measured on the post-T1 **four**-EIK set on
2026-08-19: 416 contracts, and all four hygiene invariants still hold —
0 missing `contractor_eik`, 0 NULL `amount_eur`, 0 self-deals, 0 intra-group
circulation. Widening to ЕСМИС introduced none of them. „Intra-group" in
particular changes meaning when a member joins, so it was re-run rather than
inherited.

- **The hub headline is exact at all 30 scopes.** `basis: headcount`, `kind:
  count`, value == `data/budget/personnel.json` `national[y].positions.filled`.
  `all` / every `ns:*` → 133,275 (2025); `y:2018`..`y:2025` each match their own
  year; `y:2016` / `y:2017` / `y:2026` fall back to 2025 carrying
  `unavailable: true` (2017's `filled` is genuinely `null` in the source, so
  skipping it is right).
- Structures KPI (`Σ central + Σ territorial`) equals the tile's own row sum in
  every year — the tile merges the two sides with an object spread, which would
  silently drop a label present on both, and no year has one.
- `services_overview.json` `total` 2,671 == `Σ byTier`.
- `pctChange` sorts ascending, so the DESC `population` array is not a bug.
- Contractor hygiene, 3-EIK set: **376** contracts, 0 missing `contractor_eik`,
  0 NULL `amount_eur`, **0 self-deals**, **133** distinct contractor keys.
  Consortium participation is TWO distinct measures and an earlier draft of this
  line fused them into one wrong sentence — they are:

  ```sql
  SELECT count(*) FILTER (WHERE consortium_eik IS NOT NULL)                        AS consortium_rows,  -- 48
         count(*) FILTER (WHERE contractor_eik LIKE 'obed-%')                       AS obed_rows,        -- 11
         count(DISTINCT contractor_eik) FILTER (WHERE contractor_eik LIKE 'obed-%') AS obed_keys,        -- 10
         count(DISTINCT contractor_eik)                                             AS contractors       -- 133
    FROM contracts WHERE tag = 'contract' AND awarder_eik IN (…);
  ```

  The claim that matters is the second pair: 11 rows carry a synthetic `obed-`
  carrier over 10 distinct keys — **one carrier per consortium, so no member is
  credited the full contract value** — and `CompanyLink` renders each as plain
  text rather than a dead `/company` link. The 48 is a different column
  (`consortium_eik`, set on rows whose award names a consortium at all) and says
  nothing about double-counting.
- **Zero intra-group circulation** between the member EIKs.
- Leaderboard basis == headline basis (both `tag='contract'`, same window, same
  EIK set); Σ leaderboard == the KPI exactly.

⚠ The live page reports **124** contractors where SQL gives 133 — that is
`moneyModel.suppliers.length`, the folded model's supplier list, not
`count(DISTINCT contractor_eik)`.

**The mechanism, measured on the re-audit (2026-08-19) — the model is RIGHT and
the raw count is the inflated one.** `061_awarder_group_model.sql`'s `sup` CTE
excludes `consortium_role = 'member'`, i.e. the €0 member rows migration 087
mints beside a consortium's carrier. On the page's default 2025 window that is
**exactly 8 rows, all €0, covering 5 contractor keys with no other presence** —
which is the whole of the live `35` vs the raw `40`. So `suppliers.length`
counts *suppliers that received money*, while `count(DISTINCT contractor_eik)`
double-counts members whose € sits on the carrier row.

Quote whichever answers the question actually asked, and say which: „колко
изпълнители получиха пари" is the model's figure, „колко юридически лица се
появяват в регистъра" is the raw one. What is NOT safe is quoting one under the
other's caption.

## Tier 1 — Add ИА ЕСМИС / ДАИТС to the e-gov group (Failure mode D)

`administrationReferenceData.ts` claims its three EIKs are "the three bodies
that have held the e-government mandate across time … so the history is whole".
They are not. **ИА „Електронни съобщителни мрежи и информационни системи"
(ex-Държавна агенция за информационни технологии и съобщения), EIK
`131516795`** — €20.24M over 40 contracts, 2011–2017 — is absent, and the baton
pass is clean and non-overlapping:

| EIK | body | years | € |
|---|---|---|---|
| `131516795` | ДАИТС → ИА ЕСМИС | 2011–2017 | 20,238,626 |
| `177098809` | ДАЕУ | 2017–2023 | 29,674,427 |
| `180742160` | ИА ИЕУ | 2022–2025 | 120,592,861 |
| `180680495` | МЕУ | 2022–2026 | 166,225,210 |

All-time €316,492,497 → €336,731,123 (+6.4%). The hub headline is unaffected
(headcount basis). The „Възложени по година" chart currently starts at 2017,
which reads as *"no e-gov procurement existed before then"*.

**Steps**
1. `ESMIS_EIK = "131516795"` in `src/lib/administrationReferenceData.ts`, added
   to `ADMIN_SECTOR_EIKS` and `ADMIN_ENTITIES` (role: legacy infrastructure
   predecessor). Record the measured lineage table in the header comment,
   including that the succession was established from the corpus (clean 2017
   handover + the body's own former name) rather than from the ПМС.
2. `SECTOR_BROWSE_PACKS.administration` already spreads `ADMIN_SECTOR_EIKS` — no
   edit, but assert it in the test.

## Tier 1 — `MINISTRY_NAMES` is 100% dead (Failure mode B)

Every one of its 9 keys carries an extra definite article:
`admin-ministerstvo**to**-na-…`, while the slugs in
`data/administration/context.json` are `admin-ministerstvo-na-…`. All 9 miss,
`ministryName()` falls through to the slug prettifier, and the „Разход за
персонал на щат" tile renders **7 transliterated Latin slugs on a Bulgarian
page** — verified live ("ministerstvo na inovatsiite i rastezha", "ministerstvo
na turizma", …).

**Steps**
1. Drop the `-то` from all 9 keys.
2. Unit test asserting every `MINISTRY_NAMES` key resolves through
   `ministryName()` to a real name (i.e. is NOT the prettified fallback), and —
   the tripwire that would have caught this — that every `adminId` present in
   the committed `context.json` is mapped.

## Tier 1 — `ADMIN_EIK` is a hardcoded duplicate (Failure mode E)

`sectorDashboards.ts:200` declares `export const ADMIN_EIK = "180680495"` under
a comment saying "where no reference-data export exists yet" — but `MEU_EIK` /
`ADMIN_GROUP_EIK` do exist. Repoint it at `ADMIN_GROUP_EIK` (re-export, the way
`TRANSPORT_EIK` already is) so the digits live once.

## Tier 2 — `stateBodyEiks` on the shared top-contractors tile (Failure mode K)

The sector's **#1 „изпълнител" is a state company owned by the sector's own
ministry, and it is unlabelled**: „Информационно обслужване" АД (`831641791`) —
€81.3M / 64 contracts, **25.7% of the all-time window and 34.6% of 2025**.
Принципал = МЕУ, the sector lead. This repo already curates it as a public body
in `SOCIAL_STATE_BODY_CONTRACTORS` ("majority state (принципал МЕУ)"), and
`/sector/social` chips it „държавно"; `/sector/administration` renders it as an
ordinary private vendor.

Two mechanical gaps behind that:
- `AdministrationScreen` passes no `memberEiks` to `SectorTopContractorsTile`
  (five other sectors do);
- `SectorTopContractorsTile` has **no `stateBodyEiks` prop at all** — only
  `VikContractorHhiTile` has one.

**Steps**
1. Add `stateBodyEiks` to `SectorTopContractorsTile`, modelled exactly on
   `VikContractorHhiTile`: labels the row („държавно"), never filters it, and a
   member (`memberEiks`) wins the more specific „в групата" chip so the two
   never both fire. Carry the ⚠ over: the list MUST be curated by ownership,
   never derived from "is this EIK an awarder somewhere" (ЗОП's utilities regime
   makes private regulated companies contracting authorities — on this group
   that probe also returns Балкангаз 2000 and Севлиевогаз-2000).
2. `ADMIN_STATE_BODY_CONTRACTORS` in `administrationReferenceData.ts` = `[
   "831641791" ]`, with the measured share and the ownership ground.
3. `AdministrationScreen` passes both `memberEiks` and `stateBodyEiks`.
4. Note **Failure mode L** in the same place: 52 of ИО АД's 64 awards carry no
   `procurement_method` and the other 12 are `limited`/single-bid — by statute,
   since ИО АД is the state's designated системен интегратор (ЗЕУ in-house
   award). The `tenders` join returns no `legal_basis` for any of them, so the
   page cannot source that ground; it is a caveat in the chip's title, not a
   claim rendered as data.

## Tier 2 — the money band must answer for the year the pill names

Default scope is `ns`, relabelled „Най-нова година". The institution tiles
resolve to `selYear` (2025, the latest Доклад) while `moneyWindow` becomes
`{from: null, to: null}` — the **whole corpus**. Live, that puts €316.5M / 376 /
124 suppliers under a pill that says "latest year", against 2025's real
€173.1M / 97 / 40:
**83% above what the label implies**, with no period stated in the band.

**Decision (2026-08-19): scope the money to the year.**

**Steps**
1. `moneyWindow` becomes `selYear`'s window unconditionally (not `year != null`),
   so the KPIs, the top-contractors leaderboard and `awarderN` answer for the
   same year as every institution tile and every KPI hint.
2. `SectorSpendByYearTile` keeps FULL history via a second
   `useAwarderGroupModel` call with an all-corpus window — the same treatment
   `DivergenceTile` and `HeadcountByTypeTile` already carry ("full-history,
   ignores year scope"). The hook is documented as supporting a second instance.
3. Name the year in the band's sub-caption so the KPIs can never be read as
   all-time.
4. ⚠ Record the consequence rather than hiding it: the Доклад lags the
   procurement corpus, so `years` runs 2017–2025 while the corpus has 2026
   (€24.2M). On the default view the money KPIs answer 2025 and **2026 is
   reachable only through the full-history chart and the „виж всички →" link**.
   Widening `years` to the union is the wrong fix — picking 2026 would leave
   every institution tile silently falling back to 2025, which is exactly the
   defect `useScope`'s resolve exists to prevent.

## Tier 2 — `parseStructureCounts` truncates two labels (upstream)

`scripts/budget/doklad.ts` strips `^администрация\s*` from every row label,
which eats the head of „Администрация на Министерския съвет" and leaves the page
rendering a bare **„на Министерския съвет"**. („Административни структури,
създадени с" is missing „…със закон" from a PDF wrap and is NOT fixed here —
it needs the source text to confirm.)

The strip exists to remove the „Централна администрация" / „Териториална
администрация" section prefix, which the two preceding `replace`s already
handle; anchor it so it only fires on that prefix.

⚠ **Inert until re-ingested.** `data/budget/personnel.json` is committed and
this parser only runs under the owning `update-budget` / `update-administration`
ingest (it fetches the Доклад PDFs). The fix lands with a unit test; the page
label changes at the next run of that skill.

## Tier 4 — regression tests

New `scripts/db/tests/sector_stats_administration.data.test.ts`, modelled on the
`sector_stats_social` sibling (auto-skips when PG is down). Bands and
inequalities only — the corpus grows fortnightly.

- headline `basis === 'headcount'`, `kind === 'count'`, and `value` equal to
  `personnel.json`'s resolved year for `all`, `y:2024` and `y:2019`;
- `y:2026` carries `unavailable` and falls back rather than emitting a partial;
- **the EIK-set copies are in lockstep**: `ADMIN_SECTOR_EIKS` ===
  `SECTOR_BROWSE_PACKS.administration.eiks` as a set, and
  `SECTOR_DASHBOARDS.administration.leadEik === ADMIN_GROUP_EIK` (the
  single-member collapse is intentional and asserted as such, so it cannot
  quietly become a different EIK);
- `ESMIS_EIK` is present and its per-EIK € clears a floor;
- the group total sits in a band (ceiling catches re-leakage, floor catches an
  over-trim);
- **beneficiary side**: `831641791` is still in `ADMIN_STATE_BODY_CONTRACTORS`
  AND is still reached by the group (the anti-allowlist twin — it stops a later
  leaderboard cleanup turning a state transfer back into an apparent private
  vendor), and its top-contractor share stays under a ceiling;
- **leaderboard basis == headline basis**: Σ of the per-contractor rollup for a
  fixed window equals the group's `awarder_eik` sum for the same window.

Plus unit tests: `administrationReferenceData.test.ts` (the `MINISTRY_NAMES`
key tripwire above), a `SectorTopContractorsTile` test for the new prop, and a
`doklad` label-strip test.

## Phase 5 — verify

`npx tsc -b`, `npm run lint`, the touched vitest suites, the new data test.
`npm run db:gen-sector-stats` is NOT required: administration is headcount-basis
and none of these changes touch a source the generator reads — confirm by diffing
`sector_stats.json` (it must not move).


---

# Re-audit — 2026-08-19 (second pass)

The whole audit was re-run from the sources rather than inherited. Everything in
„What reconciled" above still holds on the four-EIK set, plus: the hub tile reads
**133 275 · СЛУЖИТЕЛИ 2025 · МЕУ** live; the 2025 money window reconciles to the
euro (**€173,144,231 / 97 contracts / 2 buyers**); hygiene is still 0/0/0/0; all
9 `context.json` ministry ids resolve through `MINISTRY_NAMES` (the `-то` fix
holds, 0 dead keys); `digital_skills.composition` sums to 100% in all three
years and `youth.rank` 27/27 `isLast` is correct against the 38-geo
cross-section; `services_overview.total` 2,671 == Σ `byTier`.

Two findings were new. `F2` (the supplier-count mechanism) and `F4` (a stale
status marker) are folded into the sections above.

## Tier 5 — add МДААР `131509441` (Failure mode D)

The e-gov group is missing its **ministry-tier predecessor**. Measured:

| field | value |
|---|---|
| EIK | `131509441` |
| `awarder_name` | Министерство на държавната администрация и административната реформа /МДААР/ |
| rows | 1 contract, `tag='contract'` |
| € | **6,426,068** |
| date | 2011-08-02 (`date_signed` 2011-07-28) |
| CPV | `72000000` (IT services) |
| title | „Доставка на софтуерни продукти на Майкрософт за нуждите на държавната администрация на Република България" |
| contractor | ЦАПК „Прогрес" ООД (`000638693`) |

⚠ **`contract_id` is „МС 76" — the contract is the COUNCIL OF MINISTERS', filed
against МДААР's legacy buyer record.** МДААР was abolished in 2009 and its
functions moved to МС; the 2011 date postdates the ministry by two years. So the
group gains the *mandate* line 2009–2016 that neither ЕСМИС (agency, →2017) nor
ДАЕУ (2017→) covers — but the header must say the buyer record and the signing
body are not the same thing, because the row renders under the МДААР name.

⚠ **This does NOT open the door to МС's own corpus, and that is the whole reason
it is safe.** `000695025` Министерски съвет is a separate awarder holding **603
contracts / €138.2M**, almost none of it e-gov. `131509441` is a legacy record
holding exactly this one row. Adding the ministry EIK instead would be the
МВР-into-defense shape at €138M.

**Impact** — all-time €336,731,123 → **€343,157,191 (+1.9%)**; 416 → 417
contracts. **Zero** on the hub headline (headcount basis) and **zero** on the
page's default 2025 window. The „Възложени по година" chart's left edge does not
move either: ЕСМИС already starts 2011-03-22.

**Decision (2026-08-19): include it.**

**Steps**
1. `MDAAR_EIK = "131509441"` in `src/lib/administrationReferenceData.ts`, added
   to `ADMIN_ENTITIES` (role: ministry-tier predecessor) and therefore to
   `ADMIN_SECTOR_EIKS`. Record the measured row, the „МС 76" provenance, and the
   €138.2M МС counter-factual in the header — the last one is what stops a
   future reader „finishing the job" by adding the Council of Ministers.
2. `SECTOR_BROWSE_PACKS.administration` spreads `ADMIN_SECTOR_EIKS`, so no edit
   there; the caption „поръчките на N ведомства" moves 4 → 5 on its own.

⚠ **The per-member € floor must become PER MEMBER, or T5 fails its own gate.**
`sector_stats_administration.data.test.ts`'s „every member still contributes real
money" arm asserts a uniform `> €10M`. МДААР is €6.43M, so a uniform floor either
rejects a legitimate member or has to drop to ~€5M for everyone — and at €5M the
arm stops discriminating for МЕУ (€166.2M) and ИЕУ (€120.6M), which is where a
collapse would actually matter. Replace the constant with an EIK→floor map, each
entry well under its own measured total and far above zero.

## Tier 6 — the consortium carriers are unexplained (beneficiary side)

The top-contractors tile explains „държавно" and says nothing about
„Обединение:" rows. Measured on the four-EIK set:

- **10 distinct `obed-` carriers over 11 rows = €63,317,678 = 18.8%** of the
  group all-time; in the displayed 2025 window, **three of the eight visible
  rows** are carriers (€49.6M = **28.6%**).
- A member firm can hold BOTH a carrier position and its own row, so the
  leaderboard understates its real reach:

  | | on the leaderboard | actual participation |
  |---|---|---|
  | А1 България, 2025 | #5 · €10,605,577 · 6.1% | **€38,730,210 · 22.3% (#2)** |
  | А1 България, all-time | #6 · €17,589,682 · 5.2% | **€58,977,226 · 17.5% (#2)** |
  | Парафлоу, 2025 | #3 · €17,878,890 | plus €8,789,610 inside row #6 |

⚠ **The euros are correct and there is no double-count** — one carrier per
consortium (11 rows / 10 keys), verified, and `CompanyLink` already renders a
synthetic key as plain text rather than a dead `/company` link. This is the
J/K/L class: a right number whose sentence is wrong. It is therefore a CAPTION,
and the row must not be filtered, re-keyed, or exploded onto its members —
crediting each member the full contract value is Failure mode M, the actual
double-count.

**Decision (2026-08-19): a generic note on the shared tile.**

**Steps**
1. `SectorTopContractorsTile` gains a consortium note modelled on the existing
   „държавно" one: it fires only when an `obed-` carrier is present **in the
   displayed top-8** (the same `rows.some(...)` gate the `stateBodyEiks` note
   uses — `carriers.length > 0` would pass on a carrier the reader cannot see),
   and says the row is one consortium counted once and that a member may also
   appear on its own row.
2. The predicate is `isLinkableCompanyKey`-adjacent but NOT that function: the
   `obed-` prefix is the one namespace this note is about, and `ph-`/`np-`
   carriers are a different statement entirely.
3. Test both directions: the note appears when a carrier is inside the top-8, and
   does NOT appear when the only carrier is below it.

## Tier 7 — regression tests

Extend `scripts/db/tests/sector_stats_administration.data.test.ts`:

- `MDAAR_EIK` is in `ADMIN_SECTOR_EIKS`, and its per-EIK € clears its own floor
  (a closed one-row series, so it cannot grow);
- the per-member floor map covers every member (a member with no entry fails,
  so a future addition cannot land floorless);
- the group band's ceiling still holds at the wider total;
- **the МС counter-factual as an anti-allowlist**: `000695025` is NOT in
  `ADMIN_SECTOR_EIKS` — the €138.2M leak this tier deliberately declined;
- a consortium-carrier arm: carriers are a minority of the group's € (ceiling),
  and no carrier key is also a plain EIK (the one-carrier-per-consortium
  property the no-double-count claim rests on).

Plus a `SectorCharts.test.tsx` arm for the T6 note, both directions.
