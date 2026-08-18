# Cross-linking strategy v2 — one corpus, one spine, one product

Status: **brainstorm / strategy**, not an implementation plan. Drafted 2026-08-18, **revised the
same day after a verification pass against local Postgres.** That pass re-measured §1 (whose first
draft was v1's table copied verbatim under a new date — seven rows had moved, and "17 role
sources" is 16), corrected the corpus-depth claim in §3, re-rated four ideas whose inputs do not
exist as assumed, and added §4.0's three cross-cutting constraints.

Follows [cross-linking-strategy-v1.md](cross-linking-strategy-v1.md) (2026-08-02), whose
structural finding still holds — this plan re-verifies it against the grown corpus, refreshes
the competitive set, and adds a second wave of linkage ideas aimed at the verticals that have
landed since v1 (outcome series, the consumption hub, roll-call votes, the sector packs).

---

## 1. What we actually hold

Re-measured from local Postgres + `data/data_map.json` on **2026-08-18**.

| Spine | Scale | Note |
|---|---|---|
| Sources → datasets → features | 41 sources · 34 datasets · 26 features (101 nodes, 167 edges) | `data/data_map.json` |
| Companies (ТР) | 1,020,707 companies · 872,202 officers · 1,340,793 person-roles | Trade Register |
| Persons (resolved) | 133,723 persons · 323,450 roles across **16 role sources** · 76,710 aliases | the identity spine |
| Procurement | 405,904 contracts + 3,488 amendments · 237,668 tenders · 24,258 annexes | + per-contract risk grade |
| EU funds | 82,011 projects · 46,171 beneficiaries | per-place geolocation |
| Farm subsidies | €11.04bn · 2,481,857 payment rows · 16,702 legal entities | EIK-keyed |
| Retail prices | 11,354,660 price facts (4,387,949 current) · 123,570 products · 6,523 stores | КЗП, SCD-2 since the euro |
| Roll-call votes | 16,741 items · 4,017,519 casts | **44th–52nd NA** |
| Declarations | 61,743 filings · 335,676 assets · 107,826 obligations | MPs + officials + magistrates |
| Graph | 200,034 edges · 87,177 company nodes · 83,337 person nodes | `graph_*` PG tables — **shipped** |
| Places | 5,720 settlements (`place_dim`) | elections to section for 80+ cycles since 2005 |

⚠️ **This table's first draft was v1's, copied verbatim under a 2026-08-18 heading.** It was
measured 2026-08-02, and seven rows had moved. Recording the deltas, because two of them are
quoted elsewhere as arguments:

- **`person_role.source` is 16, not 17** — and v1's own enumerated list also counts 16 against
  its own "17" header, so the error is inherited rather than introduced. Both this plan and
  `competitive-review-2026.md` lead with "17 role sources" as the differentiator. The 16:
  `tr` 192,374 · `candidate` 67,065 · `local` 25,319 · `official_exec` 9,842 · `ngo` 7,162 ·
  `official_muni` 6,647 · `public_sector` 6,023 · `mp` 3,852 · `magistrate` 3,594 · `donor`
  1,283 · `diplomat` 203 · `mep` 35 · `regulator` 32 · `ds` 12 · `president` 6 · `sanctions` 1.
- **Retail prices lost a load-bearing word.** v1 said "1,398,414 **current** store-prices ·
  629,165 product-days"; v2 kept the snapshot figure as the corpus size. `price_facts` is
  11.35M SCD-2 rows (4.39M current) — an 8× understatement of the input to shortlist #3, whose
  whole pitch is longitudinal depth.
- **Contracts went 456k → 409k**, almost certainly `reconcile_cross_source` evicting cross-feed
  duplicates — i.e. the corpus became *more correct*, not smaller. Quote the new number: see §3
  for what that does to the depth claim.
- Grown since v1 and understated by the old figures: persons +13%, roles +14%, TR officers
  +13%, declarations +25%, and the whole graph +21–25%.
- **The roll-call range was wrong at both ends.** `vote_item` spans the **44th to the 52nd** NA
  (44: 1,050 · 45: 231 · 46: 599 · 47: 2,116 · 48: 1,690 · 49: 4,308 · 50: 797 · 51: 4,687 ·
  52: 1,263) — the old "45th–51st" dropped the 44th and, more consequentially, the **sitting**
  parliament.

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
  layer, and it is **shipped, not under construction**: 200,034 edges / 87,177 company nodes /
  83,337 person nodes, migrations 127–129, loaded by `db:load:graph:pg[:cloud]`, serving
  `/connections`. `company_public_money` holds 81,389 rows. It links person↔company on
  co-ownership and procurement, with money on company nodes. This is the substrate most ideas
  below build on — so cost every idea against a substrate that exists, not one that is pending.
  **What it does NOT add is DATES** (§4.0), which is the constraint two of the ideas below were
  mis-rated on.
- **v1's ranked shortlist is still mostly open**, but "open" means different things per item, so
  all six are reported here rather than four (measured 2026-08-18):
  - **1.1 political geography of money** — open, no surface.
  - **1.3 settlement reality card** — open as a *cross-corpus card*; not to be confused with the
    election-only `/settlement/:id` family, which predates v1. Omitted from the first draft's
    audit entirely.
  - **2.1 revolving-door detector** — open, and **blocked on role dating, not on the graph**
    (§4.0).
  - **3.1 total public money, all corpora** — the *page* is unbuilt, but the **basis shipped**:
    `company_public_money` (127) is documented as the one reusable per-EIK broad-money basis, and
    a dual-corpus leaderboard is live as a `/funds` tile over matview 077. Scoring this "0"
    overstates what is left to do.
  - **4.1 universal cabinet scorecard** — partial: only the indicators `CabinetScoreRow`.
  - **5.1 build-your-own basket** — shipped (`/consumption/basket`).

  Also shipped since v1: `/following` (5.2), the sector packs, the graph engine, the person
  contracts browser, the subsidies cross-programme map.

### The join keys (five from v1, three added)

1. **`person_id`** — 16 role sources on one identity. Nothing else in BG has this.
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

Every idea below exploits one of those keys. **Most need no new source; three do**, and the
first draft's blanket "none requires a new source" was wrong on its own evidence — it rated
bid-rotation **C** *because* it needs bidder rosters. The three, called out at their entries and
again in §4.0: **bid-rotation radar** (no bidder roster exists in `tenders`), **shell-address
constellations** (`tr_companies` carries no address or phone), and **sanctions gap** (the
register is three curated designees).

---

## 3. Competitive review

The full, citation-backed sweep is [competitive-review-2026.md](../../competitive-review-2026.md)
(research snapshot Aug 2026, ~20 platforms). This section carries the condensed table and the
four moves worth adopting; v1's table is the base.

### Bulgaria

| Who | What they have | What they cannot do |
|---|---|---|
| **SIGMA** (sigma.midt.bg, МИДТ, state) | Launched **16 Jun 2026**: open-source register, ~193k contracts / >€51bn / 4,400 institutions / 17k companies, six years, built in a month. **No risk detection shipped yet** — Phase 2 (ownership links) and Phase 3 (preferential-treatment alerts) are still roadmap; a separate AI tool was presented to the Council of Ministers. | Procurement only; no person layer, no elections, no places, no prices, no outcomes. Our corpus is **405,904 contracts** (+3,488 amendments, +24,258 annexes) — **2.1× the rows**. On depth, quote it precisely: `date_signed` does span 2000→2029, but the pre-2011 tail is **68 rows in total** (2000: 1 · 2005: 1 · 2007: 10 · 2008: 26 · 2009: 30), with 2010 at 429 and 2011 the first real year at 15,886. So the honest claim is **~9 extra years of substantive depth plus a thin tail**, not the "+22 years" an earlier draft asserted on 68 contracts. As a state platform it is unlikely to ship a political-attribution view. Same procurement + company ground as ours, open-source, with the ownership-link and detection phases still roadmap. |
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

### 4.0 Three constraints every idea below inherits

None of these is a reason not to build; each is a reason a rating or a headline has to change.
They are here rather than repeated per idea because they cut across the whole list.

**1. A name match is not an attribution — and this repo already decided that.** Several ideas
below make claims about *named individuals*: "your MP's business partner's company won these 40
contracts", the loyalty-to-contract scatter, the NGO round-trip ("who profits from civic
society"), and every lead the lead engine composes. The standing rule is that a shared name is
**refused, not graded**: `mp_tr_roles` (150) and `place_mp_companies` (151) read the gated
`person_role` set through the Commerce Registry's own people-count fold (`tr_name_fold_people`,
148), and an unmeasured fold is refused outright. That gate dropped **410 of 2,014** (MP,
company) attributions the retired shard trees had been publishing. So:

