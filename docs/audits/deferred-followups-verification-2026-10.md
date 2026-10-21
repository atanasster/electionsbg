# deferred-followups.md — external-claim verification (2026-10-21)

Scope: every entry in `docs/deferred-followups.md` (state at `b60eaf2a41`, 379 lines) that makes a
claim about the outside world — a register, URL, statute, dataset availability, named person/office,
infrastructure state. Purely internal engineering items are listed at the end as "internal, not
checked". All sources were accessed **2026-10-21**. Money in EUR (BGN converted at 1.95583).
The followups file itself was NOT edited; proposed edits are in the last column and summarised in
§ "Proposed edits".

Verdicts: **confirmed** · **contradicted** (the claim was wrong when written) · **outdated** (was
true or plausible, the world or the repo has moved on) · **unverifiable**.

Method: four parallel research passes (procurement/TR, funds/open calls, budget/sectors,
people/elections) plus direct checks of infrastructure (`gcloud`, `gsutil`, `curl`) and local raw
data. Where a public site was unreachable from this machine (minfin.bg and results.cik.bg sit
behind Cloudflare and return 403 to automated clients), Wayback captures or the repo's own cached
copy of the source were used, and that is stated in the row.

## Headline

- **Candidates to close outright (premise gone):** bucket cleanup (both blobs already removed);
  Сметна палата `CATEGORY_MAP` widening (already ingests ~57 categories / 16,109 entries);
  „candidate datasets" АДФИ / подизпълнители / TED (shipped as 173/171/172); ДФЗ 2015–2022 backfill
  (the premise is wrong and those years are already loaded); `ai.electionsbg.com` redirect (already
  301s).
- **Premise wrong — rewrite before anyone acts on it:** TR daily feed „zero `<Erase>` tags"; CR
  Deeds field codes (`06010`, `05400`, `1005010` are wrong); storage.eop.bg field names and the
  missing `verify_eur_currency_eop.ts`; `minfin.bg/statistics/13` and `/4` (annual КФП and fiscal
  reserve, not monthly КФП); `mof.bg` (a fashion site); `analytics.egov.bg` (a Matomo instance with
  an open API); `opendata.his.bg` (no e-referral/e-prescription data); „БАБХ" for drinking water;
  Interreg host names; ЦКЗ ministry.
- **Time-critical:** the presidential election is **25.10.2026** (round 1, four days from now) with
  a runoff on **01.11.2026**. The entry „when `2026_11_pvr` approaches" is now due, and the
  `2026_11_pvr` folder name does not match round 1's month.
- **Repo-internal contradictions surfaced:** CLAUDE.md says Cloud SQL is `db-perf-optimized-N-2`;
  the live instance is `db-custom-2-13312` / ENTERPRISE, as this followups file says. CLAUDE.md
  cites „чл. 232а, ал. 2 ЗОП" for the experts register; the current law puts it at чл. 229,
  ал. 1, т. 17. Five repo paths the followups file names do not exist.

## Results

