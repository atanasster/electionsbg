# Cross-linking strategy v2 — one corpus, one spine, one product

Status: **brainstorm / strategy**, not an implementation plan. Drafted 2026-08-18.
Follows [cross-linking-strategy-v1.md](cross-linking-strategy-v1.md) (2026-08-02), whose
structural finding still holds — this plan re-verifies it against the grown corpus, refreshes
the competitive set, and adds a second wave of linkage ideas aimed at the verticals that have
landed since v1 (outcome series, the consumption hub, roll-call votes, the sector packs).

---

## 1. What we actually hold (2026-08-18)

| Spine | Scale | Note |
|---|---|---|
| Sources → datasets → features | 41 sources · 34 datasets · 26 features (101 nodes, 167 edges) | `data/data_map.json` |
| Companies (ТР) | ~1.02M companies · 773k officers · 1.2M person-roles | Trade Register |
| Persons (resolved) | ~118k persons · 284k roles across **17 role sources** · 76.5k aliases | the identity spine |
| Procurement | 456k contracts (2000→2029) · 233k tenders · 31.7k annexes | + per-contract risk grade |
| EU funds | 81.9k projects · 46.2k beneficiaries | per-place geolocation |
| Farm subsidies | €11bn · 2.5M payment rows · 16.7k legal entities | EIK-keyed |
| Retail prices | 1.4M store-prices · 121k products · 6.2k stores | КЗП, since the euro |
| Roll-call votes | 16,741 items · 4.0M casts | 45th–51st NA |
| Declarations | 49.2k filings · 259.6k assets · 107.8k obligations | MPs + officials + magistrates |
| Graph | 162k edges · 70k company nodes · 68.9k person nodes | being rebuilt as `graph_*` PG tables |
| Places | 5,720 settlements (`place_dim`) | elections to section for 80+ cycles since 2005 |

**New since v1 (the reason for a v2):** the corpus stopped being "money only" and gained an
**outcome half**. Sector packs now pair spend with a measured result — air (PM10/PM2.5), road
deaths, poverty-reduction, matura value-added, court workload, НЗОК hospital payments, recycling
rates, rail subsidy per passenger, e-government uptake. That is the one asset class the v1
linkage list barely touched, and it is the cheapest high-impact linking surface left: **the
money↔outcome join requires no new ingest anywhere — both sides are already keyed by place and
date.**

## 2. The structural finding (unchanged, now partially addressed)

v1: every `data_map.json` edge is `source→dataset` or `dataset→feature`. **Zero dataset↔dataset
edges.** The corpus is a star topology; each vertical is a complete silo and the joins live
inside features, invisible at the map level.

Status since v1:

- The **lateral-edges plan** (`data-hub-lateral-edges-v1.md`, research, not yet implemented)
  specifies `dataset↔dataset` links keyed by join column, measured overlap, a `links` manifest
  array separate from the ELK layout, and a `links` lens on `/data`. Still open.
- The **graph engine** (`connections-engine-v1.md`) — `graph_person_node` / `graph_company_node`
  / `graph_edge` + `company_public_money` (contracts ∪ subsidies ∪ funds) — is the real lateral
  layer under construction. It links person↔company on co-ownership and procurement, with money
  on company nodes. This is the substrate most ideas below build on.
- **v1's ranked shortlist is still almost entirely open** (measured 2026-08-18): revolving-door
  detector (0 hits), total-public-money leaderboard (0), political geography of money (0),
  universal cabinet scorecard (only the indicators `CabinetScoreRow`). Shipped since v1:
  `/consumption/basket` (5.1), `/following` (5.2), the sector packs, the graph engine, person
  contracts browser, subsidies cross-programme map.

### The join keys (five from v1, three added)

1. **`person_id`** — 17 role sources on one identity. Nothing else in BG has this.
2. **`eik`/Bulstat** — contractor ∪ fund beneficiary ∪ subsidy ∪ hospital ∪ school ∪ retail
   chain ∪ NGO ∪ awarder ∪ film producer ∪ water operator.
3. **`ekatte` / obshtina / oblast** — elections (to section) ∪ prices ∪ procurement seats ∪
   schools ∪ GRAO ∪ demographics ∪ local taxes ∪ air ∪ indicators.