- every idea in §(c) and §(f) must state **which identity tier** it may draw on — the gated
  `person_role` set, or nothing;
- a link that exists only because two strings match is **not publishable**, however good the
  headline;
- where a link is refused, the honest output is a gap, not a weaker claim.

Getting this wrong does not produce a bug — it produces a confident, wrong sentence about a real
person, which is the failure mode the person layer was rebuilt to end.

**2. A new page is three artifacts, not one.** Shortlist #1–#3 are public pages. Each needs a
prerendered static page, a sitemap `<loc>` in **both** `route_defs` lists, and **its own
`og:image`** — the site's own finding is that broader-data pages without that set draw ~0 search
impressions, and a share card that falls back to the site default defeats the point of anything
built to be posted. Any idea rated **A** on the strength of "the aggregation already exists" is
being rated on its query, not its delivery. The mayor's report card is the clearest case: the
numbers are close to A, ~265 pages plus share cards are not.

**3. The TR half of the identity graph is UNDATED.** Measured: `person_role` carries
`date_basis` on 0 of 192,374 `tr` rows, 0 of 7,162 `ngo` rows and 0 of 67,065 `candidate` rows;
`tr_officers` has only `changed_at` (a record-change timestamp, not an appointment date) and
`active`. Dated coverage is `local` 25,319/25,319, `official_exec` 4,907/9,842, `mp`
2,896/3,852. Any idea whose sentence contains "before/after the hire" is therefore gated on a
dating source we do not hold — and the graph engine, which several entries lean on, adds money
and edges but **no dates**.

