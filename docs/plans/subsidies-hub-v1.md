# /subsidies as a dashboard hub — v1

**Status:** proposed, 2026-08-16. Revised the same day after four scoping questions (§1.4, §2.5,
§4.2, §6.1).
**Pattern:** `.claude/skills/dashboard-hub`. Reference implementations: `/funds`
([funds-hub-v1.md](funds-hub-v1.md)), `/parliament`.
**Corpus:** ДФ „Земеделие" CAP payments — `agri_subsidies` + `agri_payloads` (migration 046),
ingested by `scripts/agri/ingest.ts`, published by `db:load:agri:pg`. **Postgres only** — there
is no `data/agri/` shard tree.

---

## 1. Why

### 1.1 The page today (dev server, 1280 px viewport, 2026-08-16)

|                                |                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| page height                    | **3 188 px**                                                                                                          |
| page-specific data fetched     | **426.8 KB across 3 requests**                                                                                        |
| the single largest             | **`/regions_map.json` — 407.6 KB, 95.5% of it** — the nation-wide oblast GeoJSON, pulled to draw a preview choropleth |
| next                           | `/api/db/agri-payload?kind=overview` 16.1 KB · `/sofia_obshtina.json` 3.1 KB                                          |
| `SubsidiesDashboardScreen.tsx` | **638 lines**, every analysis tile rendered inline                                                                    |
| inline bilingual ternaries     | **32** `bg ? "…" : "…"` — the screen uses almost no i18n keys                                                         |

**The GeoJSON is 407 KB on prod too, not just on the dev server.** Checked directly:

```
$ curl -sI -H 'Accept-Encoding: gzip' \
    https://storage.googleapis.com/data-electionsbg-com/regions_map.json
x-goog-stored-content-encoding: identity
x-goog-stored-content-length: 417039
content-length: 417039
```

GCS serves it uncompressed (`reference_gcs_bucket_compression`), so there is no compression
ratio to discount here the way funds-hub-v1 §1.1 had to. Same defect `/funds` recorded and
fixed — _"the map was the single heaviest thing on this page … rendered to draw a preview nobody
had asked for yet"_ — reproduced, and worse in proportion: there the outsized fetch was 63% of
the page, here it is 95%.

### 1.2 But the shape differs from `/funds`, and the plan has to say so

`/funds` had **eighteen** routed pages and a front page rendering fourteen inline. Its rework was
a **split**.

`/subsidies` has **two** routed pages in the entire module:

```
/subsidies          the dashboard
/subsidies/browse   the DbDataTable over 2 481 857 payment rows
/farm/:eik          per-recipient, parameterised (picker = the search box, correctly)
```

So this is a **split plus a build**. Four analysis tiles exist to move (concentration, by scheme,
by oblast, by year) and one table (top recipients). Everything else in §4 is a page that does not
exist yet.

Cutting 407 KB off the front page is real and immediate; the larger prize is that a €11.04bn
corpus with 2.48M rows currently offers a reader exactly one destination beyond a spreadsheet.

### 1.3 What is NOT being changed

- **The finder stays live above the grid.** `SubsidiesSearchBox` is the repo's only server-side
  typeahead and it is the picker for `/farm/:eik`. It moves onto the shared `HubSearch` adapter
  (§7); it does not become a tile.
- **`ScopeControl` stays.** `?pscope` is this hub's selector and §3 is entirely about it.
- **`/sector/agri` stays separate.** That page is ДФЗ as a **procurement awarder** (its own
  tenders); this one is ДФЗ as a **paying agency**. Two money lenses over one institution.

---

### 1.4 Is `/subsidies` only farm subsidies? — the landscape, measured

The URL claims a whole category and the page serves one stream. Every subsidy corpus this repo
holds, measured 2026-08-16:

| stream                                                                                            | corpus                                    | money                                                                              | where it lives today                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| **ДФЗ CAP farm subsidies**                                                                        | `agri_subsidies`, 2.48M rows, 8 FY        | **€11.04bn** (2015–2025)                                                           | **`/subsidies`**                            |
| **Municipal transfers** (обща субсидия за делегирани дейности · изравнителна · целева капиталова) | `budget_muni_transfer`, 265 общини × 9 yr | **€4.56bn** (2025); delegated alone €4.04bn                                        | `/budget/municipal`                         |
| **Transport PSO + infrastructure subsidy** (БДЖ · НКЖИ)                                           | `data/transport/rail_subsidy.json`, 9 yr  | **€447.2m** budgeted 2026 (PSO €110.7m + НКЖИ operating €171.6m + capital €165.0m) | `/sector/transport`, `TransportSubsidyTile` |
| **State-budget КФП „Субсидии" line**                                                              | `budget_kfp_snapshot_line`                | **€965.7m** executed 2025 (€1.44bn in 2021)                                        | `/budget/spending`, `/budget/simulator`     |
| **НФЦ film subsidies**                                                                            | `data/culture/films.json`, 944 films      | **€94.9m** (2014–2025)                                                             | `/culture` — already a full sub-module      |
| **Party subsidies**                                                                               | curated                                   | **≈€9.3m/yr** (3.00 €/vote from 2026-04-30)                                        | `/budget/simulator`, financing pages        |
| **NGO state-budget subsidy**                                                                      | `ngo_funding` `source='budget_subsidy'`   | **€3.76m**, 3 rows, 2026 only                                                      | NGO signal chip                             |
| Municipal capital „държавна субсидия"                                                             | `budget_muni_capital_project`             | a funding-source split, not a stream                                               | `/budget/municipal/capital`                 |

**The four biggest streams are on four different pages and no page names the set.** A reader
arriving at `/subsidies` asking „защо общината ми получава субсидия" — a €4.56bn question — gets
a farm page.

**Recommendation: keep `/subsidies` as the ДФЗ hub, and add a fourth band that fronts the other
streams where they already live.** Reasoning:

- **Do not move the agri corpus to `/subsidies/agri`.** `/subsidies` is prerendered, in both
  sitemap lists, has an og card, and is linked from the governance hub and the header menu. A
  move costs 301s and an og re-shoot for no reader benefit, and every other stream is a single
  tile on somebody else's dashboard — there is no second module to balance it against.
- **Do not duplicate the other streams here.** Each already has a home that renders it in its own
  context (rail subsidy per passenger only means something beside ridership). A second rendering
  is the drift the pattern exists to prevent.
- **A cross-link band makes the URL's claim true at zero data cost.** Four tiles, four existing
  destinations, four figures read from the artifacts those pages already publish. It is the
  skill's "reachable" test applied across modules.

**⚠️ These are NEVER summed.** They are four different accounting bases: CAP money is EU funds
passing through a paying agency; municipal transfers are intra-government; the КФП line is
national-budget expenditure that _includes_ a national agriculture top-up; the transport figure
is budgeted, not executed. The band's description says so, and no tile shows a total across it.

---

## 2. Step 0 — every figure, with its denominator

Per the skill §0, done **before** any tile is written. Measured against the local corpus on
2026-08-16 (`agri_subsidies`, 2 481 857 rows).

### 2.1 Corpus shape

