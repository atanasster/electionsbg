# Deferred follow-ups

This is the compact home for work deliberately left outside an otherwise completed
implementation. Entries stay only while they name an unresolved decision, a concrete trigger,
or a bounded next step. Completed implementation histories belong in Git, not here.

## Production publish (deferred-followups-verification-fixes-v1) — done 2026-10-21

Published and verified against local the same day: `open_calls` 88 → 119 (Interreg ×6, АХУ, АЗ;
row-for-row equal to local), Interreg coverage notes → `graph` → `tr-company-place`
(`company_public_money` equal to the cent, `tr_company_place` 359,094 rows equal),
`admin_service_requests` (2,918 rows equal), the gzip uploads of `data_map.json` +
`governments.json` and the two new bucket files, and hosting → `deploy:db` → hosting (bundle
`index-B9gWD1hk.js` on `/`, `/person`, `/company`). Still open:

- Firebase: clear the domain-level redirect on `ai.electionsbg.com` (see the AI app entry).
- `npm run db:load:municipal-fiscal:pg:cloud` — optional; no verdict differs.
- The cloud person chain ran 2026-10-21 (19 steps, 24 min): prod now equals local on persons,
  `/persons`, search and attribution; TR roles within 3, graph edges within 2. It cost two
  measured 500 windows (~5½ min + ~1 min) — recorded in CLAUDE.md beside the 2026-09-04 poll.

## Companies & Commerce Registry

- Add NKID and founding-date facets to `/companies` only after the UI can distinguish unknown
  coverage from a negative result.
- Consider director-name search as a separate person-to-company query, not as a hidden join in
  the company-name index.
- Do not expose money aggregates in the company browser until the join cardinality has been
  re-measured and guarded.
- `tr_owner_share` fixes percentages but does not decide whether an owner whose latest row
  predates the current capital-table vintage is still current. Resolve that identity/dedup
  question separately; never restore the old all-non-erased-row denominator.