### (a) Outcome × money — value-for-money lenses

- **€-per-matura-point league** — education value-added (`school_scores`) × the school's own
  awarder procurement. Ranks schools on "euros spent per matura point gained". Parents see
  whether the money buys results; auditors see the money-sinks. **B — and the best-evidenced
  entry in this section.** Measured 2026-08-18: **990 of 994 schools carry an `eik`, 917 of them
  appear as `awarder_eik`, over 14,809 contracts worth €487.7M.** The МОН crosswalk problem that
  blocks education joins elsewhere is already solved for this set. Two caveats to carry into the
  copy: 994 schools is a subset of the national total, so this ranks the schools we hold rather
  than the country; and there is **no school-grain per-pupil budget** in PG (`school_context` is
  obshtina grain, 266 rows), so the ratio is *own-procurement € per matura point* — name it that
  way rather than implying a full per-pupil cost.
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
- **Euro shock, store by store** — КЗП store prices (**11.35M SCD-2 facts**, 4.39M current,
  123,570 products, 6,523 stores) × store type × place × GRAO income. Pinpoints which chains and
  municipalities raised prices at 2026-01-01 and by how much per product. **B.** Two things the
  copy must carry: the corpus is a **monitoring basket index, not CPI/HICP** — it sits beside the
  Eurostat HICP tile and never replaces it — and naming a chain is a market-conduct claim about a
  named company, so the comparison has to be like-for-like at pack identity, with `nPriced`
  shown, exactly as the existing chain comparison does it.
- **Sanctions gap** — sanctions designations × companies/officers × contract/annex dates.
  Contracts *paid* to entities whose officers hit sanctions lists in the N months *after*
  signing. **C, and today it has no sample.** `data/person/sanctions.json` is a 1.7 KB
  hand-curated file holding **three designees** (each with a designation date, but no snapshot
  series), and exactly **one** reaches `person_role`. The idea needs a real OFAC/EU list ingest
  with dated designations before it is an analysis rather than an anecdote — at which point it
  becomes one of the strongest entries here, because the contract side is fully dated.
- **Revolving-door payoff lag** — persons (regulator/awarder roles, `date_basis='filing'`) ×
  company officer roles × those companies' contracts. v1 detects the door; this measures the
  payoff — win-rate and average contract value 24 months before vs after the hire. **C, not B —
  the company officer roles are NOT dated** (§4.0-3): 0 of 192,374 `tr` roles carry a
  `date_basis`, and `tr_officers.changed_at` is a record-change timestamp that would misdate
  every hire it was used for. The state side is dated (4,907 `official_exec` roles carry
  `date_basis='filing'`), so the *door* is detectable; the *payoff window* needs an appointment
  date the corpus does not hold. Either source appointment dates from CR Deeds, or reframe as an
  undated before/after around the STATE role's dates only, and say which.
