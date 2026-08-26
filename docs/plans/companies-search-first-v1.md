# /companies — search-first browser, KPI band and honest filters, v1

**Status:** audited 2026-08-26 against local Postgres and the working tree; see §15.
**Tier 6 is already implemented locally and UNCOMMITTED** — `188_company_browse.sql` carries the
index and `scripts/db/schema/pg/193_company_browse_contract_count_index.sql` exists (untracked),
and the index is present in the local database. **It has NOT been applied to Cloud SQL.** Every
other tier is unstarted.
**Screen:** `src/screens/dev/CompaniesBrowseDbScreen.tsx` (323 lines today — yes, `dev/`; it serves `/companies`)
**Table:** `company_browse_table`, migration `scripts/db/schema/pg/188_company_browse.sql`
**Resource:** the `companies` entry in `functions/db_table.js`
**Predecessor:** `docs/plans/company-browse-dashboard-v1.md` (the browse this reworks)
**Sibling precedent:** `docs/plans/persons-search-first-v1.md` and its follow-up
`docs/plans/persons-place-position-params-v1.md`. This plan mirrors their shape deliberately —
rule module plus gate, chips over hidden state, a per-figure declared basis — and, like the
second, it recommends **against** two of the things asked for, because the measurements said so.

Every figure below was measured **2026-08-26** against local Postgres
(`postgres://postgres@127.0.0.1:5433/electionsbg`) unless it names another source.

---

## 0. What was asked, and what each ask actually costs

Four requests:

1. is the `has_signal` default (98,737 of 1,022,592) the right default?
2. is a **search-first landing** right here, as it was on `/persons`?
3. the **URL contract** — what is shareable, what `NARROWING_PARAMS` would be;
4. **widen the filters** and **add KPIs**, which there are none of today.

(1) turns out to be the wrong question in a useful way — §1.1. (2) is yes, and it is the change
that makes (1) mostly moot. (3) is the largest single defect on the page: **three of the four
controls are not in the URL at all**, and the fourth does not survive Back. (4) splits: five of the
eleven filter candidates are worth building, two are worth refusing, and the KPI band needs a
withholding rule for **five** separate tautologies rather than /persons' two.

| ask | verdict | cost |
|---|---|---|
| widen the default past `has_signal` | **no — keep the floor, but stop it applying to SEARCH** (§1.1, §1.2) | Tier 1 |
| search-first landing | **yes** (§1.3) | Tiers 3, 5 |
| URL contract | **build it — there is none today** (§1.4) | Tier 1 |
| widen the filters | **5 of 11** (§1.6) | Tier 4 |
| a KPI band | **4 cells, one candidate refused** (§1.7) | Tier 2 |
| a `legal_form` picker | ⚠️ **refuse** — the vocabulary is doubled (§1.5) | — |
| a "signal kind" param | ⚠️ **refuse** — it is the union of four params that already exist (§1.6) | — |

### The corpus, measured

| | rows | share |
|---|---|---|
| `company_browse_table` total (= `tr_companies`) | **1,022,592** | 100% |
| `has_signal` — today's default view | **98,737** | 9.66% |
| hidden by the floor | **923,855** | 90.34% |
| `is_official_linked` (the `?political=1` toggle) | **17,675** | 1.73% |
| `contract_count > 0` | **18,689** | 1.83% |
| `public_money_eur > 0` | **59,884** | 5.86% |
| NGO classes (`ngo_assoc` ∪ `ngo_found` ∪ `chitalishte`) | **30,339** | 2.97% |
| `is_mp_tied` (from `contractor_rank`) | **106** | 0.01% |
| carries a resolved place (`oblast_name IS NOT NULL`) | **327,161** | 32.0% |
| `status = 'active'` | **977,216** | 95.6% |

`entity_class` — 7 values, **no NULLs**: company 988,644 · ngo_assoc 21,815 · ngo_found 5,085 ·
chitalishte 3,439 · coop 2,708 · foreign_branch 878 · state_enterprise 23.

`status` — 4 values, **no NULLs**: active 977,216 · ceased 39,293 · in_liquidation 5,812 ·
bankrupt 271.

`oblast_name` — **28** values, no empty strings. `obshtina_code` — **265** values, of which
**13 rows carry the empty string** (the facet's own `<> ''` guard drops it, so no picker would
ever show it; a hand-built `?obshtina=` could still send it).

Money: `sum(public_money_eur)` = **€76,125,285,097**, `sum(contractor_total_eur)` =
**€64,775,985,979**, `sum(contract_count)` = **373,067**. Median non-zero public money
**€30,678**, mean **€1,271,212**.

---

## 1. Seven findings that shape the design

### 1.1 ⚠️ The page's own promise is FALSE, in four places, and that is the headline defect

Both locale corpora and both prerendered bodies say the same thing:

> „…но **търсенето обхваща целия регистър**."
> "…but **the search box reaches the whole registry**."

— `companies_browse_intro` (`src/locales/{bg,en}/translation.json:5168`) and
`scripts/prerender/routes.ts:4942` / `:4952`.

It does not. `extraFilters` pushes `{ id: "has_signal", value: true }` on **every** request
(`CompaniesBrowseDbScreen.tsx:100`), and `DbDataTable` ANDs `extraFilters` with the global term
in one `columns` array (`DbDataTable.tsx:271-274`). So the floor applies to searches exactly as
it applies to browsing, and **923,855 companies (90.34%) cannot be found by name or by EIK**
unless the reader first discovers the „Покажи всички" button.

Measured, three probes:

| query | rows under the default floor | rows in the corpus |
|---|---|---|
| `uic = '205074978'` (ЕЛСЛАК ЕООД, active, €1.59bn declared capital) | **0** | 1 |
| `name ILIKE '%елслак%'` | **0** | 1 |
| `name ILIKE '%бета фонд%'` (Бета Фонд АД, €20.45bn capital) | **0** | 1 |