### Companies & Commerce Registry

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 1 | Historical TR `valid_from`/`valid_to` | The TR daily dump „emits full entity state with zero `<Erase>` tags and no role appointment date". | **contradicted** | Local copy of the data.egov.bg TR daily feed: `raw_data/tr/daily/2026-10-16.json` (116 `Erase` ops, 3 `EraseProcura`, 1 `EraseDistraint`), `20210104.json` (175), `2023-09-05.json` (163); `scripts/declarations/tr/parse_daily_filing.ts` | The feed is a **delta** (`PackageType:"ForChange"`): every field carries `FieldOperation` Add/Erase, and there are dedicated erase sections (`EraseActualOwner` 05510, `EraseProcura`). Every field also carries `FieldEntryDate` / `FieldActionDate`, the date the circumstance was entered in the register. What is true: no contractual appointment date separate from the register entry date, and prior vintages are not always erased (the `tr_owner_share` problem). **Edit:** replace the premise with „the feed is a change log with entry dates per field; tenure can be built from `FieldEntryDate` + Erase ops, with the known gap that old vintages are not always erased". |
| 2 | CR Deeds signals | Act `1005010` = Учредяване / Прехвърляне на дял; Field `06010` = ГФО filing; `00050` = registered address; `05400` = UBO; `Правоприемство` = lineage. | **contradicted** (only `00050` correct) | `raw_data/tr/cr_deeds.sqlite` (6,000-company read-only sample); `scripts/declarations/tr/__fixtures__/cr_deeds/ood.json`; daily feed element names | `00050` = `Seat` ✔. `06010` = `TransferringEnterprise` (прехвърляне на предприятие, `CR_F_601_L`), not the ГФО. The ГФО is a document act (`ActModeValue` 2 „Годишен финансов отчет"), not a field. UBO is `05500` `ActualOwners` (`05510` erase). `1005010` and `Правоприемство` appear nowhere in the repo, the capture or the feed — only in this doc. No public Registry Agency nomenclature was found online. **Edit:** correct the codes (06010→ГФО via ActModeValue 2; 05400→05500); mark the act code and lineage field as unidentified. |
| 3 | CR Deeds signals — UBO comparison | Compare UBO to registered owner. | **outdated (legal)** | ЗМИП чл. 63б (ДВ бр. 49/2025): https://lex.bg/bg/laws/ldoc/2137182924 ; https://webgate.ec.europa.eu/e-justice/38576/BG/beneficial_ownership_registers__search_for_beneficial_ownership_information | Since ДВ 49/2025, access to UBO data is limited to authorities, obliged entities and persons with a „законен интерес" (the post-CJEU C-37/20 & C-601/20 regime). The TR open-data feed still carries `ActualOwners` with names and addresses (ЕГН hashed), and the repo parses them. **Edit:** gate the UBO signal on a legal/GDPR decision before building it. |
| 4 | Bucket cleanup | `parliament/companies-index.json` and `officials/derived/company_links.json` are still in GCS. | **outdated** | `gsutil ls gs://data-electionsbg-com/parliament/companies-index.json` and `…/officials/derived/company_links.json` → „matched no objects" | Both are already gone. **Edit:** close the entry. |

### Procurement & Dossiers

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 5 | Cross-source date tolerance | АПИ procedures `00044-2023-0015` and `00044-2023-0029` exist (together €67.0m of long-tail candidates). | **confirmed** (existence; the €67.0m is internal) | https://ted.europa.eu/en/notice/95594-2023/xml ; https://ted.europa.eu/en/notice/172740-2023/xml | `-0015`: „Поддържане и ремонтни дейности на републиканските пътища…", lots by ОПУ, published 15.02.2023, estimated €267.24m. `-0029`: road signs by regional lot, published 22.03.2023, estimated €51.13m. Matched on buyer + title + identical estimated value; TED does not print the УНП. Both are multi-lot framework procedures, so date-tolerant matching there is plausibly ambiguous. No edit. |
| 6 | ЦАИС ЕОП EUR guard & `T`-ids | Verify `Currency === "EUR"` on storage.eop.bg JSON with `scripts/procurement/verify_eur_currency_eop.ts`; cross-map `T`-ids via a `TenderNumber` field. | **contradicted** | https://storage.eop.bg/open-data-2026-10-19/… (daily JSON, 200, 438,604 B); `scripts/procurement/ingest_eop.ts`; `git log --all -- scripts/procurement/verify_eur_currency_eop.ts` (no history) | storage.eop.bg publishes **one JSON per day**, not per contract. Keys are camelCase `currency` **and** `contractCurrency` (they can disagree), `tenderId`, `uniqueProcurementNumber`; no `Currency` or `TenderNumber`. `T`-ids are `"T" + tenderId` placed in `uniqueProcurementNumber` when there is no УНП, so the cross-map key is `tenderId`. The named script does not exist and never did. **Edit:** fix the field names, say which of the two currency fields to trust, and drop the script reference (or write it). |
| 7 | Review queue — external experts | „АОП external-experts register (чл. 229, ал. 1, т. 17 ЗОП)" is a candidate dataset. | **confirmed (statute); partly outdated (dataset)** | ЗОП: https://lex.bg/laws/ldoc/2136735703 ; https://www.aop.bg/ets.php ; `scripts/db/schema/pg/174_aop_experts.sql` | Current чл. 229, ал. 1, т. 17 is indeed the experts list. Current чл. 232а (in force 22.07.2024) is about ex-ante control. aop.bg/ets.php still cites the repealed 2019–2020 чл. 232а, ал. 2, and that historical list (88 experts) is what 174 loads. The live чл. 229 т. 17 list is still not ingested (CLAUDE.md: `ee2014.php` is 404). **Edit:** say the historical list shipped as 174; the live one is open. **Also fix CLAUDE.md's „чл. 232а, ал. 2" citation.** |
| 8 | Review queue — ЗМИП beneficial owners | Candidate dataset. | **outdated (legal)** | as row 3 | Access was narrowed by ДВ 49/2025; see row 3. |
| 9 | Review queue — АДФИ, подизпълнители, TED | Candidate datasets. | **outdated** | `scripts/db/schema/pg/171_subcontractors.sql`, `172_ted.sql`, `173_adfi.sql` | All three shipped. Only Сметна палата audit reports remain open (no migration or loader). **Edit:** remove the three; keep „Сметна палата audit reports". |
| 10 | Review queue — ИСУН нередности | „ИСУН financial corrections (`нередности`)" is a candidate dataset. | **contradicted** | https://antifraud-knowledge-centre.ec.europa.eu/guidance-legislation/faq_bg ; https://aeuf.minfin.bg/upload/487/Методология.pdf ; `175_isun_clean_delivery.sql` | No public per-project register exists. Irregularities go to OLAF's IMS (confidential) and are published only as aggregates. The public counterpart, the „clean delivery" register, already shipped as 175 and must not be inverted into a list of corrections. **Edit:** remove, citing the CLAUDE.md warning. |

### EU Funds, Open Calls & Subsidies

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 11 | Blocked open-calls arms — АХУ | `ahu.mlsp.government.bg` is „currently connection-reset". | **outdated** | https://ahu.mlsp.government.bg/ → 302 → `/home/` (200, two probes); https://ahu.mlsp.government.bg/portal/page/123 ; `/portal/page/7` | Reachable, same domain. АХУ runs annual project rounds under named методики (чл. 49/51 ЗХУ, НПЗХУ) and publishes dated evaluation protocols for 2026; the intake announcements themselves were not opened. **Edit:** unblock and re-scope as a scraper task (pages 7/123; filter staff competitions on page 4). |
| 12 | Blocked open-calls arms — Interreg RO-BG | Romania–Bulgaria publishes no calls index. | **contradicted** | https://interregviarobg.eu/en/calls-for-proposals ; https://interregviarobg.eu/en/the-indicative-timetable-for-planned-calls-of-proposals ; https://interregrobg.eu/en/calls-for-proposals/open-calls.html | The 2021–27 programme lives on **interregviarobg.eu**, with Open/Closed sections (Calls 1–7 closed) and an indicative timetable. interregrobg.eu is the 2014–2020 site. **Edit:** point the parser at interregviarobg.eu; no open call today. |
| 13 | Blocked open-calls arms — BG-RS / BG-MK / BG-TR | Hosts reset the connection. | **outdated (wrong hosts)** | https://ipa-bgrs.mrrb.bg/en , https://ipa-bgmk.mrrb.bg/en , https://ipa-bgtr.mrrb.bg/en (all 200) | The live sites are МРРБ subdomains. Old `ipa-cbc-*` domains fail on DNS or are refused, and `ipa-cbc-programme.eu` is Greece–North Macedonia. The mrrb.bg hosts serve an incomplete TLS chain, so strict clients fail („unable to verify the first certificate") — likely the original „reset". No open call as of 2026-10-21 (BG-RS 2nd SME call closed 31.03.2026). **Edit:** replace the hostnames and note the TLS-chain quirk. |
| 14 | Blocked open-calls arms — АЗ | Evaluate АЗ as `indicative`-only if it publishes intake windows. | **confirmed** | https://www.az.government.bg/bg/news/view/agencijata-po-zaetostta-otkriva-novi-vyzmojnosti-za-rabotodatelite-po-nacionalni-programi-i-merki-4263/ ; https://www.az.government.bg/bg/news/view/nov-priem-po-ay-izbiram-bylgarija-au-tozi-pyt-sys-stimuli-za-jivot-i-rabota-izvyn-golemija-grad-4265/ | Windows are published as dated news prose (employers 16–26.10.2026; „Старт на кариерата" to 30.10.2026), not as a structured register. Keep the entry as written. |
| 15 | Blocked open-calls arms — Cloud SQL one-off | `DELETE FROM open_calls WHERE source='interreg' AND closes_at IS NULL` applied on Cloud SQL? | internal, not checked | — | DB operator step. |
| 16 | keep.eu gaps — BG-RS | IPA BG-RS 2021–27 has 0 projects in keep.eu. | **confirmed** | https://keep.eu/api/programme/307/ | `projects_in_keep = 0` against the programme's own 10 projects / 60 partnerships (record modified 2026-10-09). |
| 17 | keep.eu gaps — GR-BG | Greece–Bulgaria 2021–27 publishes 0% partner budgets/postcodes. | **confirmed** | https://keep.eu/api/programme/343/ | 21/21 projects and 85/85 partnerships are now present (€49,818,765 EU funding); 0/85 budgets and postcodes. The repo's `coverageNote` „38% of partnerships" is stale. |
| 18 | keep.eu gaps — URBACT IV / ESPON 2030 | Both publish partial/0% budgets. | **URBACT confirmed; ESPON outdated** | https://keep.eu/api/programme/393/ ; https://keep.eu/api/programme/395/ | URBACT IV: budgets 521/544 (95.8%), postcodes 0. ESPON 2030: keep.eu now holds **0 of 110 projects**, a bigger gap than partial budgets. **Edit:** reword ESPON. |
| 19 | ИСУН per-project executors | Detail pages are shelved for WAF rate limits; revisit via a ЗДОИ request to ЦКЗ. | **confirmed, with corrections** | https://2020.eufunds.bg/bg/0/0/Project/BasicData?contractId=1 (F5 „Request Rejected" 3/3 cold); https://www.eufunds.bg/bg/node/457 ; https://www.bulnao.government.bg/bg/documents/15523/PK_ISUN-112025.pdf ; https://www.gov.bg/bg/administratsia/dostap-do-informatsia | A cold request is blocked, so this is a client-fingerprint block (CLAUDE.md's curl-without-Referer route), not just a rate limit. ЦКЗ sits at the **Администрация на Министерския съвет** (ПМС 265/2024); the ЗДОИ route is via gov.bg / ms_register@government.bg. **Edit:** say „blocked (fingerprint)", and name МС as the ЗДОИ addressee. |
| 20 | ДФЗ backfill 2015–2022 | egov ДФЗ CSVs for 2015–2022 are unloaded because scheme columns are merged into two macro-buckets `ЕФГЗ + ЕЗФРСР`. | **contradicted** | https://data.egov.bg/api/getResourceMetadata (FY2015 `af68bcf4-…`), https://data.egov.bg/api/getResourceData (FY2022 `6143ad6c-…`); local `agri_subsidies` row counts | Every year's header carries a per-row **„Мярка"** column (47–83 schemes a year) and **three** fund columns (ЕФГЗ-ДП, ЕФГЗ, ЕЗФРСР-НБ). FY2015/16/17/21/22 are **already loaded** (307,997 / 312,981 / 365,619 / 407,109 / 334,480 rows). The real gap is FY2018–2019 (absent from the portal) and FY2020 (empty resource). data.egov.bg's certificate verified fine today. **Edit:** replace with „FY2018–2020 are missing upstream; watch for a re-publication". |

### Budget & Macro

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 21 | Historical КФП monthly series | Monthly КФП workbooks are at `minfin.bg/bg/statistics/13` and `/4`; breaks are „2014 Cash→ESA 2010" and „2016 chart-of-accounts restructure". | **contradicted** | https://web.archive.org/web/20250424132230/https://www.minfin.bg/bg/statistics/13 ; https://web.archive.org/web/20250429120730/https://www.minfin.bg/bg/statistics/4 ; https://www.minfin.bg/bg/statistics/5 (Wayback); live minfin.bg is behind Cloudflare | `/13` is the **annual** КФП (1998–2013, 2014–2023); `/4` is the **Фискален резерв**. Monthly КФП is `/statistics/5` (quarterly `/6`). КФП stayed cash-based; the 2014 break is ЗПФ plus a GFSM 2014 presentation, not ESA 2010 (that is Eurostat's accrual S13). No source found for a 2016 chart-of-accounts break. The repo's own `fetch_cash_balance.ts` / `fetch_fiscal_reserve.ts` already describe `/13` and `/4` correctly. **Edit:** URLs → `/5` (monthly) + `/13` (annual); breaks → GFSM 86 / 2001 / 2014; drop the 2016 claim unless sourced. |
| 22 | СЕБРА daily payments | „`mof.bg` per-ППРБ daily СЕБРА payment tables". | **contradicted (domain)** | https://mof.bg/bg (title „Ministry of Fashion"); Наредба по ПМС № 299/2016: https://kik-info.com/normativna-baza/naredbi/0X2136933199/ | MinFin is **minfin.bg**. Under ПМС 299/2016 (last amended ПМС 76/2024), МФ publishes daily СЕБРА payments on minfin.bg (чл. 2), and **each ППРБ publishes its own daily Excel file on its own site** (чл. 4, 9). The current minfin.bg URL was not confirmed (Cloudflare). **Edit:** fix the domain and cite the наредба. |
| 23 | Municipal fiscal eras | „Q4-anchored explicit **чл. 130а** criteria sheets". | **confirmed (article); count needs checking** | https://kik-info.com/normativna-baza/zakoni/zpf/ ; https://www.minfin.bg/upload/35747/ZAKON_za_publicnite_finansi-2017-1.pdf | чл. 130а, ал. 1 ЗПФ lists the criteria (three or more met = financial difficulty). The consolidated text found lists **six**, while CLAUDE.md and `criteria.ts` use **seven** (likely т. 1 split into чл. 32 ал. 1 / ал. 2 in МФ's sheets, or a post-2020 amendment). чл. 130г = quarterly publication; чл. 130д = recovery procedure. No edit to this entry; **follow-up:** reconcile 6 vs 7 against the current ДВ text. |

