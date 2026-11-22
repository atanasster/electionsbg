# Procurement 2020 РОП backfill — v1

Status: **applied locally (2018 + 2020 rebuilt with `--replace`), cloud publish
pending.** Opened 2026-11-22 from a
reader report: ПСИТ БЪЛГАРИЯ ООД (030116772) has no МОН contract for УНП
`00165-2019-0017` (open procedure published 2019-10-21, estimate 3,200,000 BGN /
€1,636,134 — the НВО/ДЗИ electronic-marking service it won again in 2023 and 2026).

## The gap

2020 is the one hole in the contracts corpus, and it is near-total in the first half:

| month    | aop-legacy | eop    | total  |
| -------- | ---------- | ------ | ------ |
| 2019 avg | ~1,860     | —      | ~1,860 |
| 2020-01  | 1          | 2      | **3**  |
| 2020-02  | 4          | 11     | **15** |
| 2020-06  | 84         | 23     | 107    |
| 2020-12  | 1,363      | 93     | 1,456  |
| 2021 avg | ~520       | ~2,050 | ~2,570 |

2020 totals 4,629 contracts against 22,339 (2019) and 31,076 (2021).

**Why:** ЦАИС ЕОП went live in 2020, but procedures opened in the old РОП kept publishing
their award notices in РОП. Neither feed we ingest carries those:

- `raw_data/procurement/legacy/2020.csv.gz` (АОП annual CSV, 4,662 rows) is ЦАИС-era
  publications only — document numbers in the 63k range, dates from September.
- The ЦАИС flat cache `raw_data/procurement/eop/2020-*.json.gz` holds 8 records for
  January and 30 for February — ЦАИС simply was not where awards were published yet.
- `ingest_rop.ts` (the РОП awards-search scraper) was only ever run for 2018.

## The source

`https://www.aop.bg/esearch_awards_from_to.php` — the same register `ingest_rop.ts` crawls,
by publication day. It still answers for 2020 and the existing parser reads it unchanged.

Sample, 2020-01-13 … 2020-01-19 (dry run): 479 rows seen, 445 EIK-resolved (92.9%),
**398 NEW**, 9 already in the corpus. Drops: awarder 2, contractor 32, no-amount 38.

## Ingester fixes (commit 003940472c)

1. **It could not reach the site.** TLS handshake ~18 s, first byte ~107 s; undici's 10 s
   connect timeout counts the handshake, so every fetch failed as
   `UND_ERR_CONNECT_TIMEOUT` and the dry run reported 0 rows with every day a shortfall.
   Now a dedicated `Agent` (60 s connect, 240 s headers/body, verification on).
2. **Dedup missed the year boundary.** Keys were loaded for the PUBLICATION year only,
   but rows are filed under the CONTRACT date — a January 2020 notice for a December
   2019 contract was written into 2019 shards unchecked against the 2019 CSV rows. Now
   loads year−1 as well. (The 2018 run had the same exposure against 2017;
   `reconcile_cross_source` covers rop↔aop pairs, so worth a `measure_cross_source`
   check rather than assuming.)

## Steps

1. Dry-run crawl 2020-01-01 … 2020-12-31 into the cache (running; ~730 pages at
   ~2 min each, concurrency 3). Re-run to fill any shortfall days — the cache makes it
   cheap.
2. Probe 2021-H1 for a РОП tail (one week) before deciding whether to extend.
3. Confirm the reported contract appears (УНП `00165-2019-0017`, ПСИТ БЪЛГАРИЯ).
4. `--apply`, then the standard chain:
   `proc:backfill-unp:apply` → `proc:reconcile:apply` → `proc:rebuild-derived` →
   `db:load:pg` → `db:load:annexes:pg`, and the derived loaders that key on contracts
   (graph, tr-company-place, persons-browse, person-search, procurement-scopes).
5. Review: `measure_cross_source.ts` §6 for same-feed and cross-feed duplicates against
   the 2019 and 2020 CSV rows; spot-check € totals per month.
6. Cloud: `db:load:pg:cloud` → `db:load:annexes:pg:cloud` → `db:load:graph:pg:cloud` →
   `db:load:tr-company-place:pg:cloud` (+ persons-browse / person-search). Outward-facing,
   needs operator go-ahead.

## Full-year dry run (2026-11-22, ~4 h, 0 shortfall days)

22,582 rows on 253 publication days; 21,084 EIK-resolved (93.4%); **18,072 NEW**, 299
already in the corpus; 106 key collisions disambiguated. Drops: awarder 49, contractor
1,449, no-amount 2,711, self-deal 2.

The reported contract is in: published 2020-01-17 (page 3), МОН 000695114 → ПСИТ
БЪЛГАРИЯ 030116772, contract „Д01-2" signed 2020-01-14, 3,175,000 BGN = €1,623,352.
Note the row is dated by PUBLICATION day — the importer's existing convention (2018 too).

