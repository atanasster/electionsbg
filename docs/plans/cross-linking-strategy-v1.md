# Cross-linking strategy v1 — turning 20 verticals into one linked corpus

Status: **brainstorm / strategy**, not an implementation plan. Drafted 2026-08-02.

---

## 1. What we actually hold

Measured from local Postgres + `data/` + `data/data_map.json` on 2026-08-02.

| Spine | Scale |
|---|---|
| Companies (ТР) | 1,019,983 companies · 773,141 officers · 1,207,251 person-roles |
| Persons (resolved) | 118,396 persons · 283,888 roles across **17 role sources** · 76,521 aliases |
| Procurement | 456,041 contracts (2000→2029 signed dates) · 232,726 tenders · 31,745 annexes |
| EU funds | 81,910 projects · 46,152 beneficiaries |
| Prices | 1,398,414 current store-prices · 629,165 product-days · 121,689 products · 6,223 stores |
| Graph | 162,156 edges · 70,025 company nodes · 68,902 person nodes |
| Declarations | 49,201 filings · 259,565 assets · 107,826 obligations |
| Places | 5,720 in `place_dim` · elections down to section for 80+ cycles since 2005 |

`person_role.source` distribution — this is the identity moat in one table:

```
tr 153,570 · candidate 67,065 · local 27,703 · official_exec 8,735 · ngo 8,099
official_muni 6,391 · public_sector 5,533 · magistrate 3,113 · mp 2,122
donor 1,283 · diplomat 189 · mep 34 · regulator 32 · ds 12 · president 6 · sanctions 1
```

### The structural finding

`data/data_map.json` has 97 nodes and 161 edges. Every single edge is either
`source → dataset` (65) or `dataset → feature` (96).

**There are zero dataset↔dataset and zero feature↔feature edges.**

The corpus is a star topology: 40 sources fan into 33 datasets which fan into 26 features.
Each vertical is complete and each is a silo. The joins that exist in the product
(`person → company → contract`, my-area) were built one at a time inside a feature, and are
invisible at the map level. We are shipping 26 good single-subject sites, not one linked corpus.

### The five join keys that already exist and are under-used

1. **`person_id`** — 17 role sources on one identity. Nothing else in BG has this.
2. **`eik`** — contractor ∪ fund beneficiary ∪ farm subsidy ∪ hospital ∪ school ∪ retail chain
   ∪ NGO ∪ awarder ∪ film producer ∪ water operator.
3. **`ekatte` / obshtina / oblast** — elections (to section) ∪ prices ∪ procurement seats ∪
   schools ∪ GRAO ∪ demographics ∪ local taxes ∪ air ∪ indicators.
4. **time / cabinet** — `cabinetAnchorContext` already exists but only binds `/governments*`
   and `/indicators*`. Every money and outcome series has a date.
5. **party** — candidate ∪ MP ∪ councillor ∪ mayor ∪ donor ∪ (via person) company officer.

Every idea below is an exploitation of one of those five keys. None requires a new source.

---

## 2. Competitive review

### Bulgaria

| Who | What they have | What they cannot do |
|---|---|---|
| **SIGMA** (sigma.midt.bg, МИДТ, state) | 193k contracts, €51.4bn, **2022–2026**, 4,440 institutions, 17,449 companies. Daily АОП refresh, open source, search by institution / company / contract. AI risk detection announced but **not shipped** (v1 is aggregation only). | Procurement only. No person layer, no elections, no places, no prices, no outcomes. Our corpus is 456k contracts back to 2000 — **2.4× the rows and 22 extra years** — plus annexes/current value, which they do not model at all. State-run, so it will never publish a political-attribution view. |
| **BIRD Public Money Scanner** (scan.bird.bg) | The closest thing to `/connections`: PEP ↔ public spending, company + property registers, BG and foreign. Investigative-grade. | A journalist's lookup tool, not a public data product. No elections, no place layer, no prices, no outcomes, no time series. Narrow entry point (you must already know the name). |
| **ИПИ** — 265obshtini.bg + regionalprofiles.bg | 32 indicators × 265 municipalities; 28 oblasts across economy, labour, education, health, security, environment, culture, tourism. Best-in-class regional indicators, strong brand. | Indicators only — **no money flow, no person layer, no company layer**, annual cadence, no drill below municipality. Cannot answer "who got the money here". |
| **Диагноза България** | Health-system audit. | One sector. |
| **Биволъ / АКФ / Свободна Европа** | Investigations. | Narrative, not queryable. They are potential *consumers* of our API, not competitors. |
| **data.egov.bg** | Raw portal. | Raw. |

### International reference points