### Sectors

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 24 | Administration | `analytics.egov.bg` e-service transaction volumes and satisfaction scores wait for the „JS-rendered portal" to expose an export. | **contradicted** | https://analytics.egov.bg/index.php?module=API&method=VisitsSummary.get&idSite=8&period=month&date=2026-09-01&format=json ; https://data.egov.bg/data/view/6e8f01d1-18f7-4438-a0bb-d796adb40d67 | analytics.egov.bg is a public **Matomo** instance (~20 sites) with an anonymously readable JSON/CSV API — it holds **page visits**, not transactions or satisfaction (egov.bg: 171,536 visits in Sept 2026). МЕУ publishes e-service request volumes on data.egov.bg (еФорми dataset, updated 2026-08-01). No satisfaction dataset found. **Edit:** unblock as „transactions from the еФорми dataset, visits from Matomo; satisfaction has no source". |
| 25 | Agriculture | Six чл. 163 ЗГ state forestry enterprises. | **confirmed** | https://www.mzh.government.bg/media/filer_public/2018/02/25/zapoved_rd_49-26_ot_23012017obshtiusloviadogovori.pdf ; https://www.infostock.bg/download/SWDP-NL/13673/bg/Ugozapadno%20DP_Corporate%20Governance%20Declaration_2016.pdf | СЗДП Враца, СЦДП Габрово, СИДП Шумен, ЮЗДП Благоевград, ЮЦДП Смолян, ЮИДП Сливен; principal МЗХ. The decision itself remains open. |
| 26 | Culture — museums | ~17 `държавен` rows in МК's „Регистър на музеите" `.xlsx`. | **partly confirmed** | https://data.egov.bg/data/view/51a78dc1-4c2c-4ef9-a98e-0e6275bd299d | It is **CSV on data.egov.bg** (МК dataset 16811), not .xlsx. The 2021 resource has exactly 17 `държавен` rows of 447; the 2023 resource returns no rows through the API. **Edit:** format and location. |
| 27 | Culture — читалища | Subsidy = ЕРС × subsidised units per община. | **partly confirmed** | https://www.bta.bg/bg/videos/32974 ; https://www.minfin.bg/upload/55659/Doklad+RMS+za+standarti+2023+g.pdf | The mechanism is a standard per субсидирана бройка (€9,998 in 2025, raised for 2026). No published per-община unit table was found, which is the input this item needs. **Edit:** name the missing input. |
| 28 | Culture — НФЦ/НФК overlap | Gate on defamation sign-off. | internal, not checked | — | Policy decision. |
| 29 | Customs | Did Агенция „Митници" publish a 2025 `fines_total`? (`data/customs/enforcement.json` has null) | **partly answerable; repo path wrong** | https://customs.bg/wps/wcm/connect/customs.bg28892/2beb244f-3618-4fe8-b3dc-7b46bdc288d8/Mitnicheska_hronika-02-03-04-2025_sait.pdf?MOD=AJPERES | „Митническа хроника" 2025 gives total receipts of 14,527.5 млн лв from excise, import VAT, duties and fines. Subtracting the three named streams leaves **21.0 млн лв ≈ €10.74m** for fines and other items. That is derived, not printed (the table is an image); the same method reproduces 2024 at 8.2 against the repo's 8.1 млн лв. `data/customs/enforcement.json` does not exist; the gap is in `data/budget/revenue_breakdown/customs/2025.json`, which has no fines line. **Edit:** fix the path; record the derivable figure with its caveat. |
| 30 | Health — НЗИС | Evaluate `opendata.his.bg` e-referral / e-prescription volumes. | **contradicted** | https://opendata.his.bg | Only three registers (аптеки, ЛЗИБПХ, дрогерии); no referral or prescription volumes. **Edit:** close or retarget (ЗДОИ to НЗИС / МЗ). |
| 31 | Health — `periodByStream` | Surface on HealthPack. | internal, not checked | — | |
| 32 | Social — НОИ ТП map | 28 ТП; pensioners-by-ТП on data.egov.bg. | **confirmed** | https://data.egov.bg/data/view/3eab3ab2-80f2-4ef3-ab24-39658918c82f | CSV 2010–2025 (updated 2026-06-24): 28 numbered ТП plus „Международни спогодби/договори" and Общо (2,058,008 in 2025). The input exists, so the item is actionable. |
| 33 | Social — AKSU | 14 unmatched rows in `data/social/aksu_homes.json`. | internal; **path does not exist** | `git log --all -- data/social/aksu_homes.json` (no history) | `data/social/` holds `benefits.json`, `git_inspections.json`, `poverty_impact.json`. **Edit:** fix the path or close. |
| 34 | Revenue — НАП | Keep `scripts/nap/Cross_check_issuers.ts` as a probe; `contracts.cpv_code` 99.66% NULL in the АОП CSV. | internal; **path does not exist** | `git ls-files` (no match) | The 99.66% figure is internal, not checked. **Edit:** fix the path or close. |
| 35 | Tourism | `ntr.tourism.government.bg` is blocked by a JS-driven session gate; static snapshot in `data/tourism/ntr.json`; add a `tour_occ_ninat` watcher. | **partly confirmed / overstated** | https://ntr.tourism.government.bg/CategoryzationAll.nsf/mn.xsp ; https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tour_occ_ninat?geo=BG&lastTimePeriod=1 | NTR is an IBM XPages app: a GET sets a `SessionID` cookie and results come from a form postback, so a cookie jar plus a POST should work without a browser. `tour_occ_ninat` exists (latest BG 2025, updated 2026-10-12; monthly `tour_occ_nim` reaches 2026-08). `data/tourism/ntr.json` does not exist (only `visitors.json`). **Edit:** reword „blocked" as „session + postback, scrapable"; fix the path. |
| 36 | Water | „БАБХ/РЗИ drinking-water monitoring zones are supply-zone strings". | **contradicted on БАБХ** | Наредба № 9/2001: https://www.mh.government.bg/upload/18191/ ; https://faolex.fao.org/docs/pdf/bul180911.pdf | Drinking water is an МЗ / **РЗИ** competence (Наредба № 9/2001; reporting via НЦОЗА); БАБХ has no role. The „zones, not EIKs" point is correct. **Edit:** „РЗИ/МЗ". |

