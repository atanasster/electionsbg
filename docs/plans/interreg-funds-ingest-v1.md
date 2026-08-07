# Interreg funds ingest — v1

> Research + plan only. Nothing implemented.
> Every figure below is measured against live sources or local Postgres on 2026-08-06.
> §12 lists what a post-draft audit corrected; §11 lists what remains unestablished.

## Context

`fund_projects` (82,011 rows, €44bn) is the EU-funds corpus behind `/funds`, the company
page money tile, the combined search's ЕВРОФОНДОВЕ tier and every per-capita EU-money
figure the site publishes. It is built from the ИСУН 2020 export at `2020.eufunds.bg` and
covers the Bulgarian operational programmes **and** the EEA/Norway Financial Mechanism —
but it contains **zero Interreg projects**.

Verified: 47 `program_code` values, none Interreg. A regex over `contract_number` for
`^(BSB|BGTR|BGENERGY|BGCULTURE|BGLD|BGJUSTICE|ROBG|GRBG|MIS)` returns exactly 200 rows =
BGENERGY(64) + BGCULTURE(55) + BGLD(64) + BGJUSTICE(17); BSB, BGTR, ROBG and GRBG
contribute nothing. `fund_projects` for `beneficiary_name ilike '%малко т%рново%'` returns
30 rows, all ИСУН/EEA, while the municipality's own register lists `BSB00963`,
`BGTR0200037`, `BGTR0200044` and `BGTR0200100` that we do not have.

**The structural reason** — established, not assumed: Interreg does not run on ИСУН.
keep.eu records each programme's provenance as *"Retrieved from the programme's monitoring
system (**Jems**) server"* (`/api/programme/342/`, `/305/`, `/306/`, `/369/`, `/387/`).
ИСУН 2020 is the Bulgarian MIS; Jems is the Interreg MIS. The gap is a system boundary, not
a filter we can flip.

**Why it matters.** Interreg is by definition cross-border, so the missing money lands
exactly on the border municipalities. Measured, not argued (§6): on a **5.5% sample** of the
corpus — 107 of ~1,930 projects, 2021-2027 CBC arm only — 29 municipalities gain money and
**all 29 sit in a border oblast**. Ветово moves +18 places on €/жител, Сапарева баня +17,
Камено +10. Every per-capita EU-money ranking we publish today understates the poorest,
most depopulated municipalities in the country, silently.

This is live: `brand/posts/drafts/2026-08-06-malko-tarnovo-eu-projects.md` ranks Малко
Търново №1/265 on projects per 1,000 residents and №3 on €/жител. Both are reproduced
exactly from `fund_projects` ⋈ `awarder_seats` (14.84 vs a 2.50 median; €4,105 vs €980).
Adding the four Interreg operations moves it to **15.64 per 1,000 (still №1)** and
**€4,309/жител (№3 → №2)** — the post is conservative and gets stronger. Other
municipalities move 10–18 places, which is the reason to do this.

---

## 1. Which Interreg programmes involve Bulgaria