| Who | Model worth stealing |
|---|---|
| **YouControl** (UA) | The gold standard company dossier: 50 state sources per company, affiliation-graph visualization, change monitoring/alerts. Our `/company/:eik` should aim here. |
| **OpenTender.eu** / Government Transparency Institute | Comparable procurement **risk indicators** across 35 jurisdictions. We already have per-contract risk grades — the missing move is *EU-comparability*. |
| **TI Integrity Watch** | Declarations + lobbying across EU, one interface per country. |
| **znasichdani.sk / foaf.sk** (SK) | "Who stands behind the company that got the contract" as a mass-market consumer product, not a journalist tool. |

### Positioning conclusion

Nobody — in Bulgaria, and on this evidence nobody in the region — holds
**elections + public money + resolved person identity + retail prices + place indicators**
on one spine. Each competitor owns one column of our matrix. Our defensible product is not
"better procurement search" (SIGMA will grind at that with state data access); it is
**the joins nobody else can compute.**

---

## 3. Linkage ideas, by spine

Feasibility legend: **A** = joins already live in PG, aggregation only · **B** = needs a new
derived table/matview · **C** = needs new ingest or methodology work.

### Spine 1 — place (`ekatte` / obshtina): *"what did my place vote, and what did it get?"*

**1.1 Political geography of public money** — **A/B**
Mayor's party (`/local/:cycle/mayors-by-party`) × per-capita public money into that
municipality (procurement seated there + state transfers from `data/budget/municipal_transfers`
+ EU funds by Местонахождение + farm subsidies). Both sides are already in the corpus.
The output is one map and one table: *does a municipality's partisan alignment with the
governing coalition predict the money it receives, per capita, per cabinet?*
No competitor holds both sides. This is the single highest-impact linkage we can build.

**1.2 The pre-election spending spike** — **A/C**
Contracts signed in the N days before each election, per buyer, vs that buyer's own baseline.
I ran the national probe (60-day pre-window vs the trailing 365-day daily mean):

```
2021-04-04  ratio 3.60      2023-04-02  ratio 0.97
2021-07-11  ratio 2.52      2024-06-09  ratio 1.36
2021-11-14  ratio 1.15      2024-10-27  ratio 1.06
2022-10-02  ratio 1.15      2026-04-19  ratio 0.75
```

The join works and the query is cheap. **The raw ratios are confounded** — the corpus's
own coverage ramps steeply over 2020–2022, which is almost certainly what the 3.6× and 2.5×
are. Publishing this needs a within-buyer, seasonally-controlled design (each buyer as its own
control, month-of-year fixed effects, coverage-normalised). That makes it a real analysis
project rather than a chart — and a defensible one, because the methodology page becomes the
moat. Do not ship the naive ratio.

**1.3 Settlement reality card** — **B**
~5,000 pages, one per settlement: population trend (GRAO) · turnout and vote history ·
public money received · subsidies · nearest school and its ДЗИ/НВО · price basket ·
air · local taxes. Every one of those is already keyed by ekatte. Also the largest SEO
surface we can mint from data we hold, and it directly attacks the discovery gap noted in
`project_seo_discovery_gap`.

**1.4 Cost of living vs income, by place** — **B**
Price basket per settlement ÷ (oblast average pension from НОИ, oblast wage). Output:
"how many days of the average local pension does the monthly basket cost, here vs
Sofia vs the EU". Mass-appeal, apolitical, highly shareable, and **completely
uncopyable** — nobody else has per-settlement prices.

**1.5 Service-desert index** — **B**
Settlement population trend × school closure × hospital distance × admin service
availability × rail/bus. "Where the state has withdrawn." Pairs naturally with 1.3.

### Spine 2 — person (`person_id`): *"who moved between the state and the money?"*

**2.1 Revolving-door detector** — **B**
`person_role` carries an institution for the exec/muni/magistrate tiers; `contracts` carries
an awarder EIK; `company_politicians` carries the person↔company link. Order them in time:
*person held a role at buyer B until date D, then joined company C, which then won contracts
from buyer B.* Fully computable today. This is the flagship finding-generator and nothing in
BG does it.

**2.2 Wealth growth vs public money won** — **A/B**
Migration 092 already computes the accumulation gap (declared wealth delta vs declared
income). Cross it with whether the person's linked companies won public money in the same
year. Ranked, per year, per tier.

**2.3 Follow the donation** — **B**
donor (ЕРИК, 1,283 roles) → party → cabinet → ministry → contract. A four-hop chain that is
already fully materialised in separate tables. Render it as one path, not four pages.

**2.4 The career ribbon** — **A**
One horizontal timeline on `/person/:slug` showing every role from all 17 sources plus
declaration filings, election candidacies, and company appointments on the same axis. This
is presentation-only over data we already serve, and it is the single best demonstration
that our identity layer exists.

