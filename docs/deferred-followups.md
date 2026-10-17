# Deferred follow-ups

This is the compact home for work deliberately left outside an otherwise completed
implementation. Entries stay only while they name an unresolved decision, a concrete trigger,
or a bounded next step. Completed implementation histories belong in Git, not here.

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
- **Historical TR `valid_from` / `valid_to` (`tr_person_history`)**: The daily XML dump emits full
  entity state with zero `<Erase>` tags and no role appointment date; genuine tenure dates require
  computing snapshots across consecutive daily XMLs (`first_seen_date` / `last_seen_date`) and/or
  parsing Act `1005010` (`Учредяване` / `Прехвърляне на дружествен дял`) from the CR Deeds store.
  Until built, `contracts_during_tenure` stays gated out of `person_connections` and `graph_edges`.
- **CR Deeds full crawl & investigative signals**: Run the resumable ~56k-EIK CR Deeds crawl
  (`npm run declarations:cr-deeds:fetch && npm run declarations:cr-deeds:parse && npm run declarations:cr-deeds:project && npm run db:load:cr-founding:pg`)
  and ship `db:load:cr-founding:pg:cloud` + `db:load:procurement-risk:pg:cloud` so `youngWinner`
  activates in production. Follow-up signals over the parsed CR Deeds store: ownership block +
  share-transfer timeline on `/company/:eik`, multi-hop corporate ownership chain
  (`company_owner_edge`), thin-capitalisation signal (`capital_bgn <= 100` winning >€500k),
  phoenix/transformation lineage (`Правоприемство`), ГФО filing compliance chip (`Field 06010`),
  shared registered-address cluster (`Field 00050`), and UBO (`Field 05400`) vs registered owner
  comparison.
- **Company-page consolidation bucket cleanup**: Remove retired legacy blobs from GCS once verified
  unused (`gsutil rm gs://data-electionsbg-com/parliament/companies-index.json` and
  `gsutil rm gs://data-electionsbg-com/officials/derived/company_links.json`).
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
- **ЦАИС ЕОП pre-2026 EUR `CurrentContractValue` guard & `T`-id canonicalization**: Out of 365
  2020–2025 contracts tagged `EUR` in the АОП portal CSV, ~322 were entered in BGN under an `EUR`
  label. Do not divide by `1.95583` without verifying `Currency === "EUR"` on `storage.eop.bg`
  JSON (`scripts/procurement/verify_eur_currency_eop.ts`). Separately, normalize `T`-prefixed
  tender IDs (`T201919` vs `00073-2020-0016`) via the `storage.eop.bg` `TenderNumber` cross-map.
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
  as „за преглед" with gated person↔company edges. Candidate external procurement datasets:
  АОП external-experts register (чл. 229, ал. 1, т. 17 ЗОП), ЗМИП beneficial owners, АДФИ
  inspections + Сметна палата audit reports, subcontractors (`подизпълнители`), ИСУН financial
  corrections (`нередности`), and TED above-threshold cross-checks.

## EU Funds, Open Calls & Subsidies

- **Grant → tender → contract UI surfaces (`166_grant_contract_link.sql`)**: The ПИИ money-spine
  table is populated in PostgreSQL; wire the strip onto `/funds/contract/:key`, `/awarder/:eik`,
  and `/culture/funds#spine`.
- **Blocked open-calls arms**: Add scrapers for АХУ (`ahu.mlsp.government.bg`, currently
  connection-reset) and remaining Interreg programmes (RO-BG, BG-RS, BG-MK, BG-TR) if/when their
  hosts become reachable; evaluate АЗ (`az.government.bg`) as `indicative`-only if intake windows
  are published. Ensure `DELETE FROM open_calls WHERE source = 'interreg' AND closes_at IS NULL;`
  has been applied on Cloud SQL.
- **Upstream keep.eu Interreg coverage gaps**: Interreg IPA Bulgaria–Serbia 2021–2027 currently
  has 0 projects in keep.eu; Greece–Bulgaria 2021–2027 publishes 0% partner budgets/postcodes;
  URBACT IV & ESPON 2030 publish partial/0% budgets.
- **ИСУН 2020 per-project executors**: Full crawl of `2020.eufunds.bg` detail pages is shelved
  due to WAF rate limits; revisit via a ЗДОИ bulk-data request to ЦКЗ if per-project subcontractor
  and payment schedules are needed at scale.
- **Funds prerender drill-downs**: Consider prerendering top `/funds/contract/:number` and
  `/company/:eik` destinations linked from `scripts/prerender/fundsTables.ts` so non-JS crawlers
  following drill-down links do not land on the bare SPA shell.
- **ДФЗ / Subsidies hub follow-ups**:
  - Backfill 2015–2022 `data.egov.bg` ДФЗ CSVs (currently unloaded because scheme columns are
    merged into two macro-buckets `ЕФГЗ + ЕЗФРСР`).
  - Refine `scripts/agri/match_seu_eik.ts` so exact legal-name matches without a legal-form marker
    (ET / ЕООД / ООД / АД / ЗК / ДЗЗД) are verified against `tr_companies` rather than skipped.
  - Evaluate joining natural-person (`ФЛ`) СЕУ rows to `person` strictly where municipality +
    three-part name is unique.
  - Build a dedicated measure page `/subsidies/measure/:code` when per-measure drill-down is needed.

