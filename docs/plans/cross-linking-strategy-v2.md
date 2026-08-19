# Cross-linking strategy v2 — one corpus, one spine, one product

Status: **brainstorm / strategy**, not an implementation plan. Drafted 2026-08-18, **revised the
same day after a verification pass against local Postgres.** That pass re-measured §1 (whose first
draft was v1's table copied verbatim under a new date — seven rows had moved, and "17 role
sources" is 16), corrected the corpus-depth claim in §3, re-rated four ideas whose inputs do not
exist as assumed, and added §4.0's first three cross-cutting constraints.

**A second pass, the same day, audited the result** — against local Postgres, the committed
`data/**` artifacts, `src/routes.tsx`, `scripts/prerender/dynamicRoutes.ts` and
`scripts/sitemap/route_defs.ts`. §3 and §4.0-1 survived it unchanged. Four things did not, and
each is recorded in place rather than silently fixed:

- **§1's central new claim was false for six of the nine series it named.** The "outcome half"
  is overwhelmingly *national annual scalars*, not a place panel, and one member is not a series
  at all. §1 now carries the grain table; §4(a) is re-rated on it.
- **The first pass rated ideas' inputs for EXISTENCE and never for `n`.** Shortlist #4 was ranked
  "instantly newsworthy" on a sample of **17**. §4.0-5 makes power a stated requirement.
- **§4.0-2 costed a page family without checking what is already shipped.** `/governance/:id` is
  prerendered and sitemapped today; the constraint was applied as if it were not.
- **Two constraints were missing entirely** — causal attribution (§4.0-4) and the per-surface
  operational tax (§4.0-6), the latter being the dominant recurring cost of every **B** here.

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
**outcome half**. Sector packs now pair spend with a measured result. That is the one asset class
the v1 linkage list barely touched, and it remains the cheapest high-impact linking surface left
— but only for the part of it that is keyed the way the money is.

⚠️ **This paragraph's first draft claimed "the money↔outcome join requires no new ingest anywhere
— both sides are already keyed by place and date", and named nine series. Measured, that is
false for six of them.** The money side is per-EIK / per-settlement / per-day; most of the
outcome side is **one national number per year**, and the one the draft led with is not a series
at all. Six ideas were rated on the wrong half.

| Series named in the first draft | Actual grain | Joinable to money at place? |
|---|---|---|
| air PM10 / PM2.5 | `data/air/index.json` — **37 stations, snapshot only** (`snapshotAsOf: 2026-03-31`, `latestReadings` + `maxObserved`; **no time dimension**), município attribution by station-name parsing | **No** |
| road deaths | `data/security/road_safety.json` — **national annual**, 14 points `{year, deaths}` | **No** |
| recycling rate | `data/environment/waste.json` — `byGeo`, **country level** (BG + EU peers) | **No** |
| poverty reduction | `data/social/poverty_impact.json` — Eurostat SILC, **country level** | **No** |
| rail subsidy per passenger | `data/transport/rail_subsidy.json` — **national annual**, 9 fiscal years | **No** |
| e-government uptake | Eurostat, **country level** | **No** |
| matura value-added | `schools` — **994 schools, 990 with `eik`**; `data/indicators.json` — **obshtina × year** | **Yes** |
| court workload | `court_load` — **1,432 rows, 208 courts, 2018–2025** | **Yes** |
| НЗОК hospital payments | `nzok_hospital_payments` — **hospital × period** | **Yes** |

**And the draft omitted the two panels that actually do the job.** Neither appears anywhere in
the first version of this plan, and between them they are the outcome half worth building on:

- **`data/indicators.json` — 265 municipalities × year.** Registered unemployment (АЗ, 2016–2025),
  ДЗИ average (МОН, 2022–2026), population change. Obshtina-keyed, i.e. grain-matched to
  `budget_muni_transfer`, `municipal_fiscal`, `awarder_seats`, `fund_projects` and
  `agri_subsidies`.
- **`data/regional.json` — 28 oblasts × year × 10 indicators.** GDP/capita, population, net
  migration, **theft rate**, enterprise density, crude death rate, FDI/capita, hospital beds,
  long-term unemployment, museum visits — back to 2005 on the Eurostat arms.

So the honest form of the claim: **the money↔outcome join needs no new ingest at obshtina,
oblast, school, court and hospital grain — and needs a new ingest for everything else on the
first draft's list.**

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
   per-company/per-person/per-sector "what changed this week" signals. This converts the data
   asset into the institutional-uptake asset.

   ⚠️ **Split this move in two, because "subscribable" assumes infrastructure that does not
   exist.** Measured: `/following` (`src/screens/person/FollowingScreen.tsx`) is
   **browser-local** — the watchlist lives in localStorage, the page keeps **no server-side
   record of who follows whom by explicit design**, it is `noindex` and never prerendered, and
   it covers **declaration filings only** (one fetch of the site-wide `useNewFilings` feed,
   filtered client-side). There is no auth, no account, no mail sender wired to the app, and the
   architecture is a static SPA plus one Cloud Function. So:
   **(a) the per-entity change FEED is B** — `/api/db/feed?entity=company:<eik>|person:<slug>|place:<code>`
   plus an RSS mirror, built from `ingest_first_seen` and the risk masks: no accounts, edge-
   cacheable, crawlable, and directly consumable by the journalists this section names as the
   target. **(b) email/webhook subscriptions are C** — an identity store, a delivery channel and
   a consent/bounce regime, i.e. a different kind of product from everything else on this list.
   Build (a); scope (b) separately or not at all.
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

### 4.0 Six constraints every idea below inherits

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

**2. A new page is three artifacts, not one — but CHECK WHICH THREE ARE ALREADY THERE.** Every
public page needs a prerendered static page, a sitemap `<loc>` in **both** `route_defs` lists,
and **its own `og:image`** — the site's own finding is that broader-data pages without that set
draw ~0 search impressions, and a share card that falls back to the site default defeats the
point of anything built to be posted. Any idea rated **A** on the strength of "the aggregation
already exists" is being rated on its query, not its delivery.

⚠️ **The first draft then applied that constraint to the mayor's report card without checking,
and inflated it by roughly an order of magnitude.** It read "~265 pages plus share cards", i.e.
budget it as B. Measured: `/governance/:id` (formerly `/my-area/:id`) is a **25-tile municipal
dashboard that already exists** — municipal budget, municipal fiscal, local taxes, tax receipt,
procurement, tenders, EU projects map, Interreg, council, representatives, upcoming ballot,
prices, basket, deals, property stock, transparency, education, capital projects, alerts — it is
**already prerendered** (`buildGovernanceMuniRoutes` + `buildGovernancePlaceRoutes` in
`scripts/prerender/dynamicRoutes.ts`) and **already in the sitemap at both município and
settlement grain** (`route_defs.ts` → `governance-municipalities`, `settlements`). Two of the
three artifacts are shipped. The missing one is the **`og:image`**, and the missing *product* is
the term-in-review framing, not the page.

The same check moves a second entry: **§4(a)'s €-per-matura-point join is shipped per school** —
`src/screens/education/SchoolProcurementTile.tsx` renders a school's own procurement on
`/school/:id`, and `SchoolIdentityTile` puts the matura score on the matching `/company/:eik`.
What is missing there is the league table and its methodology page.

So the constraint has a second half: **before costing delivery, enumerate the artifacts that
exist.** Two of the five shortlist entries were mis-costed for want of one `grep` over
`dynamicRoutes.ts` and `route_defs.ts`.

Worth knowing for the og half specifically: `scripts/og/generate.ts` already renders **per-oblast**
cards (`renderOblastCard` → `region/<oblast>.png`) through an incremental CardSpec cache, so a
per-município card is an extension of a working generator rather than a new pipeline.

**3. The TR half of the identity graph is UNDATED.** Measured: `person_role` carries
`date_basis` on 0 of 192,374 `tr` rows, 0 of 7,162 `ngo` rows and 0 of 67,065 `candidate` rows;
`tr_officers` has only `changed_at` (a record-change timestamp, not an appointment date) and
`active`. Dated coverage is `local` 25,319/25,319, `official_exec` 4,907/9,842, `mp`
2,896/3,852. Any idea whose sentence contains "before/after the hire" is therefore gated on a
dating source we do not hold — and the graph engine, which several entries lean on, adds money
and edges but **no dates**.

**4. A ratio is not a value-for-money claim unless the denominator funds the numerator.** This is
the causal twin of constraint 1, and its absence is what let three ideas through with arithmetic
that is correct and a sentence that is false. "Lev per microgram removed", "€ per matura point",
"the month minister X took over, this series jumped", "did subsidy-per-capita predict the
incumbent mayor's retention" — each divides one series by another and names a responsible
official. But a municipality's total procurement is not its air-quality programme, and a school's
own procurement (fuel, food, repairs) is not its teaching budget — this plan already records that
there is **no school-grain per-pupil budget** in PG (`school_context` is obshtina grain, 266 rows)
and then rates the ratio anyway. So:

- a ratio may name **only the spend plausibly causal to the outcome**, or it is labelled a
  co-occurrence and never a value-for-money verdict;
- the page states its confounders — cohort intake for schools, industrial base and topography for
  air, catchment and case mix for courts;
- the denominator's name carries its own scope (*own-procurement € per matura point*, never
  *€ per matura point*).