- **Historical TR `valid_from` / `valid_to` (`tr_person_history`)**: The daily feed is a CHANGE
  log (`PackageType:"ForChange"`), not full state: every field carries `FieldOperation` Add/Erase
  (116–175 Erase ops per sampled file, plus `EraseActualOwner` / `EraseProcura` sections) and a
  `FieldEntryDate` / `FieldActionDate` — the date the circumstance was entered in the register.
  Tenure can be built from those entry dates plus the Erase ops. Two gaps remain: there is no
  contractual appointment date separate from the register entry date, and prior cap-table vintages
  are not always erased (the `tr_owner_share` problem above). Until built, `contracts_during_tenure`
  stays gated out of `person_connections` and `graph_edges`. (Verified 2026-10-21 against
  `raw_data/tr/daily/`; an earlier version of this entry said „zero `<Erase>` tags, no dates".)
- **CR Deeds full crawl & investigative signals**: Run the resumable ~56k-EIK CR Deeds crawl
  (`npm run declarations:cr-deeds:fetch && npm run declarations:cr-deeds:parse && npm run declarations:cr-deeds:project && npm run db:load:cr-founding:pg`)
  and ship `db:load:cr-founding:pg:cloud` + `db:load:procurement-risk:pg:cloud` so `youngWinner`
  activates in production. Follow-up signals over the parsed CR Deeds store: ownership block +
  share-transfer timeline on `/company/:eik`, multi-hop corporate ownership chain
  (`company_owner_edge`), thin-capitalisation signal (`capital_bgn <= 100` winning >€500k),
  phoenix/transformation lineage (no field code identified yet — `06000`–`06020` enterprise
  transfer is the closest family), ГФО filing compliance chip (the ГФО is a document act,
  `ActModeValue` 2 „Годишен финансов отчет", not a field), shared registered-address cluster
  (`Field 00050`), and UBO (`Field 05500` `ActualOwners`, erase `05510`) vs registered owner
  comparison. Field codes verified 2026-10-21; `06010` / `06020` are the two counterparty
  enterprises of a transfer (the records do not say which is transferor and which acquirer — see
  the table in `parse_cr_deeds.ts`), not the ГФО,
  and the act code `1005010` cited earlier appears nowhere in the capture or the feed.
  ⚠️ The UBO comparison needs a legal/GDPR decision first: since ДВ бр. 49/2025 (new чл. 63б
  ЗМИП) access to beneficial-owner data is limited to authorities, obliged entities and persons
  with a „законен интерес", even though the TR open-data feed still carries the names.
  **UBO exposure today (inventory, local Postgres, 2026-10-21)** — the question for counsel is
  not only the planned comparison but what ALREADY renders:
  - `tr_person_roles` role `actual_owner`: 21,162 rows (20,579 not erased), parsed from feed
    field 05500 (`parse_daily_filing.ts` → `ActualOwners`) and CR Deeds `CR_F_550_L`. Stored per
    person: name, position, country. No address and no identifier — `Indent` is deliberately
    not extracted.
  - `company_person_roles` (022) → `/company/:eik/officers`: **19,037** rows, i.e. every
    company's beneficial owners by name, public figure or not.
  - Two functions read `tr_person_roles` DIRECTLY, with no person-layer gate:
    `company_officers(eik)` (008) → `/api/db/company` → the officers preview on `/company/:eik`
    and `/awarder/:eik` and the AI chat company tool (`ai/tools/company.ts`); and
    `person_roles(q)` (008) → `/api/db/person?name=` → the name-keyed `/person/:name` page and the
    AI chat portfolio tool (`ai/tools/person.ts`), which returns ANY name's UBO rows.
  - `person_role` (source `tr`): 2,461 roles held by 1,950 people — 211 of those roles (174
    people) on active public figures, 2,250 on Tier-V private owners → `/person` roles,
    `graph_edge` (2,461 `tr_owner` edges → `/connections`), `company_politicians` (23 rows →
    procurement relation labels).
    **Owner decision with GDPR counsel (the pending lawyer review of the published-persons
    notice; no outcome recorded as of 2026-10-21):** whether
    displaying registry-sourced UBOs is still covered by the journalistic exemption after чл. 63б,
    and if not, which of the surfaces above to withdraw — all four paths carry UBOs, so withdrawing
    only the officers page would leave `company_officers`, `person_roles` and the AI tools
    publishing them. Until decided,
    do NOT build the UBO-vs-registered-owner signal.
- **Component test harness for `CompanyDbScreen`**: Build a mock payload fixture (~30 fields) so
  `CompanyDbScreen` can be mounted in unit tests like `PersonScreen.test.tsx`.

## Education

- Decide whether school `residual` and `verdict` should become relational columns so AI tools
  can query the same value-added interpretation served in place payloads. The broader education
  roadmap already owns the `maturaByPlace` and `educationGaps` tools.
- **School value-for-money view**: Cross-reference school own-procurement (`€496.8M` across 917
  schools) against ДЗИ/НВО points only alongside an explicit intake-confounding adjustment.

## Procurement & Dossiers

- Cross-source reconciliation deliberately excludes date-tolerant matches. Revisit only after
  manually checking АПИ procedures `00044-2023-0015` and `00044-2023-0029`; together they
  account for €67.0m of the measured long-tail candidates. A wider rule needs an explicit date
  tolerance and new ambiguity gates.
- Add a cohort-granularity control to procurement normalcy only if readers need to inspect the
  CPV-8/CPV-4/division basis. Consider per-metric cohort widening when a fine cohort falls below
  the minimum sample instead of weakening the shared minimum itself.
- **ЦАИС ЕОП EUR guard & `T`-id canonicalization**: the verifier now exists —
  `npx tsx scripts/procurement/verify_eur_currency_eop.ts` (read-only; writes the gitignored
  `raw_data/procurement/eur_currency_check.json`). Measured 2026-10-21 over 2020–2025, it does NOT
  reproduce the earlier „365 EUR-tagged, ~322 entered in BGN" note. The legacy АОП CSV's currency
  column tags 90 rows EUR (2020–2023; none in the 2024/2025 RL dumps); `parseLegacyCsv` keeps 57 of
  them. 37 of those join the ЕОП daily feed on УНП + contract number, all with the same amount: 35
  recorded EUR/EUR, 1 with one field empty, 1 BGN/EUR — so 0 BGN-amount-under-EUR-label among the
  legacy rows. In the ЕОП feed itself (174,575 distinct contracts with a value) `currency` and
  `contractCurrency` disagree on 15 rows (EUR/BGN 6, BGN/EUR 5, USD/BGN 3, BGN/USD 1). That
  `currency` labels the ESTIMATE is inferred from field order, not shown. Against a BGN estimate,
  4 of the 5 BGN/EUR rows are same-scale — a BGN amount under an EUR `contractCurrency` — and 1 is
  EUR-scale. So NEITHER field is authoritative for those rows: no blanket ÷1.95583, and no blanket
  trust in `contractCurrency` (which `eop_field_map.ts` uses today). Hand-triage the 15 rows from
  the report's `disagreeSample`, and re-measure before acting on the old figure. Separately, normalize
  `T`-prefixed tender IDs (`T486119` vs `00073-2020-0016`): a `T`-id is `"T" + tenderId`, placed in
  `uniqueProcurementNumber` when a procedure has no УНП, so the cross-map key is `tenderId`
  (there is no `TenderNumber` field).
- **Same-feed duplicate suppression**: 213 `same_feed_dup` groups (€139.2M, e.g. ВМА multi-medicine
  contracts sharing a registry number across distinct lot subjects) remain unmerged until `subject`
  is added to the deduplication key or multi-lot registry numbers are split at ingest.
- **Unlinked `obed-*` consortium annexes**: Do not add a `(awarder_eik, date, value)` fallback key
  for the 330 unlinked `obed-*` annexes unless the post-annex vs signing-value collision on
  `contracts.value_eur` is solved first.
- **Single-token & transliterated foreign consortium members**: `extractForeignMembers` requires
  2+ tokens + legal-form marker (skipping single-token brands like `Талес`/`Алстом` and Cyrillic-transliterated
  foreign names without Latin legal markers); handle only via a curated brand dictionary if needed.
- **Contractors browser `/procurement/contractors`**: Consider adding a direct „Най-големи
  възложители" tile on `/procurement` and extending `contract_party` with an `'awarder'` role if
  a unified awarders browser is built.
- **ID-like query routing in procurement search**: `classifyProcurementQuery` routes UNP/IKOP/hash
  queries on `/procurement` and `/procurement/search`; consider wiring `DbDataTable`'s in-table
  search box on `/procurement/contracts` and `/procurement/tenders` to offer a cross-entity jump
  banner when an ID of the opposite kind is pasted.
- **Settlement procurement attribution**: Contract-subject settlement mentions (e.g. АПИ contracts
  naming a road or village) remain unparsed; attribution currently flows strictly via `awarder_eik`
  seat EKATTE (87% of value). Keep `data/procurement/by_ekatte.json` on disk until `gen_home/flyover.ts`
  reads PG directly.
- **Client-side risk-index retirement**: Delete `useContractRiskFlags` / `useContractRiskScorer`
  and the 7 client risk-index hooks in `src/data/procurement/useContractRiskFlags.tsx` once
  `TenderDetailScreen` and `ProjectFileScreen` consume server-side `risk_mask` exclusively.
- **Procurement review queue & new datasets**: Surface `contract_risk_cache` grades D/E/F strictly
  as „за преглед" with gated person↔company edges. Remaining candidate external datasets:
  - the LIVE АОП external-experts list under чл. 229, ал. 1, т. 17 ЗОП. Migration 174 loads the
    HISTORICAL list that aop.bg/ets.php still titles „по чл. 232а, ал. 2" — the 2019–2020 wording,
    since repealed (no repeal date was confirmed); the current чл. 232а (in force 22.07.2024) is
    ex-ante control. The live list's page
    (`www.aop.bg/ee2014.php`) is a 404.
  - Сметна палата audit reports (no migration or loader yet).
  - ЗМИП beneficial owners — subject to the access limits of чл. 63б ЗМИП (ДВ бр. 49/2025); see
    the CR Deeds entry.

  Already shipped: АДФИ inspections (173), subcontractors (171), TED cross-check (172). Dropped:
  ИСУН financial corrections (`нередности`). There is no public per-project source — irregularities
  go to OLAF's confidential IMS, and only aggregates are published. The clean-delivery register
  (175) must never be inverted into one.

## EU Funds, Open Calls & Subsidies

- **Grant → tender → contract UI surfaces (`166_grant_contract_link.sql`)**: The ПИИ money-spine
  table is populated in PostgreSQL; wire the strip onto `/funds/contract/:key`, `/awarder/:eik`,
  and `/culture/funds#spine`.
- **Open-calls arms — all scraped locally (2026-10-21), none published.** АХУ (`opencalls:ahu`),
  all six Interreg programmes incl. RO-BG (`interregviarobg.eu`) and BG-RS/MK/TR (`ipa-bg*.mrrb.bg`)
  (`opencalls:interreg`), and АЗ dated intakes (`opencalls:az`, exact rows only) load into the
  LOCAL `open_calls`. Still open:
  - Cloud SQL has none of it: `npm run db:load:open-calls:pg:cloud`. Checked before publishing:
    all 5 Interreg keys prod holds today are in the new snapshot, field-for-field identical, so
    the load adds 31 rows and orphans none.
  - Ensure `DELETE FROM open_calls WHERE source = 'interreg' AND closes_at IS NULL;` has been
    applied on Cloud SQL.
  - ⚠️ The `*.mrrb.bg` wildcard certificate EXPIRED 2026-10-15; on 2026-10-21 `ipa-bgrs` served
    the expired one (`CERT_HAS_EXPIRED`) while `ipa-bgmk` / `ipa-bgtr` still answered. The crawler
    keeps verification on, so BG-RS reads as unreachable until МРРБ renews — expected, not a bug.
  - Black Sea Basin was down on the first crawl; it has no rows yet.
  - No watcher for АЗ (run `opencalls:az` with every open-calls refresh).

- **Upstream keep.eu Interreg coverage gaps** (re-checked 2026-10-21):
  - Interreg IPA Bulgaria–Serbia 2021–2027: 0 projects in keep.eu, against the programme's own
    10 projects / 60 partnerships.
  - Greece–Bulgaria 2021–2027: all 21 projects and 85 partnerships are present, but 0% carry a
    partner budget or postcode. The coverage notes are now derived from keep.eu's own counts
    (T2.2; all 22 re-checked against keep.eu live on 2026-10-21) — but Cloud SQL still serves the
    old hand-typed notes („38%", URBACT „1%") until `npm run db:load:interreg:pg:cloud`.
  - URBACT IV: 95.8% partner budgets, 0% postcodes.
  - ESPON 2030: keep.eu holds 0 of 110 projects.
- **ИСУН 2020 per-project executors**: Full crawl of `2020.eufunds.bg` detail pages is shelved —
  the F5 WAF rejects even a cold first request (a client-fingerprint block, see CLAUDE.md), not
  only bursts. Revisit via a ЗДОИ bulk-data request to ЦКЗ, which sits in the Администрация на
  Министерския съвет since ПМС 265/2024 (ЗДОИ via gov.bg „Достъп до информация"), if per-project
  subcontractor and payment schedules are needed at scale.
- **Funds prerender drill-downs**: Consider prerendering top `/funds/contract/:number` and
  `/company/:eik` destinations linked from `scripts/prerender/fundsTables.ts` so non-JS crawlers
  following drill-down links do not land on the bare SPA shell.
- **ДФЗ / Subsidies hub follow-ups**:
  - Watch for upstream re-publication of ДФЗ FY2018–2019 (absent from `data.egov.bg`) and FY2020
    (resource returns 0 rows). FY2015/16/17/21/22 are already loaded. Those sheets do carry a
    per-row „Мярка" column and three fund columns (ЕФГЗ-ДП, ЕФГЗ, ЕЗФРСР-НБ), so the earlier „merged
    into two macro-buckets" premise was wrong.
  - Refine `scripts/agri/match_seu_eik.ts` so exact legal-name matches without a legal-form marker
    (ET / ЕООД / ООД / АД / ЗК / ДЗЗД) are verified against `tr_companies` rather than skipped.
  - Evaluate joining natural-person (`ФЛ`) СЕУ rows to `person` strictly where municipality +
    three-part name is unique.
  - Build a dedicated measure page `/subsidies/measure/:code` when per-measure drill-down is needed.

## Budget & Macro

- **Historical КФП monthly time series (1998–present)**: Ingest MinFin's monthly КФП workbooks
  (`minfin.bg/bg/statistics/5`; the annual series is `/statistics/13`, while `/statistics/4` is the
  Фискален резерв, not КФП) into a multi-year series table once BGN→EUR pre-2026 conversion and the
  methodology breaks are annotated. The breaks are the GFSM 86 / GFSM 2001 / GFSM 2014
  presentations, with ЗПФ in force from 01.01.2014. КФП stays cash-based throughout — it is not an
  ESA 2010 series. The „2016 chart-of-accounts restructure" cited earlier is unsourced; verify it
  before annotating. minfin.bg sits behind Cloudflare for automated clients.
- **СЕБРА daily payment execution**: Ingest the daily СЕБРА payment files as a separate budget
  execution pipeline. Under the Наредба по ПМС № 299/2016 (last amended ПМС 76/2024), МФ publishes
  daily payments by ППРБ on `minfin.bg` (чл. 2), and each ППРБ publishes its own daily Excel file on
  its own site (чл. 4, 9). The МФ URL is not yet pinned. (`mof.bg`, named here earlier, is an
  unrelated fashion site.)
- **Trimming `/budget/deep-dive` (`BudgetScreen.tsx`)**: Retire the legacy inline tiles
  (`PersonnelSection`, `AdminComparisonSection`, `SocialFundsCard`, `CapitalComparisonCard`,
  `DeviationsSection`) from `/budget/deep-dive` once the route is scoped strictly to the
  interactive tax/budget sandbox.
- **Municipal fiscal commitments historical eras (pre-2024)**: Add per-era column maps for pre-2024
  MinFin workbooks cached in `data/_cache/minfin_municipal_fiscal/` (2022–2023 62-column shift,
  2021 59-column shift, 2016–2020 layouts, and Q4-anchored explicit чл. 130а criteria sheets).
  (The SIX-vs-SEVEN question is settled: МФ splits т. 1 into чл. 32 ал. 1 / ал. 2, and the
  threshold now counts statutory conditions — see CLAUDE.md's municipal_fiscal section.)
- **Retiring `budget/reconciliation/` & `budget/facts/` JSONs**: Retire once `budget_admin_fact`
  adds the 4 currency-split columns needed by the reconciliation view.

## Sectors (Administration, Agriculture, Culture, Customs, Health, Revenue, Social, Tourism, Water)

- **Sector entity search (`sector_entity_search`)**:
  - Consider adding `tr_companies` officers/owners (`tr_person_roles`) for contractors winning in
    a sector so typing a contractor owner's name in the sector search box surfaces the person +
    company.
  - Populate `person_role.org_eik` on `executive` roles (ministers, deputy ministers, agency
    chairs, oblast governors) so they appear in `sector_entity_search` by principal EIK rather
    than only via the curated `sectorKey` static list.
- **Buy-side `sector_awarder_stats` matview**: Extend `CompanySectorRankTile` to buy-side
  awarders (currently sell-side contractors only).
- **Administration**: e-service request volumes are INGESTED (2026-10-21) — МЕУ's еФорми
  dataset (data.egov.bg 20218) → committed `data/administration/eforms_requests.json`
  (`npm run admin:eforms`) → `admin_service_requests` + `admin_service_requests_month`
  (migration 201, `db:load:admin-service-requests:pg`, in `db:refresh`). 23 months 2024-02…2026-07,
  173,509 requests, 407 services (295 join the ИИСДА catalogue). Still open:
  - **No surface reads it yet.** A `/sector/administration` tile must say „заявени през
    еФорми" (requests, one system only) and name the missing months — the publisher skipped
    2025-01…04, 2025-07…08 and 2026-02, and nothing after 2026-07 had appeared by 2026-10-21.
  - **No watcher.** The dataset's monthly resources land on the 1st; a `scripts/watch/sources/`
    entry on the dataset's `updated_at` would flag `npm run admin:eforms`.
  - **Cloud SQL never received it**: `npm run db:load:admin-service-requests:pg:cloud`.
  - `analytics.egov.bg` (public Matomo, ~20 egov sites, anonymous JSON/CSV API) holds page
    VISITS, not transactions — optional, and only ever labelled as visits. No
    client-satisfaction dataset has been found.
- **Agriculture**: Decide whether the six чл. 163 ЗГ state forestry enterprises (`ДП` and their
  териториални поделения) belong in „Земеделие" (must be delimited by EIK, never by name regex).
- **Culture**:
  - Hand-classify the 17 `държавен` rows in МК's „Регистър на музеите" across principals (МК vs
    МО vs БАН). It is published as CSV on data.egov.bg (МК dataset 16811); use the 2021 resource,
    447 rows — the 2023 resource returns no rows through the API.
  - Compute читалища subsidy per subsidised unit (стандарт per субсидирана бройка, set yearly by
    РМС; €9,998 in 2025). Blocked on the per-община subsidised-unit table, which has not been found
    published.
  - Gate any НФЦ/НФК commission ↔ recipient overlap surface on defamation-policy sign-off.
- **Customs**: `data/budget/revenue_breakdown/customs/2025.json` has no `fines_total` line
  (2022–2024 have one). „Митническа хроника" 2025 does not print the figure as text: its total of
  14,527.5 млн лв minus excise (7,423.7), import VAT (6,684.5) and duties (398.3) leaves
  21.0 млн лв ≈ €10.74m for „глоби и други". The same method gives 8.2 for 2024 against the repo's
  8.1. **Decided 2026-10-21: keep null.** The residual covers more than fines, and a derived
  number in that key reads as a printed one. Revisit only if a later report prints the fines row
  as text again, or if a `finesBasis: "residual"` field with its own „глоби и други" label is
  built first.
- **Health (НЗОК)**:
  - Surface `periodByStream` on the national `/awarder/121858220` pack (`HealthPack.tsx`) so the
    pack header shows per-stream month coverage (`105/105` vs `44/105` months) like `/company/:eik`.
  - An e-referral / e-prescription volume cross-check against НЗОК billed activities has no
    public source: `opendata.his.bg` only publishes the pharmacy, drugstore and outpatient-facility
    registers. Revisit only via a ЗДОИ request to МЗ / НЗИС.
- **Social & Pensions (МТСП / НОИ)**:
  - НОИ 28-ТП territorial map. The INPUT is ingested (2026-10-21): `npm run noi:pensioners-by-tp`
    → `data/budget/noi/pensioners_by_tp.json` (data.egov.bg 10480; 2010–2025; 28 ТП on the
    canonical oblast buckets, София-град `SOFIA_CITY` and София-област `SFO` apart, ТП 29
    „Международни спогодби/договори" kept unplaced; every year sums exactly to „Общо"). Still
    open: the map itself (a choropleth on `/pensions`, captioned „по ТП, където се администрира
    пенсията", which is not always where the pensioner lives), a watcher on the dataset, the
    pre-2023 B1 backfill, and `bucket:sync` of the new file.
  - IF an АКСУ social-homes register is ingested: an earlier note reported 14 unmatched rows
    (`1,182 / 1,196` municipality match), to be resolved by joining settlement names via
    `data/ekatte.json` when a row names a village rather than an община. ⚠️ No AKSU homes artifact
    exists — not in the tree, not in git history, not in any script
    (checked 2026-10-21). The match figure therefore has no reproducible source; re-derive it
    from a fresh АКСУ register pull before acting on it.
- **Revenue (НАП)**: If an issuers cross-check is ever built, keep it a standalone probe only — joining
  `nap_issuers` to `contracts` over-counts multi-activity retailers (fuel chains, telecoms,
  pharmacies) because `contracts.cpv_code` is 99.66% NULL in the АОП portal CSV. ⚠️ No such
  probe exists in the repo (no script, no `nap_issuers` relation; checked 2026-10-21) — this is
  the rule for one if it is built, not a description of code that ships.
- **Tourism**: the НТР accommodation register is FETCHED (2026-10-21) — `npm run tourism:ntr`
  (`scripts/tourism/fetch_ntr.ts`). No cookie jar or postback turned out to be needed: the XPages
  page's table reads Domino's REST Data Service
  (`/CategoryzationAll.nsf/api/data/collections/name/vRegistarMNValid1?ps=100&page=N`, JSON,
  `Content-Range` total, no session). It writes the full register to gitignored
  `raw_data/tourism/ntr/mn_valid.json` and a committed per-municipality summary
  `data/tourism/ntr_summary.json` (objects / rooms / beds by kind and category). First crawl:
  41,422 objects, 577,069 beds; the view also counts 41 entries it never serves anonymously,
  so completeness is checked positionally, not by count. A municipality NAME resolves only when
  unique or when НТР disambiguates it („Бяла - Русе"); „Столична" maps to the city-wide `SOF`;
  plain „Бяла" (591 objects) stays unresolved. 216 objects state no beds and 3,371 no rooms —
  the sums are a floor. `--from-cache` re-summarises without a crawl. Still open: a surface for it, the
  expired-certificates view (`mnexpired.xsp`) and the other НТР views (`mnvu.xsp`), a watcher, and
  `bucket:sync` of the summary. The annual Eurostat `tour_occ_ninat` series has a WATCH-ONLY watcher since 2026-10-21
  (`eurostat_tourism_annual`; latest BG year 2025) — nothing reads it yet. Before this fetcher there was no
  static НТР snapshot to replace (checked 2026-10-21); the rest of the tourism data is the
  Eurostat-backed `data/tourism/visitors.json`, `src/lib/tourismReferenceData.ts` and the
  PG-served tourism procurement figures. Note the existing `eurostat_tourism`
  watcher covers `tour_occ_nim` and `tour_occ_ninraw`.
- **Water (`/water`)**:
  - Keep `water_quality_zones` separate from `vik_performance`: РЗИ / МЗ drinking-water monitoring
    zones (Наредба № 9/2001; БАБХ has no role here) are supply-zone strings (`Зона Пловдив`,
    `Зона Каменец`), not operator EIKs.
  - Keep `useWaterData` (static JSON) alongside `useWaterHubStats` (PG) while `/awarder/:eik`,
    `MyAreaWaterStrip`, and `ai/tools/water.ts` still consume `useWaterData`.
  - Optional later enrichments: per-zone `exceedance_2022_pct` / `exceedance_2023_pct` columns for
    a 3-year trend delta, and per-municipality drought mapping inside multi-municipality ВиК operators.

## People, Declarations & Officials

- **ЕРИК campaign donors ↔ contractors & TR officers (`donors-connections`)**: Build
  `party_donors_overview` and `donor_contractor_cross` SQL functions and a `DonorContractorCrossTile`
  on `/financing` and `/connections` to cross-reference ЕРИК campaign donors against procurement
  contractors and TR company officers (with an explicit namesake caveat on `name_fold` joins).
- **Officials `person_source` facets**: The category widening this entry used to describe is
  done. `scripts/officials/index.ts` ingests every category of the Сметна палата register
  (register.cacbg.bg — 95 category nodes, 52 non-empty in 2026) except MPs, municipal and
  judiciary: ~57 categories and 16,109 entries, including hospital directors, ЗОП signatories,
  rectors, MEPs and the President. Re-check whether any `person_source` facet is still empty, and
  close if not.
- **Judiciary (ИВСС) declarations**:
  - Enter ИВСС money tables 10/11/13 into `person_wealth_year`. All three are point-in-time stocks
    (verified 2026-10-21 on a 2026 filing): № 10 cash, № 11 bank accounts, № 13 debts over
    10,000 лв. The flows are № 18 (income) and № 20 (expenses). They map like cacbg tables 4/5/7.
    The form still prints thresholds in лева.
  - Interleave ИВСС and КПКОНПИ/Сметна палата filings chronologically into a single career timeline
    on `/person/:slug`.
- **Person identity & electoral history**:
  - Deterministic slug tiebreak by claim strength (`chooseStableSlug` / `resolve_persons.ts`
    deduplication loop) + slug-changed-hands retirement tripwire on the next full
    `db:resolve:persons:cloud`.
  - Extend stable CIK candidate keys to non-MP multi-cycle candidates who switched both party and
    МИР so they consolidate into one `person` profile without relaxing `weakBoth`.
  - Decide whether to use transient in-memory `Indent` (EGN hash) inside `resolve_persons.ts` to
    merge same-human TR roles without persisting EGN or linking private citizens.
  - Reconcile the 10 shortened-spelling ЕРИК candidate donor names (€7,285 total) that do not
    exact-match full ballot names in `085_person_elections.sql`.
  - `/candidate/:id/*` sub-page bodies (`CandidateConnectionsScreen`, `CandidateLocationsScreen`,
    `CandidateSectionsScreen`, `CandidateColleaguesScreen`) and `save_preferences.ts` shards remain
    name-keyed for shared-name candidates.
- **Local electoral history & village mayors (`kmetstvo`)**:
  - Build `person_local_elections` + `PersonLocalElectoralSection` on `/person/:slug` (mayoral
    round-1/round-2 votes + council list preferences across 2007–2023 local cycles) and wire
    `decorate_local_person_links.ts` into `update-persons` Step 5.
  - Attribute `kmet_kmetstvo` roles in `data/officials/municipal/index.json` to the village's own
    5-digit EKATTE (recovering the ~3,000 elected кметове на кметства from ЦИК's `chmi` / `mi2023`
    bundles and distinguishing кмет на кметство from кметски наместник).
- **Панагюрище (`PAZ20`) dual-mayor source anomaly**: Two sitting mayors (`Желязко Гагов` and
  `Никола Белишки`) remain allowlisted in `scripts/db/tests/officials_diff_missing.data.test.ts`
  until the Сметна палата register stops listing Белишки as a current кмет. ЦИК is not the
  blocker: the ВАС annulled the 2023 runoff, and Гагов won the 23.06.2024 нови избори in round 1
  (64.48%). ЦИК published it (`chmi2024-2026/2024-06-23_nov`), and the repo already holds it in
  `data/local_chmi_history.json`.
- **Retiring `/officials/*` & legacy person JSON shards**:
  - Activate the `/officials/*` → `/person/*` 301 rewrite in `firebase.json` and delete
    `OfficialProfileScreen` once `/person` prerender replaces the 5,000 static officials pages.
  - Move `councillor_signals` / `councillor_conflicts` (`data/officials/derived/`) into PG and
    retire per-candidate election shards (`data/{election}/candidates/**`) from disk and bucket.
  - Move load-only JSON sources (`data/officials/declarations/`, `candidates.json`) out of `data/`
    into a non-synced directory so `gsutil rsync` stops enumerating them.
- **Other person enrichments**:
  - Optional `data/person/party_leaders.json` (`party_leader` role in `resolve_persons.ts`),
    generalised ministerial tenure across all cabinet portfolios, and a single mayoral salary
    ceiling line. Since 01.01.2019, ПМС № 67/2010 чл. 5, ал. 16 lets the общински съвет set
    mayors' pay, capped at a minister's basic salary, so there are no population pay bands to
    encode.
  - External market-price benchmark for declared real estate remains blocked on an external
    property AVM / НСИ deals reference (`share` column must never be used as a price divisor).
  - Align `ASSET_ROW_CEILING_EUR` in `src/lib/declarations.ts` with `089_declarations.sql` (€50M)
    if still divergent.

## Elections, Parliament & Polls

- **Presidential elections**:
  - ⚠️ DUE NOW: round 1 is **25.10.2026** and the runoff **01.11.2026** (НС decision of
    31.07.2026, ДВ 04.08.2026; ЦИК slug `pvr2026`; 27 candidate pairs). The cycle folder is
    `2026_10_25_pvr`, with the runoff inside it (settled 2026-10-21, `6977245023`). Header and
    sitemap need no new wiring: the elections menu links `LATEST_PRESIDENTIAL_CYCLE` and the cycle
    dropdown lists presidential rows, and `/polls/presidential` (the real path, not
    `/presidential/polls`) already has BG + EN `<loc>`s and prerendered pages (verified
    2026-10-21). ⚠️ OPEN: the presidential ingest cannot run a round-1-only cycle —
    `PresidentialSource.rounds` requires both rounds and `download.ts` reads round 2
    unguarded — so round 1 cannot be published in the week before the runoff until that is made
    optional. Also still to do on results night: add the 2026 entry to
    `scripts/parsers_presidential/sources.ts` (it lists 2021/2016/2011/2006/2001 only, and the
    archive URLs need a browser check), and bump `LATEST_PRESIDENTIAL_CYCLE` from its literal
    `"2021_11_14_pvr"` — until both land, the header and the elections registry open 2021.
  - **24.10.2026, results-day readiness (operator, no code):** plain `curl` gets 403 on
    results.cik.bg and cik.bg, so prove the Cloudflare-warming path against a KNOWN-GOOD cycle
    the day before, where failure cannot be confused with „not published yet":
    `npm run data -- --pvr-download 2021_11_14_pvr --pvr-force` (headed Playwright, ~165 MB).
    `sources.ts` pins each archive's md5 and the downloader refuses a mismatch before
    extracting, so exit 0 with „2 archive(s) fetched" is the pass. Expect `SOURCE.json` to show
    as modified (a forced fetch rewrites its `fetchedAt`) and restore it with
    `git checkout -- raw_data/2021_11_14_pvr/SOURCE.json` before the auto-committer picks it up;
    any change under `ТУР1/` or `ТУР2/` is the real alarm. 2021 rehearses only the `click`
    strategy — also run `npm run data -- --pvr-download 2016_11_06_pvr --pvr-force` (the
    `goto` path, same checks) unless the 2026 entry is known to be `click`.
  - When 2026 round 1 (`2026_10_25_pvr`) drops, re-verify `runoffFlow` ridge-regularised OLS fit on
    live 2026 round-1 → round-2 pairs and calibrate `presidential_2026` risk-index weights once
    2026 round-1 section tallies exist.
- **Local neighbourhood corpus (`problem_sections_local`)** — see
  `docs/plans/local-neighbourhoods-coverage-v1.md`. Record correction (2026-10-21): the retired
  presidential-analysis-sections plan (`fa5260ca06`) recorded 2019/2023 matching **2**
  neighbourhoods against 7 in 2011/2015. That „2" was an out-of-order build (shards re-parsed,
  generator run before `--local-coords`), not a shrink: the corpus matches 7 / 7 / 8 / 8, the
  7 → 8 being Долно Езерово's Burgas codes `020400309–315`, created ~2016. The generator now
  refuses that build. Open:
  - Every local address is anachronistic: the backfill can only use 2022+ parliamentary
    addresses (2015's all come from `2026_04_19`; `addressSource` now records this on the next
    `--local-coords` run), so renumbered codes inherit today's building.
  - The planned ±50% roll-continuity filter (vs the same code's 2023 roll) was NOT shipped: it
    would drop 8 / 6 / 4 ADDRESS-MATCHED stations in 2011 / 2015 / 2019 across Pobeda, Fakulteta
    and Maksuda, not only the known 2015 Maksuda small stations `03396`/`03397`. Applied to every
    section carrying an `addressSource`, it would also drop prefix-matched Stolipinovo `009`
    (2011), `004/009/034/052` (2015, plus `071`, which has no 2023 roll) and `009/047` (2019).
    Any implementation must limit itself to address-rule matches and decide what a code missing
    from 2023 means; then decide per station before changing published numbers.
  - Долно Езерово before 2016 is placeable only from an era-correct section address list. ЦИК's
    CSV bundles carry no address field: 020400309–315 first appear in pvrnr2016, and mi2015 stops at 020400290. The ЦИК archive HTML is Cloudflare-blocked. The realistic source is Община Бургас's
    заповеди за образуване на избирателни секции (2011 / 2015 / 2016) or the РИК/ОИК decisions. Do
    not guess codes.
- **Parliamentary votes & bills**:
  - Decide whether to prerender a scored subset of `/votes/:date/:slug` item pages (top engaged
    URL family in the parliament module, currently SPA-only).
  - Ingest bills (`законопроекти`) from `parliament.bg` to populate `bill.final_item` and pass/fail
    law outcomes. Source: the undocumented SPA API. `POST /api/v1/fn-bills` with body `{}` lists
    recent bills; `GET /api/v1/bill/{L_Act_id}` returns ДВ promulgation (`L_Act_dv_iss` / `_year`),
    veto, withdrawn, committee reports and plenary transcripts. There is no single outcome field,
    so derive pass/fail from the ДВ fields plus the readings.

## Governance, Places & Council

- **Place header & my-area consolidation**:
  - Decide whether `/area` (`MyAreaDashboardScreen`, which also resolves exact streets via Nominatim
    to voting sections) should eventually redirect to `/governance/:code` once street-to-section
    lookup lives inside `GovernancePlaceScreen`.
  - Retire `data/schools/index.json` once `MyAreaQualityStrip` national rank semantics are verified
    against `schools_by_obshtina`.
  - Consider adding a regional producer link (`/governance/region/:oblast` → `/persons?oblast=<code>`)
    and per-place `og:image` share cards on `/governance/:id`.
- **Council resolution title coverage**: Improve title extraction in `scripts/council/` for `HKV09`
  (315 rows where the agenda is in the minutes header before the first `ПРЕДСЕДАТЕЛ:` turn),
  `SZR12` (352 rows requiring a two-hop fetch of the `ОС_NNNN` docket subject), and `PVN01` (132
  rows needing a fresh crawl because `source_url` 404s — a 2026-10-21 spot check found some
  `obs.pleven.bg/uploads/posts/protokol-*.docx` links live and some 404, so re-measure first).

## Prices & Consumption

- **Chain-specific product absence**: Do not equate missing `(chain, canon_id)` observations in
  КЗП „Колко струва" with physical out-of-stock shelf status; chains differ in ERP feed scope
  (e.g. T-Market maps 25/101 canonical products, Kaufland 77/101, Lidl 79/101).
- **Corrupt upstream КЗП CSV days**: Add `--skip-day <date>` to `scripts/prices/ingest.ts` if
  upstream publishes a malformed daily archive.
- **Store-by-store euro transition analysis**: Optional deep-dive over the 11.35M SCD-2
  `price_facts` rows tracking store-level price rounding around euro adoption.

## AI Chat & Search

- **Router modularization**: Behavior-neutral structural split of `routeText` in
  `ai/orchestrator/router.ts` into domain modules under `ai/orchestrator/routers/*`, plus a
  dedicated `ClarifyDialog` render test (`ai/app/chat/ClarifyDialog.test.tsx`).
- **Funding chat UI polish**: Clarify in the `/questions` funding prompt that ИСУН projects do not
  expose a signing date, replace the raw `financial_year_unavailable` reason string on missing ДФЗ
  egov years (`2024` in the 2015–2023 series) with human-readable copy, and split `/chat` funding
  starters into subtopics.
- **Standalone AI app retirement & legacy `elections-bg-llm` cleanup**: `ai.electionsbg.com`
  301s to the naiasno.bg HOMEPAGE, not `/chat`. Diagnosed 2026-10-21: `firebase.json` (target
  `ai`) is CORRECT — `electionsbg-ai.web.app/` answers `301 → naiasno.bg/chat` — but the custom
  domain carries a Firebase Hosting **domain-level redirect** (`redirectTarget: naiasno.bg`,
  MOVED_PERMANENTLY, path-preserving), which wins over every `firebase.json` rule. ⚠️ The fix is
  to CLEAR that redirect (Hosting console → Domains, or the `customDomains` API), NOT to add a
  `firebase.json` catch-all: the same domain-level redirect is also breaking `/legacy-export`,
  the recovery page where a returning reader exports chat history stored in THIS origin's
  `localStorage`, and a catch-all redirect would break it the same way (redirects precede
  rewrites). Then decide when the transition window closes and retire the standalone build —
  `ai/main.tsx`, `ai/index.html`, `vite.config.ai.ts`, `vite/ai-public-assets.ts`, the
  `dev/build/preview/deploy:ai` scripts and the `Build both applications` CI step. NOT `ai/app/`
  or `ai/App.tsx`: those ARE the live `/chat` (`src/screens/ChatScreen.tsx` imports them).
  Decommission the legacy `elections-bg-llm` Cloud Function project if no external callers
  remain; the current gcloud account has no access to it, so confirm whether it still exists.
- **Search money basis (`company_public_money`)**: `contracts_eur` in `company_public_money` uses
  full contract face value per linked EIK (so consortium contracts credit each member's row,
  matching `/company/:eik`). If consortium-split attribution is ever needed in search badges, add
  it as a separate column rather than changing `contracts_eur`.

## News (`news.naiasno.bg`)

- **Jev continuous sentiment & person-sentiment publication gates**:
  - Flip `NEWS_PUBLISH_JEV_LEANING`, `NEWS_PUBLISH_JEV_RUSSIA`, and `NEWS_PUBLISH_JEV_PARTIES` on
    in production once human-adjudicated calibration gates pass.
  - Flip `NEWS_PUBLISH_PERSON_RAIL`, `NEWS_PUBLISH_PERSON_PAGES`, `NEWS_PUBLISH_PERSON_GRID`, and
    `NEWS_PUBLISH_MAIN_SITE_MEDIA_TONE` on once the human adjudication queues (`Самоличност`,
    `Фамилии`, `Нови лица`, `Оценки` in `npm run news:review`) clear `person_accuracy_gate.py`.
- **Realtime worker & scheduler (Phases 5–6)**: Wire fast-path overlay invocation into
  `run_hourly.sh` / LaunchAgent scheduler, run a 72h unattended local soak test, and decide between
  local Mac mini vs a ~€6–9/mo EU VPS (Hetzner CX23 €5.49 / CAX11 €5.99 excl. VAT and IPv4 after
  the April and June 2026 repricings, with limited availability reported; Netcup has retired G12 and
  its smallest is the VPS 500 G12.5 at €8.26 on a 12-month term; prices checked 2026-10-21).
- **Browser-tier harvest resilience**: Add per-article fallback and `storageState` persistence in
  `news/scripts/harvest_browser.mjs` for `blitz.bg`, `dnevnik.bg`, `capital.bg`, and `24chasa.bg`.
- **Entity & mention linking (`resolve_mentions.py`)**:
  - Merge the 7 elected mayors whose two-part gazetteer surface is blocked by a candidate-only
    namesake (incl. Благомир Коцев, Варна — still in office as of 2026-10; detained 07.2025 and
    released on bail 11.2025, case pending) via `data/person/link_overrides.json`.
  - Make short abbreviation matching case-sensitive in `news/scripts/resolve_mentions.py` so
    lowercase `"мо"` does not false-match Министерство на отбраната (МО).
- **Ground-news model follow-ups**:
  - Full browse route for the „Показваме 1 от N" feed link and server/index-level filtering before
    pagination on `OutletScreen`.
  - Story auto-join promotion gate (requires ≥300 adjudicated accepted test pairs across ≥50
    events with observed precision ≥0.99 and 95% Wilson LB ≥0.97).
  - Bounded full-text/chunked pass for the ~13.5% of articles exceeding the 6,000-character body
    prefix.
  - Frontier-model reference baseline (`analyze_articles.py --eval-frontier` on the 250-article
    gold set) on `/methodology`.
  - Coverage-gap discovery route on observable outlet-health cohorts, `Outlet` EIK/ownership
    provenance on `OutletScreen`, and production analytics sink + consent check for
    `window.naiasnoNewsAnalytics`.

## Infrastructure, Database & Site Hygiene

- **Cloud SQL tier selection (`electionsbg-pg`)**: Currently running `Enterprise / db-custom-2-13312`
  (~$160/mo, 1.56× slower under 8-way concurrency with a 778 ms `person_connections` tail vs
  `Enterprise Plus / db-perf-optimized-N-2` at ~$229/mo; confirmed by `gcloud sql instances describe`
  2026-10-21, and CLAUDE.md's header was corrected in `7b62716bb7`). Tier windows from the Cloud
  Audit Log: `db-g1-small` until 2026-08-20 08:57Z → `db-perf-optimized-N-2` until 2026-08-27 02:54Z
  → `db-custom-2-13312` since, unchanged for eight weeks; `shared_buffers` 4324 MB now vs 5332 MB on
  N-2. Every figure dated 2026-08-29 or later is a measurement of the CURRENT box — e.g. the person
  chain at 7m35s, and in the publish traces TR at 497–670 s and roll-call derived at 188–202 s over
  2026-08-29 → 2026-09-09 (later runs reach TR 687–742 s, once 1,189 s, and roll-call derived
  237–260 s). The 08-22 / 08-27 tables are N-2. Decide whether to stay on `db-custom-2-13312`, move
  to `db-custom-2-15360` (~$173/mo) to eliminate buffer-pool evictions, or return to
  `db-perf-optimized-N-2`.
- **Cloud loader resilience & deploy speed**:
  - Suppress per-loader matview double-refresh during multi-loader runs (`--defer-refresh` /
    `NAIASNO_DEFER_REFRESH=1`).
  - Set non-zero `idle_in_transaction_session_timeout` (e.g. `10min`) on Cloud SQL + TCP keepalives
    in `scripts/db/lib/pg.ts`.
  - Add `--post-only` flag to `scripts/db/load_pg.ts` so interrupted runs after COPY can finish
    `postLoad` without re-copying.
- **Bundle & i18n splits**:
  - `governments.json` is in `bucket:gz`'s `GLOBAL_FILES` since 2026-10-21; the bucket copy is
    still the uncompressed 2026-05-11 upload (content identical), so the remaining step is
    `npm run bucket:gz`.
  - Next candidate locale bundles to split out of `src/i18n.ts` when entry JS byte budgets tighten:
    `funds`, `procurement`, `person`, `indicators`, `local`.
- **Data Hub (`/data`) granularity**:
  - Split `README.md` `## Data sources` implementation notes into skills/docs and replace the long
    source list with a pointer to `/data/sources`.
  - Attribute runtime freshness on `/data` per watcher source (`ManifestSourceRef`) rather than at
    `SOURCE_GROUP` union grain, and add dedicated dataset nodes for `ds:air`, `ds:tourism`,
    `ds:environment`, and `ds:landuse`.
- **Testing & GDPR**:
  - Optional `scripts/db/tests/skip_budget.test.ts` meta-test asserting a ceiling on skipped gates
    during `npm run test:data`.
  - External GDPR counsel review of `/privacy` "People in our data" Art. 14 / journalistic
    exemption wording (`src/screens/privacy/privacyContent.ts`).
- **Site hygiene follow-ups**:
  - Optional `scripts/audit/site_hygiene.test.ts` static gates (asserting every `.ts`/`.tsx` under
    `src/screens/` is reachable from `src/routes.tsx` and every `<Link to="/...">` matches a known
    route pattern).
  - Remove dead routes `/company/:eik/awards` (`CompanyAwardsDbScreen.tsx`) and `/Test` (`Test.tsx`)
    if confirmed unused, or link `/company/:eik/awards` from `CompanyDbScreen`.