## Budget & Macro

- **Historical КФП monthly time series (1998–present)**: Ingest MinFin's historical monthly КФП
  workbooks (`minfin.bg/bg/statistics/13` and `statistics/4`) into a multi-year series table once
  BGN→EUR pre-2026 conversion and methodology changes (2014 Cash→ESA 2010 and 2016 chart-of-accounts
  restructure) are annotated.
- **СЕБРА daily payment execution**: Ingest `mof.bg` per-ППРБ daily СЕБРА payment tables as a
  separate budget execution pipeline.
- **Trimming `/budget/deep-dive` (`BudgetScreen.tsx`)**: Retire the legacy inline tiles
  (`PersonnelSection`, `AdminComparisonSection`, `SocialFundsCard`, `CapitalComparisonCard`,
  `DeviationsSection`) from `/budget/deep-dive` once the route is scoped strictly to the
  interactive tax/budget sandbox.
- **Municipal fiscal commitments historical eras (pre-2024)**: Add per-era column maps for pre-2024
  MinFin workbooks cached in `data/_cache/minfin_municipal_fiscal/` (2022–2023 62-column shift,
  2021 59-column shift, 2016–2020 layouts, and Q4-anchored explicit чл. 130а criteria sheets).
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
- **Administration**: `analytics.egov.bg` e-service transaction volumes and client-satisfaction
  scores remain deferred until the JS-rendered portal exposes a stable open-data export.
- **Agriculture**: Decide whether the six чл. 163 ЗГ state forestry enterprises (`ДП` and their
  териториални поделения) belong in „Земеделие" (must be delimited by EIK, never by name regex).
- **Culture**:
  - Hand-classify the ~17 `държавен` rows in МК's „Регистър на музеите" `.xlsx` across principals
    (МК vs МО vs БАН).
  - Compute читалища subsidy per subsidised unit (`Единен разходен стандарт × subsidised units`
    per община).
  - Gate any НФЦ/НФК commission ↔ recipient overlap surface on defamation-policy sign-off.
- **Customs**: Verify whether Агенция „Митници" published a 2025 `fines_total` figure in
  „Митническа хроника" (`data/customs/enforcement.json` currently has `fines_total: null` for 2025).
- **Health (НЗОК)**:
  - Surface `periodByStream` on the national `/awarder/121858220` pack (`HealthPack.tsx`) so the
    pack header shows per-stream month coverage (`105/105` vs `44/105` months) like `/company/:eik`.
  - Evaluate НЗИС open data (`opendata.his.bg`) e-referral / e-prescription volume cross-check
    against НЗОК billed activities.
- **Social & Pensions (МТСП / НОИ)**:
  - НОИ 28-ТП territorial map (requires ingesting pensioners-by-ТП from `data.egov.bg` + pre-2023
    B1 backfill).
  - Resolve the 14 unmatched rows in `data/social/aksu_homes.json` (`1,182 / 1,196` municipality
    match) by joining settlement names via `data/ekatte.json` when an AKSU row names a village
    rather than an община.
- **Revenue (НАП)**: Keep `scripts/nap/Cross_check_issuers.ts` as a standalone probe only —
  joining `nap_issuers` to `contracts` over-counts multi-activity retailers (fuel chains,
  telecoms, pharmacies) because `contracts.cpv_code` is 99.66% NULL in the АОП portal CSV.
- **Tourism**: Build an automated scraper for `ntr.tourism.government.bg` (currently blocked by a
  JS-driven session gate) to replace the static 2026-08 snapshot in `data/tourism/ntr.json`, and
  add a fresh Eurostat `tour_occ_ninat` watcher.
- **Water (`/water`)**:
  - Keep `water_quality_zones` separate from `vik_performance`: БАБХ/РЗИ drinking-water monitoring
    zones are supply-zone strings (`Зона Пловдив`, `Зона Каменец`), not operator EIKs.
  - Keep `useWaterData` (static JSON) alongside `useWaterHubStats` (PG) while `/awarder/:eik`,
    `MyAreaWaterStrip`, and `ai/tools/water.ts` still consume `useWaterData`.
  - Optional later enrichments: per-zone `exceedance_2022_pct` / `exceedance_2023_pct` columns for
    a 3-year trend delta, and per-municipality drought mapping inside multi-municipality ВиК operators.

## People, Declarations & Officials

- **ЕРИК campaign donors ↔ contractors & TR officers (`donors-connections`)**: Build
  `party_donors_overview` and `donor_contractor_cross` SQL functions and a `DonorContractorCrossTile`
  on `/financing` and `/connections` to cross-reference ЕРИК campaign donors against procurement
  contractors and TR company officers (with an explicit namesake caveat on `name_fold` joins).