The failure mode is already on the record here: `risk_score` mixes procedural and
vote-distribution signals and is unusable for party claims for exactly this reason. A
value-for-money ranking that names mayors is the same defect with a bigger blast radius.

**5. An idea whose output is a correlation, ranking or scatter must state its `n` before it gets
a rating.** The first pass measured whether inputs EXIST and never how many rows survive the
join, which is how a shortlist entry reached #4 on a sample of seventeen. Measured for the
loyalty-to-contract scatter, through the gated `person_role` set constraint 1 mandates
(`source IN ('tr','ngo') AND confidence IN ('exact_id','high','manual')`):

| Population | MPs | with a gated company role | whose company ever won a contract |
|---|---|---|---|
| **52nd NA (sitting)** | 254 | 96 | **17** |
| all parliaments (44th–52nd) | 2,118 | 753 | **102** |

Pooling to 102 does not rescue it: nine parliaments with different governments and party systems
make the loyalty axis non-comparable across them. Note also that this join crosses `mp_dissent`
(keyed `(ns, mp_id)`) with `person_role` (keyed `ref = '<mpId>:<ns>'`, with **956 legacy bare-`mpId`
rows**), and the standing finding here is that `mp_id` is not a person key — an unguarded join is
~17% wrong people. Fold on `(ns, mp_id)` and say so.