**2.5 Two-hop exposure** — **B**
Anyone within 2 hops of an OFAC/EU-sanctioned person or a ДС affiliation, via co-ownership.
Registers are already ingested (`sanctions`, `ds` role sources) but tiny (1 and 12 roles) —
the value is the graph traversal, not the register size.

### Spine 3 — company (`eik`): *"how much public money, from all taps?"*

**3.1 Total public money, all corpora** — **B**
`company_public_money` (migration 127) already unions contracts ∪ subsidies ∪ funds.
Add НЗОК hospital payments, culture/НФЦ, and the excise/water/transport packs →
**"Топ 100 получатели на публични пари, всички източници."** One leaderboard, one number
per company, drill to each tap. Dual-corpus (077) proved the pattern; this generalises it.
Nobody in BG publishes a cross-corpus total.

**3.2 Concentration as a universal lens** — **A/B**
HHI is computed today in several places independently. Put every market the state pays for
on one comparable page: procurement by CPV, textbook publishers, retail chains, drug
suppliers by INN, film producers, hospital payments, farm subsidies, rail. *"Which of the
markets the state funds are actually competitive?"* Cheap — the inputs all exist — and
strikingly distinctive.

**3.3 The company dossier, YouControl-grade** — **B**
`/company/:eik` today = procurement + funds + officers + annexes. Add: founding date,
ГФО revenue where filed, political links, subsidies, НЗОК, NGO board links, sanctions
proximity, appeal history (КЗК), debarment. One page that answers "should I be worried
about this counterparty".

### Spine 4 — time / cabinet: *"what changed under each government?"*

**4.1 Universal cabinet scorecard** — **B**
`cabinetAnchorContext` already exists but only binds two route groups. Extend the anchor to
**every** vertical and generate one comparable object per government: procurement volume and
single-source share · budget execution vs plan · inflation and basket · hospital and court
delay · road deaths · subsidies · administration headcount · EU absorption. This is the
cheapest way to make 20 verticals feel like one product, and it converts our breadth from a
navigation problem into the actual selling point.

**4.2 Promised vs spent** — **B**
Приложение III investment programme (per-project allocations, already ingested) vs contracts
actually signed for those projects. Per cabinet, per ministry, per project.

### Spine 5 — product / retention

**5.1 Build your own basket → your personal inflation** — **B**
Pick 20 products from the 121,689-product catalogue → your CPI vs the official one vs your
oblast. Best mass-market hook we have; connects `prices` to `macro`, two verticals that
currently never touch.

**5.2 Alerts on anything** — **B**
A `/following` route already exists. Make it universal: alert when a watched company wins a
contract, a watched municipality signs one over €X, a watched person files a declaration or
changes role, a watched product's price moves. This is what turns a reference site into a
returning-user product, and it is the YouControl monitoring model.

**5.3 Cross-dataset AI answers with citations** — **A**
~155 tools already exist. The differentiated behaviour is not more tools — it is answers that
*span* datasets ("did the villages that flipped to X get more money?") with a per-number
citation and a generated shareable card.

### Spine 0 — the cheap structural fix

**0.1 Give `/data/map` lateral edges** — **A**
Add `dataset ↔ dataset` edges keyed by the actual join column (`person_id`, `eik`, `ekatte`,
`date`, `party`). Today the map *proves* we are a silo. A handful of edges plus a
"joined by" label makes the map itself the argument for the whole product — and it is a
generator change, not a new dataset.

---

## 4. Ranked shortlist

Ranked on (uniqueness vs competitors) × (impact) ÷ (effort), given everything is already in PG.

| # | Idea | Spine | Why it wins |
|---|---|---|---|
| 1 | **Political geography of public money** (1.1) | place × party | Both sides in the corpus; nobody else has either pair. Defines the site. |
| 2 | **Total public money, all corpora** (3.1) | eik | Extends 127; one leaderboard nobody in BG can publish. |
| 3 | **Revolving-door detector** (2.1) | person | Pure finding-generator; the identity layer's payoff. |
| 4 | **Universal cabinet scorecard** (4.1) | time | Makes 20 verticals one product; anchor already exists. |
| 5 | **Settlement reality card** (1.3) | place | 5,000 unique pages; directly attacks the SEO discovery gap. |
| 6 | **Build-your-own basket** (5.1) | prices | Mass-market retention hook, apolitical, uncopyable. |

Deliberately parked: **1.2 (pre-election spike)** — highest headline value of anything here,
but it must not ship before the coverage/seasonality controls exist. The naive ratio is
wrong and would be the first thing a critic attacks.

Cheapest first move: **0.1**, half a day, and it reframes the whole site.