### ⚠ The contractor drop is 35% of the money

|                               | 2020                             | 2018 (already loaded)            |
| ----------------------------- | -------------------------------- | -------------------------------- |
| all rows, €                   | 5,797.1M                         | 4,317.8M                         |
| emitted, €                    | 3,750.9M                         | 3,203.3M                         |
| dropped — supplier unresolved | **2,048.8M (35.3%)**, 1,448 rows | **1,108.6M (25.7%)**, 1,470 rows |
| of which ДЗЗД / consortia     | **1,747.1M**, 620 rows           | 669.4M, 515 rows                 |

The row count (~7%) hides it: the unresolved suppliers are the LARGEST contracts —
НКЖИ, АПИ and БДЖ consortia (ЩРАБАГ ДЖИ ПИ РЕЙЛ 2017 €230.8M, ГЕОПЪТ ЛОТ 1 €114.9M,
ЗГОП БЪЛГАРИЯ €113.7M, Алстом Транспорт €83.9M …). РОП publishes the supplier by NAME
only, and `buildResolutionMaps` resolves names only against the on-disk corpus, so a
supplier that never appears elsewhere with an EIK is dropped. 2018 has carried this gap
since it was loaded.

Options for the resolver (decide before `--apply`, then re-run 2018 too — cache only):

- registered companies/ДЗЗД: unique-name match against `tr_companies` (refuse on >1 hit —
  [[name match ≠ identity]] applies only to PERSONS; a company name in TR is a registry
  identifier, but must still be unique);
- unregistered consortia: a synthetic name-keyed supplier (the `ph-` precedent in
  `supplier_identity.ts`), never attributed to member firms we cannot see.

### Resolver fix (commit 4d2657598e)

1. Tier 2 — unique Commerce Registry name match (`resolveViaTr`), refused on
   ambiguity, legal-form disagreement, an undeclared form, and any consortium name.
   334 suppliers / €59M across both years; of the 45 with a known founding date, none
   was founded after its contract.
2. Tier 3 — name-keyed `nm-` supplier (`nameOnlySupplierKey`), non-linkable like
   `ph-`/`np-`.
3. **A comma LIST of suppliers no longer resolves to its first member.** The old
   fallback credited МЗ's centralised oncology-drug framework (УНП 00080-2019-0022,
   РД-11-270 at 595M лв and РД-11-277 at 486M лв, 13 wholesalers) to Алта
   Фармасютикълс alone — €639.5M across 59 rows in 2020.
4. `nm-` rows also dedup on supplier-agnostic keys (УНП+amount; buyer+signing
   date+amount).

Result, from cache: 2020 keeps **19,281** new rows (1,106 name-keyed, 192 via TR);
2018 adds **1,421** — exactly the rows its original load dropped. 2020 money
€5.80bn, of which €2.67bn (46%) sits on name-keyed suppliers.

Applied 2026-11-22 (both years, 12 month-shards each). Reconcile evicted 5
cross-source twins (€3.7M, four of them leftovers of the 2018 load).

### Known, not fixed here

- **МЗ framework agreements vs hospital call-offs.** A framework's value is a
  ceiling that hospitals then draw down in their own contracts, which the corpus
  also holds. The ЦАИС years already carry МЗ frameworks split per supplier
  (2021 €361M, 2025 €1.51bn), so including 2020's is consistent — but whether the
  corpus double-counts frameworks against call-offs is a corpus-wide question.
- The 7 list-to-first-member rows already in 2018 (€0.3M) stay as loaded; their
  `nm-` re-derivations are caught by the supplier-agnostic dedup.

## Open questions

- The 38 no-amount rows per week are mostly `анекс към …` notices with 0 — expected,
  but confirm none is a base contract with a missing value.
- 32 contractor-unresolved rows per week (~7%) are name-only suppliers; they are dropped,
  not keyed by name. Measure the € share before accepting that.

## Local state after apply (2026-11-22)

- `db:load:pg` first aborted on `contracts_stage_pkey`: 10 amendments the РОП re-filed
  in 2020 for 2018 contracts reused the 2018 rows' keys. Fixed in 8506755d3a
  (`avoidExistingKeys` — the newcomer is re-keyed, published URLs never move) and the
  10 rows on disk re-keyed the same way.
- Postgres: 430,646 contracts (+20,683); 2018 20,198 → 21,603 rows / €3.19bn → €4.30bn;
  2020 4,629 → 23,802 / €1.08bn → €6.84bn. 2,198 `nm-` rows, 1,612 suppliers, €3.72bn.
- Hub: 410,068 → 430,646 contracts, €95.28bn → €102.15bn. Cross-reference pair counts
  unchanged (MP 121, officials 891).