**6. A derived table is a permanent publishing obligation, not a one-off query.** The rating scale
above reads **B = "needs a derived table/matview"** as if the cost ended at the SQL. In this repo
it does not. A new matview or loader acquires: an entry in `SCOPED_MATVIEWS` with a correct
`inputs` array (whose omission is invisible to every row count), membership in `db:refresh` or in
`REFRESH_EXCLUSIONS` enforced by `refresh_coverage.test.ts`, an `ORDER_PAIRS` entry when it
follows a rebuild of its input, a `:cloud` publish command that **nothing runs automatically**, a
`vacuumAfterReload()` call, a `*.data.test.ts` gate, and a documented deploy ordering. The
marginal cost of a **B** is therefore not the query — it is one more permanent way for prod to
serve last month's numbers at a 200 while every count reconciles.

Consequence for design, not just for budgeting: **prefer a plain serving FUNCTION over existing
tables to a new matview wherever the query allows it.** A function carries no refresh obligation
(it carries the apply-on-cloud obligation instead, which is cheaper and already documented), and
several entries below — the value-for-money panels especially — are aggregate-over-existing-tables
shaped rather than precompute shaped.

### (a) Outcome × money — value-for-money lenses

- **€-per-matura-point league** — education value-added (`school_scores`) × the school's own
  awarder procurement. Ranks schools on "euros spent per matura point gained". Parents see
  whether the money buys results; auditors see the money-sinks. **A/B — the best-evidenced entry
  in this section, and the join is ALREADY SHIPPED per school**
  (`src/screens/education/SchoolProcurementTile.tsx` on `/school/:id`, mirrored by
  `SchoolIdentityTile` on `/company/:eik`), so what is left is the league table plus its
  methodology page, not the join. Re-measured 2026-08-18: **990 of 994 schools carry an `eik`,
  917 of them appear as `awarder_eik`, over 14,901 contracts worth €496.8M** (the 14,809 /
  €487.7M in the first draft went stale across a reload). The МОН crosswalk problem that
  blocks education joins elsewhere is already solved for this set. Two caveats to carry into the
  copy: 994 schools is a subset of the national total, so this ranks the schools we hold rather
  than the country; and there is **no school-grain per-pupil budget** in PG (`school_context` is
  obshtina grain, 266 rows), so the ratio is *own-procurement € per matura point* — name it that
  way rather than implying a full per-pupil cost.