### People, Declarations & Officials

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 37 | Widen Сметна палата `CATEGORY_MAP` | Only 7 categories mapped; ~49 remain (~9,000 declarants/yr). | **outdated** | https://register.cacbg.bg/2026/list.xml ; `scripts/officials/index.ts`; `data/officials/index.json` | The register (run by **Сметна палата**, still at register.cacbg.bg) has 95 category nodes, 52 non-empty, 16,563 persons in 2026. The repo already ingests every category except MPs, municipal and judiciary: 16,109 entries across ~57 categories, including all the named groups (hospital directors 742, ЗОП signatories 1,030, rectors 223, MEPs 35, President 6, diplomats 203). **Edit:** close; if `person_source` facets are still empty, open a narrower item for that. |
| 38 | ИВСС tables 10/11/13 | Adjudicate stock-vs-flow before entering `person_wealth_year`. | **confirmed (facts now known)** | ИВСС register sample: http://62.176.124.194/images/declaracii/2026/AglikaVelichkovaAdamovaPetkova040520261506.pdf ; https://www.inspectoratvss.bg/bg/page/129 | № 10 = cash, № 11 = bank accounts, № 13 = debts over 10,000 лв — all point-in-time **stocks**; flows are № 18 (income) and № 20 (expenses). Thresholds are still printed in лева. **Edit:** record that all three are stocks, so the adjudication is now mostly mechanical. |
| 39 | `kmet_pay_bands.json` | ПМС № 67/2010 gives a statutory salary ceiling. | **confirmed, with caveat** | https://kik-info.com/normativna-baza/postanovlenia/0X2135676423/ ; https://www.capital.bg/politika_i_ikonomika/bulgaria/2018/12/02/3354207_obshtinskite_suveti_shte_opredeliat_zaplatite_na/ | In force (last amended ДВ бр. 76/2026). Since 01.01.2019 (чл. 5, ал. 16) the общински съвет sets mayors' pay, capped at a minister's basic salary; there are **no pay bands**. **Edit:** rename to a single-ceiling line; „pay bands" do not exist. |
| 40 | Панагюрище (`PAZ20`) dual-mayor anomaly | Two sitting mayors (Желязко Гагов, Никола Белишки) remain allowlisted „until ЦИК publishes the `chmi` bundle or the municipal roster marks Белишки as former". | **outdated** | https://results.cik.bg/chmi2024-2026/2024-06-23_nov/tur1/rezultati/1320.html ; https://bnrnews.bg/horizont/post/316460/izvanredni-izbori-za-kmet-na-panagurishte ; repo `data/local_chmi_history.json`, `raw_data/2024_06_23_chmi_nov/` | The ВАС annulled the 2023 runoff; нови избори on **23.06.2024**: Гагов won round 1 with 64.48% against Белишки's 34.62%. ЦИК published it, and the repo already holds it (PAZ20 → `2024_06_23_chmi_nov`). The residual cause is the Сметна палата 2026 listing naming both. **Edit:** drop the ЦИК condition; keep only „until the Сметна палата register drops Белишки". |
| 41 | Market-price benchmark for real estate | Blocked on an external AVM / НСИ deals reference. | unverifiable / internal | — | Not checked. |