An exact EIK — the least ambiguous query this corpus accepts, and the one `searchWhen:
"[0-9]{8,14}"` exists to route — returns „нищо намерено" at a 200. Migration 188's own header
states the opposite as the design (*"an exact name or EIK search always finds a match — the whole
point of widening past 178"*); the client half was never built to match.

**This is the ask-1 answer, and it is not „widen the default".** The floor is right for browsing
and wrong for searching.

### 1.2 The hidden 90% is NOT dormant shells — but it is four columns of dashes

Measured over the 923,855 rows the floor hides: **881,169 are `status = 'active'`** (95.4% of the
hidden arm, i.e. the same active share as the corpus) and **294,032 carry a resolved place**.
They are ordinary trading companies. „A million dormant shells" is not what is behind the floor.

What IS true is that **the page has nothing to say about them.** The table has five columns; for a
hidden row, four of them render „—":

| column | value for a hidden row |
|---|---|
| Фирма | name, EIK, legal form, status, seat — the only live cell |
| Основание | „—" by construction (`!isOfficialLinked`) |
| Област | „—" for 68.2% of them (31.8% placed, indistinguishable from the corpus's 32.0%) |
| Поръчки | „—" by construction (`contract_count = 0`) |
| Публични средства | „—" by construction (`public_money_eur = 0`) |

So the floor is not hiding a story; it is hiding a phone book. **Keep it as the browse default.**

Two measured properties of the floor that the rest of this plan leans on, both with **zero
counterexamples**:

```
is_official_linked        ⇒ has_signal      0 counterexamples
contract_count > 0        ⇒ has_signal      0
public_money_eur > 0      ⇒ has_signal      0
entity_class ∈ NGO classes ⇒ has_signal     0   (21,815/21,815 · 5,085/5,085 · 3,439/3,439)
```

⚠️ One edge worth a line: `has_signal` tests `public_money_eur > 0`, so **2 companies whose only
public-money record is NEGATIVE are hidden** (4 rows carry negative money — €−0.01 twice, and two
читалища at €−16.67 and €−598.83, both of which stay visible via the linked arm). Not worth a
migration; worth not being surprised by.

### 1.3 A search-first landing is right here for a reason /persons did not have

/persons' argument was that a 137,461-row prominence-ranked table answers no question. Here it is
stronger: the default table's first page is **€2.43bn СОФАРМА ТРЕЙДИНГ** and five more of the
same, unchanged on every arrival, forever — a leaderboard nobody asked for that also happens to be
the one thing the evidence rail can show instead (§1.7).

Both page queries are cheap, so this is not a performance argument:

| | buffers |
|---|---|
| default page, floored, money sort (Index Only Scan on `idx_company_browse_default`) | **5** |
| same, unfloored (`idx_company_browse_money`) | **5** |

Searching is cheap too, which is what makes §1.1's fix affordable. Measured under `PREPARE`
(a psql literal constant-folds and hides the generic plan — the trap `db_table.js`'s own
`SEARCH_MIN_CHARS` header names):

| term | matches | page query | count+sum query |
|---|---|---|---|
| `елслак` | 1 | 29 buffers / 7 ms | — |
| `sofia` | small | 53 buffers | — |
| `stroy` | 15,807 | 375 buffers | 11,360 buffers / 116 ms |
| `trans` | 24,897 | 1,903 buffers | **15,501 buffers / 542 ms** |

`trans` is the worst realistic case and it is inside budget. Note the count query is the expensive
twin, and it carries the `sum` aggregate with it.

### 1.4 There is no URL contract — three of four controls are pure local state

| control | today | shareable? | survives Back? |
|---|---|---|---|
| „Свързана с публично лице" | `useState(params.get("political") === "1")`, written with `replace: true` | yes | **no** — read once on mount, so Back changes the URL and not the checkbox |
| entity-class `Select` | `useState(ALL)` | **no** | n/a |
| „Покажи всички" | `useState(false)` | **no** | n/a |
| search box | `initialSearch={params.get("q")}` — read once, **never written** | **no** | **no** |

So a reader who filters to сдружения in Варна and searches „екология" has a URL that says
`/companies` and nothing else. There is no `useUrlCompanyFilters` hook; there is no
`NARROWING_PARAMS`. Everything in Tier 1 is new construction, not a migration of existing state.

### 1.5 ⚠️ `legal_form` has a DOUBLED vocabulary — refuse the picker

41 distinct values, and roughly half are Cyrillic labels for codes already in the list:

| code | rows | its Cyrillic twin | rows | twin's share |
|---|---|---|---|---|
| `EOOD` | 677,498 | Еднолично дружество с ограничена отговорност | 52,498 | 7.2% |
| `OOD` | 196,377 | Дружество с ограничена отговорност | 11,664 | 5.6% |
| `ET` | 23,384 | Едноличен търговец | 6,868 | 22.7% |
| `ASSOC` | 17,112 | Сдружение | 4,703 | 21.6% |
| `AD` | 9,951 | Акционерно дружество | 91 | 0.9% |
| `FOUND` | 3,582 | Фондация | 1,503 | 29.6% |
| `CC` | 3,356 | Народно читалище | 83 | 2.4% |
| `K` | 2,669 | Кооперация | 39 | 1.4% |
| `KCHT` | 716 | Клон на чуждестранен търговец | 115 | 13.8% |
| `SD` | 4,626 | Събирателно дружество | 13 | 0.3% |
| `KD` | 244 | Командитно дружество | 35 | 12.5% |
| `EAD` | 4,034 | Еднолично акционерно дружество | 95 | 2.4% |

⚠️ **The split is not random.** The Cyrillic-labelled EOOD rows carry `has_signal` at **2.5%**
(1,289/52,498) against **6.2%** (41,802/677,498) for the Latin-coded ones — so the two spellings
come from different ingest vintages and correlate with the data itself.

A picker over this column offers „ЕООД" and, one row down, „Еднолично дружество с ограничена
отговорност", and picking either silently loses the other. That is the `SOF00`/`SFO_CITY` shape
in a vocabulary of 41 — but with **twelve** synonym pairs rather than one, and with `TPP` /
`TPPD` / `BFLE` / `IAD` / `EDPK` / `IEAD` / `LEKD` / `EKD` (a total of 42 rows) whose Cyrillic
twin is not obvious enough to fold by hand.

**Decision: no `legal_form` picker.** `entity_class` is the DERIVED, de-duplicated answer to the
same question — 7 values, no NULLs, no synonyms — and it already exists and is already in the
toolbar. It is coarser (it collapses EOOD/OOD/AD/EAD into `company`), and that is the trade.

**Alternatively**, mint a `legal_form_code` in 188 that folds the twelve pairs. That is a real
migration on a 1.02M-row matview whose only payoff is a finer picker on a page whose readers
arrive knowing a company name, so it is out of scope here — but if it is ever built, the gate in
§8.5 is what tells you the fold is still needed.

### 1.6 The filter candidates, measured against the registry and against coverage

| candidate | server-side today | vocabulary | coverage | verdict |
|---|---|---|---|---|
| `entity_class` | `filter: "in"` | 7, no NULLs | 100% | **build** — `?class` |
| `status` | `filter: "in"` | 4, no NULLs | 100% | **build** — `?status`; 45,376 non-active rows is a real question |
| `oblast_name` | `filter: "in"` | 28 NAMES (not codes) | **32.0%** | **build** — `?oblast`, coverage stated on the control (§1.6a) |
| `is_official_linked` | `filter: "eq"`, partial index | boolean | 100% | **build properly** — `?political`, already the redirect target |
| `public_money_eur` | `filter: "range"` | — | — | **build as a BOOLEAN** `?money=1` (`min: 0.01`), never an open range (§1.6b) |
| `contract_count` | `filter: "range"`, **no index** | — | — | **build as a BOOLEAN** `?contracts=1`, and add the index (§1.6c) |
| `obshtina_code` | `filter: "eq"` | 265 | 32.0% | **chip only, no picker** (§1.6d) |
| `legal_form` | `filter: "in"` | 41, **doubled** | 100% | ⚠️ **refuse** (§1.5) |
| `is_mp_tied` | `filter: "eq"` | boolean | 106 rows | ⚠️ **refuse** (§1.6e) |
| `person_count` | `filter: "range"` | 20 buckets | 100% | **no** — `?political=1` already asks it |
| a "signal KIND" param | — | — | — | ⚠️ **refuse** (§1.6f) |

**1.6a — the oblast picker at 32% coverage is a stated decision, not a silent one.**
188's own column comment and CLAUDE.md both warn: *"NULL for the ~68% of the corpus with no
resolved seat — this column may narrow a view and must never define one"*, and
`oblast_name IS NOT NULL` must never be read as „this company has no place" (it means the free-text
seat did not resolve through `EkatteResolver`). The coverage is **the same either side of the
floor** — 33.6% of signal rows, 31.8% of hidden ones — so it is a property of `tr_company_place`,
not of the population.

Two rules follow:
* the control's label carries the coverage — „Област (по седалище; известна за 327 161 от
  1 022 592)" — rather than a footnote somewhere else;
* **no „без област" option.** The facet's `expr IS NOT NULL AND expr <> ''` guard already means
  the picker cannot show one; the hazard is someone ADDING it, because it would read as „companies
  with no registered seat" over a set that is 68% „we could not resolve the text".

Cost, and it is the one place the floor is expensive:

| facet | unfloored | under `WHERE has_signal` |
|---|---|---|
| `oblast_name` (LIMIT 500) | **292 buffers / 19 ms** — Parallel Index Only Scan on `idx_company_browse_oblast` | **23,892 buffers** |
| `entity_class` | **870 buffers / 45 ms** — Parallel Index Only Scan on `idx_company_browse_entity_class` | **23,889 buffers / 205 ms** |
| `status` | **869 buffers / 33 ms** | (unmeasured; same shape) |
| `obshtina_code` (LIMIT 500) | **289 buffers / 19 ms** | (unmeasured; same shape) |
| `has_signal` (boolean) | **23,504 buffers / 265 ms** — parallel seq scan, no index can serve it | n/a |
| `is_official_linked` (boolean) | **23,504 buffers** — the index is PARTIAL (`WHERE is_official_linked`), so it cannot enumerate `false` | n/a |