- **Widen Сметна палата `CATEGORY_MAP` (`scripts/officials/index.ts`)**: Expand beyond the 7
  currently mapped categories to ingest the remaining ~49 categories (~9,000 declarants/year:
  hospital directors, ОП/ДП boards, ЗОП signatories, diplomatic heads, university rectors, MEPs,
  President, and statutory regulator filings) and fill the empty `person_source` facets.
- **Judiciary (ИВСС) declarations**:
  - Adjudicate ИВСС money tables 10/11/13 stock-vs-flow semantics before entering `person_wealth_year`.
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
  until ЦИК publishes the `chmi` bundle or the municipal roster marks Белишки as former.
- **Retiring `/officials/*` & legacy person JSON shards**:
  - Activate the `/officials/*` → `/person/*` 301 rewrite in `firebase.json` and delete
    `OfficialProfileScreen` once `/person` prerender replaces the 5,000 static officials pages.
  - Move `councillor_signals` / `councillor_conflicts` (`data/officials/derived/`) into PG and
    retire per-candidate election shards (`data/{election}/candidates/**`) from disk and bucket.
  - Move load-only JSON sources (`data/officials/declarations/`, `candidates.json`) out of `data/`
    into a non-synced directory so `gsutil rsync` stops enumerating them.
- **Other person enrichments**:
  - Optional `data/person/party_leaders.json` (`party_leader` role in `resolve_persons.ts`),
    generalised ministerial tenure across all cabinet portfolios, and `data/officials/kmet_pay_bands.json`
    (ПМС № 67/2010 statutory salary ceiling line).
  - External market-price benchmark for declared real estate remains blocked on an external
    property AVM / НСИ deals reference (`share` column must never be used as a price divisor).
  - Align `ASSET_ROW_CEILING_EUR` in `src/lib/declarations.ts` with `089_declarations.sql` (€50M)
    if still divergent.

## Elections, Parliament & Polls

- **Presidential elections**:
  - Wire `/presidential` into the main header/cycle switcher when `2026_11_pvr` approaches and add
    `/presidential/polls` to `scripts/sitemap/route_defs.ts`.
  - When 2026 round 1 (`2026_11_pvr`) drops, re-verify `runoffFlow` ridge-regularised OLS fit on
    live 2026 round-1 → round-2 pairs and calibrate `presidential_2026` risk-index weights once
    2026 round-1 section tallies exist.
- **Parliamentary votes & bills**:
  - Decide whether to prerender a scored subset of `/votes/:date/:slug` item pages (top engaged
    URL family in the parliament module, currently SPA-only).
  - Ingest bills (`законопроекти`) from `parliament.bg` to populate `bill.final_item` and pass/fail
    law outcomes.

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
  rows needing a fresh crawl because `source_url` 404s).

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
- **Standalone `ai/app/` retirement & legacy `elections-bg-llm` cleanup**: Once the post-launch
  soak and domain flip (`docs/plans/naiasno-flip-runbook-v1.md`) complete, retire the standalone
  `ai/app/` SPA entrypoint (`ai/app/main.tsx`, `ai/app/index.html`, `ai/app/vite.config.ts`) in
  favor of 301 redirects from `ai.electionsbg.com` to `naiasno.bg/chat`, and decommission the
  legacy `elections-bg-llm` Cloud Function project if no external callers remain.
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
  local Mac mini vs a €4–5/mo EU VPS (Hetzner CX23/CAX11 or Netcup VPS 200 G12).
- **Browser-tier harvest resilience**: Add per-article fallback and `storageState` persistence in
  `news/scripts/harvest_browser.mjs` for `blitz.bg`, `dnevnik.bg`, `capital.bg`, and `24chasa.bg`.
- **Entity & mention linking (`resolve_mentions.py`)**:
  - Merge the 7 elected mayors whose two-part gazetteer surface is blocked by a candidate-only
    namesake (incl. Благомир Коцев, Варна) via `data/person/link_overrides.json`.
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
  `Enterprise Plus / db-perf-optimized-N-2` at ~$229/mo). Decide whether to stay on
  `db-custom-2-13312`, move to `db-custom-2-15360` (~$173/mo) to eliminate buffer-pool evictions,
  or return to `db-perf-optimized-N-2`.
- **Cloud loader resilience & deploy speed**:
  - Suppress per-loader matview double-refresh during multi-loader runs (`--defer-refresh` /
    `NAIASNO_DEFER_REFRESH=1`).
  - Set non-zero `idle_in_transaction_session_timeout` (e.g. `10min`) on Cloud SQL + TCP keepalives
    in `scripts/db/lib/pg.ts`.
  - Add `--post-only` flag to `scripts/db/load_pg.ts` so interrupted runs after COPY can finish
    `postLoad` without re-copying.
- **Bundle & i18n splits**:
  - Re-upload `canonical_parties.json` and `governments.json` to GCS with gzip content encoding
    (`gsutil -h "Content-Encoding:gzip" cp -Z ... gs://data-electionsbg-com/`).
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