### Elections, Parliament & Polls

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 42 | Presidential elections | Wire `/presidential` „when `2026_11_pvr` approaches"; re-verify when 2026 round 1 drops. | **confirmed (date) — now due** | https://www.mediapool.bg/prezidentski-izbori-2026/okonchatelno-prezidentskite-izbori-shte-sa-na-25-oktomvri/ ; https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=245127 ; https://www.cik.bg/bg/decisions/30/2026-08-13 ; https://www.cik.bg/bg/decisions/271/2026-09-24 | Round 1 is **Sunday 25.10.2026**, runoff **01.11.2026**, set by an НС decision of 31.07.2026 (ДВ 04.08.2026), not a presidential указ. 27 candidate pairs (Решение № 271-ПВР). ЦИК slug `pvr2026`; the results URL can't be confirmed before polling day. **Edit:** the trigger has fired; the folder name `2026_11_pvr` mismatches round 1 (October) — decide on `2026_10_25_pvr` / `2026_11_01_pvr`. |
| 43 | Local neighbourhood corpus | Долно Езерово codes `020400309–315` created ~2016; pre-2016 placement needs an era-correct ЦИК СИК address list (2011/2015/2016) „if one exists". | **partly confirmed; address lists unverifiable** | https://results.cik.bg/minr2011/ , https://results.cik.bg/mi2015/ (403, Cloudflare); `raw_data/2016_11_06_pvr/ТУР1/readme_06.11.2016.txt`, `raw_data/2015_10_25_mi/ТУР1/ОС/sections_25.10.2015.txt` | 020400309–315 exist in pvrnr2016 (EKATTE 07079) while mi2015 tops out at 020400290, which fits „created between Oct 2015 and Nov 2016". ЦИК's CSV bundles have **no address field**. Historical addresses were published as mayors' orders forming the sections and РИК/ОИК decisions (PDFs), which is the realistic source. **Edit:** name that source (Община Бургас заповеди за образуване на секции, 2011/2015/2016). |
| 44 | Ingest bills from parliament.bg | — | **confirmed (feasible)** | https://www.parliament.bg/api/v1/bill/167603 ; https://www.parliament.bg/api/v1/fn-bills | An undocumented JSON API: `GET /api/v1/bill/{id}` (ДВ promulgation, veto, withdrawn, committee reports, plenary transcripts) and `POST /api/v1/fn-bills`. There is no single outcome field: pass/fail must be derived from the ДВ fields plus the readings. **Edit:** add the endpoints. |
| 45 | Prerender `/votes/:date/:slug` | — | internal, not checked | — | |