- Reported contract live locally: `/company/030116772` now lists МОН, 2020-01-17,
  €1,623,352 (`rop-00165-2019-0017-Д01-2`).
- Gates: `single_source_per_contract` aop+rop band re-measured 126 → 287 (all new
  groups are framework number reuse, none equal-amount); `no_personal_ids` now exempts
  the minted name-hash shape (`nm-b0729022607f` contains a checksum-valid digit run).

## Rebuild with `--replace` (2026-11-22, second pass)

Both years were re-derived from the page cache with `--replace` (removes the window's
existing РОП rows, then re-ingests), so 2018 picks up every resolver fix too.

- **Content-key dedup tightened.** The loose `u:` key dropped genuine repeat purchases;
  dedup now uses `ropContentKeys` (УНП + supplier + contract no. + amount, awarder +
  supplier + contract no. + signing date, awarder + supplier + date + amount) across
  ALL years, plus supplier-agnostic keys for `nm-` rows. The 3 Лего Трейд duplicates
  (00737-2020-0002 / 134-136, €43,918) are now dropped.
- **Ambiguous corpus names are refused, not voted on.** `normOrgName` strips the city,
  so „Симекс ЕООД" maps to two different companies (Криводол, Кърджали). The contractor
  name map took the majority EIK; it now resolves only when one EIK holds ≥90% of the
  name's matches (`CONTRACTOR_NAME_MIN_SHARE`), otherwise it falls through to the
  registry tier and then to an `nm-` key. Measured: 2,705 rows (€380M) used a name with
  more than one EIK; 682 had no EIK at 90%.
- **`isOrganisationName` was left as is, on purpose.** Its Cyrillic forms never fired
  (`\b` is ASCII-only), but making them fire would be the wrong fix: a Bulgarian
  company's own id is never 10 digits, so a checksum-valid 10-digit id beside „ООД" is
  most likely the owner's ЕГН. The dead alternatives were removed and the reason written
  beside the regex. Only one served row was affected (ВАШУТВИЛ-ГЕП ООД, `np-`).
- **Result:** 2018 21,621 РОП rows, 2020 19,322; 0 duplicate keys corpus-wide.
- ⚠ **URL movement.** Against the pre-replace shards, 2018 keeps 21,085 of 21,602 keys.
  Of the 517 that move (€124M), 481 are suppliers now name-keyed instead of guessed,
  34 are rows the tighter dedup drops, 1 changed EIK and 1 re-keyed. 2018 has been
  live since 2026-07-11, so those ~517 `/procurement/contract/:key` URLs will answer
  404 after the cloud publish (the key embeds the supplier, so the move is inherent).
  2020 moves 290 keys, but none of 2020 is published yet.

### What the full `test:data` run turned up after the rebuild

- **The annex fold has to run after a `--replace`.** The replaced rows come back at
  their signing value, so `anexi_current_value --apply` belongs between the ingest and
  the УНП backfill (1 row: Стройконсулт, 01379-2017-0012).
- **The excise register over-stated two operators by the supplier-list misattribution.**
  The July 2018 load credited „Брентаг, Индустриалкомплект, …" lists entirely to
  Брентаг (130948282, €3.27M). The committed `data/customs/excise_register.json` was
  re-enriched from Postgres with the generator's own query instead of re-fetching the
  register, so only the procurement columns moved (26 operators).
- **Three road dossiers took in 2020 rows through their place-name seeds.** Excluded:
  the regional winter-maintenance framework 00044-2019-0009 from Русе–Велико Търново;
  the archaeology framework AGREEMENT `cf1bfc88975c` (€20.45M ceiling, whose call-offs
  are already members) from Русе–ВТ and Хемус; and the ten-lot design framework
  00044-2019-0077 from Западна дъга, where only lot 4 is the project and no row says
  which lot it is.
- **Two tests were too strict, not wrong data.** `stake_procurement` compared a
  Postgres `round()` of a double (ties to even) with `Math.round` on a sum of exactly
  €1,038,708.50; `search_subtitle` matched „Техника" case-sensitively after the
  corpus's most frequent spelling became „Бит и техника ООД - Варна".
- Retired three `single_source_per_contract` allowlist entries: the 2018 РОП side of
  those aop/rop pairs is now deduped away.
- **Not caused here:** `sector_stats_tourism` — advertising is 40% of МТ's corpus
  against the „около половината" caption. 2020 adds €0.64M with no CPV (<1 point);
  the share was ~41% before this work.

## Still open

- **Cloud publish not run**: `db:load:pg:cloud` → `db:load:annexes:pg:cloud` →
  `db:load:graph:pg:cloud` → `db:load:tr-company-place:pg:cloud` →
  `db:load:persons-browse:pg:cloud` → `db:load:person-search:pg:cloud`, then
  `bucket:sync:paths` for the regenerated `data/procurement/derived/*` + `index.json`.