- **Micrograms per million** — environment pack (heating/renovation CPV) × PM2.5 station series ×
  place × mayor. "Lev per microgram removed" per municipality — a cost-effectiveness frontier
  that names mayors who paid 2× the neighbour and the air did not move. **C, and NOT buildable
  today — the first draft rated it B on an input that does not exist.** `data/air/index.json`
  holds a **37-station snapshot** (`latestReadings` + `maxObserved`, `snapshotAsOf 2026-03-31`)
  with **no time dimension at all**, covering ~30 of 265 municipalities by station-name parsing.
  The headline needs two measurements over time on one side and a causal denominator on the other
  (§4.0-4), and we hold neither. It becomes B only after a dated ИАОС series is ingested — the
  station-level daily/annual datasets exist on data.egov.bg, and `data/air/index.json`'s own note
  records that NO2 and CO were left behind for want of the per-resource UUID.
- **Trauma-ward ledger** — НЗОК hospital payments (per DRG) × МВР road deaths/theft per oblast.
  Cross-checks two independent ledgers: districts where road deaths fell but trauma billing rose
  (and vice versa) expose coding-up and unreported crashes. **Split. The НЗОК side is per-hospital
  and fine; the ROAD-DEATH side is national-only** (`data/security/road_safety.json`, 14 annual
  points), so "districts where road deaths fell" has no district. The **theft** arm survives at
  oblast grain — `data/regional.json` carries `theftRate` per oblast per year — which is a
  different and weaker sentence, and should be written as one. **B on theft@oblast, C on road
  deaths.**
- **Justice clock** — court workload/duration × court expenditure × `magistrate_current` bench.
  "Days per resolved case" beside "levs per resolved case" per court — slow *and* expensive
  courts, with the bench sitting on the money. **B**
- **One-year lag engine** — any money corpus × any outcome series × place × year. A generic
  lagged-correlation tool ("spend year N → outcome year N+1") that turns every sector pack into
  a hypothesis-testing machine. **B, on four panels rather than nine** (§1): obshtina×year
  (`indicators.json`), oblast×year (`regional.json`), school×year and court×year. Every output it
  emits inherits §4.0-4 — a lagged correlation between a place's total spend and a place's
  outcome is a co-occurrence, and the tool must label it as one rather than let each consumer
  decide.
- **Municipal value-for-money panel** *(new — the replacement for what §1 removed)* —
  `data/indicators.json` (265 municipalities × year: registered unemployment 2016–2025, ДЗИ
  2022–2026, population change) × `data/regional.json` (28 oblasts × year × 10 indicators) ×
  the municipal money already in PG (`budget_muni_transfer`, `municipal_fiscal`, `awarder_seats`,
  `fund_projects`, `agri_subsidies`). This is the same lens the air and road entries were reaching
  for, restricted to the grain that actually exists, and it lands on `/governance/:id`, a page
  that is already prerendered and sitemapped (§4.0-2). **B**
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

- **The review queue** *(was: "lead engine" — renamed, because "lead" invites the reading the
  third constraint below forbids)* — every flag already computed (`contract_risk_cache` bits,
  single_bid, donor links, revolving door, declaration anomalies, Benford) × severity scoring ×
  ranked, *explained* output. An auto-generated investigative queue where each entry is a composed
  rationale with linked evidence. **Sized 2026-08-18: `contract_risk_cache` grades D 3,244 · E 429
  · F 81 — 3,754 contracts above C.** That is the fact that makes it a product rather than a
  firehose: it is a queue a small team can actually walk, so the design target is ranking and
  explanation quality, not recall. **B**, with three constraints that decide whether it is
  publishable:
  every person↔company edge in a rationale comes from the gated `person_role` set or is omitted
  (§4.0-1); the framing is the risk methodology's own — a fired flag means the behaviour is *not
  illicit*, *suboptimal*, or *illicit*, in that order, and leads are **for review**, never a
  finding; and any comparative clause ("N% above market") needs a stated comparator, which the
  per-contract corpus does not currently have — the published index is a count of checks fired,
  and a per-contract score is noisy at n=1 by the corpus's own literature.