### Governance, Places & Council

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 46 | Council title coverage | `PVN01` needs a fresh crawl because `source_url` 404s (132 rows). | **partly confirmed** | 3-row random sample of local `council_resolution` (PVN01): https://obs.pleven.bg/uploads/posts/protokol-48.docx (200), https://obs.pleven.bg/uploads/posts/protokol-411.docx (200), https://obs.pleven.bg/uploads/posts/protokol-47.docx (404) | Some PVN01 sources 404 and some are live; the 132-row count was not re-measured. HKV09 / SZR12 are parser items, not checked. |

### News

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 47 | Realtime worker hosting | „a €4–5/mo EU VPS (Hetzner CX23/CAX11 or Netcup VPS 200 G12)". | **outdated** | https://www.hetzner.com/cloud/ ; https://privatedevops.com/news/hetzner-june-2026-cloud-price-increase-what-to-do ; https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/ ; https://www.netcup.com/en/server/vps | Hetzner repriced twice in 2026 (April and 15.06.2026): **CX23 €5.49, CAX11 €5.99** a month excl. VAT and the €0.50 IPv4 (cost-optimized „from €5.99" on hetzner.com); one source reports limited availability. Netcup no longer sells G12 („generally no longer available"); its smallest plan is the VPS 500 G12.5 at **€8.26/mo** (12-month term, excl. VAT). **Edit:** „~€6–9/mo". |
| 48 | Entity linking — Благомир Коцев | Listed among elected mayors to merge in mention linking. | **confirmed** | https://varna.bg/ ; https://bg.wikipedia.org/wiki/Благомир_Коцев | Sitting mayor of Варна since 08.11.2023; detained 08.07.2025, released on bail 28.11.2025 and back in office; case pending. A caveat in any mention text is advisable. |
| 49 | ЕРИК | (context) `erik.bulnao.government.bg` | **confirmed** | https://erik.bulnao.government.bg/Reports?electionId=95 | Already lists the 25.10.2026 presidential election (id 95) and an 18.10.2026 election (id 96, likely partial local) — a possible ingest trigger. |

### AI Chat & Infrastructure

| # | Item | Claim | Verdict | Sources | Note / proposed edit |
|---|---|---|---|---|---|
| 50 | Standalone `ai/app/` retirement | Retire in favour of 301s from `ai.electionsbg.com` to `naiasno.bg/chat`; decommission `elections-bg-llm` if unused. | **partly outdated** | `curl -I https://ai.electionsbg.com/` → **301 → https://naiasno.bg/** ; `gcloud functions list --project elections-bg-llm` → permission denied | The redirect already exists but lands on the **homepage**, not `/chat`. `elections-bg-llm` is not accessible to the current account (deleted or other owner) — unverifiable. **Edit:** narrow to „point the 301 at /chat; retire the `ai/app/` entrypoint". |
| 51 | Cloud SQL tier | Currently `Enterprise / db-custom-2-13312`. | **confirmed** | `gcloud sql instances describe electionsbg-pg --project elections-bg` → `db-custom-2-13312  ENTERPRISE  POSTGRES_16  ZONAL` | The followups file is right and **CLAUDE.md is stale** (it says `db-perf-optimized-N-2` / ENTERPRISE_PLUS „as of 2026-08-22"). Monthly costs ($160 / $173 / $229) are internal estimates and were not re-priced. **Follow-up:** correct CLAUDE.md's serving-instance header. |
| 52 | gzip re-upload | Re-upload `canonical_parties.json` and `governments.json` with gzip encoding. | **half outdated** | `gsutil ls -L gs://data-electionsbg-com/canonical_parties.json` (Content-Encoding gzip, updated 2026-10-20); `…/governments.json` (no Content-Encoding, 9,960 B, updated 2026-05-11) | `canonical_parties.json` is done; `governments.json` is still uncompressed. **Edit:** keep only `governments.json`. |
| 53 | GDPR counsel review | External counsel review of `/privacy`. | internal, not checked | — | Memory notes a review ~2026-10-10; status unknown. |

## Internal, not checked

No external claim, or an internal measurement only:

- **Companies:** NKID / founding-date facets; director-name search; money aggregates in the
  company browser; `tr_owner_share` vintage currency; `CompanyDbScreen` test harness; CR Deeds
  crawl run and cloud ship (operator step).
- **Education:** both items.
- **Procurement:** normalcy cohort control; same-feed dedup (213 groups / €139.2M); `obed-*`
  annexes (330); foreign consortium members; contractors tile; ID-like query routing; settlement
  attribution / `by_ekatte.json`; client-side risk-index retirement; review-queue D/E/F surfacing.
- **Funds:** grant→contract UI; funds prerender; `match_seu_eik.ts`; ФЛ join; measure page.
- **Budget:** `/budget/deep-dive` trimming; `budget/reconciliation/` retirement.
- **Sectors:** `sector_entity_search` (both); buy-side `sector_awarder_stats`; НЗОК
  `periodByStream`; water `useWaterData` and the optional enrichments.
- **People:** donors↔contractors; ИВСС/КПК timeline interleave; person identity sub-items (slug
  tiebreak, CIK keys, EGN-hash decision, 10 ЕРИК names / €7,285, name-keyed sub-pages); local
  electoral history and kmetstvo EKATTE; `/officials/*` retirement; `party_leaders.json`;
  `ASSET_ROW_CEILING_EUR` alignment.
- **Elections:** `runoffFlow` refit; roll-continuity filter (all sub-bullets are internal
  measurements).
- **Governance:** `/area` redirect; `schools/index.json`; region links and og:image; council
  parsers HKV09 / SZR12.
- **Prices:** all three (chain counts 25/77/79 of 101 are internal measurements).
- **AI chat:** router split; funding UI polish; `company_public_money` basis.
- **News:** publish gates; harvest resilience; abbreviation case-sensitivity; 7 mayors' overrides;
  ground-news follow-ups.
- **Infrastructure:** `--defer-refresh`; `idle_in_transaction_session_timeout`; `--post-only`;
  locale bundle splits; `/data` granularity; skip-budget meta-test; site-hygiene gates; dead
  routes.

## Proposed edits to docs/deferred-followups.md (not applied)

1. **Close:** bucket cleanup (row 4); `CATEGORY_MAP` widening (37); АДФИ / подизпълнители / TED in
   the review queue (9); ИСУН нередности (10); ДФЗ 2015–2022 backfill → replace with an „FY2018–2020
   missing upstream" watch (20); `opendata.his.bg` evaluation (30).
2. **Rewrite the premise:** TR delta feed with entry dates (1); CR Deeds codes (2); storage.eop.bg
   fields and the non-existent script (6); КФП URLs and methodology (21); СЕБРА domain (22);
   analytics.egov.bg (24); НТР „session + postback" (35); РЗИ not БАБХ (36); Interreg hosts and
   RO-BG calls index (12, 13); АХУ reachable (11); ЦКЗ at МС (19); museums register CSV on egov
   (26); ESPON 0/110 (18); pay ceiling, not bands (39); Панагюрище exit condition (40);
   Hetzner/Netcup prices (47); the 301 lands on the homepage, not /chat (50); gzip →
   `governments.json` only (52).
3. **Fix broken repo paths:** `data/customs/enforcement.json` → `data/budget/revenue_breakdown/customs/2025.json`;
   `data/tourism/ntr.json`, `data/social/aksu_homes.json`, `scripts/nap/Cross_check_issuers.ts`,
   `scripts/procurement/verify_eur_currency_eop.ts` do not exist.
4. **Add:** UBO legal gate after ДВ 49/2025 (3); parliament.bg `/api/v1/bill` endpoints (44);
   Бургас mayors' section orders as the Долно Езерово source (43); the derivable 2025 customs
   figure, ≈ €10.74m with its caveat (29).
5. **Time-critical:** presidential round 1 is 25.10.2026 (42).

Outside this file: CLAUDE.md's Cloud SQL header (51) and its „чл. 232а, ал. 2 ЗОП" citation (7)
are stale; ЗПФ чл. 130а criteria count, 6 vs 7 (23), needs reconciling against the current ДВ.