Roster from МРРБ's two index pages
([2014-2020](https://www.mrrb.bg/bg/infrastruktura-i-programi/programi-za-teritorialno-sutrudnichestvo-2014-2020/),
[2021-2027](https://www.mrrb.bg/bg/infrastruktura-i-programi/programi-za-teritorialno-sutrudnichestvo-2021-2027/)),
cross-checked against keep.eu. Eligible NUTS3 areas read from
`/api/programme/<id>/ → eligible_geographical_area` (exact, machine-readable).

### 2021-2027

| Programme | keep id | CCI | BG eligible NUTS3 | Projects | Partnerships | Σ EU funding |
|---|---|---|---|---|---|---|
| Interreg VI-A Romania–Bulgaria | 342 | 2021TC16RFCB020 | BG311/312/313/314/321/323/325/332 | 38 | 110 | €68.54m |
| Interreg VI-A Greece–Bulgaria | 343 | 2021TC16RFCB021 | BG413/422/424/425 | 8 (3 in keep) | 26 (10) | €27.37m |
| Interreg VI-A IPA Bulgaria–Türkiye | 305 | 2021TC16IPCB005 | BG341/343/422 | 36 | 151 (111) | €24.84m |
| Interreg VI-A IPA Bulgaria–N. Macedonia | 306 | 2021TC16IPCB006 | BG413/415 | 18 | 78 | €20.06m |
| Interreg VI-A IPA Bulgaria–Serbia | 307 | 2021TC16IPCB007 | BG311/312/313/412/414/415 | 8 (**0 in keep**) | 48 (0) | — |
| Interreg VI-B NEXT Black Sea Basin | 387 | 2021TC16NXTN002 | BG33, BG34 | 82 | 372 (367) | €75.61m |
| Interreg VI-B Danube Region | 369 | 2021TC16FFTN004 | whole country | 139 (138) | 1,431 | €180.12m |
| Interreg VI-B Euro-MED | 377 | 2021TC16FFTN001 | whole country | 96 | 900 | €187.83m |
| Interreg VI-C Interreg Europe | 394 | 2021TC16RFIR001 | whole country | 262 | 2,261 | €368.61m |
| Interreg VI-C URBACT IV | 393 | 2021TC16FFIR001 | whole country | 257 (**30**) | 2,081 (30) | — |
| Interreg VI-C ESPON 2030 | 395 | 2021TC16RFIR004 | whole country | 110 (**0**) | 616 (0) | — |
| INTERACT IV | — | — | technical assistance | n/a | n/a | — |

### 2014-2020

| Programme | keep id | BG eligible NUTS3 | Projects | Partnerships | Σ EU funding |
|---|---|---|---|---|---|
| INTERREG V-A Romania–Bulgaria | 35 | BG311/312/313/314/321/323/325/332 | 169 | 445 | €230.45m |
| INTERREG V-A Greece–Bulgaria | 10 | BG413/422/424/425 | 132 | 489 | €127.56m |
| Interreg IPA CBC Bulgaria–Serbia | 72 | BG311/312/313/412/414/415 | 105 | 245 (232) | €29.28m |
| Interreg IPA CBC Bulgaria–Turkey | 66 | BG341/343/422 | 102 | 219 | €24.50m |
| Interreg IPA CBC Bulgaria–N. Macedonia | 73 | BG413/415 | 73 | 151 | €15.42m |
| Black Sea Basin ENI CBC | 64 | BG33, BG34 | 57 | 290 | €23.22m |
| INTERREG V-B Balkan-Mediterranean | 125 | whole country | 44 | 282 | €39.15m |
| INTERREG V-B Danube | 63 | whole country | 155 | 1,582 | €221.27m |
| Interreg Europe | 58 | whole country | 258 | 2,085 (2,084) | €334.94m |
| URBACT III | 85 | whole country | 88 | 716 | €44.11m |
| ESPON 2020 | 69 | whole country | 69 (68) | 370 (353) | €21.14m |
| INTERACT III | — | technical assistance | n/a | n/a | — |

**Out of scope:** 2007-2013 and 2000-2006 (keep.eu holds them; the partner-budget field is
`n/a` for every one — it did not exist). INTERACT is pure technical assistance with no
Bulgarian beneficiary. Mediterranean Sea Basin ENI / NEXT MED and INTERREG V-B
Mediterranean do not include Bulgaria.

**Union of land-CBC eligible NUTS3**: BG311 Видин, BG312 Монтана, BG313 Враца, BG314
Плевен, BG321 В. Търново, BG323 Русе, BG325 Силистра, BG332 Добрич, BG341 Бургас, BG343
Ямбол, BG412 София-област, BG413 Благоевград, BG414 Перник, BG415 Кюстендил, BG422 Хасково,
BG424 Смолян, BG425 Кърджали. BSB adds BG33+BG34 (Варна, Шумен, Търговище, Сливен, Стара
Загора). Never eligible for any CBC arm: София-град, Пловдив, Пазарджик, Габрово, Ловеч,
Разград.

---

## 2. Sources — and the recommendation

### 2.1 keep.eu — authoritative, and the recommended source for every programme

Run by INTERACT, the Interreg programmes' own coordination body. It ingests each
programme's Jems directly and it is the generator behind the programmes' published
Art. 49(3) lists of operations (BSB's carries the header *"Go to keep.eu for much more…"*).
For Interreg it is the upstream, not a convenience.

**(a) `GET https://keep.eu/api/project/<keepId>/` — public, no key. Build on this.**
Returns the operation plus one object per partnership. Per-partner fields, verbatim:

```
total_budget "123819.00"        ← the PARTNER's own eligible budget
co_financing_eur "111437.10"    ← the partner's programme (EU) co-financing
co_financing_percentage, partner_contribution_project_budget
pic, beneficiary_id             ← the national ID (the EIK) — 2021-2027 ONLY, see §3.2
partner.name (Cyrillic) / partner.translations.en.name_translated
town, street, postcode, town_department, postcode_department, country
type "partner"|"lead", legal_status, organisation_type
location_json {lat,lng}, location_address
```

Operation level: `project_id` (the programme's own operation ID — **NULL for 2014-2020**),
`total_budget`, `eu_funding`, `union_co_financing_rate`, `start_date`, `end_date`, `status`,
`programme{id,title,period}`, `intervention_type`, `priority`, `translations`, `themes`.

**(b) `GET https://keep.eu/api/search/projects/?page=N` — public, no key.** 32,702 projects,
6/page, 5,451 pages, ordered by keep id **descending**. Query-string and POST filters are
accepted and **ignored** (measured: `?programme=342`, `?programmes[]=342`, POST
`{"programmes":{…}}` all return the unfiltered 32,702), so enumeration means walking the
index. Also public: `/api/search/programmes/` (390), `/api/search/partners/` (93,331),
`/api/programme/<id>/`, and `/api/partner/partner_coverage?detailed=true&excel=true` — the
per-programme, per-field fill-rate report every coverage number here comes from.

**Measured cost.** 1,363 index pages at 8-way concurrency took 1,755 s → ~1.29 s/page wall,
~10 s/request. A cold full index walk is **≈2 h at 8-way**; detail fetches for the ~1,930
BG-relevant projects add **≈40 min**.

**Refresh is not just "walk until a known id".** The index is id-descending, so new
operations are cheap to spot — but keep.eu **re-imports whole programmes** (ROBG 21-27
imported 2026-04, BSB NEXT 2026-05, Euro-MED 2026-06), which revises existing rows in place,
and the search index exposes no `modified`. Design: **stop-at-known-id weekly for new
operations, full re-crawl of the ~1,930 BG-programme details monthly** for revisions. A
programme's `date_of_data_import` on `/api/programme/<id>/` is the cheap trigger for a
targeted re-crawl of just that programme.

**(c) `GET https://keep.eu/api/open-data?key=…`** — the documented bulk endpoint
(programmes + projects + partnerships, `period` / `onlyprogramme` / `callsstatus` filters).
Needs a key: register at keep.eu, then email `keep.support@interact.eu`; *"access will be
evaluated by Interact on a case-by-case basis."* **Request it on day one and build against
(a)+(b) meanwhile** — if granted, the crawl collapses to one download and only the fetch
layer changes. Attribution ("credit keep.eu and provide a link") is required either way.

### 2.2 The programmes' own Art. 49(3) lists of operations — verification, not ingest

Both regimes (Reg. 1303/2013 Art. 115(2) + Annex XII; Reg. 2021/1060 Art. 49(3)) oblige
each programme to publish a list of operations in CSV or XLSX. They exist and are not usable
as the ingest path:

- **The Interact standard template has no per-partner budget.** Verified by downloading
  BSB's: sheet `Operations` has `Total eligible cost`, `Total EU funding (amount)`,
  `Number of partners`; sheet `Partners` has `Partner name`, lead flag, `Partner type`,
  `PIC`, `Partner's IDs if not PIC`, `Town`, `Country` — **and no money column at all**.
- **The shape is not standard.** Interreg Europe publishes something else entirely —
  [`interregeurope.eu/…/List_of_operations.xlsx`](https://www.interregeurope.eu/sites/default/files/2024-06/List_of_operations.xlsx),
  2,257 rows, **one row per partner** with that partner's `Total eligible expenditure`,
  `Operation postal code`, `Country code`, `NUTS2 code`.
- **They go stale.** BSB's file is dated 2024-08-16 with 26 operations; keep.eu holds 82,
  imported 2026-05.
- **Reachability.** `ipa-bgtr.mrrb.bg` / `ipa-bgmk.mrrb.bg` / `ipa-bgrs.mrrb.bg` fail TLS
  chain verification; `ipacbc-bgtr.eu` did not resolve at all on 2026-08-06.

**Use:** an independent cross-check on operation counts and totals per programme (§9), not
an ingest path.

### 2.3 Kohesio — rejected

`kohesio.ec.europa.eu` states it includes ETC/Interreg and offers per-country CSV/XLSX and a
SPARQL endpoint. Rejected: it is a downstream re-publication of the same MA data keep.eu
takes upstream; its beneficiary linkage is an **ML match to Wikidata with "accuracy above
90%"**, which is name-matching by another name and collides with
`feedback_name_match_not_identity`; and its grain is one beneficiary per project, so it
cannot answer the partner-share question at all. Its REST surface rejected every probe
(`/api/projects?country=BG` → 400). Worth revisiting only if we ever want EU-wide
comparability ("BG vs peers on absorption").

### 2.4 data.egov.bg — nothing

No Interreg / трансгранично сътрудничество dataset. МРРБ publishes programme pages as HTML
only. Consistent with the Jems boundary.

### 2.5 Recommended source per programme

**keep.eu `/api/project/<id>/` for all of them**, with these declared gaps (from keep.eu's
own fill-rate report):

| Programme | in keep | partner budget | national ID | Recommendation |
|---|---|---|---|---|
| RO-BG 14-20 / 21-27 | 100% / 100% | 100% / 100% | 0% / 100% | keep.eu |
| BG-TR 14-20 / 21-27 | 100% / 74% | 98% / 100% | 0% / 100% | keep.eu; 40 of 151 partnerships absent in 21-27 |
| BG-MK 14-20 / 21-27 | 100% / 100% | 100% / 100% | 0% / 100% | keep.eu |
| BG-RS 14-20 | 95% | 97% | 0% | keep.eu |
| BSB 14-20 / NEXT 21-27 | 100% / 99% | **74%** / 100% | 0% / 100% | keep.eu; the 14-20 budget gap is real |
| Balkan-Med 14-20 | 100% | 100% | 0% | keep.eu |
| Danube 14-20 / 21-27 | 100% / 100% | 100% / 99% | 0% / 100% | keep.eu |
| Euro-MED 21-27 | 100% | 99% | 100% | keep.eu |
| Interreg Europe 14-20 / 21-27 | 100% / 100% | 100% / 100% | 0% / 100% | keep.eu (LoP xlsx as cross-check) |
| GR-BG 14-20 | 100% | 100% | 0% | keep.eu |
| **GR-BG 21-27** | **38%** | **0%** | 100% | operations + partners only, `budget_basis='unpublished'`; also **postcode 0%** — place via EIK |
| **BG-RS 21-27** | **0%** | — | — | **cannot ingest.** A named gap |
| URBACT III / **IV** | 100% / **1%** | 100% / 0% | 0% / 7% | III yes; IV a named gap |
| ESPON 2020 / **2030** | 95% / **0%** | **0%** / 0% | 0% / 0% | operations only; no money either period |

---

## 3. The three schema problems

### 3.1 Partner shares vs total project budget — solved by the source

`partnerships[].total_budget` is the partner's own eligible budget;
`co_financing_eur` its EU share. Measured on the 2021-2027 CBC sample: **130 of 136
Bulgarian partner rows carry a budget (95.6%)**; the 6 that do not are all GR-BG 21-27,
exactly as keep.eu's fill-rate report predicts. On a 2014-2020 BG-CBC sample: **30 of 30
(100%)** — the older period is *better* on money than on identity.

The operation that started this:

| Operation | Partner | EIK | Partner budget | EU co-fin |
|---|---|---|---|---|
| BSB00963 ALL4NATURE | Община Малко Търново | 000057086 | €357,183.12 | €321,464.80 |
| BGTR0200037 ENPORT | Община Малко Търново | 000057086 | €178,814.72 | €151,992.51 |
| BGTR0200044 MOBIGATE | Ист. музей „Проф. Ал. Фол" | 102826129 | €261,847.74 | €222,570.57 |
| BGTR0200100 | Ист. музей „Проф. Ал. Фол" (**lead**) | 102826129 | €204,236.48 | €173,601.00 |

Storing the operation total on any of these would put ~4× the true money on Малко Търново.
The design forbids it structurally: **the operation total lives on `interreg_operations`,
the partner budget on `interreg_partners`, and no money aggregate ever reads across the
join** (§9 gate 4 asserts it against `pg_get_functiondef`).

**Three budget states, all distinct, none inferred:**
- `published` — a non-NULL, non-zero `total_budget`.
- `published_zero` — a literal `0.00`. **Observed**: 2 of 30 rows in the 2014-2020 sample
  (`Клуб на инвалидите…`, `Регионална библиотека Хасково`). A co-beneficiary with no budget
  line is a real thing; collapsing it into NULL would lose the distinction.
- `unpublished` — NULL. Contributes **zero** to money and still counts in project counts.

**We never equal-split.** This is the inverse of `scripts/funds/projects_share.ts`'s
`muniShare` and for the same reason: `muniShare` splits because *not* splitting put €7.15bn
of phantom spend on the choropleth; here splitting would *invent* a number the source never
stated. Every surface must therefore be able to say "N operations, of which M carry a
published budget".

**There is no Interreg equivalent of `paid_eur`.** `total_expenditure` and
`eu_funding_expenditure` are NULL on every sampled partnership. Any "изплатени / % absorbed"
metric stays ИСУН-only and must say so.

### 3.2 Location attribution — and the period split that governs it

**The single most important correction from the audit: `beneficiary_id` and `pic` are
2021-2027 fields only.** keep.eu's own fill-rate report labels columns 21–26 literally
`(2021 - 2027) PIC`, `(2021 - 2027) Partner's ID if not PIC`, `(2021 - 2027) Type of
organisation`, `(2021 - 2027) Partner's programme co-financing`. Confirmed against live
data: **0 of 30** sampled 2014-2020 BG partner rows carry any national ID or PIC; **124 of
136** (91%) of 2021-2027 rows do. The 2021-2027 template introduced the field; the older
period simply has no identity column.

So there are two attribution tiers, and they must be labelled as such everywhere:

**Tier L — "linked" (2021-2027).** `beneficiary_id` → `canonicalEik()` → place, and a real
legal-entity identity.

| Step | Method | Coverage (124 rows with an EIK) |
|---|---|---|
| L1 | EIK → `awarder_seats.ekatte` | **67 (54%)** — public bodies |
| L2 | EIK → `tr_company_place.ekatte` (mig 133) | **+10 (8%)** |
| L3 | fall through to Tier P | the remaining 47 (читалища, museums, chambers, NGOs, universities — BULSTAT bodies in neither table) |

77 of 124 (62%) placed with zero inference. 77 of those EIKs already appear in
`fund_projects` as ИСУН beneficiaries, so the join is real.

**Tier P — "placed only" (2014-2020, and the Tier-L fall-through).** No identity; geography
only, from three signals keep.eu fills at 92–100% in both periods (town 100%, postcode
92–100%, lat/lng 100%):

| Step | Method |
|---|---|
| P1 | Map the Latin town to Cyrillic via `data/settlements.json.name_en` → `name`, then `EkatteResolver.resolve({locality, postalCode})` (`scripts/procurement/resolve_ekatte.ts`) |
| P2 | For rows whose partner name matches the **closed 265-municipality roster** (`data/municipalities.json`), take that municipality's seat |
| P3 | Confirm with `location_json {lat,lng}` — the chosen settlement must be within **25 km** of the published point, else drop to unresolved |
| P4 | Unresolved → `ekatte = NULL`, keep `location_raw`. Never a guess |

**Measured end to end** (EN→BG town mapping + resolver + 25 km geo confirmation):

| Sample | n | town mapped EN→BG | resolved | geo contradictions | unresolved |
|---|---|---|---|---|---|
| 2021-2027 CBC | 136 | 127 (93%) | **132 (97%)** | **0** | 4 |
| 2014-2020 CBC | 30 | 26 (87%) | **27 (90%)** | **0** | 3 |

**This is the finding that keeps the plan viable**: the 2014-2020 half — the larger half of
the money — is placeable to ~90% *without* any identifier, and the geo signal contradicted
the resolver on zero rows. What 2014-2020 cannot have is a `/company/:eik` link or a
contribution to `company_public_money`.

Two hazards the audit surfaced:
- **308 of 4,275 postcodes in `data/ekatte_index.json` are ambiguous** (e.g. 2060 → 13
  settlements). The resolver correctly refuses those (every arm requires `length === 1`), and
  P3 is what breaks the tie. Sofia sub-postcodes (e.g. `1592`) are absent from the index
  entirely and fall to P2/P3.
- **P2 is a name match, and that is deliberate and bounded.** `feedback_name_match_not_identity`
  forbids attributing a *person* or *company* on a name. A municipality roster is a closed
  set of 265 authoritative names, and the target is a *place*, not an identity. Measured:
  44 of 45 rows named "Община …" match the roster; the one miss is
  `Община "Тунджа" - гр.Ямбол` (quotes + a suffix), fixable in the normaliser. Any name not
  in the closed roster is **not** matched.

Store the band per row (`place_basis`: `eik:awarder_seats` | `eik:tr` | `postal+name` |
`postal_only` | `name_only` | `roster` | NULL) as `load_tr_company_place_pg.ts:169` does, so
downstream can filter. `load_tr_company_place_pg.ts:11-13` already states the rule:
"placing a company in the wrong village is worse than not placing it, because the tile reads
as a fact about that place."

**EIK normalisation.** `beneficiary_id` is free text: `"BG000852633"`, `"000057001"`,
`"BG 129010723"`, `"BG000057086 | 000057086 | Registry number (EN)"`, `"N/A | 17590372"`,
`"N.a."`. Strip a leading `BG`, split on `|`, take the first 9-digit token, then pass through
`canonicalEik()` (`scripts/funds/eik.ts`), which already refuses 10-digit values so a legacy
BULSTAT cannot be mistaken for an ЕГН.

**How Interreg compares to ИСУН on geography.** ИСУН has no `ekatte` on 11,311 of 82,011
rows (13.8%) but those hold €26.8bn of €44bn (61%) — because they are ministry and agency
projects with national scope (АМС/министерство 72.6% of its money unplaced, изпълнителни
агенции 79.4%, общинска администрация 51.9%). Interreg is the opposite shape: a partner row
*is* an organisation at an address. The measured ~90–97% placement above is why this ingest
improves the geography of the corpus rather than diluting it — and §9's floor makes the
loader prove it rather than assume it.

### 3.3 Double counting — verified clean, with gates to keep it that way

- `SELECT count(*) FROM fund_projects WHERE contract_number ~ '^(BSB|BGTR|ROBG|GRBG|BGRS|BGMK|CB00|MIS|DTP|DRP|PGI|EUMED)'` → **0**. The namespaces are disjoint.
- ИСУН and Jems are separate monitoring systems; a project registered in one is not in the other.
- Within Interreg an operation appears under exactly one programme, and a BG partner in
  Interreg Europe *and* in a CBC programme is genuinely two different projects.

Gates in §9: namespace disjointness as an assertion; a fuzzy overlap probe on
`(beneficiary_eik, folded title, start year, amount ±1%)` across the two corpora — which can
only run for Tier-L rows, since Tier P has no EIK, so the probe is necessarily partial and
must say so; and an explicit period fence excluding 2007-2013 and 2000-2006.

---

## 4. Schema decision: sibling tables, **not** rows in `fund_projects`

### Why not append

1. **The grain differs and `total_eur` would change meaning.** `fund_projects` is PK
   `contract_number`, one beneficiary, one `total_eur` = the project's total cost. Interreg
   is one operation × N partners × N budgets. Appending forces one of two lies: one row per
   operation (whose beneficiary? whose money?) or one row per BG partner with `total_eur` =
   the operation total — the €2m-for-a-€300k-partner inversion. Redefining `total_eur` for
   1.7% of rows is the failure class CLAUDE.md already documents twice: `oblast = oblasts[0]`
   ("renders as a clean fact with nothing failing", `projects_share.ts:56-63`) and the
   €7.15bn phantom choropleth.
2. **Eight live readers would widen implicitly, at once** — `fund_contract_detail()`
   (`043:64`), the company page top-6 (`db_routes.js:579`), the company SSR `<title>` money
   sum (`index.js:597`), `search_fund_projects()` (`086`), the `fund_projects` DbDataTable
   registry (`db_table.js:402`), `ngo_signals`' `eu` CTE (`080:211`), the person-profile
   `fundProjects` count (`082:119`), the changelog resolver (`007:198`). Several **sum**
   `total_eur`. Widening them is desirable; widening them silently with a redefined column is not.
3. **The ИСУН derivation tree cannot carry Interreg rows.** `data/funds/projects/`'s
   procedures, themes, taxonomy, absorption, sankey and integrity artifacts are keyed on
   ИСУН procedure codes (`scripts/funds/procedures.ts`); Interreg has none.
4. **Two writers into one TRUNCATEd table is an ordering trap.** `load_funds_pg.ts:406-435`
   TRUNCATEs `fund_projects` and rebuilds it from `by-contract/*.json`.
5. **Interreg carries fields ИСУН has no column for**: lead flag, partner country, partner
   co-financing rate, PIC, the multi-country partner set, the eligible NUTS area — and it
   *lacks* `paid_eur`, `org_kind`, `org_form` and any procedure lineage.

**The cost, stated plainly:** every surface needs *explicit* widening. That is the point —
eight readers reviewed one at a time, each declaring its basis, beats eight readers changed
at once by a column redefinition nobody sees.

### What appending would and would not have moved

Worth recording because it is counter-intuitive: **`company_public_money` (migration 127)
reads `fund_beneficiaries.paid_eur`, not `fund_projects`** (`127:39`; same for the inlined
copies at `120_person_browse.sql:382` and `resolve_persons.ts`). So does
`dual_corpus_rankings_cache` (`077:30-34`). Adding rows to `fund_projects` would **not** have
reached `/connections`, the `/persons` money column, `tr_company_place.money_eur` or the
governance tile at all. That is Tier 4, a separate decision.

`fund_beneficiaries` stays ИСУН-only, so the `/funds` beneficiary pages keep one basis.

### Proposed shape — migration **`137_interreg.sql`** (136 is taken by `136_bill.sql`)

```sql
CREATE TABLE interreg_operations (
  keep_id           integer PRIMARY KEY,   -- keep.eu project id: the ONLY always-present key
  operation_id      text,                  -- BSB00963 / BGTR0200037. NULL for all 2014-2020.
  programme_code    text NOT NULL,         -- INTERREG-ROBG-2127 (curated, see below)
  programme_name    text, programme_name_en text,
  period            text NOT NULL,         -- '2014-2020' | '2021-2027'
  title_en          text NOT NULL,         -- keep.eu is EN-only, see §7
  title_bg          text,                  -- NULL until a BG source exists
  summary_en        text,
  status            text, start_date date, end_date date,
  total_budget_eur  double precision,      -- the OPERATION total. Never a partner's.
  eu_funding_eur    double precision,
  co_financing_rate double precision,
  partner_count     integer,
  partner_budget_sum_eur double precision, -- Σ partner budgets; NEED NOT equal total_budget_eur
  partner_budget_published_count integer,  -- how many partners that Σ covers (§3.1's "N of which M")
  countries         text[],
  source_fetched_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX ON interreg_operations (operation_id) WHERE operation_id IS NOT NULL;

CREATE TABLE interreg_partners (
  keep_id        integer NOT NULL REFERENCES interreg_operations(keep_id) ON DELETE CASCADE,
  partner_seq    integer NOT NULL,
  keep_partnership_id integer,             -- keep.eu's stable partnership id; orders partner_seq
  keep_partner_id integer,
  is_lead        boolean NOT NULL,
  country        text NOT NULL,            -- keep.eu's country NAME, verbatim ("Bulgaria")
  country_department text,                 -- department's country, where it differs
  partner_name   text NOT NULL,            -- Cyrillic where published (129/136)
  partner_name_en text,                    -- 136/136
  eik            text,                     -- 2021-2027 only; NULL for 2014-2020
  pic            text,
  org_type       text, legal_status text,  -- keep.eu's 11-value vocabulary, verbatim
  budget_eur     double precision,
  eu_funding_eur double precision,
  budget_basis   text NOT NULL,            -- 'published' | 'published_zero' | 'unpublished'
  location_raw   text, postcode text,
  ekatte         text, obshtina text, oblast text,
  place_basis    text,                     -- see §3.2; non-NULL iff ekatte is
  lat            double precision, lng double precision,
  PRIMARY KEY (keep_id, partner_seq)
);
```

**PK is `keep_id`, not `operation_id`** — corrected by the audit. `project_id` is NULL for
every sampled 2014-2020 project, and where present it is heterogeneous (`BSB00963`,
`BGTR0200037`, `BGTR0500192`, and bare numerics like `6028519`), so it cannot be assumed
unique across programmes or periods. `keep_id` is the only always-present, always-unique key,
and it is also the refresh key.

**`country` stores keep.eu's country NAME verbatim, not ISO2** — decided 2026-08-07.
keep.eu's `country` is `{id, title}` where the id is its own internal key, so an ISO2
column would have to be minted from a curated name→code map: a second thing to maintain
and a second place to be wrong, for no gain. The only question this corpus asks of a
country is "is this partner Bulgarian", which the title answers exactly.
`isBulgarianPartner()` is the accessor, and it tests the department's country too.

**All partners are stored, not only Bulgarian ones** (~12,100 rows for ~1,400 BG rows). The
foreign partners are what make an operation legible as cross-border on its page, and the
volume is trivial. Only rows `isBulgarianPartner()` admits are ever placed or counted as Bulgarian money.

`programme_code` is **curated**, in the register of `src/data/funds/programmeNamesEn.ts`
("CURATED, NOT TRANSLATED… add only names you can point at a source for"): a stable
`INTERREG-<pair>-<period>` slug per keep.eu programme id, with BG and EN names from МРРБ and
the programme itself. A keep.eu programme with no entry is **skipped with a warning**, so a
new programme upstream cannot silently mint an unnamed code.

Both tables are on a serving path → **stage-merge, never TRUNCATE**
(`scripts/db/lib/stage_merge.ts`). `person_reload_locks.data.test.ts`'s ALLOWED registry
records `load_funds_pg.ts`'s two TRUNCATEs as accepted debt — do not add a third.

### Serving: **do not write into `fund_payloads`**

The audit's second material correction. `load_funds_pg.ts:449-473` stage-merges
`fund_payloads` with an **unscoped anti-join DELETE** —
`DELETE FROM fund_payloads t WHERE NOT EXISTS (SELECT 1 FROM fund_payloads_stage g WHERE g.kind=t.kind AND g.key=t.key)`
— followed by a parity guard asserting live == staged. An `interreg-*` payload kind written
by a second loader would be **silently deleted by the next `db:load:funds:pg`**, and the
parity guard would pass. Rejected alternatives: teaching `collectPayloads()` about the
Interreg tree (couples the two loaders' ordering forever) or scoping the delete (changes a
shared primitive for one caller).

**Serve live from the two fact tables.** ~900 operations and ~12,100 partner rows is small
enough that a per-place or per-EIK aggregate is an index scan; no precompute is warranted at
this size. Measure before shipping (`feedback_db_query_perf`: EXPLAIN ANALYZE the worst-case
entity — Столична, which has the most partner rows).

---

## 5. Scale — what this adds

**Measured, 2021-2027 CBC (107 projects / 384 partner rows):**

| Programme | BG partner rows | BG budget | BG share of project totals |
|---|---|---|---|
| IPA BG–Türkiye | 56 | €14.54m | 51.8% |
| Romania–Bulgaria | 37 | €11.54m | 48.5% |
| BSB NEXT | 32 | €7.26m | 17.1% |
| IPA BG–N. Macedonia | 5 | €1.15m | 48.5% |
| Greece–Bulgaria | 6 | — (0% published) | — |
| **Total** | **136** | **€34.49m** | |

**Measured, Interreg Europe 2021-2027** (the programme's own LoP xlsx): 46 BG partner rows,
**€8.19m** of €468.4m (1.75%), across all six BG NUTS2 regions.

**Extrapolated to the full corpus** — bilateral CBC at the ~48–52% BG share measured,
multi-country at each programme's BG partnership share (~17% BSB, ~4% Danube, ~2% Interreg
Europe / Euro-MED), EU funding grossed to total budget at the observed ~85–90% rate:

- **≈1,300–1,500 Bulgarian partner rows** (of ~12,100 partner rows total)
- across **≈800–1,000 distinct operations** (of ~1,930 BG-programme operations in keep.eu)
- carrying **€300–450m** of Bulgarian partner budget
- split roughly **€250–300m 2014-2020** (Tier P, place-only) and **€80–120m 2021-2027**
  (Tier L, EIK-linked, still contracting)

Against 82,011 rows / €44bn that is **+1.7% of rows and +0.8% of money nationally** — and
that ratio is exactly why the gap survived: invisible in any total, decisive in a per-capita
ranking of small border municipalities.

**Note the asymmetry the audit exposed**: roughly **two-thirds of the money is Tier P**, so
the majority of what this ingest recovers can be attributed to a *place* but not to a *legal
entity*. That is enough for the ranking (the harm this plan exists to fix) and not enough
for the company page or `company_public_money`.

**Confidence:** the 2021-2027 CBC figures are measured. The 2014-2020 extrapolation assumes
a stable BG partner share across periods — plausible (same eligible areas, same programme
pairs) but **unverified**; T0 replaces it with a measurement before any schema lands.

### 5.1 T0 RESULT — the whole corpus, measured 2026-08-07

The full crawl landed: **1,954 operations, 12,141 partnerships, 1,493 Bulgarian partner
rows.** Every per-programme operation count reconciles to §1 exactly, all 22 of them.
Crawl cost was well under budget — 40m22s for the 5,451-page index walk (§2.1 estimated
~2 h) and 3m17s for 1,954 details (estimated ~40 min), with 0 missing and 0 failed.

| period | ops | partnerships | BG rows | BG budget | BG w/ EIK | budget published | published_zero | unpublished |
|---|---|---|---|---|---|---|---|---|
| 2014-2020 | 1,251 | 6,843 | 1,080 | **€281.72m** | **0 (0%)** | 1,058 (98.0%) | 7 | 15 |
| 2021-2027 | 703 | 5,298 | 413 | **€114.67m** | **359 (87%)** | 407 (98.5%) | 0 | 6 |
| **total** | **1,954** | **12,141** | **1,493** | **€396.39m** | 359 (24%) | 1,465 (98.1%) | 7 | 21 |

**§5's extrapolation holds — every band was right:**

| §5 predicted | measured |
|---|---|
| ≈1,300–1,500 BG partner rows | **1,493** ✓ |
| €300–450m BG partner budget | **€396.39m** ✓ |
| €250–300m 2014-2020 / €80–120m 2021-2027 | **€281.72m / €114.67m** ✓ both |
| ≈800–1,000 distinct operations | **1,115** ✗ — *above* the range |

**The gate's two kill conditions, answered:**

1. *"If the 2014-2020 BG partner share differs materially from the 2021-2027 one, §5 is
   wrong."* The **blended** shares do differ — BG takes 34.7% of the operations it joins in
   2014-2020 against 21.1% in 2021-2027 — but §5 never used a blended rate; it applied a
   per-programme share (~48–52% bilateral CBC, ~17% BSB, ~4% Danube, ~2% Interreg Europe).
   The difference is **mix**, not a broken assumption: 2021-2027 is proportionally more
   multi-country and its bilateral programmes are still contracting. The totals landed
   inside every predicted band, so the method stands. **PASS.**
2. *"If 2014-2020 placement across the full corpus falls below the §9 floor."* Not yet
   answerable — it needs the resolver (T2.2) — but the **inputs are stronger than the
   30-row sample suggested**: town 100%, lat/lng 100%, postcode 95.6% (2014-2020) and 98.3%
   (2021-2027). The §9.6 floor of ≥90% is reachable on signal availability alone. **Not
   blocking; re-check at T2.2.**

**Four corrections T0 makes to this document:**

- **`co_financing_eur` is ALSO 2021-2027-only** — NULL on every sampled 2014-2020 partner
  row, alongside `pic`, `beneficiary_id`, `organisation_type` and
  `union_co_financing_rate`. §3.1 quotes it as a per-partner field without that caveat.
  Partner-level EU funding therefore exists for 413 rows, not 1,493; `budget_eur` is the
  only money the older period publishes per partner.
- **Tier P is 71.1% of the money and 72.3% of the rows**, not the "roughly two-thirds" §5
  states. The share attributable to a place but not a legal entity is slightly larger than
  the plan assumed, which tightens T4's scope further.
- **Budget coverage is far better than §2.5's fill-rate table implied**: 98.1% of BG rows
  carry a published budget. The programme-level gaps are real but small in aggregate — the
  two 0%-budget arms contribute 12 BG rows and €0.00m between them.
- **`published_zero` is confirmed and rarer than the sample suggested**: 7 rows, all
  2014-2020 (the sample found 2 of 30, implying ~72).

**The four named gaps in §2.5 are all confirmed as stated**, and none is a surprise:
BG-Serbia 21-27 → 0 operations; ESPON 2030 → 0; Greece-Bulgaria 21-27 → 3 operations, 6 BG
rows, €0.00m; ESPON 2020 → 6 BG rows, €0.00m.

---

## 6. Which municipalities move

Modelled by adding the **sampled** Interreg municipal-administration money (5.5% of the
corpus, 2021-2027 CBC only) to the reproduced baseline. A **lower bound** — the 2014-2020
arm is roughly three times larger. Baseline reproduced exactly: median 2.50 projects per
1,000 residents, median €980/жител over 256 mapped municipalities.

| Municipality | Oblast | Pop | +proj | +EUR | €/жител rank | Δ | €/жител |
|---|---|---|---|---|---|---|---|
| Ветово | Русе | 9,952 | 1 | 897,280 | 222→204 | **+18** | 509→599 |
| Сапарева баня | Кюстендил | 6,691 | 2 | 477,170 | 225→208 | **+17** | 505→576 |
| Камено | Бургас | 9,545 | 2 | 550,792 | 74→64 | **+10** | 1,232→1,289 |
| Белене | Плевен | 7,803 | 1 | 449,916 | 234→227 | +7 | 425→482 |
| Стралджа | Ямбол | 10,370 | 1 | 291,409 | 91→85 | +6 | 1,122→1,150 |
| Лясковец | В. Търново | 11,468 | 1 | 655,570 | 230→224 | +6 | 457→514 |
| Созопол | Бургас | 11,984 | 1 | 413,261 | 81→75 | +6 | 1,194→1,229 |
| Тополовград | Хасково | 8,941 | 2 | 612,045 | 21→16 | +5 | 2,098→2,166 |
| Поморие | Бургас | 25,406 | 1 | 682,609 | 103→98 | +5 | 1,059→1,085 |
| Берковица | Монтана | 14,501 | 1 | 745,678 | 53→50 | +3 | 1,470→1,521 |
| **Малко Търново** | **Бургас** | **2,628** | **2** | **535,998** | **3→2** | **+1** | **4,105→4,309** |
| Белоградчик | Видин | 5,049 | 1 | 340,064 | 5→4 | +1 | 2,855→2,922 |
| …18 more | | | | | | | |

**29 municipalities move on a 5.5% sample, and all 29 sit in a border oblast.** Малко Търново
keeps №1 on projects per 1,000 (14.84 → 15.64) and goes №3 → №2 on €/жител, so the live
post's claim is conservative — while a fair share of the field below it moves 10–18 places.

Two modelling hazards to carry into implementation:
- **Municipality name is not a key.** `data/municipalities.json` has three duplicate names —
  Бяла (Русе, Варна), Искър, Средец. Join on the obshtina code. My throwaway ranking script
  joined on name and produced a visible artifact (two "Бяла" rows, identical population).
- The baseline maps 256 of 265 via `awarder_seats`; "Столична" needs the `SOF` special case
  the local-elections tree already uses.

**The ranking filter must not use `org_type`.** ИСУН's `org_kind = 'Общинска администрация'`
has no clean counterpart in keep.eu's 11-value vocabulary (`Local public authority`,
`Regional public authority`, `National public authority`, `Higher education and research
organisations`, `Interest groups including NGOs`, `SME`, `Business support organisation`,
`Education/training centre and school`, `Sectoral agency`, `Other`, `N.a.`) —
`Регионална дирекция ПБЗН - Бургас` is typed `Regional public authority`, and
`Local public authority` includes bodies that are not the municipal administration. Filter
the municipal ranking on **the closed 265-municipality roster** (by EIK for Tier L, by the
§3.2-P2 roster match for Tier P), not on an org-type string.

---

## 7. Language — an unsolved presentation problem, stated not hidden

keep.eu holds **English only** for project titles and descriptions: `translations` had
exactly `{en}` for **107 of 107** sampled projects, no `bg`. Partner names are better —
**129 of 136** are Cyrillic and **136 of 136** carry an EN translation — but the operation
title, which is what a card or a search result shows, is English.

Consequences and the v1 decision:
- Store `title_en` (NOT NULL) and `title_bg` (NULL until a source exists). Do **not**
  machine-translate: `programmeNamesEn.ts` records the rule — inventing a plausible
  translation is exactly the fabrication the naming policy refuses.
- On BG pages render the English title with a visible marker that the programme publishes it
  in English only, next to the keep.eu attribution. This is honest and slightly ugly, and it
  is better than a fabricated Bulgarian title.
- The programmes' own BG-language project pages exist for some CBC programmes (МРРБ
  subdomains) and are a possible later enrichment — see §11.
- **SEO**: an English-titled page under a BG canonical is a weak page. Combined with the
  `/funds/interreg/:keepId` page-family decision in §8, keep v1 to `noindex` on the BG side
  and index the EN side only, rather than minting ~900 thin BG pages
  (`project_seo_discovery_gap`).

---

## 8. Ingest, loader and wiring

### Ingest — facts only, no place resolution

New directory `scripts/funds/interreg/`, a **sibling** of the ИСУН chain (whose
`MIN_ROWS = 60_000` guard in `projects_ingest.ts:76` is an ИСУН-export floor and must never
see Interreg rows).

| File | Role |
|---|---|
| `programmes.ts` | The curated keep.eu-programme-id → `programme_code` / BG+EN name / period / eligible NUTS3 map. The only place a programme is admitted. |
| `keep_fetch.ts` | Index walk (`/api/search/projects/?page=N`, id-desc, stop-at-known-id) + detail fetch + the monthly full re-crawl (§2.1). Concurrency ≤8, backoff, identifying `User-Agent`. Writes the gitignored raw cache `raw_data/interreg/keep/<keepId>.json`. |
| `parse.ts` | keep.eu JSON → `InterregOperation` + `InterregPartner[]`. EIK via `canonicalEik()`. Refuses an operation whose Σ partner budgets exceed its total by >1%. |
| `ingest.ts` | CLI → `data/funds/interreg/{operations,partners,index}.json` (committed). `--dry-run`, `--programme`, `--full`. |
| `measure.ts` | Read-only harness (T0): re-derives every figure in §3/§5/§6 from the raw cache or Postgres. No writes, no `--apply`. Modelled on `scripts/procurement/measure_cross_source.ts`, which exists for exactly this purpose — "so that every number in the plan can be re-derived by running one command… with THE SAME CODE the pass acts on rather than a re-implementation". **Not yet landed** — §5.1's headline figures are meanwhile pinned by `scripts/funds/interreg/ingest.test.ts` against the committed corpus, which is a gate but not a harness: it asserts the numbers, it does not re-derive §6's ranking delta. |

**Place resolution moves to the loader, not the ingest** — corrected by the audit. Tiers L1
and L2 read `awarder_seats` and `tr_company_place`, which live in Postgres; an ingest script
reaching into PG would make the committed JSON tree non-reproducible from a fresh clone and
would put the ordering dependency in the wrong place. `load_tr_company_place_pg.ts` is the
precedent: it resolves inside the loader and reports coverage. So `data/funds/interreg/`
carries no `ekatte`; `resolve_place.ts` runs loader-side.

**Keeping the tree under `data/funds/` is load-bearing, not cosmetic.**
`scripts/bucket_sync_paths.ts:55` excludes `rel === "funds" || rel.startsWith("funds/")`
("funds/ is served from Cloud SQL"), and `rel` is relative to `DATA_DIR = "data"`, so
`data/funds/interreg/` inherits the exclusion. No `CHILD_EXCLUDES` entry is needed — that
list only guards a child under a *still-served* parent, and `funds/` is refused whole. A new
top-level `data/interreg/` would be uploaded to the bucket, contradicting
`reference_funds_pg_only`.

**Attribution.** keep.eu's terms require crediting keep.eu with a link. Every Interreg figure
carries it, and `/data/sources` gains an entry.

### Loader

`scripts/db/load_interreg_pg.ts`, `npm run db:load:interreg:pg` (+ `:cloud`). Follow the
**funds** `:cloud` shape (`package.json:73-74` — duplicate the whole command, do **not** nest
`npm run`; `load_funds_pg.ts:508-512` records why the nested form swallowed a flag and caused
an outage). Applies `137_interreg.sql`; resolves place (§3.2); stage-merges both tables;
`recordIngestBatch({ source: 'interreg_partner' })`.

After place resolution it also **reports** how many BG partners landed outside their own
programme's eligible area (`isEligibleNuts` from `programmes.ts`, against the settlement's
NUTS3). A warning, not a failure — see §9 gate 14 for why zero is the wrong assertion.

**`db:refresh` position.** After `db:load:funds:pg` and — critically — **after both
`db:load:awarder-seats:pg` and `db:load:tr-company-place:pg`**, which the place cascade
reads. Add both as `ORDER_PAIRS` entries in `scripts/db/refresh_coverage.test.ts:85-115`
("this loader must follow the step that rebuilds its input") — the gate that would have
caught the `tr-company-place`-before-`graph` bug. Membership alone is not enough.

**Changelog.** `recent_updates()`'s `ingest_first_seen` branch is generic, so an
`interreg_partner` source flows through with `eik = NULL` immediately. Linking Tier-L rows to
`/company/:eik` needs a third arm in the `CASE fs.source` at `007_query_builders.sql:198`.
007 is an **"applied, never loaded"** migration, so shipping that one-line change to prod is
an explicit `apply_functions.ts 007_query_builders.sql` — it rides `db:load:tr:pg:cloud` but
must not wait for one. Keep the branch's `LIMIT lim` intact: 007 was rewritten from 13.61 s
to 0.15 s precisely by adding per-branch limits.

**CLAUDE.md** gains a section in the register of the others: what `db:load:interreg:pg:cloud`
does, that nothing runs it on the cloud side, and its re-run triggers — a keep.eu re-import,
an `awarder_seats` reload, a `tr_company_place` reload
(`reference_migrated_family_watch_reload`).

**Skill.** `.claude/skills/update-funds/SKILL.md` gains **Step 3c — Interreg (keep.eu)**
between the geo-pins step and Step 4, plus rows in the File map and the Data-integrity
contract tables, and both publish commands in Step 4. Add a `keep_eu_interreg` source to the
daily watcher and to `process-watch-report`'s mapping + cloud-publish tables. While there:
`SKILL_LINKS` in `scripts/lib/data-changes.ts` has no `update-funds` entry, so its
`/data/updates` rows render linkless.

### Serving (T3) — the surfaces, each declaring its basis

One SQL function pair — `interreg_by_place(p_ekatte)` / `interreg_by_eik(p_eik)` — then
widen one at a time:

1. the per-capita municipal ranking (the harm in §Context);
2. `/funds` — a new Interreg section, served live from the fact tables, **not** via `fund_payloads`;
3. governance + My-Area EU-money tiles (`src/screens/myarea/MyAreaProjectsMapTile.tsx`);
4. **`scripts/myarea/build_alerts.ts:199-200,514`**, which reads the on-disk
   `data/funds/projects/by-muni` + `changes/` rather than PG — a separate code path that will
   otherwise keep the old basis;
5. **the AI chat tools** — `ai/tools/profile.ts` (`placeEuProjects`), `ai/tools/fiscal.ts`,
   `ai/tools/regional.ts`, `ai/tools/environment.ts` — all of which read `fund_payloads` and
   would otherwise answer with exactly the geographic bias this plan exists to end;
6. the company page tile and `search_fund_projects` — **Tier L only**, and only once (7) exists;
7. a `/funds/interreg/:keepId` page family, because a search hit needs a link target. ~900
   operations × 2 languages ≈ 1,800 prerendered files against a `dist/` of ~248k, well under
   the Firebase ceiling (`project_firebase_deploy_ceiling`), plus a sitemap shard. See §7 on
   indexing the EN side only in v1.

### T4 — `company_public_money` (migration 127)

Recommend **yes**, as a **fourth, separately labelled arm** reading
`interreg_partners.budget_eur WHERE country='BG' AND eik IS NOT NULL`. Interreg money to a
Bulgarian organisation is public money by the same definition as the other three arms, and a
separate arm keeps the basis declarable. **Its scope is Tier L only** — roughly a third of
the recovered money — because 2014-2020 has no EIK. That limitation belongs in the tile's
caption, not just in this document.

It lands with its own row in `company_public_money.data.test.ts`'s canonical-spec drift gate.
Downstream re-run chain: 127 → `load_graph_pg.ts` → `tr_company_place.money_eur` →
`db:load:persons-browse:pg` → `db:load:person-search:pg`.

---

## 9. Test gates

`scripts/db/tests/interreg.data.test.ts` (PG-gated, auto-skips):
1. **Non-empty, non-shrinking** — operations and partners above a floor; a >5% shrink fails.
2. **No partner row carries the operation total** — for every operation, Σ `partners.budget_eur` ≤ `operations.total_budget_eur × 1.01`, and no single partner budget equals the operation total when `partner_count > 1`.
3. **Budget basis is exhaustive and exclusive** — every row is exactly one of `published` / `published_zero` / `unpublished`, and `budget_eur` agrees (non-zero / zero / NULL).
4. **No money aggregate crosses the join** — read every shipped function body out of `pg_get_functiondef` and fail if any sums `interreg_operations.total_budget_eur` grouped by a place- or beneficiary-keyed column (the `procurement_payloads.data.test.ts` idiom).
5. **EKATTE is never invented** — every non-NULL `ekatte` exists in `data/settlements.json`; every placed row is within 25 km of its published lat/lng; `place_basis` is non-NULL exactly when `ekatte` is.
6. **Placement floor, split by period** — ≥90% of BG partner rows *and* ≥90% of BG partner money placed, asserted **separately for 2014-2020 and 2021-2027** so a regression in the harder tier cannot hide behind the easier one.
7. **EIK hygiene** — no 10-digit value ever stored (the ЕГН guard); ≥85% of 2021-2027 BG rows carry an EIK; **exactly 0% of 2014-2020 rows do** (asserted, so a future source change that starts supplying them is noticed rather than silently absorbed).
8. **Namespace disjointness** — no `interreg_operations.operation_id` appears as a `fund_projects.contract_number`, and vice versa.
9. **No cross-corpus double count** — no `(eik, folded title, start year, amount ±1%)` match between `fund_projects` and `interreg_partners`. The test asserts its own partiality: it can only cover Tier L, and it reports the uncovered row count.
10. **Period fence** — no row outside {2014-2020, 2021-2027}.
11. **Programme admission** — every `programme_code` exists in the curated map; a keep.eu programme id absent from the map produced zero rows, not silent ones.
12. **Serving latency** — `interreg_by_place()` on the worst-case entity (Столична) under a stated ceiling, EXPLAIN-backed (`feedback_db_query_perf`).
13. **`fund_payloads` is untouched** — assert `interreg%` matches zero `kind` values, so a future shortcut into that table (which the next funds load would silently delete) goes red here.
14. **Placed inside the programme's own eligible area** — for every placed BG partner of a CBC programme, the settlement's NUTS3 is inside that programme's declared `eligibleNuts` (`isEligibleNuts`, prefix semantics, so BSB's NUTS2 declaration matches). **Reported with a ceiling, not asserted at zero**: a partner may legitimately sit outside the area (a national body leading a border project), so the gate is a bound on the share plus a printed list. Zero would be the wrong assertion; unbounded would make it decoration. Added 2026-08-06 after the T0.1 review found `isEligibleNuts` had no consumer — a BG partner outside its own programme's area is either a placement error or a keep.eu error, and nothing else in this list would notice.

`scripts/funds/interreg/*.test.ts` (unit, no network):
- `parse.ts` on fixtures: the four Малко Търново rows parse to the exact budgets in §3.1; every observed `beneficiary_id` shape yields the right EIK; `N.a.` yields NULL; a `0.00` budget becomes `published_zero`, never `unpublished`; a NULL `project_id` is accepted and `keep_id` carries the row.
- `resolve_place.ts`: cascade order; an ambiguous postcode (e.g. 2060 → 13 settlements) resolves via geo or not at all; a >25 km geo contradiction drops to unresolved; the roster matcher matches `Община "Тунджа" - гр.Ямбол` and refuses a name outside the 265.
- `programmes.ts`: an unknown keep.eu programme id → skip + warn, never an invented code.

**Cross-source verification** (`measure.ts --verify`): operation counts and totals per
programme reconcile against the programme's own Art. 49(3) list where one exists (BSB,
Interreg Europe, Danube), within a tolerance for publication lag. Reported, not failed — the
LoP is usually the staler of the two.

**Ranking regression** — commit the §6 delta table as a fixture and assert the ranking
recomputed with the Interreg arm still produces it. A change that silently drops the arm goes
red instead of quietly restoring today's bias.

`refresh_coverage.test.ts` — chain membership plus the two `ORDER_PAIRS` entries.

---

## 10. Tiers

| Tier | Scope | Ships |
|---|---|---|
| **T0** | `programmes.ts`, `keep_fetch.ts`, `measure.ts`. One full crawl into the raw cache; every §3/§5/§6 number re-derived from the whole corpus, no extrapolation. Request the keep.eu API key. | A measurement report. No schema, no writes. |
| **T1** | `parse.ts`, `ingest.ts` → committed `data/funds/interreg/`. Unit tests. | The corpus on disk. |
| **T2** | `137_interreg.sql`, `load_interreg_pg.ts` (incl. `resolve_place.ts`), `:cloud`, chain + `ORDER_PAIRS`, `interreg.data.test.ts`. | The corpus in Postgres, local and prod. |
| **T3** | `interreg_by_place()` / `interreg_by_eik()`; the seven surfaces in §8, in that order. Each declares its basis. | The gap closed on the site. |
| **T4** | `company_public_money` fourth arm (Tier L only) + the downstream re-run chain. | Interreg counted as public money. |
| **T5** | `update-funds` Step 3c, CLAUDE.md section, watcher source, `process-watch-report` mapping, `/data/sources` + keep.eu attribution. | It stays current. |

**T0 is a hard gate.** Two of its numbers can invalidate the design: if the 2014-2020 BG
partner share differs materially from the 2021-2027 one, §5 is wrong; if 2014-2020 placement
across the full corpus falls below the §9 floor, T3's ranking widening cannot ship for that
period and the plan needs revising before any schema lands.

---

## 11. What I could not establish

- **Whether the keep.eu API key is granted, at what rate limit, and on what licence.** Interact evaluates case-by-case. The plan works without it.
- **The 2014-2020 BG partner share**, and therefore two-thirds of §5. Measured only for 2021-2027 CBC. T0 replaces it.
- **Whether the ~85–90% co-financing rate used to gross EU funding to total budget holds per programme.** Observed on the sample; not verified programme by programme.
- **Placement across the *whole* 2014-2020 corpus.** Measured on 30 rows (90% placed, 0 geo contradictions). A 30-row sample is thin for a €250–300m claim.
- **Interreg IPA Bulgaria–Serbia 2021-2027 has zero projects in keep.eu** (8 operations, 48 partnerships known to exist). No source found. A named gap, not a silent one.
- **URBACT IV (30 of 2,081 partnerships) and ESPON 2030 (0 of 616)** likewise. ESPON 2020 has 353 partnerships in keep.eu but **0% budget coverage** in both periods.
- **Greece–Bulgaria 2021-2027 publishes no partner budgets and no postcodes** (both 0%; 10 of 26 partnerships present). Placeable via EIK; money not ingestable.
- **Whether a partner budget is ever revised after publication**, and therefore whether `budget_eur` needs history. keep.eu exposes `modified` per project; I did not test whether budgets actually move.
- **Whether `project_id` is globally unique where present.** Bare-numeric values like `6028519` sit alongside `BSB00963`, so collision across programmes is plausible. The `keep_id` PK makes this moot for correctness, but the unique-where-not-null index on `operation_id` may need to become `(programme_code, operation_id)` — T0 answers it.
- **Whether a Bulgarian-language title exists anywhere** for these operations (§7). The МРРБ programme subdomains may carry BG project pages; not investigated, and two of them fail TLS verification.
- **`ipacbc-bgtr.eu` did not resolve and three `*.mrrb.bg` subdomains fail TLS chain verification** as of 2026-08-06. Not blocking — cross-check only — but the fallback path is weaker than the primary.

---

## 12. What the audit corrected in the first draft

Recorded because each was a real defect, and because two of them would have shipped silently.

1. **`beneficiary_id` / `pic` are 2021-2027 fields only** (0 of 30 sampled 2014-2020 rows carry either). The draft's "91% EIK coverage" was measured on 2021-2027 and generalised. Forced the Tier L / Tier P split, the `keep_id` PK, and the halving of T4's scope.
2. **`project_id` is NULL for 2014-2020** and heterogeneous where present. PK changed from `operation_id` to `keep_id`.
3. **Writing into `fund_payloads` would be silently erased** by the next `db:load:funds:pg` — `mergeFromStage` runs an unscoped anti-join DELETE and its parity guard would still pass. Serving moved to live aggregates over the fact tables.
4. **Migration 136 is taken** (`136_bill.sql`). Now 137.
5. **keep.eu is English-only for titles** (107/107 projects have no `bg` translation) — a presentation problem the draft did not name. Now §7, with a v1 decision.
6. **Place resolution belongs in the loader, not the ingest** — L1/L2 read Postgres tables, and an ingest that reaches into PG makes the committed tree unreproducible from a fresh clone.
7. **`org_type` cannot stand in for ИСУН's `org_kind`** — keep.eu's 11-value vocabulary does not map cleanly, so the municipal ranking filters the closed 265-municipality roster instead.
8. **There is no Interreg `paid_eur`** — absorption metrics stay ИСУН-only.
9. **`published_zero` is a real third budget state** (2 of 30 rows), distinct from `unpublished`.
10. **Incremental refresh cannot be stop-at-known-id alone** — keep.eu re-imports whole programmes, revising rows in place, and the index exposes no `modified`.
11. **Surfaces the draft missed**: `scripts/myarea/build_alerts.ts` (reads on-disk JSON, not PG) and the four AI-chat tool families that read `fund_payloads`.
12. **`data/funds/interreg/` inherits the bucket-sync exclusion** only because it sits under `funds/` — a design constraint, not an accident.
13. The draft's verification section invented a `settlements_where_obshtina()` function. Replaced below with real queries.

---

## Verification

```bash
# 1. The premise (0 before T2, non-zero after)
psql "postgres://postgres:postgres@localhost:5433/electionsbg" -c \
  "select count(*) from fund_projects where contract_number ~ '^(BSB|BGTR|ROBG|GRBG)';"
```
```bash
# 2. T0 — measure the whole corpus before writing anything
npx tsx scripts/funds/interreg/measure.ts --full
```
```bash
# 3. T1 — ingest
npm run funds:ingest-interreg -- --dry-run && npm run funds:ingest-interreg
```
```bash
# 4. T2 — load and gate
npm run db:load:interreg:pg && npx vitest run scripts/db/tests/interreg.data.test.ts scripts/db/refresh_coverage.test.ts scripts/funds/interreg
```
```bash
# 5. The four Малко Търново rows, end to end (obshtina BGS12)
psql "postgres://postgres:postgres@localhost:5433/electionsbg" -c \
  "select o.operation_id, o.keep_id, p.partner_name, p.eik, p.budget_eur, p.budget_basis, p.ekatte, p.place_basis
     from interreg_partners p join interreg_operations o using (keep_id)
    where p.obshtina = 'BGS12' order by o.keep_id;"
```
```bash
# 6. Placement coverage, split by period (the §9.6 floor)
psql "postgres://postgres:postgres@localhost:5433/electionsbg" -c \
  "select o.period,
          count(*) rows, count(p.ekatte) placed,
          round(100.0*count(p.ekatte)/count(*),1) pct_rows,
          round(100.0*coalesce(sum(p.budget_eur) filter (where p.ekatte is not null),0)
                / nullif(sum(p.budget_eur),0),1) pct_money
     from interreg_partners p join interreg_operations o using (keep_id)
    where p.country='BG' group by 1;"
```
```bash
# 7. The ranking, before and after
npx tsx scripts/funds/interreg/measure.ts --ranking-delta
```
```bash
# 8. Full gates
npm run test:unit && npm run build
```
