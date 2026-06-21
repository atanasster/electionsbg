---
keywords:
  - public procurement
  - corruption risk index
  - single bidding
  - АОП
  - ЦАИС ЕОП
  - SIGMA
  - opentender
  - OCDS
  - DOZORRO
  - red flags
  - MP-connected companies
  - beneficial ownership
  - data.egov.bg
schemaType: Article
---
# Following the public money: a citizen's toolkit for procurement

Bulgaria signs tens of thousands of public-procurement contracts a year. The records are public — and almost unusable. They live as thousands of files on [data.egov.bg](https://data.egov.bg/) and inside the [ЦАИС ЕОП](https://app.eop.bg/) system, with no way to ask the questions that matter: *Who keeps winning without competition? Which companies are tied to the people who run the state? Where does my município's money go?*

The [Public Procurement](/procurement) module answers those questions. It holds **255,198 contracts and amendments** worth **€74.7 billion**, from **4,389 contracting authorities** to **23,598 companies**, covering **2011 through 2026** — and it layers an explainable risk score, money-flow diagrams, a person scanner, a geographic view and a red-flag feed on top. This piece sets it against what exists in Bulgaria and abroad, walks through each tool, and ends with what you can actually find with it.

## 1. The landscape: Bulgaria and abroad

**In Bulgaria,** the primary source is the Public Procurement Agency (АОП) and the ЦАИС ЕОП platform, republished as open data on [data.egov.bg](https://data.egov.bg/organisation/about/aop). It is comprehensive and authoritative — and raw: no analytics, no risk scoring, and crucially no link between a contract and the *people* behind the winning company. In June 2026 the Ministry of Innovation launched [СИГМА](https://sigma.midt.bg) (sigma.midt.bg), a government analytics layer over the *same* АОП data. It has a clean interface and ships a working directory of authorities, companies and authority→company flows, plus search, from day one — a solid base to build on. The more ambitious features it announced (an AI assistant, a green/yellow/red risk index and a beneficial-owner layer) are, for now, slated for a later stage.

Beyond the official registers, Bulgaria has accumulated civic and commercial efforts around procurement — from investigative journalism to business services:

| Platform | What it is | Focus | Status |
| --- | --- | --- | --- |
| [BIRD / Bivol](https://scan.bird.bg/) | investigative journalism + search | PEPs, public spending, companies, procurement, EU funds — search by name | active |
| [IME — Open Public Procurement](https://ime.bg/) | open-data analysis + a dedicated site (oop.ime.bg) | spending efficiency, indicators | the dedicated site is no longer maintained |
| [Anti-Corruption Fund](https://acf.bg/) | investigative NGO | specific procurement schemes — reports, not a database | active |
| [BILI](http://www.bili-bg.org/) | legal-initiatives NGO | integrity, declarations, judicial transparency (not a procurement tool) | active |
| [aop-baza.bg](https://www.aop-baza.bg/), [targove.info](https://www.targove.info/) | commercial alert services | subscription: filtered BG+EU notices, daily email (free tier) | active · paid |
| [ZOP Plus](https://zopplus.com/) | specialist magazine + "ZOP+ Assistant" | expert consulting, training, documentation | active · paid |

**Abroad,** the reference standard is the [Open Contracting Data Standard](https://standard.open-contracting.org/) (OCDS), which makes procurement comparable across countries. The EU-wide [opentender.eu](https://opentender.eu/) project (DIGIWHIST) pioneered a quantitative **Corruption Risk Index** — the work of Mihály Fazekas and the [Government Transparency Institute](https://www.govtransparency.eu/) — built on objective red flags: single bidding, short tender windows, non-open procedures, supplier concentration. Ukraine pairs its [ProZorro](https://prozorro.gov.ua/) procurement system with the civil-society [DOZORRO](https://dozorro.org/) layer, which monitors risk and lets anyone *follow* a buyer or supplier. Commercial platforms (Spend Network and Tussell in the UK, GovSpend in the US) sell buyer/supplier dashboards and alerts; the US [USAspending.gov](https://www.usaspending.gov/) offers a drill-down explorer with geographic maps.

**Where this module fits:** it borrows the international playbook — the explainable Fazekas-style risk index, the DOZORRO "follow an entity" idea, OCDS-grade structure — and adds the one thing none of the others localise: the **political-accountability cross-join**. Every contract is checked against the Bulgarian political class — MPs, ministers, mayors, councillors, governors — via their declarations to the [Audit Office](https://register.cacbg.bg/) and the [Commerce Registry](https://portal.registryagency.bg/CR/). The table below compares feature by feature.

| Feature | АОП / ЦАИС ЕОП | SIGMA | opentender.eu | ProZorro / DOZORRO | Naiasno |
| --- | --- | --- | --- | --- | --- |
| Coverage | all PPA contracts | 2020– | EU, incl. BG | Ukraine | BG, 2011–2026 |
| Open standard (OCDS) | yes | no | yes | yes | yes |
| Explainable risk index | no | announced | yes | yes | yes |
| Single-bidder flag | no | no | yes | yes | yes |
| Other red flags | no | announced | yes | yes | yes |
| Money-flow diagrams | no | yes | no | partial | yes |
| Links to politicians / owners | no | announced | no | partial | yes |
| Map by region / municipality | no | no | partial | yes | yes |
| Search by person / company | partial | yes | yes | yes | yes |
| Follow / watchlist | no | no | no | yes | yes |
| AI assistant (natural language) | no | announced | no | partial | yes |
| Local-government procurement | no | partial | partial | yes | yes |
| Access | free · state | free · state | free · academic | free · state + civic | free · Bulgarian · independent |

"Announced" means a feature stated on the roadmap but not yet shipped (as of June 2026).

A second group sits outside this comparison: commercial market-intelligence platforms and public-spending portals. They solve a different problem — helping vendors win customers, or making one government's spending visible — so they don't score corruption risk or link contracts to politicians:

| Platform | What it is | For whom / focus | Access |
| --- | --- | --- | --- |
| [Spend Network](https://www.spendnetwork.com/) | global procurement database (160+ countries) | suppliers & analysts | paid |
| [Tussell](https://www.tussell.com/) | UK contract & framework data | supplier market intelligence | paid |
| [GovSpend](https://govspend.com/) | US procurement & spend data | selling to the public sector | paid |
| [USAspending.gov](https://www.usaspending.gov/) | official US federal spending portal | government-spending transparency | free · state |

## 2. The tools

### An explainable risk index, not a black box

Every contract carries a **Corruption Risk Index** from 0 to 100 — the share of the applicable red-flag checks that fired, in the Fazekas/Government-Transparency-Institute tradition. It is deliberately transparent: the page shows *which* checks fired and how many were even applicable ("3 of 7 risk checks"), so you can judge it yourself rather than trust a colour.

![A contract page with the explainable Corruption Risk Index meter and red-flag chips](/articles/images/procurement-tools/01-risk-index.png)

*[See it live: an example contract →](/procurement/contract/09e1dcda9dd5)*

The checks: a **single bidder** (read from the bid count the OCDS feed actually publishes, and suppressed in markets that are structurally single-bid so it doesn't cry wolf[^cpv]), a **non-open procedure**, a **short tender window**, an **amendment** that revises the original deal, a contractor on the АОП **debarment register**, a buyer whose spending is **concentrated** on one supplier, and a contractor **tied to an MP or a public official**.

### Where the money flows

Each company and authority page draws the money flow as a Sankey diagram — for a supplier, which authorities pay it; for a buyer, which suppliers it pays — with companies tied to a parliamentarian highlighted.

![A buyer-to-supplier money-flow Sankey diagram on a company page](/articles/images/procurement-tools/02-entity-flow.png)

*[See it live: a company page →](/company/103267194)*

A treemap shows the same composition by size, so concentration is visible at a glance.

![A treemap of a company's procurement revenue by buyer](/articles/images/procurement-tools/03-treemap.png)

*[See it live: a company page →](/company/103267194)*

### The people behind the companies

The module surfaces, on each company page, the politicians tied to it — and not only MPs. Mayors, deputy-mayors, councillors, ministers, governors and agency heads are matched to the companies they declared a stake in or appear as an officer of in the Commerce Registry.

![The "connected officials" section on a company page](/articles/images/procurement-tools/04-officials.png)

*[See it live: a company page →](/company/103267194)*

Or start from the person: the [public money scanner](/procurement/people) lets you type a politician and see the procurement reachable through their connected companies.

![The public money scanner, searching a politician by procurement ties](/articles/images/procurement-tools/07-scanner.png)

*[See it live: the public money scanner →](/procurement/people)*

A link here is a **declared tie from a public register, not an accusation**. Bulgarian law lets officials own shares; it forbids sitting MPs from management roles but not past business or ownership. The tool surfaces the relationship and cites the source — the judgement is yours.

### Your own município

Local procurement surfaces on every place dashboard: what the município, its schools and its hospitals spent, and on whom.

![The local-procurement tile on a place dashboard](/articles/images/procurement-tools/08-myarea.png)

*[See it live: the Plovdiv dashboard →](/governance/PDV22)*

And the [maps](/procurement/by-settlement) show every oblast three ways at once — total, **per capita** (so they don't just redraw the population map) and average contract value. Click any oblast on any of the maps to filter the settlement table beneath them.

![Choropleth maps of procurement by oblast — total, per capita and average contract value](/articles/images/procurement-tools/05-choropleth.png)

*[See it live: the oblast maps →](/procurement/by-settlement)*

### The red-flag feed

The [red-flag feed](/procurement/flags) collects the signals worth a second look in one place — buyers concentrated on a single supplier, active debarments, and the largest politically-connected contractors. And, DOZORRO-style, you can **follow** any buyer, supplier or politician and keep them on your own watchlist.

![The procurement red-flag feed](/articles/images/procurement-tools/06-flags.png)

*[See it live: the red-flag feed →](/procurement/flags)*

## 3. What you can find

**Single-supplier concentration.** Across the corpus, **51% of contracts whose bid count is published had a single bidder** — Bulgaria's well-documented competition problem. The feed surfaces the extreme cases: buyers that have sent *100%* of their procurement to one company. Many are small schools — e.g. a secondary school in the village of Ribnovo that placed all **€5.0 million** of its contracts with a single Blagoevgrad firm — where a single supplier dominating millions in spending warrants a question, even if each award was lawful.

**The political class as contractors.** The module records **55 MPs tied to 59 companies** that have won contracts worth **€710 million** over the full period, and **120 non-MP officials** tied to **134** contractor companies. The largest ties run through familiar names: a municipal councillor is a declared officer of a pharmaceutical distributor that has won **€1.6 billion** in state contracts; a deputy-mayor of a state road-building company at **€325 million**; a councillor of a nuclear-maintenance firm at **€235 million**; a mayor of a construction company at **€158 million**. None of this is itself wrongdoing — it is exactly the map of declared interest that was, until now, scattered across thousands of filings.

**Per-município reality.** Because every local buyer is pinned to its settlement, you can read a município like Plovdiv directly: **€3.5 billion** awarded across 12,404 contracts, led by the regional electricity distributor, the university hospital and the municipality itself.

## 4. Method and limits

Everything derives from the same open АОП / ЦАИС ЕОП data — no private source. The single-bidder signal reads the realised bid count the OCDS feed publishes; it is gated against a per-sector competition baseline so structurally single-bid markets aren't falsely flagged. Person links use **only** high-confidence matches — a declared stake or a unique-name Commerce-Registry record — and are dropped where a common Bulgarian name would create false positives. Out of scope: contracts below the Public Procurement Act thresholds, in-house awards, and foreign suppliers. The risk index is a sorting and screening aid, not legal evidence; every figure links back to its source on data.egov.bg so you can check it yourself.

Open the [Public Procurement](/procurement) module, or ask the [assistant](https://ai.electionsbg.com) a question like *"show the procurement red flags"* — and follow the money.

## Sources

**Bulgarian data and registers**

- Public Procurement Agency (АОП) — open data: [data.egov.bg](https://data.egov.bg/organisation/about/aop)
- ЦАИС ЕОП (Central Automated Information System for e-Procurement): [app.eop.bg](https://app.eop.bg/)
- СИГМА (Ministry of Innovation and Growth): [sigma.midt.bg](https://sigma.midt.bg)
- Audit Office — asset & interest declarations: [register.cacbg.bg](https://register.cacbg.bg/)
- Commerce Registry (Registry Agency): [portal.registryagency.bg/CR](https://portal.registryagency.bg/CR/)

**Standards and methodology**

- Open Contracting Data Standard / Open Contracting Partnership: [standard.open-contracting.org](https://standard.open-contracting.org/)
- Government Transparency Institute: [govtransparency.eu](https://www.govtransparency.eu/)
- Fazekas, Tóth & King — *Anatomy of Grand Corruption: A Composite Corruption Risk Index Based on Objective Data* (SSRN): [papers.ssrn.com/abstract=2331980](https://papers.ssrn.com/abstract=2331980)

**International tools**

- opentender.eu (DIGIWHIST): [opentender.eu](https://opentender.eu/)
- ProZorro (Ukraine): [prozorro.gov.ua](https://prozorro.gov.ua/)
- DOZORRO (Transparency International Ukraine): [dozorro.org](https://dozorro.org/)
- Spend Network: [spendnetwork.com](https://www.spendnetwork.com/)
- Tussell: [tussell.com](https://www.tussell.com/)
- GovSpend: [govspend.com](https://govspend.com/)
- USAspending.gov: [usaspending.gov](https://www.usaspending.gov/)

[^cpv]: We decide this per sector, from the data — no hand-picked list. For each two-digit CPV division (the EU's Common Procurement Vocabulary) we measure the share of contracts with a published bid count that had only one bidder; if that share is 80% or more, we treat the division as structurally single-bid and suppress the flag there. The thresholds are recomputed from the corpus on every update. Currently 7 of 45 divisions qualify — among them water supply, electricity/gas/water distribution, postal and telecom services, real estate, R&D services, and printed matter.
