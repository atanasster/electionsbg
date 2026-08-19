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
| T2 · `stateBodyEiks` + `ADMIN_STATE_BODY_CONTRACTORS` | ⏳ open |
| T2 · money band scoped to the year | ✅ shipped |
| T2 · `parseStructureCounts` label strip | ✅ shipped (inert until the ingest re-runs) |
| T4 · `sector_stats_administration.data.test.ts` | ⏳ open |
| T4 · `administrationReferenceData.test.ts` | ✅ shipped |

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
`count(DISTINCT contractor_eik)`. Quote the SQL figure; the two are not
interchangeable.

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