|                          |                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| financial years          | **8** — 2015, 2016, 2017, 2021, 2022, 2023, 2024, 2025                                                                               |
| absent                   | **2014, 2018, 2019, 2020** — see §9                                                                                                  |
| total paid               | **€11 037 181 927**                                                                                                                  |
| legal entities           | **16 701** distinct EIK (ДФЗ's own `121100421` excluded)                                                                             |
| natural persons          | **168 043** distinct (name + oblast) — no EIK exists for them                                                                        |
| oblasti                  | 28, zero blanks                                                                                                                      |
| distinct `scheme` labels | **481**                                                                                                                              |
| CAP pillar split         | ЕФГЗ-ДП (direct) **€6 169 852 104** · ЕФГЗ (market) **€158 884 232** · ЕЗФРСР (rural) **€4 708 445 585** — sums exactly to the total |

### 2.2 Each candidate figure, and the other defensible answers

| figure                      | the number                                    | its denominator                                                                             | the other defensible answers                                                              |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| money                       | €11.04bn                                      | all rows, all 8 years                                                                       | 2025 alone **€1.587bn**; legal-entity only **€6.62bn**                                    |
| recipients                  | 16 701 companies **+** 168 043 no-ЕИК records | distinct EIK / distinct name+oblast — **a no-ЕИК record is not necessarily a person, §4.3** | 2025 scope: 8 396 + 24 727                                                                |
| **individual share**        | **€4.39bn = 39.8%**                           | individual €/total €, all years                                                             | 2025: €782.8m / €1.587bn = **49.3%** — and rising, §2.3                                   |
| top-100 concentration       | **12.6%** all years                           | share of **legal-entity** money (€6.62bn)                                                   | of ALL money: **7.5%**; 2025 scope: **14.8%**                                             |
| top-10 / top-1000           | 3.1% / 48.5%                                  | same entity denominator                                                                     |                                                                                           |
| largest scheme              | СЕПП, €2.33bn                                 | all years, raw label                                                                        | 2025: „I.А.1-1 основно подпомагане…" €382.7m — **the same instrument renamed**, §9        |
| largest oblast              | Пловдив €818.5m                               | recipient's oblast as ДФЗ publishes it                                                      | София (столица) 2nd at €716.9m — a **registered-seat** artefact, §9                       |
| **politically linked**      | **568 EIKs · €184.4m · 729 public figures**   | the canonical `person_link_n` gate, §2.4                                                    | `company_politicians`: **11 · €17.6m**; 082's business-only gate: **504 · €170.0m · 621** |
| also holds public contracts | 772 EIKs · €525.7m of farm money              | `agri.eik ∈ contracts.contractor_eik`                                                       |                                                                                           |
| also holds EU funds (ИСУН)  | 3 911 EIKs · €3.11bn of farm money            | `agri.eik ∈ fund_projects.beneficiary_eik`                                                  |                                                                                           |

### 2.3 The individual share is the corpus's largest single fact

| year                | 2015  | 2016  | 2017  | 2021  | 2022  | 2023  | 2024      | 2025      |
| ------------------- | ----- | ----- | ----- | ----- | ----- | ----- | --------- | --------- |
| on rows with no ЕИК | 33.2% | 31.8% | 41.2% | 36.1% | 37.0% | 38.3% | **48.7%** | **49.3%** |

Half of last year's CAP money sat on rows with no ЕИК — therefore no `/farm/` page, no
company record, no ownership, no cross-programme join and no political link. **Every
entity-ranked figure on this hub is computed over the other half.** That is a page (§4), not a
footnote. See §9 for the source break that sits on the 2023→2024 jump.

### 2.4 ⚠️ The political basis — three predicates already ship, and they disagree

This is the `political_n` / `person_link_n` trap from CLAUDE.md, reproduced for agri. Measured:

| predicate                                                                | where it already ships                                        | EIKs    | money       | people |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- | ------- | ----------- | ------ |
| `company_politicians` (008)                                              | `/procurement/contractors` MP-tied KPIs                       | **11**  | **€17.6m**  | —      |
| `person_role` `source='tr'` + confidence gate + public figure            | **`082_person_api.sql` → `/person/:slug`'s `subsidiesEur`**   | **504** | **€170.0m** | 621    |
| `person_role` `source IN ('tr','ngo')` + confidence gate + public figure | **`person_link_n` (133 loader) and `151_place_mp_companies`** | **568** | **€184.4m** | 729    |

⚠️ **These are semi-join sums.** A first pass measured them with a plain `JOIN person_role`, which
fans out once per (person, role) pair and inflated the money ~1.8× (€330.9m for the canonical
gate). Any figure over `person_role` must use `IN`/`EXISTS`, never a join — the EIK counts survive
a fanout and the money does not, which is what makes it hard to spot.

`company_politicians` is money-restricted and **procurement-derived** (113 companies site-wide) —
using it would tell a reader that 0.11% of farm money touches a public figure when the site's own
person layer knows 1.67%. A factor of 10.

**Use the third — the canonical `person_link_n` gate**, written once and imported, never restated:

```sql
person_role r JOIN person pe ON pe.person_id = r.person_id
WHERE r.source IN ('tr','ngo')
  AND r.confidence IN ('exact_id','high','manual')
  AND pe.status = 'active' AND pe.is_public_figure
```

It is the one three shipped surfaces (`person_link_n`, `place_mp_companies`, and the
„фирми, регистрирани тук" tile) already agree on, and `idx_person_role_tr_ref_person` (151) is
built for exactly it.

**The 082 divergence is pre-existing, deliberate, and this page will expose it** — 64 companies
and €14.37m apart. It is not a bug to reconcile; it is two different questions. Full analysis and
the recommended resolution are in §13.1.

### 2.5 Duplication audit — what already renders farm-subsidy data

Asked for explicitly. Every surface reading `agri_subsidies` / `agri_payloads` today:

| surface                              | what it shows                              | source                                                      | overlaps the hub?                 |
| ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- | --------------------------------- |
| `/subsidies`                         | the whole dashboard                        | `agri_payloads` overview                                    | **is** the hub                    |
| `/subsidies/browse`                  | 2.48M payment rows                         | `agri_subsidies` via DbDataTable                            | no — it is the destination        |
| `/farm/:eik`                         | one recipient's history                    | `agri_payloads` recipient                                   | no — parameterised                |
| `/company/:eik`                      | „Земеделски субсидии" tile                 | `agri_payloads` recipient                                   | no — per entity                   |
| `/person/:slug`                      | `pp_subsidies_total` „Земеделски субсидии" | `082` over `agri_subsidies`                                 | **figure must agree** — §2.4      |
| `/governance/sectors` agri tile      | headline payout                            | `db:gen-sector-stats` → `agri_payloads` `headline.totalEur` | **figure must agree** — see below |
| `/sector/agri`                       | ДФЗ's own procurement                      | `contracts`                                                 | no — different lens               |
| governance „фирми, регистрирани тук" | ranks by public money incl. subsidies      | `company_public_money` (127)                                | no — a rollup                     |
| `/connections` graph                 | money basis incl. subsidies                | `company_public_money` (127)                                | no — a rollup                     |
| `/persons` money column              | `public_money_eur`                         | `person_browse_table` (120)                                 | no — a rollup                     |

**Two hard figure-agreement constraints fall out of this, and one is a live inconsistency:**

- **`db:gen-sector-stats` reads `agri_payloads` `headline.totalEur` per year** — so the hub blob
  must read _that same field_, not re-derive from `agri_subsidies`. Read the payload and the two
  cannot drift; re-derive and they will.
- **⚠️ „all" already means two different things.** `sector_stats.json`'s `all` scope carries
  `agri = {basis:"payout", value: 1 586 940 416.44, year: 2025}` — the **latest year**, because
  the sectors hub's headline is an annual payout. The `/subsidies` hub's `all` scope is the
  **€11.04bn corpus**. Both are defensible and they are 7× apart under the same pill label. The
  hub must caption its `all` as „всички години" and never as „общо" unqualified, and the gate in
  §10 asserts the two values are _deliberately_ different rather than accidentally equal.

**Nothing else duplicates.** The other subsidy streams (§1.4) share no corpus, no table and no
component with this one — which is exactly why band 3 cross-links rather than re-renders.

---

## 3. The scope rule — the highest-risk part of this change

`/subsidies` carries `?pscope` (`ns` | `all` | `y:YYYY`), resolved by `agriScopeToKey`
(`src/data/agri/constants.ts`). `ns` means the **latest financial year**, not a parliament.

The skill's first trap is _"corpus total on a scoped hub"_. This hub is unusually exposed, for
three compounding reasons:

1. **The default scope is not the corpus.** `ns` → 2025 → €1.587bn, one seventh of €11.04bn. A
   tile showing the corpus total under a pill reading „Последна година" is the defect, formed.
2. **`?pscope` arrives from pages that do not share this corpus.** It rides in from
   `/procurement*` and `/governance/sectors`, whose picker runs `SCOPE_FIRST_YEAR(2011)..now`.
   `agriScopeToKey` returns **`null`** for 2019. The hub must then render metrics **absent**,
   never `0`.
3. **The destinations scope themselves.** `InfographicTile` links through `usePreserveParams` and
   `pscope` is in that allowlist, so **the scope is already carried forward for free**. Keep and
   gate that property; `SubsidiesDashboardScreen`'s hand-built `browseTo()` retires with it.

**Therefore the stat blob is keyed by scope**, on the same ten keys `agri_payloads(kind='overview')`
already uses — so the hub cannot key differently from the body it replaces.

Band 3's four cross-stream tiles are the deliberate exception: those corpora have no `?pscope`
dimension, so their figures are annual and each tile **names its year in the caption**.

---

### 3.1 ⚠️ Band-3 tiles and `?pscope` — the leak was real, and it was not where this said

`InfographicTile` links through `usePreserveParams`, `pscope` is in that allowlist, and there is
no opt-out prop. §3 counts that as a feature for the eight in-module tiles. For band 3 this
section predicted a defect at four cross-module destinations. **Measured at step 6c, all four
rows were wrong** — and the real exposure was inside this module:

| destination         | this section claimed                          | measured 2026-08-17                                                                                              |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/budget/municipal` | "a page with no data for the year in its pill" | **Does not read `pscope` at all.** Its year param is `?fy=`, already clamped to `stats.muniYears`; no `ScopeControl`. Inbound `pscope` is inert. |
| `/culture`          | "CLAUDE.md documents this exact hazard"        | **Already resolved** — `useScope({ years: cultureYears, allowAll: false })`, handed to its `ScopeControl` as `value`/`onChange`. |
| `/sector/transport` | "partial"                                      | The picker governs the **procurement** half, which spans 2011-2026 — the whole default year list. The rail-subsidy tile is deliberately annual (`not scope-windowed`, its own comment) and prints its own year. |
| `/budget/simulator` | "ignored (harmless)"                           | Correct — zero scope references.                                                                                   |

**Where it actually was: this module** — and one layer deeper than the pill. Three `ScopeControl` call sites offer a narrowed
`years={AGRI_FINANCIAL_YEARS}` while reading `?pscope` unresolved — the hub, the browse, and
`AgriScopeGate` (the shared picker behind all eight sub-pages). That is the exact shape §3.1
warned about, and it is **correct here**: the CAP corpus skips 2014 and 2018-2020, so an off-list
year is ordinary rather than exotic, and each of the three names the gap („Няма данни за субсидии
за 2019“ + the list of years ДФЗ does publish) instead of snapping the reader to a year they did
not ask for. CLAUDE.md's URL contract and `ScopeControl`'s own header both already record this as
the second honest answer.

**But two of the seven sub-pages were not actually doing that.** `/subsidies/political` and
`/subsidies/cross-programme` rendered a hand-rolled „Няма данни за субсидии за избрания период" —
no year, no published-years list, no way back, and a FAILED fetch shown as an unpublished year
(the four-state defect, one directory from where step 6b fixed it on `/farm/:eik`). So the
module's claim to the second honest answer was only 5/7 true. Both now render
`<AgriScopeFallback>`, and the gate checks that claim directly rather than trusting the
exception's prose.

So the decision §3.1 asked for is moot — neither option 1 (a `preserveParams` opt-out) nor option 2
(resolve at the four destinations) has anything left to fix. What remains is the gate, and it is
worth more than the fix would have been:

**`src/screens/components/scopeContract.test.ts`** reads the SOURCE of every `<ScopeControl>` call
site site-wide and fails when one offers a narrowed picker (`years=` / `allowAll={false}`) while
reading the scope unresolved, unless it is declared in `NAMES_THE_GAP` with a reason **and** a
`rawScopeIn` pointer to the file whose `useScope()` must stay bare. Both directions are held: a new
narrowed-uncontrolled site fails, and an exception whose page starts clamping fails as stale.
Mutation-checked six ways — un-control a narrowed picker; make an excepted reader clamp; list a
file with no picker; and the three parser evasions a `[^>]*?` regex allows (an inline
`onChange={(v) => …}`, whose `>` truncated the tag and made the site VANISH; a non-self-closing
`<ScopeControl …></ScopeControl>`; a `<ScopeControl>` named in a comment, which
`PersonContractsScreen` does twice). The parser is brace-aware and reconciles its own count
against the raw occurrences, so a form it cannot read fails loudly instead of passing silently.

Its reach is **every destination that renders a `<ScopeControl>`** — which is the mechanism band 3
would leak through, but not literally every destination: `/budget/municipal` has a bespoke `?fy=`
picker and stays outside it. That page is safe for an independent reason (it never reads `pscope`),
not because this gate is watching it.

The one hazard the gate cannot see, recorded rather than fixed: `/sector/transport` shows „2016" in
its scope pill beside a rail-subsidy tile captioned „2026 г.". Both label their own year and the
tile is annual by design, so nothing is mislabelled — but a reader scanning the pill first has to
notice. Not introduced by band 3 and not this plan's to change.

---

## 4. Target shape

```
Title + description
SectorBreadcrumb
HubSearch                    ← SubsidiesSearchBox, migrated to the shared adapter
ScopeControl (Обхват)        ← unchanged
──────────────────────────────────────────────────  live, above the grid
BAND 1  Кой получава парите          4 tiles   scope-keyed
BAND 2  Концентрация и връзки        3 tiles   scope-keyed
BAND 3  Други публични субсидии      4 tiles   annual, cross-module
BAND 4  Данните                      2 tiles
source footer (ДФЗ + generatedFrom)
```

**4 / 3 / 4 / 2 = 13 tiles, 13 distinct accents** (the palette has 21). The grid is 4 columns at
`xl`, so no band strands a tile on a second row — checked on the rendered grid, not the array
length. Bands are named for the question they answer, never „Още".

### 4.1 The tiles

| #                                                                    | tile                    | destination                  | status                                     | headline (basis)                                       | second figure               |
| -------------------------------------------------------------------- | ----------------------- | ---------------------------- | ------------------------------------------ | ------------------------------------------------------ | --------------------------- |
| **Band 1 — Кой получава парите** _(scope-keyed)_                     |                         |                              |                                            |                                                        |                             |
| 1                                                                    | Топ получатели          | `/subsidies/recipients`      | **NEW**                                    | `16 701` фирми _(distinct EIK in scope)_               | €6,62 млрд                  |
| 2                                                                    | По схема                | `/subsidies/schemes`         | **NEW**                                    | `481` схеми                                            | най-голяма: СЕПП €2,33 млрд |
| 3                                                                    | По област               | `/subsidies/places`          | **NEW** — takes the choropleth off the hub | `€818,5 млн` _(Пловдив, largest)_                      | 28 области                  |
| 4                                                                    | Непроследими получатели | `/subsidies/untraceable`     | **NEW** — see §4.3                         | `39,8%` _(money on rows with no ЕИК)_                  | €4,39 млрд · 168 043 записа |
| **Band 2 — Концентрация и връзки** _(scope-keyed)_                   |                         |                              |                                            |                                                        |                             |
| 5                                                                    | Концентрация            | `/subsidies/concentration`   | **NEW**                                    | `12,6%` _(top-100 of legal-entity money)_              | 48,5% за топ 1000           |
| 6                                                                    | Политически свързани    | `/subsidies/political`       | **NEW**                                    | `568` фирми _(canonical §2.4 gate)_                    | €184,4 млн · 729 лица       |
| 7                                                                    | И по други програми     | `/subsidies/cross-programme` | **NEW**                                    | `3 911` фирми _(also in ИСУН)_                         | 772 и с обществени поръчки  |
| **Band 3 — Други публични субсидии** _(annual, each names its year)_ |                         |                              |                                            |                                                        |                             |
| 8                                                                    | Общински трансфери      | `/budget/municipal`          | **exists**                                 | `€4,56 млрд` _(2025, чл. 53 envelope)_                 | 265 общини                  |
| 9                                                                    | Кой плаща за влака      | `/sector/transport`          | **exists**                                 | `€447,2 млн` _(2026 budgeted, БДЖ+НКЖИ)_               | €110,7 млн PSO за билетите  |
| 10                                                                   | Филмови субсидии        | `/culture`                   | **exists**                                 | `€94,9 млн` _(2014–2025 НФЦ)_                          | 944 филма                   |
| 11                                                                   | Партийни субсидии       | `/budget/simulator`          | **exists** — see the caveat below          | `€9,31 млн` _(годишно, ЗПП: 3 103 303 гласа × 3,00 €)_ | 10 формации над 1%          |
| **Band 4 — Данните**                                                 |                         |                              |                                            |                                                        |                             |
| 12                                                                   | Всички плащания         | `/subsidies/browse`          | **exists**                                 | `2 481 857` плащания                                   | 8 финансови години          |
| 13                                                                   | Обхват и източници      | `/subsidies/coverage`        | **NEW**                                    | `8` от 12 години                                       | 2014, 2018–2020 липсват     |

All 13 `to` values are **static**, and all four band-3 destinations were grepped in `routes.tsx`
(`/budget/municipal`, `/culture`, `/budget/simulator`, and `/sector/transport` via `sector/:id`).
No seeded tiles: `/farm/:eik` is parameterised and its picker is the live search box.

**The КФП „Субсидии" budget line is deliberately NOT a tile**, though §1.4 measures it at €965.7m.
It is not a distinct stream — it is a **budget aggregate that already contains** the national
agriculture top-up, the energy subsidies _and_ part of the СОЕ transport money, so placing it
beside four registers of identifiable recipients invites exactly the summation the band forbids.
The other four each name a distinct, countable set of recipients. The line stays one click away:
the band's description links `/budget/spending` in prose.

**⚠️ Tile 11 (партийни субсидии) points at a SIMULATOR, and that is a real weakness.** Verified:
`PARTY_SUBSIDY_VOTES` / `PARTY_SUBSIDY_RATE_EUR` (`src/lib/bgTaxPolicy.ts`) have exactly one
consumer in the whole repo — `BudgetPolicySimulator.tsx`. `/financing` (`PartiesFinancing`) is the
Сметна палата corpus of **private** donations and spending and renders no state subsidy at all, so
it would be the wrong destination. The reader therefore lands on a slider rather than on „кой
колко получи", which strains the skill's rule that _a count that links somewhere must be nameable
there_. Two mitigations, and the tile ships only with the first:

1. **Caption it for what it is** — the annual ЗПП envelope, with the destination named as the
   budget lever. Do not imply a register.
2. **The per-party breakdown is derivable and should become the real destination.** The subsidy
   is `party-list valid votes × €3.00` for the ten formations over 1%, and this repo holds those
   votes. A small `/financing/subsidy` page (or a section on `/financing`) would make the figure
   nameable per party. Out of scope here; recorded in §13.3.

**⚠️ Read the two constants, never re-derive from the budget envelope.** `bgTaxPolicy.ts` carries
an explicit warning: ЗДБРБ-2026 чл. 13 ал. 4 states „до 8 964,3 хил. евро", but чл. 63 sets **two
rates inside the one year** (€4.09 to 29.04, €3.00 from 30.04) over **two vote bases** (the 19.04
election changed it). `8 964 300 ÷ 3.00 = 2 988 100` is a vote count from no election that ever
happened. The tile imports the constants; a literal in the registry would bake the transition into
a steady-state number.

**⚠️ Tile 9 points at `/sector/transport`, not at `#rail-subsidy`.** The tile has an
`id="rail-subsidy"` and the anchor is tempting — but the skill records exactly this: three
`/funds` KPI cards targeted `#top-beneficiaries`, `#money-flow` and `#absorption`, sections a
later rework moved onto their own pages, and all three silently did nothing when clicked. A
same-page anchor is the link that rots when the destination is reorganised.

### 4.2 Decisions taken, and what was rejected

- **`/subsidies/untraceable` is a named page** _(decided — but NOT the page the first draft
  specified; see §4.3, which is a correction, not a refinement)_.

- **`/subsidies/pillars` is a section of `/subsidies/schemes`, not a 14th tile.** The three
  columns (`dp_eur`, `market_eur`, `rural_eur`) are unsurfaced anywhere today, which is a real
  gap — but „direct income support vs rural investment" is the scheme question at a coarser
  grain.
- **No news/wire band.** ДФЗ payments are an annual publication; a wire would report the crawl
  date as an event date — the mistake funds-hub-v1 §4 names for `fund_projects`. The
  `agri_subsidy` ingest already stamps `recent_updates`; `/data/updates` is its home.
- **No „За теб" band.** There is no per-person subsidy view to personalise; `/person`'s
  `pp_subsidies_total` already surfaces it.

---

### 4.3 ⚠️ CORRECTION — `eik IS NULL` is not „физическо лице"

The first draft specified `/subsidies/individuals` with the headline „39,8% от парите отиват при
физически лица", derived from `agri_subsidies WHERE eik IS NULL`. **The audit falsified the
premise.** Measured on the no-EIK rows:

|                                                                                                                          |                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| rows whose NAME matches a legal-entity pattern (ЕООД · ООД · ЕАД · АД · кооперация · сдружение · фондация · община · ЕТ) | **50 684 rows · 6 372 distinct names · €385 472 285**                                                                             |
| that as a share of the €4.39bn no-EIK money                                                                              | **8.8%**                                                                                                                          |
| largest                                                                                                                  | **Напоителни системи ЕАД €47.8m** (the state irrigation company), РЕСЕН ЕООД €4.0m, ТРОЯ-АВТО ЕООД €3.3m, **Община Баните €1.6m** |

A pattern match is a floor, not a census — an unknown further slice carries no recognisable
suffix. So the true individual share is **below 39.8% and not knowable from this corpus**, and a
page asserting „39,8% при физически лица" would publish a false sentence built on a correct sum.
This is the skill's §0 defect class exactly, and it was in a page this plan invented.

**The page still earns its place — with the honest question.** What the corpus _does_ support is:

- **Headline: 39,8% от парите стоят на редове без ЕИК** — unattributable, correct as stated. No
  `/farm/` page, no ownership, no cross-programme join, no political link. That is the fact every
  entity-ranked figure on this hub depends on, and the reason to have the page.
- **A named sub-finding: some of that is companies.** ДФЗ publishes at least €385.5m of payments
  to identifiable legal entities **without recording their ЕИК** — a state-owned ЕАД and a
  municipality among them. That is a register-quality finding in its own right and belongs on a
  transparency site, stated as a floor.
- The rising trend (§2.3) is then a claim about **attribution coverage falling**, which is what
  the numbers actually show, rather than about who farms.

Both §4.2 constraints survive unchanged: aggregates lead, and **no ranking of individuals by
amount**. The renaming makes the second easier to hold — a „непроследими" page has no reason to
rank people at all.

**Everywhere the phrase „физически лица" appears as a money basis it must be re-checked.** The
existing dashboard's KPI („Получатели … физ. лица") and `agri_payloads`'
`headline.individualCount` / `individualEur` are built on the same `eik IS NULL` rule, so they
carry the same overstatement today. Fixing the ingest's field NAMES is out of scope; the hub must
not compound it by putting the wrong word on a tile.

---

## 5. The stat blob — a materialised PG cache, not a committed JSON

`feedback_no_json_from_pg` and the `/funds` precedent both apply: `/subsidies` is already
100% PG-served, so a committed JSON blob would be a **second** serving surface for the same
numbers — the shape CLAUDE.md records going stale for two months while still serving 200s.

**Proposed: migration `159_agri_hub_stats.sql`** — `agri_hub_stats_cache` (matview) +
`agri_hub_stats(scope_key)`, behind `/api/db/agri-hub-stats`. (158 is taken by the untracked
`158_company_political_links.sql`; confirm the next free number at implementation time.)

### 5.1 It must be MATERIALISED — measured, not assumed

The politically-linked figure cannot be served live:

```
EXPLAIN (ANALYZE, BUFFERS) — person_role semi-join over agri_subsidies
Aggregate (actual time=259.540..259.543 rows=1)
  Buffers: shared hit=217884 read=15390        ← 233 274 buffers
  ->  Merge Semi Join (rows=10567)
        ->  Index Only Scan idx_agri_eik_total (rows=387609, Heap Fetches: 0)
        ->  Hash Join → Seq Scan person_role (199 531) + Seq Scan person (63 782)
Execution Time: 259.869 ms
```

**233 274 buffers against the skill §8 ceiling of ~2 000**, warm, local, for a figure recomputed
on every hub view — and prod is a `db-g1-small` reading cold over the proxy under a 10 s
`statement_timeout`. Precompute it. The cross-programme joins are the same shape.

### 5.2 Rules carried over from the pattern

- **Built from what the ingest already holds.** Where a figure exists in
  `agri_payloads(kind='overview')` — headline, concentration, top scheme, oblast top — the cache
  reads **that payload**, not a re-derivation. That is the anti-drift rule, and §2.5 shows it is
  also what keeps the hub in step with `db:gen-sector-stats`. Only the three cross-corpus figures
  (political, contracts, funds) are new SQL.
- **Band 3's four figures are read from their own sources**, not restated as constants:
  `budget_muni_transfer`, `data/transport/rail_subsidy.json` (via its existing hook or a small
  server read), `data/culture/overview.json`, and `PARTY_SUBSIDY_VOTES` × `PARTY_SUBSIDY_RATE_EUR`
  imported from `src/lib/bgTaxPolicy.ts` (§4.1 — never the budget envelope). A hard-coded €4.56bn
  goes stale the next time `update-budget` runs, silently, at a 200.
- **Keyed by scope** (§3), one row per `agri_payloads` overview key.
- **`undefined`, never `0`**, for an uncovered key. The route already 404s an unbuilt overview
  scope; the hub route returns the same shape so tiles render metric-less.
- **Degrade on `42P01 · 55000 · 42501 · 55P03`, never on `57014`** (skill §8). `55000` matters:
  a matview created `WITH NO DATA` raises rather than returning zero rows — every first cloud
  deploy.
- **Log `ahs:not-built` once per process** with the loader to run.
- **Refreshed inside `scripts/agri/ingest.ts`**, beside the existing
  `REFRESH MATERIALIZED VIEW agri_beneficiary` (line 744) — **not** in `load_agri_pg.ts`, which is a
  45-line wrapper that only checks for the `raw_data/agri/` cache and calls
  `runAgriIngest({ offline: true })`. Reached by `db:load:agri:pg` (already `db:refresh` step 14, already declares
  `raw_data/agri` in `refresh_coverage.ts`). Add the `ORDER_PAIRS` entry. The cross-corpus arms
  read `contracts`, `fund_projects` and `person_role`, so the cache also stales on a contracts /
  funds reload and on `db:resolve:persons` — name those in the migration header, in the CLAUDE.md
  entry, and in the `update-procurement` / `update-funds` / `update-persons` publish notes.

  **That is a dependency cycle in miniature, stated rather than hidden:** `db:load:agri:pg` is
  step 14 and `db:resolve:persons` is step 45, so a full `db:refresh` builds the political arm
  from the **previous** run's person layer — the same shape as the Interreg/graph cycle. Either
  re-run `db:load:agri:pg` after the person chain, or give the cache refresh its own late step.
  Decide at implementation; do not leave it undocumented.

---

## 6. The seven new pages

Each is **self-contained**: its own `Title`, `SectorBreadcrumb`, source footer, and it owns the
fetch its content needs. That is what takes the fetch off the hub.

| page                         | content                                                                                                                                                      | data                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/subsidies/recipients`      | the full recipient ranking, currently 25 rows inline                                                                                                         | `agri_beneficiary` **with a year dimension** — §6.1                                                                                                                       |
| `/subsidies/schemes`         | the 481 schemes, the CAP-period fold (§9), the three-pillar split                                                                                            | `agri_subsidies` GROUP BY `scheme`, period-aware                                                                                                                          |
| `/subsidies/places`          | **the choropleth**, plus the oblast table                                                                                                                    | `regions_map.json` moves HERE — this is the 407 KB                                                                                                                        |
| `/subsidies/untraceable`     | the unattributable share by year / oblast / scheme, **plus the €385.5m of named legal entities filed with no ЕИК** — aggregates, no leaderboard (§4.2, §4.3) | `agri_subsidies WHERE eik IS NULL`                                                                                                                                        |
| `/subsidies/concentration`   | the tier bar **plus the Lorenz curve the payload already carries and nothing renders**                                                                       | `agri_payloads` overview `concentration.lorenz`                                                                                                                           |
| `/subsidies/political`       | the 568 companies, each with the public figures holding a registry role, linking to `/person/:slug` and `/farm/:eik`                                         | the §2.4 canonical gate; **reuse `person_company_bridge_a` / the `tr_name_fold_people` gate** — a shared name is refused, not graded (`feedback_name_match_not_identity`) |
| `/subsidies/cross-programme` | farms that also hold procurement contracts and/or ИСУН grants                                                                                                | `agri_subsidies` ⨝ `contracts` / `fund_projects`; `company_public_money` (127) already unions all three per EIK                                                           |
| `/subsidies/coverage`        | which years exist, which do not, egov vs СЕУ provenance, the payer exclusion, the individual gap, the „all" ambiguity of §2.5                                | prose + `totalsByYear`                                                                                                                                                    |

Two recover work already paid for: the **Lorenz curve** is computed in `scripts/agri/ingest.ts`
(25 points per scope), stored in every overview payload, and rendered **nowhere** — verified: the
only reference outside `types.ts` is a test fixture. `ConcentrationBar` deliberately does not use
it, because a Lorenz curve cannot separate the tiers on a linear axis inside a tile. On its own
page it can.

### 6.1 `agri_beneficiary` must gain a year dimension _(decided)_

Today it is an **all-time** matview and cannot serve a scoped page:

```
Materialized view "public.agri_beneficiary"
  eik | name | oblast | total_eur | name_fold
Indexes: idx_agri_beneficiary_eik UNIQUE · idx_agri_beneficiary_total (total_eur DESC)
         idx_agri_beneficiary_name_trgm · idx_agri_beneficiary_fold_trgm
```

`/subsidies/recipients` carries the hub's `?pscope` pill, so a full all-time table under it would
show one window and count another — precisely the `useScope({ years })` failure CLAUDE.md's URL
contract describes.

**Proposal — a second, scoped rollup rather than a reshape of this one.** Two consumers with two
different needs share this matview, and merging them breaks the cheaper one:

- **`agri_beneficiary` stays exactly as it is** — it backs `agri_beneficiary_search()`, the
  typeahead measured at 3 ms against 2 152 ms for the GROUP-BY form. Search must find a farm
  whatever year the reader has selected (§7: **scope ranks, it never filters**), and it is keyed
  `UNIQUE (eik)`, which a year dimension destroys.
- **Add `agri_beneficiary_year (scope_key, eik, name, oblast, total_eur, payment_count)`** to
  migration 046 or 159, one row per (scope × EIK), with `(scope_key, total_eur DESC, eik)` for
  the ranked page walk and `(scope_key, eik)` unique. `scope_key` uses the **same ten keys** as
  `agri_payloads` — `''`, `all`, and each financial year — so a scope that resolves for the hub
  resolves for the ranking, by construction.

Sizing: 8 years × ~9 000 entities + an all-time partition of 16 701 ≈ **90 k rows**. Trivial, and
it is the same shape `contractor_rank` (122) uses for the procurement leaderboard — a
`(scope_key × dimension)` rollup with an `'ALL'` sentinel — so the precedent, the index shape and
the refresh discipline all already exist in this codebase.

Refresh it in `scripts/agri/ingest.ts` (§5.2) alongside the hub cache, add it to whatever exhaustiveness list
covers it, and **`vacuumAfterReload()` it** — a bulk-rebuilt table with an empty visibility map
gives back the index-only scan the ranked walk exists for (CLAUDE.md's visibility-map section,
and `reload_visibility_map.data.test.ts` derives its file list from `scripts/db/load_*.ts`).

---

## 7. The finder

`SubsidiesSearchBox` already exists and is good — the repo's only server typeahead, reading
`agri_beneficiary` (3 ms vs 2 152 ms for the GROUP-BY form). Three changes:

- **Migrate to the shared `HubSearch` adapter** (`src/ux/search/HubSearch.tsx` +
  `hubSearchSources`) as a single `ServerSource`. Housekeeping, not a rewrite: it buys the shared
  combobox ARIA, keyboard nav and empty states, and it is what `/parliament` and
  `/governance/declarations` are on.
- **Scope ranks, it never filters** (skill §4). The search stays on the **all-time**
  `agri_beneficiary` — §6.1's whole point. „Вашата фирма не съществува" is a far worse answer
  than „вашата фирма няма плащания през 2025", and the destination scopes itself. If a scope
  group is ever added it must be **two independent sources with independent caps**, never one
  query partitioned afterwards.
- **Natural persons stay unsearchable and the hint keeps saying so** — they have no EIK and
  `/farm/:eik` is the only destination. `/subsidies/untraceable` is now where that fact has a
  home to link to, and the hint should link there.

---

## 7a. Where `/subsidies` belongs — the breadcrumb is the one surface that disagrees

Asked directly. The answer is not a judgement call: **three of the four placement surfaces already
treat `/subsidies` as a top-level money vertical, and the fourth names a parent that does not
contain it.**

| surface                                  | what it says today                                                                                                                                            | verdict                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/governance` hub, „Пари и разходи" band | a tile beside Държавен бюджет · Обществени поръчки · Европейски средства · Общински финанси · Държавни сектори                                                | ✓ correct — `governanceRegistry.ts`'s own comment calls it „a whole money vertical (/subsidies + /subsidies/browse + /farm/:eik)" |
| governance dropdown (`reportMenus.ts`)   | `agri_subsidies_nav → /subsidies`, listed between `/funds` and `/governance/sectors`                                                                          | ✓ correct — a peer, not a leaf                                                                                                    |
| `/governance/sectors` hub                | **does not list `/subsidies` at all** — verified, zero matches for `"/subsidies"` in `sectorRegistry.ts`; the agriculture tile there points at `/sector/agri` | ✓ correct, and it is _why_ the breadcrumb is wrong                                                                                |
| **breadcrumb on `/subsidies`**           | `Управление › Обществени поръчки › Държавни сектори › Земеделски субсидии`                                                                                    | ✗ **wrong in three ways**                                                                                                         |

### 7a.1 What the current trail gets wrong

1. **The parent does not contain the child.** Click „Държавни сектори" from `/subsidies` and you
   arrive at a hub with no subsidies tile. Its „Земеделие" tile goes to `/sector/agri` — ДФЗ's
   **procurement**, a different page about a different money lens. The trail is a dead end that
   looks like a hierarchy.
2. **„Обществени поръчки" is a false claim.** CAP subsidies are not procurement. §1.3 draws
   exactly this boundary — `/sector/agri` is the procurement lens, `/subsidies` is the payout
   lens — and the breadcrumb asserts the opposite on every page in the module.
3. **There is no slot for the hub level.** `SectorBreadcrumb`'s trail is fixed at
   `Управление › Обществени поръчки › Сектори › <current>`. A sub-page would render
   `… › Сектори › По област` and **lose the link back to `/subsidies` entirely** — fatal for a hub
   whose whole job is to front seven sub-pages.

`/subsidies` is the **only** `SectorBreadcrumb` consumer that is not on the sectors hub. Every
other one — `/water`, `/judiciary`, `/defense`, `/culture`, `/administration`, `/sector/:id`, and
the hub itself — is in `SECTORS`.

### 7a.2 The fix — `GovernanceBreadcrumb`, which every money-vertical peer already uses

```tsx
/budget    <GovernanceBreadcrumb sectionKey="budget_link_label" sectionTo="/budget" />
/funds     <GovernanceBreadcrumb sectionKey="funds_index_title" sectionTo="/funds" />
```

so:

```tsx
// the hub
<GovernanceBreadcrumb sectionKey="agri_subsidies_nav" sectionTo="/subsidies" className="mt-5" />
//   → Управление › Земеделски субсидии

// every sub-page
<GovernanceBreadcrumb sectionKey="agri_subsidies_nav" sectionTo="/subsidies"
                      currentKey="subsidies_places_nav" className="mt-5" />
//   → Управление › Земеделски субсидии › По област
```

`GovernanceBreadcrumb` renders `Управление › <section> › <sub-page>`, links the section only when
a leaf is present, and is described in its own header as the component "for the governance
sub-hubs … and their sub-pages". It is the shape this module needs and the one its peers use.

### 7a.3 Two pages in the module have NO breadcrumb at all

Verified: `/subsidies/browse` and `/farm/:eik` render none. Both gain one in the same step —
`/farm/:eik` with the resolved-label form (`current={farm name}`), like an awarder page, so a
reader can climb from one recipient back to the hub.

### 7a.4 What does NOT change

`/sector/agri` keeps `SectorBreadcrumb` — it genuinely is a sector on that hub. The two pages
stay separate and cross-link in prose; the hub's source footer names the boundary („собствените
обществени поръчки на фонда са на страницата на ДФ „Земеделие"), which the prerendered body
already does.

**No route moves and no redirect is needed.** This is a component swap plus two additions, and it
makes the breadcrumb agree with an information architecture the other three surfaces already have
right.

---

## 8. Every page ships three artifacts

`/subsidies` and `/subsidies/browse` already have all three. **The seven new pages need all three
each, in the same commit as the screen.** This is the §5 clustering failure: nobody forgets one
page, they forget a module.

1. **`staticPage({…})` in `scripts/prerender/routes.ts`** — real `bodyHtml`, no leading/trailing
   slash, **and the `english:` block**, or the EN mirror does not exist.
2. **BOTH sitemap lists** in `scripts/sitemap/route_defs.ts` — `routeDefs(year)` for the BG
   `<loc>` (with a `file:` that **exists on disk**; a typo skips the entry silently) and
   `ENGLISH_STATIC_PAGES` for `/en/<slug>`. Then **`npm run sitemap` and commit the XML**.
3. **An og card** via `scripts/og/capture-screens.ts` (not a `screenshot_*.ts` family script —
   those clip `{x:0,y:0}` and hide no chrome, so the card is the nav bar). One slug at a time:
   ```bash
   npx tsx scripts/og/capture-screens.ts subsidies-places
   ```
   `waitFor` must name something that exists only after data loads — put a `data-og="…"` on the
   target. `/subsidies/places` anchors on the rendered choropleth; the ranking pages take
   `anchor: "h1"` with `OG_CLIP_VIEWPORT=1200`. **Then `Read` the PNG** — a capture reports
   success on a screenshot of a skeleton.

The hub keeps `public/og/subsidies.png` but **must be re-shot**: the current card anchors on
`[data-og="subsidies-hero"]`, a KPI strip this rework removes. Set the capture's `viewport`
**below 1280** so the tile grid renders three full columns rather than slicing the fourth.

Band 3's four destinations are existing pages and need nothing here.

`scripts/prerender/ogAndSitemapCoverage.test.ts` gates all of it — **extend that file.**

---

### 8.1 ⚠️ The prerendered `bodyHtml` describes the page being deleted

`/subsidies`' `staticPage` body is a table of contents for the current screen —
„Накратко · Концентрация · По схема · По област · По година · Най-големи получатели" — every one
of which moves to a sub-page in this rework. Both the BG and the `english:` block. It is the only
part of the page a crawler that runs no JS ever sees, so leaving it is worse than a stub: it is a
confident description of content that is no longer there. **Rewrite it in the same commit as the
screen (step 7), not in the artifacts step.**

---

## 9. What a hub cannot fix — state it, do not smooth it

- **2014, 2018, 2019 and 2020 are absent at SOURCE.** The egov portal has no 2014/2018/2019
  sheets and serves **0 rows** for 2020. A hole in a public register, not a pipeline bug —
  `/subsidies/coverage` exists to say so. A „по година" chart with 8 bars and no gap invites the
  reader to conclude the money stopped.
- **Two provenances, one series.** 2015–2023 come from the egov portal (`scripts/agri/source.ts`),
  2024–2025 from the СЕУ register (`scripts/agri/seu_fetch.ts`). The individual share jumps from
  38.3% (2023, egov) to 48.7% (2024, СЕУ) — **that break sits exactly on the source change**, and
  this plan does not claim to know whether it is a real shift in CAP recipients or a difference
  in how the two registers classify a recipient without an EIK. Do not draw a trend line across
  it until someone checks.
- **481 scheme labels span two CAP periods and alias the same instrument.** „СЕПП" (2015–2022,
  €2.33bn) and „I.А.1-1 основно подпомагане на доходите за устойчивост" (2023+, €382.7m) are
  basic income support under two names. `/subsidies/schemes` needs a **period-aware fold in
  TypeScript** (the discipline `secondReadingStem` and `naceLabel` follow — never a SQL regex),
  or it groups by period first and says so.
- **„София (столица)" at €716.9m is second-largest and is a registered-seat artefact.** ДФЗ
  publishes the recipient's oblast, which for a company is where it is registered, not where the
  land is. Caption the choropleth „по област на получателя", never „къде отиват парите".
- **`/subsidies/political` reports a REGISTRY ROLE**, not ownership and not wrongdoing. 568 of
  16 701 is 3.4%; the honest sentence is „публична фигура заема вписана роля", the wording
  `/funds/political` and `place_mp_companies` already use.

---

## 9a. Revision record — the 2026-08-16 audit

A full pass against the codebase after the plan was drafted. Every finding is now folded into the
section it belongs to; this is the record of what changed and why, kept because the evidence is
the part that stops it recurring.

### 9a.1 Five defects, corrected in place

| #   | defect                                                                                                                                                                                                              | where                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | **`eik IS NULL` is not „физическо лице"** — €385.5m (8.8%) of the no-EIK money carries a legal-entity name, incl. Напоителни системи ЕАД €47.8m and Община Баните. The invented page's headline was false.          | §4.3 — page renamed and re-premised |
| 2   | **The refresh site was the wrong file.** `load_agri_pg.ts` is a 45-line wrapper around `runAgriIngest({offline:true})`; the actual `REFRESH MATERIALIZED VIEW agri_beneficiary` is at `scripts/agri/ingest.ts:744`. | §5.2, §6.1                          |
| 3   | **Political money was inflated ~1.8×** by a fanning `JOIN person_role`.                                                                                                                                             | §2.4                                |
| 4   | **`db:refresh` step numbers wrong** — `db:resolve:persons` is step 45 of 62, not 43 of 57 (CLAUDE.md's 57 is stale).                                                                                                | §5.2, §13.2                         |
| 5   | **The breadcrumb names a parent that does not contain the page** — `/subsidies` is not in `SECTORS` (0 matches), yet its trail runs through `Обществени поръчки › Държавни сектори`.                                | §7a — full analysis                 |

### 9a.2 Work items that were simply absent

Each is now a step in §11 or a gate in §10.

- **Three existing test files are in the blast radius:**
  `src/screens/SubsidiesDashboardScreen.test.tsx` (tests the 638-line screen this rework replaces —
  it must be split to follow its content, not deleted), `src/data/agri/useAgriOverview.test.tsx`,
  `src/data/agri/constants.test.ts`.
- **`AGRI_FINANCIAL_YEARS` is a hand-maintained client constant with no gate.** Verified it matches
  the database today exactly (`agri_payloads` overview keys = `'' , 2015, 2016, 2017, 2021, 2022,
2023, 2024, 2025, all`). Nothing keeps it that way: a new financial year reaches PG and the
  picker does not offer it, silently. Add the gate — it is one query and it protects §6.1's
  `scope_key` contract too.
- **`/subsidies/browse`'s `?scheme=` and `?oblast=` deep links are not in CLAUDE.md's URL
  contract**, and `/subsidies/schemes` + `/subsidies/places` become their new minters. Add them
  when the pages land.
- **Decimal-comma formatting.** `/funds`' `tileMetric` carries a documented trap: a template
  literal renders „53.8%" whatever the page language is. Every percentage on this hub goes through
  `Intl.NumberFormat`, never a `${…}%`.
- **The subsidies module is absent from the LLM corpus.** `scripts/llms/buildIndex.ts` and
  `buildFull.ts` contain zero references to `/subsidies` or `/farm`. Pre-existing, and seven new
  pages would inherit it — worth closing while the module is open.

### 9a.3 Checked and found sound (no action)

- **`ai/tools/subsidies.ts` needs no change.** It reads the same `agri-payload` blobs
  (`overview` / `recipient`) the pages do, so the hub rework is invisible to it. `agri_beneficiary_year`
  (§6.1) would additionally let it answer scoped recipient questions it currently cannot.
- `/subsidies` and `/subsidies/browse` have all three artifacts (staticPage + both sitemap lists +
  a captured og file).
- All four band-3 destinations are routed (`/budget/municipal`, `/culture`, `/budget/simulator`,
  `/sector/transport` via `sector/:id`).
- No `preloadData` is needed — the hub's data comes from `/api/db`, not a data file.
- `agri_subsidies` is already in `sync_cloud.ts`'s `CRITICAL_TABLES`; the derived rollups do not
  need to be.

---

## 10. Gates to write

Modelled on `src/screens/funds/fundsHubRegistry.test.ts` + `fundsHubCoverage.test.ts`.

| gate                                                                                                                          | catches                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| every tile id has a scene in `SUBSIDIES_SCENES`, and no scene is orphaned                                                     | `InfographicTile` renders `<Scene/>` unguarded → "Element type is invalid", a **white page**                                                     |
| every `to` is absolute AND in a `ROUTED` list of **literals** — including the four cross-module ones                          | dead links; a deleted route breaks loudly                                                                                                        |
| **no band-3 `to` is a fragment** (`#…`)                                                                                       | the `/funds` `#top-beneficiaries` class — a card that silently does nothing                                                                      |
| every routed `/subsidies/*` page is a hub destination                                                                         | orphans                                                                                                                                          |
| no accent used twice on this page                                                                                             | „these two tiles are the same kind of thing"                                                                                                     |
| every tile figure recomputed **from its declared basis**, with the rejected alternatives asserted as explicit `notEqual`s     | the six-of-six class — top-100 over entity money ≠ over total; political via the canonical gate ≠ via `company_politicians` (11) ≠ via 082 (504) |
| the hub's figures equal the DESTINATION's own                                                                                 | a tile announcing a number its destination disagrees with                                                                                        |
| **the hub's `all` ≠ `sector_stats.json`'s `all.agri`**, asserted deliberately                                                 | §2.5 — the same word meaning two things, accidentally reconciled                                                                                 |
| **band-3 figures are read from their sources, not literals** — assert each against its table/artifact                         | a constant that goes stale at a 200 the next time `update-budget` runs                                                                           |
| a scoped key produces scoped figures; an uncovered key produces **absent**, not `0`                                           | the corpus total under a „Последна година" pill                                                                                                  |
| **`agri_beneficiary_year`'s `scope_key` set == `agri_payloads(kind='overview')`'s key set**                                   | a scope the hub resolves and the ranking cannot serve                                                                                            |
| `agri_beneficiary` keeps its `UNIQUE (eik)` and no year column                                                                | the search silently becoming scope-filtered (§7)                                                                                                 |
| every new file in `src/screens/subsidies/` is imported                                                                        | the half-finished move that leaves sediment                                                                                                      |
| the hub does **not** fetch `regions_map.json`                                                                                 | the whole point of the change, undone by a future tile                                                                                           |
| every new page has `staticPage` + BOTH sitemap lists + an `ogImage` that resolves to a file                                   | §8 — all four have shipped broken separately                                                                                                     |
| **no band-3 destination renders a scope pill it cannot serve** (§3.1)                                                         | `?pscope=y:2016` landing on `/budget/municipal`, whose corpus starts 2018                                                                        |
| **`AGRI_FINANCIAL_YEARS` == the `agri_payloads` overview year keys**                                                          | a new financial year in PG that the picker never offers                                                                                          |
| **no money label says „физически лица"** where the basis is `eik IS NULL` (§4.3)                                              | €385.5m of named companies published as individuals                                                                                              |
| **`/subsidies`' prerendered `bodyHtml` names no section that has moved** (§8.1)                                               | a crawler reading a table of contents for a deleted page                                                                                         |
| every page in the module uses `GovernanceBreadcrumb` with `sectionTo="/subsidies"`, and none imports `SectorBreadcrumb` (§7a) | sub-pages with no link back to the hub; a trail whose parent does not contain the child                                                          |

**Then break each clause and watch it fire.** The skill records two gates in this codebase that
read as real tests and were vacuous — one asserting `max(id) >= count(*)` (true of any gap-free
sequence, i.e. the symptom it named), one matching a `timeZone: "UTC"` string inside the comment
explaining the fix.

**And a figure gate must assert against something the generator does not use.** Re-running the
cache's own SQL and comparing it to the cache's own output proves only that the matview was
refreshed. Assert against `agri_payloads`, against the destination screen's own filter, and
against the raw `agri_subsidies` aggregate.

---

## 11. Steps

Each ends with `/code-review` in a subagent, then `/code-repair`, then a commit of only that
step's files. The pattern's history is 2–5 real defects per step and the rate does not fall.

| #   | step                                                                                                                                                                                                                                                                                                 | ships                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 0   | **Measurement** — re-run §2 against the corpus and write the table into the migration header                                                                                                                                                                                                         | no code                        |
| 1   | **`agri_beneficiary_year`** (§6.1) + its refresh + `vacuumAfterReload`                                                                                                                                                                                                                               | the scoped rollup              |
| 2   | **Migration `159_agri_hub_stats.sql`** + `/api/db/agri-hub-stats` + the `db:load:agri:pg` refresh + `ORDER_PAIRS` + the cycle note (§5.2)                                                                                                                                                            | the blob                       |
| 3   | **`/subsidies/places`** — the choropleth moves off the hub                                                                                                                                                                                                                                           | **−407 KB**, the immediate win |
| 4   | **`/subsidies/recipients`, `/subsidies/schemes`, `/subsidies/concentration`** — the inline analyses become pages (Lorenz rendered at last)                                                                                                                                                           | 3 pages                        |
| 5   | **`/subsidies/untraceable`, `/subsidies/coverage`** — the two honesty pages                                                                                                                                                                                                                          | 2 pages                        |
| 6   | **`/subsidies/political`, `/subsidies/cross-programme`** — on the canonical §2.4 gate                                                                                                                                                                                                                | 2 pages                        |
| 6b  | **Breadcrumb switch** (§7a) — hub + all sub-pages onto `GovernanceBreadcrumb`; `/subsidies/browse` and `/farm/:eik` gain one                                                                                                                                                                         | navigation                     |
| 6c  | **The `?pscope` decision for band 3** (§3.1) — resolve the scope on the four destinations, or add the opt-out prop                                                                                                                                                                                   | the leak closed                |
| 7   | **The registry + scenes + hub screen** — `subsidiesRegistry.ts`, `subsidiesScenes.tsx`, `SubsidiesDashboardScreen` rewritten as composition; `browseTo()` retired for `usePreserveParams`; **band 3 wired to its four sources**; **the prerendered `bodyHtml` rewritten in this same commit** (§8.1) | the hub                        |
| 7b  | **Test migration** — `SubsidiesDashboardScreen.test.tsx` split to follow its content onto the sub-pages, not deleted (§9a.2)                                                                                                                                                                         | the suite                      |
| 8   | **i18n** — ~40 keys × 2 languages, replacing the 32 inline ternaries. **BG written as BG**, not as a translation of the EN sibling (skill §6, `feedback_bg_language`)                                                                                                                                | the copy                       |
| 9   | **`HubSearch` migration** for `SubsidiesSearchBox`                                                                                                                                                                                                                                                   | the finder                     |
| 10  | **Three artifacts × 8 pages** + re-shoot `subsidies.png` + `npm run sitemap` + commit the XML                                                                                                                                                                                                        | crawlability                   |
| 11  | **Gates** (§10), then break each clause                                                                                                                                                                                                                                                              | the gates                      |

Steps 3–6 are independently shippable and each is a real improvement alone; step 7 is what makes
them reachable.

---

## 12. Shipping order

Hosting last. The two manual `public/` writers come **first** — `vite build` copies `public/`
into `dist/`, so running them after the build ships one deploy late.

```bash
npm run dev                                        # 0. another shell, for the captures
npx tsx scripts/og/capture-screens.ts <one-slug>   # 1. ×8, one slug per invocation
npm run sitemap                                    # 2. rewrites public/sitemap*.xml — COMMIT it
npm run db:load:agri:pg:cloud                      # 3. applies 159 + fills agri_beneficiary_year
npm run deploy:db                                  # 4. the /api/db/agri-hub-stats route
npm run build                                      # 5. prerender + og cards + png→webp
npm run deploy                                     # 6. hosting
```

No `bucket:sync` step — this module is Postgres-only. Step 3 **before** step 4: the route degrades
a missing migration, so the ordering is cosmetic rather than breaking, but a premature deploy
reads as „no data" indefinitely with nothing in the logs.

`npm run deploy` does **not** build.

---

## 13. Open decisions

Five of the original questions are settled above: `/subsidies` stays the ДФЗ hub with a
cross-stream band (§1.4), the duplication audit is §2.5, `/subsidies/untraceable` is a named page
(§4.2), `agri_beneficiary` gains a scoped twin (§6.1), and party subsidies are in as band-3 tile
11 (§4.1). What remains:

### 13.1 The 082 question — and it is NOT a reconciliation

The word „reconcile" was wrong in the first draft. Reading `082_person_api.sql` shows the
divergence is **deliberate, documented and internally consistent**:

| block in 082                                         | predicate                                                  | rendered as                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `'companies'`                                        | `person_role source = 'tr'`                                | business interests, **with** `procuredEur` · `fundsEur` · `subsidiesEur` columns |
| `'ngos'`                                             | `person_role source = 'ngo'`                               | civic board seats, **in their own section, no money columns**                    |
| `procuredEur` · `fundsEur` · `subsidiesEur` roll-ups | `source = 'tr'`, commented `-- match the companies filter` | one figure per stream, business-only                                             |

The file states the position in a comment: _"a civic board seat, not a business interest, so it
renders in its own section (no procurement column)"_. `person_link_n` / 151 uses `tr`+`ngo`
because it answers a **different** question — _is a public figure attached to this entity at all_
— a countable link, not a money attribution. Both are right for what they ask.

**So the real decision is narrower: should an NGO board seat carry a MONEY attribution when the
money is CAP subsidies?**

**What the gap actually contains.** The 64 entities, €14 373 725, classified by `tr_companies.legal_form`:

| legal form          | n      | money       |
| ------------------- | ------ | ----------- |
| ASSOC + „Сдружение" | **60** | **€13.65m** |
| CC (читалище)       | 2      | €0.71m      |
| FOUND (фондация)    | 2      | €0.02m      |

The largest by money: Национален съюз на градинарите (€1.57m), Асоциация на земеделските
производители (€0.77m), **СДРУЖЕНИЕ МИГ ТУНДЖА** (€0.72m), СМИГ Лясковец–Стражица (€0.68m),
Регионална лозаро-винарска камара (€0.64m), **СНЦ МИГ САМОКОВ** (€0.55m), Сдружение МИГ
Елхово-Болярово (€0.53m), НЧ Пробуда 1914 (€0.47m).

That is not incidental civic activity. **МИГ — местни инициативни групи, the LEADER Local Action
Groups — are constituted as сдружения and are the statutory delivery vehicle for ЕЗФРСР
rural-development money.** Branch producer associations are the other half. An association here
is receiving CAP money _as a CAP beneficiary_, which is a money fact by any reading.

#### **+** for widening 082

- **One number for one question.** A reader clicking `/subsidies/political` → `/person/:slug`
  currently sees €184.4m-basis on one page and €170.0m-basis on the other.
- **For CAP specifically the NGO arm is substantive**, not noise — see the МИГ finding above.
- **It aligns 082 with the predicate three shipped surfaces already agree on** (`person_link_n`,
  `place_mp_companies`, and the governance „фирми, регистрирани тук" tile).

#### **−** against

- **Widening only the subsidies arm breaks 082's internal consistency**, which is worse than the
  cross-page one it fixes. `subsidiesEur` would count NGOs while `procuredEur` and `fundsEur`
  beside it would not, so three figures on one profile card would carry three denominators — the
  exact defect class this plan exists to avoid, moved one page over.
- **Widening all three is a much larger, riskier change.** It puts a public-contract figure
  against a читалище board seat — attributing procurement money to somebody for sitting on a
  community-centre board. That is a reputational claim, not an arithmetic one, and `/person` is
  the page where the repo is most careful about exactly that (`feedback_name_match_not_identity`,
  the `linkBasis` / „не е потвърдена самоличност" caveats a few lines above in the same file).
- **It silently moves a shipped number on ~56k profiles.** A function-body change is the
  "applied, never loaded" class: invisible to every row count, no loader reports it, and local
  and prod diverge until someone runs `apply_functions.ts`.
- **The information is not hidden today, only unpriced.** The profile already lists the NGO seats
  in their own section; what is missing is a money column there, not a wider rollup.

#### Recommendation: change nothing in 082 — split the arm on `/subsidies/political`

- The page's **headline is the canonical 568 / €184.4m**, matching `person_link_n` and 151, i.e.
  what a governance place page already shows for the same link set.
- The table **splits into „чрез фирма" (504 / €170.0m) and „чрез сдружение, читалище или
  фондация" (64 / €14.4m)** — which is the honest structure of the finding anyway. An МИГ is a
  different kind of link from an ЕООД, and a reader needs to see which one they are looking at.
- `/person/:slug` keeps `subsidiesEur` as the **business-interest** figure. The natural follow-up,
  if wanted later, is a subsidies line inside the profile's existing `'ngos'` section — additive,
  correctly labelled, and it touches no existing rollup.
- Two numbers survive, but **two numbers with two labels**, which is the skill's rule („never one
  number wearing both"). One number with an ambiguous basis is the thing to avoid, not two.

**Gate it:** `/subsidies/political`'s split must satisfy `чрез фирма + чрез сдружение == the
headline`, and the „чрез фирма" figure must equal what `082` returns for the same person set —
so the split cannot silently drift from the profile it links to.

### 13.2 Where the cache refresh sits relative to `db:resolve:persons`

§5.2's cycle: `db:load:agri:pg` is `db:refresh` step 14, `db:resolve:persons` is step 45, so the
political arm builds from the previous run's person layer. Either re-run the loader after the
person chain, or give the cache refresh its own late step.

### 13.3 `/financing/subsidy` — the party tile's proper destination

Band-3 tile 11 points at `/budget/simulator` because that is the only page in the repo that
renders the ЗПП figure (§4.1). The per-party breakdown is derivable from data already held —
party-list valid votes × €3.00 for the ten formations over 1% — so a small register page would
make the €9.31m nameable per party and give the tile a destination that answers „кой колко
получава". Out of scope here.