- **Handover shock** — cabinet anchor (minister tenures) × outcome series × budget. Automated
  breakpoint detection at handover boundaries — "the month minister X took over, this series
  jumped". **B**

### (c) Network / graph

- **Bid-rotation radar** — per-tender bidder rosters (233k tenders) × eik × person_id × winners.
  Bidder-pair co-occurrence matrices surface cartel signatures — win rotation among the same
  2–4 bidders, complementary bidding, identical losers. A public cartel radar no BG institution
  publishes. **C — needs a new source.** Confirmed 2026-08-18: `tenders` has no bidder-roster
  column at all (only `lots`, `lots_count`, `change_notice_count` …), and the risk plan records
  the missing-bidders screen as blocked on the same gap. The single-bid flag already exists;
  the rosters are the whole question.
- **Shell-address constellations** — companies sharing a registered address × officers ×
  procurement winners × subsidy beneficiaries × EU beneficiaries, with the money attached to
  every cluster. **C and partly not buildable as written.** `tr_companies` carries
  `uic, name, legal_form, seat, status, funds_amount, funds_currency, last_updated, name_fold,
  entity_class, ngo_type` — **there is no phone column at all**, and `seat` is free text resolved
  only to *settlement* grain via `tr_company_place`. Clustering on that grain puts ~110k Sofia
  companies in one "constellation". A real address needs a new ingest (the CR Deeds capture is
  the plausible source). Until then the co-officer arm of the graph does this job better and is
  already built.
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
  linked evidence. **B**, with three constraints that decide whether it is publishable:
  every person↔company edge in a rationale comes from the gated `person_role` set or is omitted
  (§4.0-1); the framing is the risk methodology's own — a fired flag means the behaviour is *not
  illicit*, *suboptimal*, or *illicit*, in that order, and leads are **for review**, never a
  finding; and any comparative clause ("N% above market") needs a stated comparator, which the
  per-contract corpus does not currently have — the published index is a count of checks fired,
  and a per-contract score is noisy at n=1 by the corpus's own literature.
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
  A composed multi-corpus profile about a named person is the single most exposed output on this
  list: it must run through the existing **grounded-number gate** (which already rejects figures
  the tools did not return) *and* through §4.0-1's identity rule, since a dossier is precisely
  where an ungated name match would read as a verified biography.

---

## 5. Ranked shortlist (second wave)

Ranked on (uniqueness in the field) × (impact) ÷ (effort), given everything is already in PG.

| # | Idea | Angle | Why it wins |
|---|---|---|---|
| 1 | **Lead engine** (#21) | red-flag | Flagship: auto-generates the site's most original content from flags it already computes; journalists get a feed, we get continuous content. |
| 2 | **Mayor's report card** (#19) | retention | Mass-market, shareable, timed to local elections; the traffic + returning-user hook. Rated near-A on the *query*; the delivery is ~265 pages each needing prerender + a sitemap `<loc>` in both lists + its own `og:image` (§4.0-2), so budget it as B. |
| 3 | **Euro shock, store by store** (#8) | temporal | Once-in-a-generation event with store-level data nobody else holds; huge media pull while the transition is fresh. Depth is the asset: 11.35M SCD-2 facts, not the 1.4M current snapshot an earlier draft quoted. |
| 4 | **Loyalty-to-contract test** (#22) | red-flag | The most uniquely cross-corpus question (parliament × companies × procurement via person_id); instantly newsworthy, zero new ingest. |
| 5 | **Benford across the money corpora** (#24) | red-flag | Cheapest (pure A), extends a brand the site already owns, and gives the lead engine its statistical backbone. |

**Still the two big v1 prizes to keep on the board** (they outrank several of the above on raw
impact but need more methodology care): *political geography of public money* (1.1) and
*revolving-door detector* (2.1). Neither is shipped. 1.1 **is** cheaper now — the graph engine
and `company_public_money` (81,389 rows) both exist. 2.1 is **not**: its blocker was never the
graph, it is that the TR half of `person_role` is undated (§4.0-3), and a shipped graph adds
edges and money but no dates.

**Cheapest structural first move (unchanged from v1):** ship the `/data/map` lateral edges
(`data-hub-lateral-edges-v1.md` T1). Half a day, and the map itself becomes the argument that the
corpus is one linked product — which is the claim every idea above depends on.