4. **time / cabinet** — `cabinetAnchorContext` exists but only binds `/governments*` and
   `/indicators*`. Every money and outcome series has a date.
5. **party** — candidate ∪ MP ∪ councillor ∪ mayor ∪ donor ∪ (via person) company officer.
6. **`procedure` / `programme`** *(new, from the lateral-edges plan)* — `open_calls.code` ×
   `fund_fit.procedure_code`; `open_calls.programme_code` × `fund_projects.program_code`.
7. **`person_key`** *(new)* — the Registry Agency's own TR person key; a stronger identity claim
   than our bridged `person_id`, restricted to TR↔TR joins.
8. **CPV division / КИД-2008** *(implicit everywhere)* — the classification that lets "spend by
   function" cross every sector pack with the same vocabulary.

Every idea below is an exploitation of one of those keys, and **none requires a new source**.

---

## 3. Competitive review

The full, citation-backed sweep is [competitive-review-2026.md](../../competitive-review-2026.md)
(research snapshot Aug 2026, ~20 platforms). This section carries the condensed table and the
four moves worth adopting; v1's table is the base.

### Bulgaria

| Who | What they have | What they cannot do |
|---|---|---|
| **SIGMA** (sigma.midt.bg, МИДТ, state) | Launched **16 Jun 2026**: open-source register, ~193k contracts / >€51bn / 4,400 institutions / 17k companies, six years, built in a month. **No risk detection shipped yet** — Phase 2 (ownership links) and Phase 3 (preferential-treatment alerts) are still roadmap; a separate AI tool was presented to the Council of Ministers. | Procurement only; no person layer, no elections, no places, no prices, no outcomes. Our corpus is 456k contracts back to 2000 (2.4× rows, +22 years) plus annexes. As a state platform it is unlikely to ship a political-attribution view. Same procurement + company ground as ours, open-source, with the ownership-link and detection phases still roadmap. |
| **AI MIRROR (Nik Ray)** | Independent AI procurement-analysis tool; SIGMA's AI was publicly accused of copying it. | Same vertical as SIGMA — procurement only, and a single-creator effort vs our corpus. |
| **Odis (INSAIT + Сметна палата)** | BgGPT-powered AI assistant for procurement auditors on EOP data; cuts a 4-day audit to ~1 day. | Internal tool, not public — but legitimizes AI-on-procurement in BG. |
| **BIRD Public Money Scanner** (scan.bird.bg) | PEP ↔ public spending, company + property registers; investigative-grade. | A journalist's lookup, not a public data product; no elections/place/prices/outcomes/time-series; you must already know the name. |
| **ИПИ — 265obshtini.bg / regionalprofiles.bg** | 32 indicators × 265 municipalities; 28 oblasts; best-in-class regional indicators. | Indicators only — no money flow, no person/company layer, annual cadence, no drill below municipality; cannot answer "who got the money here". |
| **Диагноза България / Martin Atanasov's healthcare-money platform** | Health-system audit; a new platform surfacing > BGN 605M in suspicious healthcare spending (the „Черна пътека" author); NHIF leadership met the creator. | One sector (health), and a single-author investigative tool — not a linked cross-corpus product. It validates that *money-in-healthcare* is the hot demand; our НЗОК + hospital-payment + procurement + person layer answers the same question with more joins. |
| **Биволъ / АКФ / Свободна Европа** | Investigations. | Narrative, not queryable. They are potential *consumers* of our API, not competitors. |
| **eumoney.bg (ACF)** · **bgparliament.io (CLS)** | Crowdsourced EU-fund irregularity flags · searchable parliament since 2009. | No entity resolution, no cross-source joining. |
| **data.egov.bg** | Raw open-data portal. | Raw. |

### International reference points (what to steal, not just who exists)