- **MPs whose firms hold public contracts** *(was: "loyalty-to-contract test")* — `vote_cast`
  loyalty/similarity per MP × person_id × their companies' contracts × party. **B as a named
  table; NOT a test, and the first draft's framing does not survive §4.0-5.** It was written as a
  "named scatter … the first public test of whether loyalty correlates with public money", and
  measured, the sitting parliament yields **17 MPs** (254 members → 96 with a gated company role
  → 17 whose company ever won a contract); all nine parliaments pooled yield **102**, across
  governments and party systems that make the loyalty axis non-comparable. A correlation claim at
  n=17 is an anecdote with error bars. The publishable product is the **list of the 17**, with
  each MP's loyalty and each contract shown beside it, and no line fitted through them — which is
  a good page, and a much smaller claim than the one that got it ranked.
- **Subsidy vote-buy test** — farm subsidies (EIK→place) × local election results across cycles ×
  turnout. A village-level distributive-politics panel: does subsidy-per-capita predict the
  incumbent mayor's retention? The natural experiment only this platform holds. **B**
- **Benford across the money corpora** — procurement values × subsidy payments × budget lines ×
  EU project values × donations. Digit-distribution heatmap per agency/year. Extends an existing
  election feature to money with zero new data. **B, not A — the data is free and the methodology
  is not**, and the first draft's phrasing ("anomalies flag which wallets are statistically off")
  is precisely what the existing feature refuses. `/benford` ships a persistent caveat banner,
  sorts by party number rather than by deviation, states "NOT fraud", and **re-calibrates the MAD
  buckets away from Nigrini** because electoral counts are range-bounded. Money needs the
  *opposite* recalibration (Nigrini's accounting thresholds do apply) and carries a confound votes
  do not: **ЗОП procedure thresholds and round-number contracting produce large, legitimate
  first-digit deviation**, so an uncalibrated heatmap will name compliant agencies. Budget the
  calibration + framing, not the query.

### (g) AI assistant

- **Auto-dossier journalist** — the 155 tools × a compose-agent skill walking person_id →
  companies → contracts → subsidies → declarations → votes → donations → EU funds. One query
  ("who is X, really?") returns a written, cited multi-corpus profile. Follow-ons: a
  "timeline constructor" (life-of-a-contract / life-of-an-MP) and a "value-for-money query" skill
  (ask it against the panels §1 confirms exist — obshtina×year unemployment/ДЗИ, oblast×year,
  school, court — **not** the PM2.5 example the first draft used, which has no series behind it).
  **C** (heavy, reuses everything).
  A composed multi-corpus profile about a named person is the single most exposed output on this
  list: it must run through the existing **grounded-number gate** (which already rejects figures
  the tools did not return) *and* through §4.0-1's identity rule, since a dossier is precisely
  where an ungated name match would read as a verified biography.

---

## 5. Ranked shortlist (second wave)

Ranked on (evidence the input exists) × (impact) ÷ (**remaining** effort). Every entry was
measured 2026-08-18; the ordering is the audit pass's, and it differs from the first draft's
because two entries turned out to be largely built and two were rated on inputs that do not
support them.

| # | Idea | Angle | Why it wins |
|---|---|---|---|
| 1 | **Per-place share card + „мандатът в цифри" strip on `/governance/:id`** (was #19, "mayor's report card") | retention | Mass-market, shareable, timed to local elections. Reordered to the top **because the page, the prerender and the sitemap entries all already exist** (§4.0-2) — the missing artifacts are the `og:image` and the term-in-review framing, and `renderOblastCard` in `scripts/og/generate.ts` already does per-place cards through an incremental cache. Turns ~6,000 already-indexed pages into postable objects. |
| 2 | **School value-for-money league** (§4(a)) | outcome×money | The one money↔outcome join that is grain-matched *and* half-built: 917 schools, 14,901 contracts, €496.8M, per-school tile shipped. Ships as a ranking + a methodology page that names the denominator honestly (*own-procurement € per matura point*) and states intake confounding (§4.0-4). |
| 3 | **Euro shock, store by store** (#8) | temporal | Unchanged from the first draft, and it survives the audit intact. Once-in-a-generation event with store-level data nobody else holds; huge media pull while the transition is fresh. Depth is the asset: 11.35M SCD-2 facts, not the 1.4M current snapshot an earlier draft quoted. |
| 4 | **The review queue** (was #21, "lead engine") | red-flag | Same idea, correctly sized and correctly framed: `contract_risk_cache` grades **D 3,244 · E 429 · F 81 — 3,754 contracts**, a human-reviewable queue rather than an infinite feed. Every person↔company edge from the gated set or omitted (§4.0-1); *for review*, never a finding; no comparative clause without a stated comparator. |
| 5 | **Per-entity change feed (JSON + RSS)** (§3 move 1a) | institutional | The buildable half of the alerts move — `company:<eik>` / `person:<slug>` / `place:<code>` → "what changed here", from `ingest_first_seen` + the risk masks. No accounts, edge-cacheable, crawlable, and it is the piece that makes the corpus institutionally consumable. |

**Dropped out of the top five by the audit, with the reason:** *loyalty-to-contract* (n=17 in the
sitting parliament — publishable as a named list, not as a test, §4.0-5) and *Benford across the
money corpora* (B not A — the methodology, not the data, is the work, §4(f)). Both stay on the
board; neither is a flagship.

**Held back pending an ingest:** *micrograms per million* and the road-death arm of the
*trauma-ward ledger*, both of which the first draft rated B on inputs that are a 37-station
snapshot and a national annual scalar respectively (§1).

**Still the two big v1 prizes to keep on the board** (they outrank several of the above on raw
impact but need more methodology care): *political geography of public money* (1.1) and
*revolving-door detector* (2.1). Neither is shipped. 1.1 **is** cheaper now — the graph engine
and `company_public_money` (81,389 rows) both exist. 2.1 is **not**: its blocker was never the
graph, it is that the TR half of `person_role` is undated (§4.0-3), and a shipped graph adds
edges and money but no dates.

**Cheapest structural first move (unchanged from v1, and re-confirmed open):** ship the
`/data/map` lateral edges (`data-hub-lateral-edges-v1.md` T1). Verified 2026-08-18 —
`data/data_map.json` carries `version, generatedAt, nodes, edges, views, tiers, tours` and **no
`links` key**, 101 nodes / 167 edges. Half a day, and the map itself becomes the argument that the
corpus is one linked product — which is the claim every idea above depends on.

---

## 6. Three things this plan still does not decide

Named rather than answered, because each is a decision for whoever picks up an entry above, and
because a plan that is silent on them reads as if they do not apply.

- **Language.** The site prerenders `/en` mirrors and maintains both `route_defs` lists, yet no
  idea here states a language. Some existing place families are deliberately BG-only
  (`/governance/:id`, `/settlement/:id`, `/municipality/:id`); the sector and indicator families
  are bilingual. "A sitemap `<loc>` in **both** lists" (§4.0-2) presumes an answer, so each new
  page must give one — and a BG-only choice is legitimate and should be written down as a choice.
- **What each idea is trying to move.** §3 cites "~0 search impressions" as the failure mode this
  whole plan designs against, and then defines no target for anything. Each shortlist entry should
  carry one number — indexed pages, impressions, returning readers, citations by others — so that
  "it shipped" and "it worked" are distinguishable a quarter later.
- **What happens when a correctly-linked named person disputes a published flag.** §4.0-1 settles
  *whether the link is real*; it says nothing about the aftermath. The review queue, the
  auto-dossier and the MP-contracts list all publish claims about named individuals at scale. A
  stated correction path and a per-page "dispute this" affordance is cheap to build and is the
  kind of omission that ends a project rather than degrading it.