⚠️ **Adding `has_signal` to a facet is an 83× buffer regression**, because no index carries
`(has_signal, <dimension>)`. This is the single strongest argument for the §2.1 resolution
(the floor is applied by an explicit „разгледай" action rather than as a URL default), because
**a picker's counts must be computed under the same scope the table is showing** or they
over-promise: „Варна 27 589" that returns 2,531 rows is the `usePersonFacets.bySpec` collision
in its other direction.

⚠️ **The boolean facets cost 23,504 buffers each and there is no index that fixes them.** Do
not build a KPI band out of three of them (§1.7 routes around this).

**1.6b — money as a boolean, not a range.** `public_money_eur` carries **40,566 distinct values**
and `contractor_total_eur` **15,857**, so faceting either yields a truncated 500-bucket list of
individual euro amounts — a vocabulary of nothing, at a full seq scan. An open min/max control is
worse than useless for a different reason: the figure is `company_public_money`'s (127) UNION of
four programmes (ЗОП contracts ∪ ДФЗ subsidies ∪ ИСУН ∪ Interreg), so a reader typing „over €1m"
is filtering a number whose basis they have not been told. A single boolean („получавала публични
средства", 59,884) makes one claim and makes it correctly.

**1.6c — `contract_count` has no index, and that is a LIVE defect, not just a plan input.**
The „Поръчки" column is sortable today (it sets `accessorFn` and does not set
`enableSorting: false`), and 188 indexes `contractor_total_eur`, `person_count` and
`public_money_eur` but **not** `contract_count`:

| sort | plan | buffers |
|---|---|---|
| `ORDER BY person_count DESC NULLS LAST, name, uic` | Index Only Scan on `idx_company_browse_person_count` | **5** |
| `ORDER BY contract_count DESC NULLS LAST, name, uic` | **Parallel Seq Scan + top-N heapsort** | **23,578** |

`count(*) WHERE contract_count > 0` is the same 23,488-buffer seq scan. Tier 6 adds the index.

**1.6d — no obshtina picker, and ⚠️ a FOURTH Sofia synonym.** `src/lib/obshtinaPlace.ts` names
three codes for Столична община — `SFO_CITY` (the officials roster and `person_browse_table`),
`SOF` (the local-elections shards), `SOF00` (the governance routes). **`company_browse_table` uses
a fourth: `SOF46`**, with 116,306 companies, 35.6% of every placed row on the page. Measured:

| code | rows in `company_browse_table` |
|---|---|
| `SOF46` | **116,306** |
| `SOF00` · `SOF` · `SFO_CITY` | **0** each |
| `S2***` (Sofia's 24 районa) | **0** — `tr_company_place` folds them into `SOF46`, unlike `person_browse_table`, which keeps them |

`SOF46` is also **the only one of the 264 non-empty codes absent from `data/municipalities.json`**
(which spells the София *oblast*'s municipalities `SFO06`…`SFO59` — one transposition away).

So: **`canonicalObshtina()` is the WRONG tool here.** It returns `SFO_CITY`, which matches nothing
in this table. Any future producer of a `?obshtina=` link into `/companies` needs its own fold, and
the `/persons` follow-up plan's Tier-4 gate ("`/governance/SOF00` emits `?obshtina=SFO_CITY`") must
NOT be copied across. This plan therefore gives `?obshtina` a **chip and no picker** — the
`/persons` resolution, for the same reason (a municipality is somewhere you arrive from) plus this
one (there is no producer yet, and the code fold it would need does not exist).

**1.6e — `is_mp_tied` is a third MP number and a control would make it a fourth mistake.**
There are three „MP-linked companies" figures in this repo and they differ by two orders of
magnitude:

| figure | value | what it is |
|---|---|---|
| `is_mp_tied` | **106** | `contractor_rank.is_mp_tied` — MP-tied **CONTRACTORS**, a procurement basis |
| person-layer MP link | **1,367** | companies where a linked public figure holds a `person_role` at `source='mp'` |
| `is_official_linked` | **17,675** | ANY public figure — MP, minister, mayor, councillor, magistrate, regulator |

All 106 `is_mp_tied` rows are also `is_official_linked`. A toggle offering 106 rows next to a
toggle offering 17,675, both readable as „свързана с депутат", is a trap for a reader and for the
next author.

⚠️ **The middle figure is already mis-stated on the site.** The prerendered `/parliament` body
(`scripts/prerender/routes.ts:4905`, and `:4924` in EN) links „Списък на **всички фирми** с поне
един **депутат**-собственик или ръководител" / "List of all companies with at least one **MP**
owner or director" at `/companies?political=1` — which returns **17,675**, twelve-and-a-half times
the 1,367 the sentence names. Same class as the /persons „count and link name different sets"
trap. Fix the sentence in Tier 7; do not build a filter for it.

**1.6f — refuse a "signal KIND" param, because it is four params that already exist.**
`has_signal` is a four-way OR, and each arm is independently filterable today with no migration:

```
money    → { id: "public_money_eur", min: 0.01 }        59,884
contract → { id: "contract_count",   min: 1 }           18,689
linked   → { id: "is_official_linked", value: true }    17,675
ngo      → { id: "entity_class", value: [ngo_assoc|ngo_found|chitalishte] }  30,339
```

Mutually exclusive, in that priority order: money **59,884** · contract-only **469** ·
linked-only **14,677** · NGO-only **23,705** (= 98,735; the two missing rows are §1.2's negative-
money читалища, which reach the floor through the linked arm).

A fifth param naming a set the other four express is exactly what
`persons-place-position-params-v1.md` retired `?position` for. And a MULTI-select kind is not
expressible anyway: the engine has `eq/in/text/prefix/range` and ANDs filters, so „money OR NGO"
would need an `ngos.signal_codes`-style padded-set column — and even that idiom is single-valued
per filter (`filter: "text"`, one `'% code %'` at a time). Single-select is all that is buildable
either way, and the four params above ARE single-select.

### 1.7 The KPI band — four cells, FIVE tautology triggers, and one candidate refused

There are no KPIs today. The only figure on the page is the table's footer aggregate
(„€76,1 млрд. за 98 737 фирми"), below the fold and under the default floor.

Unlike `/persons`, the two big figures here are **table aggregates**, not facets — `count` and
`sum(public_money_eur)` are declared on the resource — so they follow the search as well as the
filters. That is a genuinely better starting position than the sibling had.

```
cell                       scope  filters  search   source
Фирми                        ✓       ✓        ✓     the table's own `count` aggregate
Публични средства            ✓       ✓        ✓     the table's own `sum` aggregate
Свързани с публично лице     ✓       ✓        ✗     the is_official_linked facet
Спечелили поръчка            ✓       ✓        ✗     the contract_count facet, buckets ≥ 1
```

The two ✗ are `/api/db/facets` having no free-text parameter — `runDbFacets` calls `buildWhere`
with `{ columns }` and no `global` (`db_table.js:3172`). Same defect `personsKpiBasis.ts` exists
to name; reuse `basisLadder` from `@/ux/infographic/kpiBasis` and its
`companies_basis_filters_not_search` key.

⚠️ **„Публични средства" must name its basis, and the honest basis is narrower than the label.**
`company_public_money` (127) holds **€118,111,285,074 over 81,464 EIKs**; only
**€76,125,285,097 over 63,063 EIKs** join to a `tr_companies.uic`. The other **€42.0bn (35.5%)**
goes to EIKs that are not Commerce-Registry companies — state awarders acting as contractors,
budget organisations, foreign entities and `supplier_identity`'s synthetic keys. So the cell's
basis says „към фирми в Търговския регистър", never „публични средства" full stop.

It is safe to SUM, unlike `/persons`' money column: one row per `uic`, and
`sum` over the whole table equals `sum` over `has_signal` to within float noise
(€76,125,285,096.665 vs €76,125,285,096.645) — because `public_money_eur > 0 ⇒ has_signal` with
zero counterexamples.

**⚠️ „С публична следа" as a KPI cell is REFUSED, and this is the most useful measurement in the
plan.** It is a tautology under **five** of the six filters this plan proposes:

| filter | `has_signal` over the filtered set | why |
|---|---|---|
| `?political=1` | **100%** | 0 rows with `is_official_linked AND NOT has_signal` |
| `?contracts=1` | **100%** | 0 rows with `contract_count > 0 AND NOT has_signal` |
| `?money=1` | **100%** | 0 rows with `public_money_eur > 0 AND NOT has_signal` |
| `?class=ngo_assoc` / `ngo_found` / `chitalishte` | **100%** | 21,815/21,815 · 5,085/5,085 · 3,439/3,439 |
| the floored browse itself | **100%** | by definition |
| `?class=company` | 6.8% | the one state where it says something |

A cell that reads 100% in five of six states is not a figure, it is the scope read back to the
reader — the `/persons` private-scope case (`0%` declared, `100%` companies) but five times over.
It belongs on the **scope control**, with counts, where /persons puts its tier sizes. Its facet
also costs 23,504 buffers (§1.6a), so refusing it is free twice.

**„Области" is refused too**, for the /persons „Общини"-cell reason plus coverage: 28 values over
a corpus that is 68% placeless, so the cell would read „28" under almost every filter and would be
a claim about a dimension two thirds of the rows do not have.

Withholding rules for the four that stay:

* **Gate on ARRIVAL, never `?? 0`.** The band renders nothing until both producers have answered
  — the same rule and the same reason as `personsKpiBasis`: „Фирми 0 · от целия регистър" is a
  sentence, and it is false.
  ⚠️ **The existing footer is NOT a precedent for this, and it is easy to read as one.** Its
  `Number(footerAgg.sumPublicMoneyEur ?? 0)` looks like the same defect, but `DbDataTable` gates
  the whole call on `renderAggregates && data` (`DbDataTable.tsx:462`), so the `?? 0` only fires
  when the engine answered WITHOUT the key. **The head's band has no such gate** — it is rendered
  by the screen, not by the table, and on the landing there is no table at all. So the guard has
  to be written here, explicitly, as a `return []`.
* **„Свързани с публично лице" is withheld under `?political=1`** — the facet excludes its own
  dimension, so it would hold at 17,675 over a set that IS 17,675.
* **„Спечелили поръчка" is withheld under `?contracts=1`**, same reason.
* ⚠️ **„Свързани с публично лице" carries a TENSE caveat in its basis.** Of the 17,675:
  **14,813** have a current registry role, **757** are declared-stake-only, and **2,105 (11.9%)
  reach the set ONLY through registry filings that have all been withdrawn.** The table's
  „Основание" column already chips „бивша" per row; the KPI count does not, so its basis must say
  „по вписване или декларация, включително заличени вписвания" or it is a present-tense claim
  about 2,105 companies. The same sentence has to reach the `?political` toggle's own label.

Cheap sources, measured, for the numerators that are NOT table aggregates:

| | buffers |
|---|---|
| `count(*) WHERE is_official_linked` (partial index) | **17** |
| `count(*) WHERE public_money_eur > 0` (index-only on `idx_company_browse_money`) | **505** |
| `count(*) WHERE entity_class IN (NGO classes)` | **37** |
| `count(*) WHERE contract_count > 0` | **23,488** ⚠️ no index — Tier 6 |
| `count(*), sum(public_money_eur) WHERE has_signal` | **1,078** |

### 1.8 The evidence rail must NOT be a money leaderboard

The obvious aside for this page is „най-много публични средства". Measured, its top six:

| # | company | public money | `entity_class` |
|---|---|---|---|
| 1 | СОФАРМА ТРЕЙДИНГ | €2,429,599,924 | company |
| 2 | ФЬОНИКС Фарма | €1,127,340,109 | company |
| 3 | **АВТОМАГИСТРАЛИ ЕАД** | €983,421,291 | company |
| 4 | **БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ ЕООД** | €980,558,458 | company |
| 5 | **НК ЖЕЛЕЗОПЪТНА ИНФРАСТРУКТУРА** | €950,303,304 | state_enterprise |
| 6 | **Фонд мениджър на финансови инструменти в България ЕАД** | €915,931,803 | company |

Four of the six are state-owned. A rail headed „кой получава най-много публични средства" reads as
„these are the companies that won the most from the state" while four of them **are** the state
receiving its own transfers — the „arithmetically right, false as a sentence" shape. And
`entity_class` **cannot fix it**: only 23 rows corpus-wide are `state_enterprise`, so three of the
four render as ordinary „фирма".

**Decision: the aside is the `entity_class` breakdown**, seven rows from a facet already in flight
(867 buffers), each linking `?class=<code>`, ranked by count — the direct analogue of /persons'
„Групи" rail. `oc_kind_*` labels exist for all seven in both corpora.

⚠️ Names carry HTML entities (`&quot;БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ&quot;`), so anything that renders a
company name outside the table must go through `decodeEntities` — the screen's name cell already
does.

---

## 2. The page, after

```
Breadcrumbs                                    (GovernanceBreadcrumb, unchanged, above the head)

┌─ HubHead ────────────────────────────────────────────────────────────────┐
│ УПРАВЛЕНИЕ · ФИРМИ                            ┌── evidence aside ──────┐ │
│ Фирми и организации                           │ ВИДОВЕ                 │ │
│ deck: one sentence — the whole Търговски      │ по брой вписвания      │ │
│ регистър, and what the site can say about it  │ фирма         988 644  │ │
│                                               │ сдружение      21 815  │ │
│ ┌──────────────────────────────────────────┐  │ фондация        5 085  │ │
│ │ 🔍  Търси фирма или ЕИК…               ✕ │  │ читалище        3 439  │ │
│ └──────────────────────────────────────────┘  │ кооперация      2 708  │ │
│ hint / example chips                          │ клон на чужд.     878  │ │
│                                               │ държ. предпр.      23  │ │
│                                               └────────────────────────┘ │
│ ┌ Фирми ────┬ Публични ср. ┬ С публично лице ┬ Спечелили ┐ ← KPI band    │
│ │ 1 022 592 │ €76,1 млрд.  │ 17 675          │ 18 689    │               │
│ │ ЦЕЛИЯТ…   │ КЪМ ФИРМИ В  │ ПО ВПИСВАНЕ ИЛИ │ ПО ДОГОВО │ ← basis, req. │
│ │           │ ТР…          │ ДЕКЛ., ВКЛ. ЗАЛ.│ РИ, ВСИЧКИ│               │
│ └───────────┴──────────────┴─────────────────┴───────────┘               │
└──────────────────────────────────────────────────────────────────────────┘

CompaniesFilterBar   Вид ▾   Състояние ▾   Област ▾
                     ☐ свързана с публично лице   ☐ с публични средства
                     ☐ спечелила обществена поръчка

Active chips         [Вид: сдружение ✕] [Област: Варна ✕]      Изчисти всички

── then ONE of two bodies ─────────────────────────────────────────────────

(A) LANDING — no query, no narrowing filter
    „Започнете оттук" — the cross-cutting queries the aside cannot express:
       Свързани с публично лице 17 675 · Получавали публични средства 59 884
       Спечелили обществена поръчка 18 689 · Читалища 3 439
    ┌ two browse buttons, and the SECOND is the floor ──────────────────┐
    │ „Разгледай 98 737 фирми с публична следа →"   ?scope=signal&browse=1│
    │ „…или целия регистър (1 022 592) →"           ?browse=1            │
    └────────────────────────────────────────────────────────────────────┘

(B) RESULTS — a query, a narrowing filter, or ?browse=1
    scope pill:  [ Целият регистър 1 022 592 ▾ ]   ← only when a table is on screen
    results header:  N фирми · €X · Свали CSV
    <DbDataTable>  (search input suppressed — the head owns it)
```

### 2.1 The rule that switches bodies, and where the floor went

```
showTable  =  queryIsSendable  ||  hasNarrowingFilters  ||  browseAll
```

* `queryIsSendable` — `termLength(term.trim()) >= SEARCH_MIN_CHARS`, read from
  `@/ux/data_table/searchTerm` (never a hand-rolled `.length >= 3` — „👍👍" is 4 code units, 2
  characters, and zero trigrams).
* `hasNarrowingFilters` — `political · class · status · oblast · obshtina · money · contracts`.
* `browseAll` — `?browse=1`, set only by the two landing buttons.

⚠️ **`?scope` is deliberately NOT a narrowing**, exactly as `?sector` is not one on /persons: it
is which population you are looking at, not a question about it. Flipping it must not open a
table.

**Where the floor went, and why this shape rather than a URL default.** The floor stops being an
invisible client-side `extraFilters` push and becomes `?scope=signal|all`, **defaulting to
`all`** — with the LANDING's primary button applying `?scope=signal` explicitly. One default, no
conditional, and three properties fall out:

1. **§1.1 is fixed by construction.** A search runs against the whole registry, so
   `uic = 205074978` finds ЕЛСЛАК and the page's own copy becomes true. Cost: §1.3's numbers.
2. **The picker counts and the table agree**, because both are computed under the same scope —
   which also keeps every facet on its cheap unfloored plan (§1.6a: 289 vs 23,892 buffers).
   Under `?scope=signal` they are computed floored and are correspondingly slower; that is the
   reader's explicit choice and it applies to one page of results at a time.
3. **The floor becomes a deliberate act with a number on it** („98 737 фирми с публична следа")
   rather than a hidden 90.34% cut with a „Покажи всички" escape.

⚠️ **The money sort does part of the floor's job for free inside any result set, but only part.**
`public_money_eur > 0 ⇒ has_signal` (0 counterexamples), and `defaultSort` is
`public_money_eur DESC NULLS LAST, name, uic`, so all 59,884 money-bearing companies sort above
every signal-less one. The other 38,853 signal rows (linked-only and NGO-only) sit at €0 and sort
alphabetically among the 923,855 hidden ones. So this is a real property worth knowing and **not**
a substitute for the scope control.

---

## 3. Tier 0 — nothing (the `DbDataTable` seam already exists)

`persons-search-first-v1.md`'s Tier 0 shipped it: `search` / `onSearchChange` /
`hideSearchInput` are on `DbDataTable` today, with the DEV guards for the two foot-guns and
`searchTerm.ts` extracted so a page can ask „would the engine accept this term?" without importing
a component. `/companies` consumes it as-is. **This plan adds no props to the shared table.**

---

## 4. Tier 1 — the URL contract

New: `src/data/companies/useUrlCompanyFilters.ts` + `useUrlCompanyFilters.test.ts`. Model it on
`src/data/persons/useUrlPersonFilters.ts`, including the single `write()` writer that reads the
CURRENT params at call time.

| param | values | notes |
|---|---|---|
| `?q` | free text, trimmed, capped at 200 | the engine's own cap. **No character validation** — `likeEscape` escapes `%`/`_` server-side, and rejecting punctuation would break „БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ". |
| `?scope` | `all` (default, written as nothing) \| `signal` | the floor. NOT a narrowing. |
| `?browse` | `1` | view mode. In `PARAMS` so `clearFilters` clears it; NOT in `hasNarrowingFilters`. |
| `?political` | `1` | `is_official_linked`. **Already the redirect target** from `/governance/companies` and from `/mp/company/**` — validate and keep. |
| `?class` | one of the 7 `entity_class` codes | validated against the literal set; unknown ⇒ dropped. |
| `?status` | one of the 4 | same. |
| `?oblast` | one of the 28 NAMES | ⚠️ a NAME, not a code (§1.6a). Validate against the facet's own vocabulary at render time rather than a hardcoded list, so a corpus change cannot silently drop a real oblast. |
| `?obshtina` | a code | chip only, no picker (§1.6d). Validate shape (`[A-Z]{3}\d{2}`) — which admits `SOF46` and rejects the 13 empty strings. |
| `?money` | `1` | ⇒ `{ id: "public_money_eur", min: 0.01 }` |
| `?contracts` | `1` | ⇒ `{ id: "contract_count", min: 1 }` |

```ts
export const NARROWING_PARAMS = [
  "political", "class", "status", "oblast", "obshtina", "money", "contracts",
] as const;

const PARAMS = [...NARROWING_PARAMS, "scope", "q", "browse"] as const;
```

⚠️ **`as const` is load-bearing**, for the reason `useUrlPersonFilters` spells out: without it the
chip-contract record widens to an index signature that accepts a MISSING dimension, so a narrowing
silently stops unlocking the table and a deep link renders a blank page.

⚠️ **`?q` and `?political` stay OUT of `usePreserveParams`' `globalParams`** (they already are —
the allowlist is `elections · recount · view · party_tabs · summary · area · pscope`). A search
term and a filter must not follow a reader onto another page.

⚠️ **`?political` must be in `NARROWING_PARAMS`, and the OG capture depends on it.**
`scripts/og/capture-screens.ts:1022` shoots `companies?political=1&elections=2026_04_19` and waits
on `[data-og="official-companies-og"] tbody tr.group`. If `political` were treated as a scope
rather than a narrowing, the landing would render and the capture would **time out and silently
keep serving the old card** — the failure its own comment warns about. Assert it in Tier 8.

**Tests:** every param round-trips · an unknown `?class` / `?status` / `?oblast` is dropped rather
than sent · `?scope=all` writes nothing while `?scope=signal` is explicit · `?browse` is cleared by
`clearFilters` but absent from `hasNarrowingFilters` · `hasNarrowingFilters` is false for a bare
`?scope=signal` and true for each of the seven · the runtime key set of the chip-contract record
equals `NARROWING_PARAMS`.

---

## 5. Tier 2 — the head and `companiesKpiBasis.ts`

Replace `<Title>` + the `Building2` intro `<p>` with `<HubHead>`.

⚠️ **`HubHead` renders both the `<h1>` and the `<SEO>`, so `<Title>` must go** or the page emits
two h1s — gated statically by `hubHead.gates.test.ts` and at runtime by `tests/ui.spec.ts`.

⚠️ **`seoDescription` is a REQUIRED prop** (verified against `HubHead.tsx`; every other prop this
plan uses is optional). It is what replaces the `<Title>`'s description, so it has to be written
rather than inherited — and it must agree with the prerendered `/companies` description in
`scripts/prerender/routes.ts`, which Tier 7 rewrites in the same pass.

⚠️ **THE SIBLING REGISTRY BROWSER DECIDED THE OPPOSITE, AND AN IMPLEMENTER WILL FIND ITS COMMENT
FIRST.** `hubHead.gates.test.ts:87-90` lists `src/screens/dev/ContractsBrowserDbScreen.tsx` under
a note reading: *"A REGISTRY BROWSER, not a tile hub. The head pattern splits for one: it takes
the identity, the deck, the scope control and the KPI band, and takes NEITHER a search slot (the
table owns its own, correctly placed above the rows it filters) NOR an evidence list (the table IS
the ranked list)."* This plan gives `/companies` both, and that is deliberate:

* **the search slot** — `/procurement/contracts` always has a table, so its own search input is
  always correctly placed. `/companies` is SEARCH-FIRST (§1.3, §2.1): on the landing there is no
  table for a search input to sit above, so the head is the only place it can live. `/persons`
  made exactly this trade and is the precedent to follow.
* **the evidence list** — „the table IS the ranked list" is true where a table is on screen. On
  the landing it is not, and the aside is what the reader gets instead (§1.8).

The measured budgets agree: `/procurement/contracts` is **304 px** (no search, no evidence) and
`/persons` is **469 px** (both). `/companies` budgets to the second — Tier 8 gate 1.

* `eyebrow` — „УПРАВЛЕНИЕ · ФИРМИ".
* `title` — „Фирми и организации" (not „Фирми": ~3.4% of the corpus are сдружения, читалища,
  фондации, кооперации, клонове and държавни предприятия, and the screen's own column comment
  already refuses to call them all фирми). Align the prerendered `<h1>` with it.
* `deck` — one sentence: the whole Търговски регистър, and what the site can add to it.
* `scope` — the `?scope` control, **rendered only when a table is on screen** (§2.1: on the
  landing the two browse buttons ARE the scope choice, and offering it twice is the „Бизнес"
  segment problem /persons had to write a paragraph about). Options carry corpus counts:
  „Целият регистър (1 022 592)" / „С публична следа (98 737)".
* `search` — `<CompaniesSearchField>` (Tier 3).
* `kpis` — from `companiesKpiBasis.ts`. `kpisPending` derived by running the rule with the
  payloads faked present, exactly as `personsKpiCellCount` does, so the skeleton count cannot
  drift from the loaded band.
* `evidence` — heading „Видове", basis „по брой вписвания", the seven `entity_class` rows from the
  facet, each `to: /companies?class=<code>` (§1.8). Drop a zero-count row; none is zero today.

### 5.1 `src/screens/companies/companiesKpiBasis.ts`

Pure, outside the screen, mirroring `personsKpiBasis.ts` / `contractsKpiBasis.ts`. Reuses
`basisLadder` + `TERM_MAX` from `@/ux/infographic/kpiBasis` — do **not** re-walk the ladder here;
the two existing browsers had already drifted on what counts as a search, which is why that module
exists.

Inputs: `count`, `sumEur`, `term`, `linkedCount`, `contractorCount`, `facetTotal`,
`politicalActive`, `contractsActive`, `scope`, `filtered`, `scopeBasis`, `fmtInt`, `fmtEur`, `t`.

Basis keys: `companies_basis_matching` / `companies_basis_filters` /
`companies_basis_filters_not_search` / `companies_basis_scope`.

Rules, all of which the test executes as a truth table:

1. `count == null || facetTotal == null` ⇒ **return `[]`** (skeletons). Not `?? 0`.
2. „Фирми" and „Публични средства" take `rowBasis` (they follow the search — table aggregates).
3. „Свързани с публично лице" and „Спечелили поръчка" take `rateBasis` (facets — filters, not
   search).
4. „Свързани с публично лице" is **withheld** when `politicalActive`.
5. „Спечелили поръчка" is **withheld** when `contractsActive`.
6. „Публични средства"'s basis always names the ТР restriction (§1.7), and „Свързани с публично
   лице"'s always names the withdrawn-filing caveat (§1.7).
7. There is **no** „С публична следа" cell and **no** „Области" cell (§1.7). The test asserts
   their absence with the reason in the assertion message, so a future author re-adding one has
   to read why.

---

## 6. Tier 3 — `CompaniesSearchField`

New: `src/screens/companies/CompaniesSearchField.tsx`. Port `PersonsSearchField.tsx` — full-width
to `max-w-2xl`, `h-12`, `type="search"`, inset icon and clear button, a visually-hidden `<label>`,
`aria-describedby` on the hint, `Esc` clears, `Enter` is a no-op that must not submit,
`autoFocus` at `lg` and up only.

Hint, three states, rendered only when the table is NOT mounted (so the reader hears one voice —
`DbDataTable`'s own `tooShort` hint owns the other case):

* empty → „Търсете по име на фирма или по ЕИК." + example chips;
* 1–2 characters → „Въведете поне 3 знака.";
* ≥ 3 → nothing.

**Example chips** go in `src/screens/companies/companiesBrowseConstants.ts` beside `URL_MIRROR_MS`
(350 ms), with the `personsBrowseConstants.ts` rule: **every chip must be a value THIS corpus
answers**, verified with a `SELECT count(*)` rather than typed from memory. Two hazards specific
to this corpus:

* ⚠️ **`&quot;` is stored in the names.** „НАЦИОНАЛНА КОМПАНИЯ &quot;ЖЕЛЕЗОПЪТНА
  ИНФРАСТРУКТУРА&quot;" is the literal `name` value. A chip containing a quote character will not
  match; pick single-token names.
* ⚠️ **`companies.name` has `searchFold` but NOT `searchFoldTokens`** (unlike `persons.name`), so
  the whole query must be one CONTIGUOUS substring of the transliterated fold. „софарма трейдинг"
  works; „софарма търговия" matches nothing even though the first word does. Chips must be
  contiguous prefixes of a real name.

Suggested set, each measured before it ships: one company name, one EIK, one NGO word.

**Search → URL:** the screen owns `term` in React state and mirrors it into `?q` on
`URL_MIRROR_MS` with `{ replace: true }`; `DbDataTable` receives `search={term}` and applies its
own 250 ms fetch debounce. ⚠️ The two debounces are intentional and must not be collapsed — one
bounds fetches, the other bounds URL writes.

---

## 7. Tier 4 — filters out of the toolbar, and chips

New: `src/screens/companies/CompaniesFilterBar.tsx` and
`src/screens/companies/CompaniesActiveFilters.tsx`, plus
`src/data/companies/useCompanyFacets.ts` (port `usePersonFacets.ts` verbatim, changing only
`resource: "companies"`).

⚠️ **Use `bySpec`, never the flat `merged` map, for any column two specs request.** The /persons
measurement is the warning: `is_company` sat in both the `groups` and `kpis` specs, so at
`?facet=mp` the picker's „Бизнес" row read 526 while clicking it returned 85,060 — 162×. Here
`entity_class` is in BOTH the picker spec (which must exclude `?class`, or the picker collapses to
the chosen option) and the evidence-aside spec (which is the corpus breakdown and must NOT exclude
it). Two right answers, one column, and `Object.assign` hands the second to both in
`Object.entries` order.

**`CompaniesFilterBar`** — three labelled `Select`s (Вид / Състояние / Област) and three
checkboxes (свързана с публично лице / с публични средства / спечелила обществена поръчка). The
`Select` is the shared Radix one with `modal={false}` (project rule; never a native `<select>`).
The Област control's label carries its coverage (§1.6a).

**`CompaniesActiveFilters`** — one removable chip per applied narrowing, plus „Изчисти всички".
Labels come from the same resolvers the selects use (`oc_kind_*`, `tr_status_*`, the oblast name
itself), so a chip can never name a value the picker names differently.

⚠️ **`?obshtina` has no picker, so its chip is the ONLY surface the dimension has** — the exact
role the chip plays for `?obshtina` on /persons. Render the raw code as a fallback rather than
nothing: a filter applied and named nowhere is the state the component exists to end. ⚠️ Do **not**
route it through `canonicalObshtina()` (§1.6d) — that maps `SOF00 → SFO_CITY`, which matches zero
rows here. Until a producer and a `SOF46` fold exist, the chip prints the code.

**„Свързана с публично лице" gains its caveat** (§1.7): the toggle's label or its hint says the
17,675 include 2,105 whose registry filings have all been withdrawn.

⚠️ **THERE IS NO CSV EXPORT ON THIS PAGE TODAY, so „Свали CSV" in §2's mock-up is a NEW
feature, not a relocation.** The current `toolbar` holds exactly three things — the entity-class
`Select`, the „свързана с публично лице" checkbox and the „Покажи всички" button — and Tiers 4/5
take all three out of it. **Decision: drop CSV from this plan.** It is not one of the four asks in
§0, `exportPersonsCsv.ts` exports a 137k-row browse rather than a 1.02M-row one, and an export
button on a corpus this size needs its own row-cap decision. Strike it from §2's mock-up; the
`toolbar` prop goes away entirely and the results header carries only „N фирми · €X".

⚠️ **Three hardcoded `bg ? … : …` strings die with the toolbar and their replacements need
keys** — „Всички видове"/"All entity types", „Покажи всички"/"Show all" and „Само със
значение"/"Only with a signal" are inline literals in `CompaniesBrowseDbScreen.tsx` today, not
i18n keys. The first becomes the Вид picker's „all" option and the other two become the `?scope`
control's two labels, so all three are new keys against §10's ~22-key budget.

---

## 8. Tier 5 — the landing body

New: `src/screens/companies/CompaniesLanding.tsx`. Port `PersonsLanding.tsx`, including its
three-state count contract (`undefined` renders „—" and keeps its grid slot; `0` suppresses the
card; `n > 0` renders) — the reflow that a placeholder exists to prevent.

**„Започнете оттук" cards.** Each must be reachable by ONE param (the engine ANDs filters and the
picker params are single-valued, so a card needing two is not a card):

| card | count | href |
|---|---|---|
| Свързани с публично лице | **17 675** | `?political=1` |
| Получавали публични средства | **59 884** | `?money=1` |
| Спечелили обществена поръчка | **18 689** | `?contracts=1` |
| Читалища | **3 439** | `?class=chitalishte` |

⚠️ **Every count comes from a facet already in flight — not one is a constant.** The corpus moves
under the page (`db:load:declarations:pg --resolve`, `db:load:graph:pg`,
`db:load:tr-company-place:pg` and `db:load:pg` all rewrite columns this table reads), so a
hard-coded figure is right on the day it is typed and wrong for as long as nobody checks.

⚠️ **„НПО, читалища и фондации" is NOT a card**, tempting though 30,339 is: it spans three
`entity_class` values and `?class` holds one. The Вид picker covers it.

**The two browse buttons**, and the second is the floor (§2.1):

* „Разгледай 98 737 фирми с публична следа →" → `?scope=signal&browse=1`
* „…или целия регистър (1 022 592) →" → `?browse=1`

The results body gains a „← Назад към търсенето" affordance whenever `browseAll` is the ONLY
reason the table is showing, since `browse` is deliberately absent from `hasActiveFilters` and so
gets no „Изчисти" button.

---

## 9. Tier 6 — the `contract_count` index (the one server change)

§1.6c: sorting the „Поръчки" column is a **23,578-buffer parallel seq scan + top-N heapsort**
today, against 5 buffers for its three indexed siblings, and `count(*) WHERE contract_count > 0`
— the KPI cell's numerator — is the same 23,488-buffer scan.

```sql
CREATE INDEX IF NOT EXISTS idx_company_browse_contract_count
  ON company_browse_table (contract_count DESC NULLS LAST, name, uic);
```

### 9.0 ⚠️ THREE PARTIAL FACET INDEXES SHIP IN THE SAME FILE — promoted from §13, measured

The audit (§15) moved this out of the risk table and into the tier, because the measurement makes
it a three-line change rather than a contingency. §1.6a establishes that a picker facet costs
**~23,900 buffers under `WHERE has_signal` against ~290–870 unfloored**, and §2.1 makes the floored
scope the LANDING'S PRIMARY BUTTON — so the reader who takes the recommended route pays three of
those on arrival (~72,000 buffers of facet queries), on Cloud SQL, cold, over the proxy.

A partial index on each picker column closes it outright. Measured 2026-08-26, local, each index
built and dropped in place:

| facet, under `WHERE has_signal` | today | with the partial index | index size |
|---|---|---|---|
| `entity_class` | 23,908 buffers | **89** (Index Only Scan) | 688 kB |
| `status` | 23,908 buffers | **89** (Index Only Scan) | 688 kB |
| `oblast_name` | 23,892 buffers | **31** (Index Only Scan) | 248 kB |

**1.6 MB in total for a 269×–770× reduction**, and it is the difference between the floored scope
being a first-class choice and being a slow one the risk table apologises for.

```sql
CREATE INDEX IF NOT EXISTS idx_company_browse_signal_entity_class
  ON company_browse_table (entity_class) WHERE has_signal;
CREATE INDEX IF NOT EXISTS idx_company_browse_signal_status
  ON company_browse_table (status) WHERE has_signal;
CREATE INDEX IF NOT EXISTS idx_company_browse_signal_oblast
  ON company_browse_table (oblast_name) WHERE has_signal AND oblast_name IS NOT NULL;
```

⚠️ **These are facet indexes, NOT sort indexes — do not give them `DESC NULLS LAST` keys.** The
rule in the block above applies to `buildOrder`'s ORDER BY; a facet is a `GROUP BY` over the whole
column and wants the plain ascending form, which is what makes it an Index Only Scan.
`db_table_sort_indexes.data.test.ts` reasons about sort keys and will not confuse the two, but a
future author copying the sibling four might.

⚠️ **The `oblast_name` one carries `AND oblast_name IS NOT NULL` and the other two must not.**
`oblast_name` is NULL on 68% of the corpus and the facet's own `IS NOT NULL AND <> ''` guard means
those rows can never be an answer, so excluding them is what takes the index to 248 kB.
`entity_class` and `status` have **no NULLs at all** (§0), so the same clause there would buy
nothing and would only be one more thing to keep true.

Same two-places rule as the sort index: in 188 beside the others, AND in the standalone file.

⚠️ **`DESC NULLS LAST` is not decoration** — `db_table.js`'s `buildOrder` emits
`<col> DESC NULLS LAST` for every descending sort while a plain DESC index is NULLS FIRST, and
mismatched the sort stops being an index walk. 188's own three index comments say so, and
`scripts/db/tests/db_table_sort_indexes.data.test.ts` is the gate.

⚠️ **It must land in TWO places, and the reason is the 122 hazard CLAUDE.md documents.**

1. **In 188 itself**, beside the other four, so a fresh build has it.
2. **In a NEW migration file** carrying only the `CREATE INDEX IF NOT EXISTS`, because
   **188 opens with `DROP MATERIALIZED VIEW IF EXISTS company_browse_table`** — so re-applying it
   to a warm database to pick up one index rebuilds 1.02M rows, and the `companies` DbDataTable
   resource reads the base relation with **no `missingMigration` degrade**, i.e. `/companies` 500s
   for the whole rebuild. This is the same shape as *"Do not add `122_contractor_rank.sql` to that
   command"*.

Cloud side, and nothing runs it automatically:

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/db/apply_functions.ts 193_company_browse_contract_count_index.sql
```

⚠️ **The file already exists and already carries the sort index — the three §9.0 partial indexes
are an EDIT to it, not a fifth file.** `scripts/db/schema/pg/193_company_browse_contract_count_index.sql`
is present (untracked) with the `contract_count` statement and the 122 precedent written out; 188
carries the same line. **Neither has reached Cloud SQL.** Rename it if the name now
under-describes it — but only before it is ever applied anywhere, since an applied filename is
what an operator greps for.

`CREATE INDEX` (non-concurrent) takes a ShareLock — writers blocked, readers not — and 188's own
loader is the only writer. Projected at ~1.02M rows and the sibling indexes' size; **unmeasured on
Cloud SQL**, so run it off-peak and re-measure rather than quoting a local number.

**No other server change.** No new `/api/db` route, no registry edit, no new column. Every filter
in Tier 4 uses a `filter:` this resource already declares.

### 9.1 Deploy order

`/companies` and its resource are already live, so nothing here is a first deploy — but the index
must reach a database **before** anything counts on it, and the two client-side halves have their
own order:

```
1. apply 193 to LOCAL Postgres                    # already done for contract_count; re-apply for §9.0
2. apply 193 to Cloud SQL                         # NOT done — nothing here has reached prod
3. npm run deploy                                 # Tiers 1-5, 7
```

Step 1 is not redundant: the local database has the `contract_count` index and none of the three
partial ones, and `apply_functions.ts` on an `IF NOT EXISTS` file is idempotent, so re-applying is
the cheapest way to make the two halves agree. Step 2 is the one that has never run.

There is no `deploy:db` step: `functions/db_table.js` is unchanged.

---

## 10. Tier 7 — copy, and the seven sites that are false today

1. **`companies_browse_intro`, BG and EN** — the „търсенето обхваща целия регистър" claim becomes
   TRUE under Tier 1's default (§1.1, §2.1). Keep the sentence; rewrite the clause before it, which
   describes a page that opens with a table.
2. **`scripts/prerender/routes.ts:4934`** — the `/companies` `staticPage` body, BG and EN. Same
   rewrite, plus the `<h1>` aligning with the head's „Фирми и организации". This is the crawlable
   content, so it is the SEO half of the change.
3. ⚠️ **FOUR prerender sites, not two — the audit found the other pair (§15.2).** Every one
   links `/companies?political=1`, which lists **17,675** office-holder-linked organisations, and
   every one names DEPUTIES. Restate all four as „лица на публична длъжност" /
   "public office-holders", which is what `nsh_tile_companies_desc`
   („Лица на публична длъжност и техните фирми") and `decl_mp_companies_desc` already say
   correctly — the in-app producers are clean, so this defect is confined to the prerendered
   bodies.

   | site | text |
   |---|---|
   | `routes.ts:4905` (BG, `/parliament`) | „Списък на всички фирми с поне един **депутат**-собственик или ръководител" |
   | `routes.ts:4924` (EN, `/parliament`) | "List of all companies with at least one **MP** owner or director" |
   | `routes.ts:5957` (BG, `/parliament` hub) | „фирмите, свързани с **депутати**" |
   | `routes.ts:6043` (EN, `/parliament` hub) | "companies linked to **MPs**" |

   ⚠️ **Do not put a number in the replacement copy.** §1.6e quotes the MP-linked subset as
   **1,367** and the audit could not reproduce it — the closest defensible derivation
   (`person_role` at `source='mp'` folded onto the same person's `tr`/`ngo` refs that exist in
   `company_browse_table`) gives **1,213**, and the plan never states which definition it used.
   The figure is rhetorical here — it establishes the order-of-magnitude gap against 17,675 and
   is never rendered — so the fix is the noun, not a count. Any surface that ever WANTS the
   number has to define it first.
4. **`companies_filter_political`** — „Свързана с публично лице" gains the tense caveat (§1.7):
   2,105 of the 17,675 reach the set only through withdrawn filings.

**i18n:** new keys land in `src/locales/{bg,en}/translation.json` — the **core** corpus, since
`/companies` is not in `LOCALE_BUNDLES` — so they count against the per-language brotli budgets in
`tests/perf.spec.ts`. Keep the set tight (~22 keys) and re-run the budget.
`scripts/i18n/key_usage.test.ts` fails on any key added and not reachable.

---

## 11. Tier 8 — gates

1. **`tests/ui.spec.ts` → `HUB_HEAD_BUDGETS`** gains `{ path: "/companies", maxPx: …, measured: …,
   cells: 4 }`. Expect the `/persons` (560) band: identity + deck + a full search field with hint
   and chips + a 4-cell band + an evidence aside, and **no scope control on the landing**, which is
   the one thing narrower than /persons. ⚠️ The entry's comment must say why the band's captions
   are load-bearing — „към фирми в ТР" is the only thing standing between €76,1 млрд. and a claim
   about the €118,1 млрд. `company_public_money` actually holds, and „включително заличени
   вписвания" is the only thing making 17,675 a true present-tense sentence. If it trips, check for
   a fifth cell rather than shortening those.
2. **`hubHead.gates.test.ts`** — two clauses, and only the first is automatic. The static
   one-h1 scan globs `grep -rl 'HubHead' src/screens`, so it picks the screen up the moment
   `HubHead` lands and must see `<Title>` gone. **The `HUB_SCREENS` list at `:84` is
   hand-maintained and `/companies` must join it** — `src/screens/dev/ContractsBrowserDbScreen.tsx`
   is already there as the sibling registry browser. Per that list's own comment it buys exactly
   one thing, the basis-year scan („names no year before the corpus starts"), which is worth
   having the moment a basis string mentions a year.
3. **`src/screens/dev/CompaniesBrowseDbScreen.test.tsx`** — the existing 16 cases are all about
   cell rendering and stay. Add: the landing renders no `<table>` · a ≥3-char `?q` renders one · a
   1–2-char `?q` does not and shows the floor hint · `?political=1` renders one (**and this is the
   OG capture's contract** — cite `capture-screens.ts:1022` in the assertion message) · each of the
   other six narrowings renders one · `?scope=signal` alone does **not** · `?browse=1` does ·
   typing writes `?q` after `URL_MIRROR_MS` · a chip's ✕ removes exactly its own param · the chip
   list is iterated from `NARROWING_PARAMS` rather than hand-written.
4. **`companiesKpiBasis.test.ts`** — §5.1's truth table, one clause per sentence the band must not
   publish, including the two absent cells with their reasons in the messages. Model it on
   `personsKpiBasis.test.ts`, which asserts over the RULE rather than the screen.
5. **`scripts/db/tests/company_browse.data.test.ts`** — five new assertions, each pinning a premise
   this plan rests on:
   * ⚠️ **the four floor implications, at 0 counterexamples** — `is_official_linked`,
     `contract_count > 0`, `public_money_eur > 0` and each NGO class all ⇒ `has_signal`. These are
     what make §1.7's withholding rules correct; if 188's `has_signal` expression ever narrows,
     the KPI band starts publishing a cell that is no longer a tautology and nothing else notices.
   * **`sum(public_money_eur)` over the whole table equals the sum over `has_signal`** — the §2.1
     money-sort property.
   * ⚠️ **the `legal_form` doubled vocabulary still exists** — assert that at least one Cyrillic
     label spelling co-occurs with its Latin code. **Inverted on purpose:** the day the TR ingest
     normalises them, this fails, and the failure means „the §1.5 refusal can be revisited", which
     is a decision nobody would otherwise re-open.
   * ⚠️ **the Sofia code hazard** — `SOF46` has rows, `SOF00` / `SOF` / `SFO_CITY` / `S2***` have
     none, and `SOF46` is the only `obshtina_code` absent from `data/municipalities.json`. This is
     the one failure that renders an empty table at a 200, and it is one fold away from happening
     the first time anyone builds a producer.
   * **the `contract_count` index exists and is used** — via
     `db_table_sort_indexes.data.test.ts`'s existing machinery if it covers this resource, else an
     `EXPLAIN` assertion that the descending sort is an Index Only Scan. (That gate iterates every
     registry resource — `runDbTable(q, { resource: name, … })` at `:206` — so `companies` is
     already in its sweep; confirm rather than assume.)
   * ⚠️ **the three PARTIAL facet indexes exist and are USED** (§9.0). An `EXPLAIN` assertion that
     each of `entity_class` / `status` / `oblast_name`, faceted `WHERE has_signal`, is an Index
     Only Scan — and a buffer ceiling well under the 23,900 the unindexed form costs. Existence
     alone is not enough here: a partial index the planner declines is indistinguishable from no
     index in every way except the plan node, and this is the whole cost argument for the floored
     scope being a first-class choice.
6. **`scripts/db/tests/reload_visibility_map.data.test.ts`** — no change expected (no loader is
   added), but re-read it before Tier 6: a new index changes nothing there, and a new *table* would.
7. **`src/entryGraph.test.ts`** — the new `src/screens/companies/*` modules must not import a
   sector registry, and `routes.tsx` must not take a constant from one.
8. **`scripts/i18n/key_usage.test.ts`** + the `tests/perf.spec.ts` brotli budgets (§10).

---

## 12. What this plan does NOT propose

* **No `legal_form` picker** (§1.5) and **no `legal_form_code` migration**. The vocabulary is
  doubled across twelve synonym pairs; `entity_class` is the de-duplicated answer to the same
  question and it already exists.
* **No "signal kind" param** (§1.6f). It is the union of four params this plan builds, and a
  multi-select version is not expressible on this engine anyway.
* **No `is_mp_tied` toggle** (§1.6e). 106 rows, on a third basis, beside a 17,675-row toggle a
  reader would read the same way.
* **No „С публична следа" KPI cell and no „Области" KPI cell** (§1.7). The first is a tautology in
  five of six states and belongs on the scope control; the second is a claim about a dimension 68%
  of rows do not have.
* **No money-leaderboard evidence rail** (§1.8). Four of its top six are the state.
* **No `?obshtina` picker and no `?obshtina` producer** (§1.6d). The `SOF46` fold does not exist,
  `canonicalObshtina()` is actively wrong here, and a municipality is somewhere you arrive from.
  The chip is what the param needs.
* **No open money-range control** (§1.6b). 40,566 distinct values, four programmes in one figure.
* **No typeahead dropdown** on the search field — on this page the table IS the result list, so a
  dropdown over the same rows would race and duplicate it.
* **No tabs**, no native `<select>`, no modal Radix dropdown (project rules).
* **No `/api/db` route, registry, or matview change.** The only server change is one index (Tier
  6), and it is deliberately NOT applied by re-running 188.
* **No new `data-og` anchor or OG slug.** The capture's `?political=1` route keeps working
  precisely because `political` is a narrowing (§4).

---

## 13. Risks

| risk | mitigation |
|---|---|
| ⚠️ Dropping the floor for search means „trans" scans 24,897 rows and pays a 15,501-buffer count. | §1.3 measures it at 542 ms locally, well inside the 10 s pool timeout. Cloud SQL is **unmeasured** — re-measure under `PREPARE` before shipping, and note the count query carries the `sum` aggregate with it. |
| A reader who bookmarked `/companies` expecting a table lands on a search page. | The landing carries TWO first-class browse buttons (§8), and every existing deep link (`?political=1`, `?q=`) opens straight into the table. |
| The scope control's counts (98 737 / 1 022 592) are corpus-wide while the table is narrowed, so they look like they describe the results. | Same resolution and the same wording as /persons' tier counts: the options name the SCOPE's size, and the band's `basis` names what the figures answered over. |
| ~~Under `?scope=signal` every picker facet costs 23,892 buffers instead of 289 (§1.6a).~~ **CLOSED by the audit** — promoted to §9.0 and measured rather than deferred. | Three partial indexes, 1.6 MB total, take the three floored facets to 89 / 89 / 31 buffers. The rejected alternative is unchanged and still rejected: never a floored-vs-unfloored facet mismatch, which would make the counts lie. |
| The `entity_class` facet is requested by two specs and the flat merge hands one answer to both. | §7 — `bySpec`, with the measured /persons 162× precedent cited at the call site. |
| Someone later builds a `?obshtina` producer with `canonicalObshtina()` and Sofia's 116,306 companies return nothing. | §1.6d and the Tier-8 data gate. This is the failure that looks like an empty result rather than an error. |
| Re-applying 188 to pick up the new index blanks `/companies` for a full 1.02M-row rebuild. | §9 — the index ships in a SEPARATE `CREATE INDEX IF NOT EXISTS` migration as well as in 188, and the 122 precedent is cited there. |
| The OG capture times out and silently keeps serving the old card. | §4 / Tier-8 gate 3 — `political` is in `NARROWING_PARAMS`, asserted with the capture's line number in the message. |
| The head grows past its budget as copy is tuned. | Tier 8 gate 1 lands with a measured number and a comment naming which two captions are load-bearing sentences rather than labels. |

---

## 14. Order

**Tier 6 first — it is already written, it is a live defect, and it is the only tier with a
database step.** Then Tier 1 → 2 → 3 → 4 → 5 → 7 → 8.

Tier 1 is independently shippable with no visible change (the hook exists, nothing consumes it).
Tier 2 is the first visible one. **Tier 6 is independent of all of them** and can ship first if the
`contract_count` seq scan (§1.6c) is judged urgent on its own — it is a live defect today, not a
consequence of this plan. Tier 5 is the first tier that can look broken if Tier 1 is wrong, so do
not reorder those two.


---

## 15. Audit, 2026-08-26 — what was re-measured and what changed

Re-measured against local Postgres (`postgres://postgres@127.0.0.1:5433/electionsbg`) and read
back against the working tree. Two temporary indexes were built and dropped during §15.3; the
database was left as found.

### 15.1 Every figure in §0–§1.8 that was checked reproduced EXACTLY

Corpus: 1,022,592 · `has_signal` 98,737 · `is_official_linked` 17,675 · `contract_count > 0`
18,689 · `public_money_eur > 0` 59,884 · NGO classes 30,339 · placed 327,161 · active 977,216 ·
`is_mp_tied` 106. `entity_class` 7 values / no NULLs and `status` 4 / no NULLs, both with the
per-value counts as printed. 28 oblast names, 265 obshtina codes of which 13 are the empty string,
41 `legal_form` values with the EOOD/ET/ASSOC/FOUND synonym pairs at the stated sizes.

The four floor implications hold at **0 counterexamples** each, and the four negative-money rows
(2 hidden) are there. `SOF46` = 116,306; `SOF00` / `SOF` / `SFO_CITY` = 0 each.

The money basis reconciles to the digit: `company_public_money` is €118,111,285,074 over 81,464
EIKs, of which €76,125,285,097 over **63,063** join `tr_companies.uic`; `sum(public_money_eur)`
over the whole matview is €76,125,285,096.633 against €76,125,285,096.641 over `has_signal`.

The tense split partitions exactly — `has_registry_link` × `has_declared_stake` ×
`has_current_role` gives 14,224 + 589 = **14,813** current, 519 + 238 = **757** declared-stake,
and **2,105** reaching the set only through withdrawn filings. 14,813 + 757 + 2,105 = 17,675.

Performance: the `trans` worst case is **15,501 buffers** over 24,897 rows (953 hit / 14,548
read — a cold Bitmap Heap Scan, which is exactly why §13's „unmeasured on Cloud SQL" caveat is
the right one to keep). The `entity_class` facet is **870 buffers unfloored / 23,908 floored**.

Every cited code anchor is where the plan says it is: the unconditional `has_signal` push, the
`columns` array `DbDataTable` ANDs with `global`, the `renderAggregates && data` gate at `:462`,
the three `useState`-only controls, `initialSearch` read once and never written, `runDbFacets`
calling `buildWhere` with no `global`, `capture-screens.ts:1022`'s `tr.group` wait,
`routes.ts:4905`/`:4924`/`:4934`, and `companies_browse_intro` at `:5168` in both corpora.

Every piece of shared infrastructure the plan assumes exists: `HubHead`'s `scope` / `search` /
`kpis` / `kpisPending` / `evidence` / `kpiNote`, `basisLadder` + `TERM_MAX`, `searchTerm.ts`'s
`SEARCH_MIN_CHARS` + `termLength`, `DbDataTable`'s `search` / `onSearchChange` / `hideSearchInput`
union, `usePersonFacets`' `bySpec`, and the `oc_kind_*` / `tr_status_*` label keys for all seven
classes and all four statuses.

### 15.2 Four changes were folded into the tiers above

1. **Tier 6 is already written and uncommitted** — header, §9, §9.1, §14.
2. **Two more false sentences**, `routes.ts:5957` and `:6043` — Tier 7 item 3, now a table of four.
   The §1.6e figure **1,367** did not reproduce (closest derivation 1,213, definition unstated),
   so the copy fix carries no number.
3. **The floored-facet cost is fixed, not deferred** — §9.0, promoted out of §13's risk table.
4. **CSV is struck** — it does not exist today, so §2's mock-up was proposing a feature nobody
   asked for; §7 says so and names the three inline strings that die with the toolbar.

Plus three smaller ones: `seoDescription` is required (§5), `HUB_SCREENS` is hand-maintained and
`/companies` must join it (Tier 8 gate 2), and the `/procurement/contracts` head rule is the
explicit opposite of this plan's and needed answering rather than ignoring (§5).

### 15.3 The §9.0 measurement

Each index built on the live local matview, the floored facet EXPLAIN'd, the index dropped:

```
entity_class  WHERE has_signal   23,908 →  89 buffers   Index Only Scan   688 kB
status        WHERE has_signal   23,908 →  89 buffers   Index Only Scan   688 kB
oblast_name   WHERE has_signal   23,892 →  31 buffers   Index Only Scan   248 kB
```

### 15.4 Two things the audit did NOT establish, stated so nobody assumes they were

* **Nothing was measured on Cloud SQL.** The `trans` count (15,501 buffers, read-dominated) and
  the three §9.0 index builds are the two places that matters most. §13's caveat stands.
* **The scale of the port is larger than the tier list implies.** `PersonsBrowserScreen.tsx` is
  1,561 lines with ~2,000 more across its siblings and tests; `CompaniesBrowseDbScreen.tsx` is 323
  today. The plan's own file list (a hook, a KPI rule, a search field, a filter bar, an active-chip
  row, a landing, and a test for each) is the honest shape of that, but the finished screen will be
  several times its current size. **The screen also stays at `src/screens/dev/`** while its new
  components go to `src/screens/companies/` — a deliberate trade (it avoids touching `routes.tsx`,
  the 273-line existing test file and the OG capture's route), but a split worth confirming rather
  than discovering.