| Who | Linkage model worth stealing |
|---|---|
| **YouControl (UA)** | Company dossier: ~50 state sources per company, affiliation-graph visualisation, change monitoring/alerts. Target for `/company/:eik`. |
| **OpenTender.eu / GTI (iMonitor 2.0)** | Cross-jurisdiction procurement **risk indicators** — iMonitor 2.0 published an updated risk methodology (Mar 2026) and TED 2011–2025 aggregate risk statistics; our per-contract risk grades need EU-comparability, not more local signals. |
| **TI Integrity Watch (EU)** | Declarations + lobbying in one interface per country. |
| **foaf.sk / znasichdani.sk (SK)** | "Who stands behind the company that got the contract" as a *consumer* product, not a journalist tool — the packaging we should copy for `/connections`. |
| **OpenSanctions / OpenOwnership** | Entity-resolution + ownership-graph linking across jurisdictions; the model for our `person_id`/`eik` spine. |
| **Open Contracting Partnership + red-flag methodology** | Cross-dataset red flags (not just per-contract); **Cardinal** is their open-source red-flag library — the model for the "lead engine" (#21 below) *and* for open-sourcing our risk index. |
| **ProPublica "Dollars for Docs" / "Nonprofit Explorer"** | Investigative data-linking shipped as a *product with a narrative*, not a raw query — the model for auto-composed dossiers (#25). |
| **OpenSanctions** | Deduplicated sanctions/PEP graph with an **entity-scoring API** — the model for a public API over our resolved `person_id` spine. |
| **TheyWorkForYou (UK, 2025)** | New **explain-the-vote** summaries + per-MP voting summaries on raw roll-calls — the model for a consumer layer over our 16,741 items / 4M casts. |
| **BudgIT "Bimi" / GRASP / OGD4All (2025–26)** | Grounded AI chatbots over budget/public-finance data — the model for a conversational "ask the budget/municipality" UX over our ~155 tools. |

### Positioning conclusion (unchanged, strengthened)

Nobody — in Bulgaria, and on current evidence nowhere in the region — holds **elections + public
money + resolved person identity + retail prices + place indicators + outcome series** on one
spine. Each of the platforms above covers one column of that matrix, several of them better than
we do within it. What we should build on is therefore not "better procurement search" but **the
joins the single-column products cannot compute** — and, since v1, the joins that pair money with
a *measured outcome*.

### Four moves worth adopting from the 2026 field

1. **Public, subscribable anomaly alerts** (Диагноза + SIGMA Phase 3 + iMonitor lesson). The
   2025-26 wave is *signals, not tables* — Диагноза's BGN 605M claims and institutional API
   demand, SIGMA's planned "early warning", iMonitor's red-flag training. We already compute the
   risk masks (incl. НКИД→CPV mismatch, single-bidder, MP-tied firms) — ship them as
   per-company/per-person/per-sector "what changed this week" alerts, with an API others can
   subscribe to. This converts the data asset into the institutional-uptake asset.
2. **TheyWorkForYou-style explain-the-vote layer.** Their 2025 Votes/summaries show the consumer
   product on raw roll-calls is *explanation*, not listing. We hold 16,741 items / 4M casts —
   add per-MP voting summaries and "what this motion did" (joined to topic, lobby contacts, and
   the companies it touches). This closes the widest gap between what the roll-call corpus holds
   and what a reader can currently use.
3. **Open-source the risk methodology (OCP Cardinal model).** Publish the corruption-risk index
   (flags, masks, thresholds, reconciliation rules) as a documented, versioned, licensed open
   library. A flag that fires on a named company is a public claim, and today it is
   unfalsifiable from outside — the definitions exist only in code, in six places. Cardinal shows
   the shape: a spec plus a reference implementation, mapped onto the OCP flag vocabulary so a
   Bulgarian calibration is legible to anyone already working in those terms. Plan:
   [procurement-risk-open-source-v1.md](procurement-risk-open-source-v1.md).
4. **Grounded conversational "ask the budget/municipality" (Bimi / GRASP lesson).** Chat over
   public money is now table stakes; generic chat is a liability. Grounded, tool-backed answers
   (our ~155 tools) are the advantage — point them at the budget→contract→company→person spine
   and at municipalities, and ship it as the reference "ask the data" UX for Bulgaria.

---

## 4. Linkage ideas, second wave

Feasibility: **A** = already computable, aggregation only · **B** = needs a derived table/matview ·
**C** = needs new ingest/methodology. Ideas are grouped by the angle they push hardest. v1's
list (place / person / company / time / product) is not repeated; these are net-new, and they
lean on the outcome half and the graph engine that v1 did not have.

### (a) Outcome × money — value-for-money lenses

- **€-per-matra-point league** — education value-added (`school_scores`/`school_context`) ×
  school awarder procurement (`awarder_seats`) × per-pupil budget. Ranks schools on
  "levs spent per matura point gained". Parents see whether the money buys results; auditors see
  the money-sinks. **B**
- **Micrograms per million** — environment pack (heating/renovation CPV) × PM2.5 station series ×
  place × mayor. "Lev per microgram removed" per municipality — a cost-effectiveness frontier
  that names mayors who paid 2× the neighbour and the air did not move. **B**
- **Trauma-ward ledger** — НЗОК hospital payments (per DRG) × МВР road deaths/theft per oblast.
  Cross-checks two independent ledgers: districts where road deaths fell but trauma billing rose
  (and vice versa) expose coding-up and unreported crashes. **B**
- **Justice clock** — court workload/duration × court expenditure × `magistrate_current` bench.
  "Days per resolved case" beside "levs per resolved case" per court — slow *and* expensive
  courts, with the bench sitting on the money. **B**
- **One-year lag engine** — any money corpus × any outcome series × place × year. A generic
  lagged-correlation tool ("spend year N → outcome year N+1") that turns every sector pack into
  a hypothesis-testing machine. **B/C**
- **Subsidy-to-shelf trace** — farm subsidies (2.5M EIK-keyed rows) × КЗП milk/bread/oil prices ×
  GRAO income. "€11bn in subsidies, here's the subsidy per litre vs the price per litre, per
  municipality" — the full farm-to-shelf money line. **C** (fuzzy product↔farm link; start
  category×sector per municipality).

### (b) Temporal — before/after, windows, lags

- **Caretaker signature** — procurement (`award_date`, `single_bid`, method) × cabinet anchor
  extended with caretaker periods × election dates. Isolates contracting under Bulgaria's
  no-mandate caretaker windows: does single-bid share / method mix / speed shift vs regular
  cabinets? Sharpens v1's naive pre-election-spike into a dated, per-caretaker forensic. **B**
- **Euro shock, store by store** — КЗП store prices (1.4M rows, 6.2k stores) × store type × place ×
  GRAO income. Pinpoints exactly which chains and municipalities raised prices at 2026-01-01 and
  by how much per product — the euro-adoption attribution, naming chains. **B**
- **Sanctions gap** — dated sanctions snapshots × companies/officers × contract/annex dates.
  Contracts *paid* to entities whose officers hit sanctions lists in the N months *after*
  signing — the public purse kept paying firms already on the radar. **B**
- **Revolving-door payoff lag** — persons (regulator/awarder roles, `date_basis='filing'`) ×
  company officer roles (dated) × those companies' contracts. v1 detects the door; this measures
  the payoff — win-rate and average contract value 24 months before vs after the hire. **B**
- **Handover shock** — cabinet anchor (minister tenures) × outcome series × budget. Automated
  breakpoint detection at handover boundaries — "the month minister X took over, this series
  jumped". **B**

### (c) Network / graph

- **Bid-rotation radar** — per-tender bidder rosters (233k tenders) × eik × person_id × winners.
  Bidder-pair co-occurrence matrices surface cartel signatures — win rotation among the same
  2–4 bidders, complementary bidding, identical losers. A public cartel radar no BG institution
  publishes. **C** (needs full bidder rosters + algorithm; the single-bid flag already exists,
  rosters are the open question).
- **Shell-address constellations** — TR addresses/phones × officers × procurement winners ×
  subsidy beneficiaries × EU beneficiaries. Clusters companies sharing a registered address or
  phone, then attaches the money — shell-family detection with euros on every cluster. **B**
- **Two-hop money web** — person_id × companies × party × procurement, rendered as a
  money-weighted multi-hop path ("your MP's business partner's company won these 40 contracts
  worth X"). v1's two-hop exposure stops at exposure; this attaches euro amounts to every edge. **B**
- **NGO money round-trip** — NGO board members × `ngo_funding` × ЕРИК donors × subcontractor
  companies. State → NGO → subcontractor whose officer donated to the party that allocated the
  money. "Who profits from civic society." **B**

### (d) Cross-country / EU

- **EU twin bar** — every sector pack × Eurostat EU-27 peer series. Bulgaria-vs-EU as a
  first-class overlay on *every* vertical (rail subsidy/pax, hospital payments, court delay,
  matura, air), not just macro. One shared overlay component. **A/B**
- **Convergence clock** — EU absorption (81.9k projects, per place) × GDP/capita PPS × GRAO ×
  time. Projects each oblast's absorption velocity onto its GDP trajectory and prints "at
  current rate X reaches 75% of EU average in 2047", with contract-competition quality as the
  dial. **B**
- **Euro basket vs euro area** — КЗП store basket × Eurostat HICP by product group × adoption
  date. Separates normal adoption noise from a Bulgarian-specific markup. **A/B**

### (e) Mass-market / retention

- **Mayor's report card** — place × municipal fiscal × procurement seats × EU projects ×
  outcomes (air, prices) × mayor party × election date. A shareable "term in review" card per
  municipality, built to be posted in municipal Facebook groups ahead of local elections. **A**
- **My basket, my MP** — user basket × person_id (my MP) × roll-call votes × party donors ×
  place. One "how does this affect me" page connecting personal inflation to the political. **B**

### (f) Investigative red-flag generators

- **Lead engine** — every flag already computed (`contract_risk_cache` bits, single_bid, donor
  links, revolving door, declaration anomalies, Benford) × severity scoring × ranked, *explained*
  output. An auto-generated investigative queue where each lead is a composed rationale with
  linked evidence ("Contract 123, signed 3 days before the election, single bidder, bidder's
  officer donated to the ruling party, 34% above market"). **B**
- **Loyalty-to-contract test** — `vote_cast` loyalty/similarity per MP × person_id × their
  companies' contracts × party. Named scatter: government-loyalty % vs contracts to the MP's own
  firms — the first public test of whether loyalty correlates with public money to one's own
  companies. **B**
- **Subsidy vote-buy test** — farm subsidies (EIK→place) × local election results across cycles ×
  turnout. A village-level distributive-politics panel: does subsidy-per-capita predict the
  incumbent mayor's retention? The natural experiment only this platform holds. **B**
- **Benford across the money corpora** — procurement values × subsidy payments × budget lines ×
  EU project values × donations. Digit-distribution heatmap per agency/year; anomalies flag
  which wallets are statistically off. Extends an existing election feature to money with zero
  new data. **A**

### (g) AI assistant

- **Auto-dossier journalist** — the 155 tools × a compose-agent skill walking person_id →
  companies → contracts → subsidies → declarations → votes → donations → EU funds. One query
  ("who is X, really?") returns a written, cited multi-corpus profile. Follow-ons: a
  "timeline constructor" (life-of-a-contract / life-of-an-MP) and a "value-for-money query" skill
  ("which municipality got the least PM2.5 reduction per lev?"). **C** (heavy, reuses everything).

---

## 5. Ranked shortlist (second wave)

Ranked on (uniqueness in the field) × (impact) ÷ (effort), given everything is already in PG.

| # | Idea | Angle | Why it wins |
|---|---|---|---|
| 1 | **Lead engine** (#21) | red-flag | Flagship: auto-generates the site's most original content from flags it already computes; journalists get a feed, we get continuous content. |
| 2 | **Mayor's report card** (#19) | retention | Mass-market, shareable, timed to local elections; near-A feasibility from existing payloads; the traffic + returning-user hook. |
| 3 | **Euro shock, store by store** (#8) | temporal | Once-in-a-generation event with store-level data nobody else holds; huge media pull while the transition is fresh. |
| 4 | **Loyalty-to-contract test** (#22) | red-flag | The most uniquely cross-corpus question (parliament × companies × procurement via person_id); instantly newsworthy, zero new ingest. |
| 5 | **Benford across the money corpora** (#24) | red-flag | Cheapest (pure A), extends a brand the site already owns, and gives the lead engine its statistical backbone. |

**Still the two big v1 prizes to keep on the board** (they beat several of the above on raw
impact but need more methodology care): *political geography of public money* (1.1) and
*revolving-door detector* (2.1). Neither is shipped; both are now cheaper because the graph
engine and `company_public_money` exist.

**Cheapest structural first move (unchanged from v1):** ship the `/data/map` lateral edges
(`data-hub-lateral-edges-v1.md` T1). Half a day, and the map itself becomes the argument that the
corpus is one linked product — which is the claim every idea above depends on.
