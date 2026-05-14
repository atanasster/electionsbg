---
keywords:
  - public procurement
  - АОП
  - data.egov.bg
  - state contracts
  - MP-connected companies
  - Energy Supply EOOD
  - CAIS EOP
  - cacbg
  - Commerce Registry
  - conflict of interest
  - 52nd National Assembly
---
# The state's money — a new module for public procurement, and which MP-connected companies have been paid

For years Bulgarian voters have been able to see *how* a given MP voted, *where* they were elected from, and *what* they declared as assets or shareholdings. What was missing — without manually downloading thousands of JSON bundles from data.egov.bg and cross-checking against the [MP business graph](/connections) — was the other side of the redistribution ledger: **which companies the state actually pays, how much they have been paid, and which of those companies have a recorded link to a sitting or former MP**.

The new [Public procurement](/procurement) module fills exactly that gap. The corpus currently holds **244,556 contracts and amendments** from **3,369 awarders** to **23,123 contractors**, covering **2011 through 2026**. During the post-2026-04-19 period (the 52nd National Assembly), 4 MPs have connected companies that received a combined €283K. Across the full 15-year corpus — **63 MPs are linked to 69 companies that together have received over €1B in state contracts**.

This article walks through the data sources, the four new pages (full corpus, company, awarder, MP), and ends with a worked example: a three-term former MP who openly declared a shareholding in an energy-supply company that has won €7M in contracts across the railway operator, the Naval Command, and the Council of Ministers.

---

## 1. What this is and isn't

This is a **public corpus of procurement contracts**, cross-referenced against the [MP business graph](/connections), to identify the contractor companies that have a recorded link to a sitting or former MP.

- **Contracts** are imported verbatim from the [Public Procurement Agency (АОП)](https://app.eop.bg/) via [data.egov.bg](https://data.egov.bg/organisation/about/aop). This includes every signed contract, amendment, and award decision under the Public Procurement Act.
- **Connected persons** come from the same graph that the [previous module](/articles/2026-05-04-mp-connections) describes — declarations to the [Audit Office](https://register.cacbg.bg/) (shareholdings) and the [Commerce Registry](https://portal.registryagency.bg/CR/) (management roles).

This is **not** an accusation list. A company that has won a public-procurement contract and is linked to an MP is not automatically breaking the law — Bulgarian legislation forbids *active* management roles by sitting MPs (Anti-Corruption Act art. 35) but does not forbid shareholdings, nor historical Commerce Registry roles, nor a connected company winning a contract on its merits. The point of the module is to make this public record easily readable.

This is **not** a complete list either: contracts below the Public Procurement Act thresholds, in-house awards, contracts before 2011, and companies registered outside Bulgaria remain outside the corpus.

## 2. Sources and refresh cadence

| source | what it provides | format | refresh |
|---|---|---|---|
| [data.egov.bg](https://data.egov.bg/organisation/about/aop) (АОП OCDS) | signed contracts, amendments, award decisions — from 2026 in OCDS format published in fortnightly bundles; 2011–2025 as legacy annual CSVs | JSON / CSV | fortnightly for 2026; one-off backfill for the archive |
| [register.cacbg.bg](https://register.cacbg.bg/) | MP shareholdings in companies (Table 10) | XML per declaration | once a year, in spring |
| [data.egov.bg](https://data.egov.bg/) — dataset 2df0c2af-… (Commerce Registry) | management roles, partners, beneficial owners | bulk JSON | daily, processed in batches |

АОП's OCDS bundles include source URLs to [CAIS ЕОП](https://app.eop.bg/) — the centralised public-procurement information system. Legacy contracts (pre-2026) come from АОП via the old РОП system, whose per-contract permalinks are no longer reliable; for those the source link points to the data.egov.bg dataset.

EIK numbers are canonicalised to 9 digits (the standard), with the 13-digit branch-suffix form preserved for the source link. This is necessary because different registries spell the same company differently.

---

## 3. Where it appears — the national dashboard

The first place a casual reader encounters the data is the [**Public procurement**](/#procurement) section of the national dashboard, beneath [*MP declarations*](/#declarations) and above [*Polling agencies*](/#polling).

The section has two side-by-side tiles:

- **Top MPs by connected procurement** — a ranking of five MPs (sitting or former) whose recorded-linked companies have been paid the most during the selected parliament's period. The filter is on *contract date*, not on whether the MP is currently sitting — so a former MP whose linked company has continued to win state contracts can sit at the top of the ranking. Each row shows the MP's avatar, the main connected company name, and the total in euros. Clicking the name navigates to the MP's profile and auto-scrolls to the new "Connected companies with public procurement" tile — described in §6 below.
- **Top contractors** — a ranking of the ten companies with the largest contract value over the selected period; rows for companies with a recorded MP linkage are flagged with an *"MP-connected"* chip.

The section header carries a [*Open the full analysis →*](/procurement) link to the full module page.

---

## 4. The [/procurement](/procurement) page

The full view. By default scoped to the period of the currently selected parliament — a *Show all years →* toggle in the top right switches to the full 15-year corpus.

### KPI block

Four cards with summary statistics for the chosen scope:

- **Contracts** — total count, broken down as "primary contracts + supplementary agreements (amendments)".
- **Total awarded** — total value, converted to euros at the locked BNB rate (1.95583 for BGN) and at recent reference rates for USD/GBP/CHF. From January 1, 2026 onwards values arrive directly in euros from АОП — the transition stays visible in the per-company "By year" chart (bars in euros from 2026 onwards).
- **Contractors** — number of distinct companies that have won at least one contract, with a qualifier showing how many state buyers paid them.
- **MP-connected** — number of MPs whose recorded-linked companies appear in the corpus, plus the count of companies and the total euro amount.

### Money flow to connected companies (Sankey)

Below the KPI block sits an interactive diagram showing the three sides of the flow in three columns:

> **Awarder → Contractor → MP**

Ribbon thickness corresponds to contract value. A *Minimum-value filter* slider in the top left drops small links to keep the diagram readable — for the full corpus the default threshold is around €40M, but it can be pulled down to zero to inspect the long tail.

The diagram shows only **contractors with a recorded MP linkage** — the full bipartite graph (every awarder × every contractor) would be unreadable. Ribbons colour the three columns separately: dark blue for awarders, orange for contractors, light blue for MPs.

### Top contractors, top awarders, top MPs

Three tiles with "See all →" links to dedicated pages:

- [/procurement/contractors](/procurement/contractors) — full sortable table of contractors across the whole corpus, with MP-linked companies highlighted.
- [/procurement/awarders](/procurement/awarders) — top awarders for the selected parliament. The ranking shifts when you switch to the full-corpus view.
- [/procurement/mps](/procurement/mps) — full page of the top MPs by connected procurement.

---

## 5. The contractor page — [/company/:eik](/company/175392783)

A dashboard-style page for every contractor company. Four KPI cards at the top (total awarded, contracts, awarders, MP-connected), beneath them a "MP linkages" tile (when applicable), a dual-axis "By year" chart (bars for euro value, line for contract count), and two side-by-side tiles at the bottom:

- **Top contracts** — the company's ten largest contracts by value, with date, awarder, amount, and a direct link to [CAIS ЕОП](https://app.eop.bg/) for each. The *See all →* link opens the full paginated table at [/company/:eik/contracts](/company/175392783/contracts).
- **Top awarders** — which state institutions have paid this company the most, with total amount and contract count for each.

A footer line at the bottom of the page cites the source and links to data.egov.bg.

## 6. The awarder page — [/awarder/:eik](/awarder/115576405)

A mirror dashboard of the contractor page, but from the buyer side — what is this institution's total state spending, to which contractors, in which years, and which of those contractors are MP-linked. When the awarder is a municipality or central government institution, the page lists in a dedicated card exactly the contractors with connected persons in parliament — along with the total each has been paid.

## 7. The MP page — [/candidate/:id](/candidate/mp-3410)

In the profile of every MP whose recorded-linked companies appear in the corpus, a new **"Connected companies with public procurement"** tile has been added. It lists every such company with the linkage type (management role or shareholding), the total contract value, and a link to the company's own page. The *See full details →* link opens a dedicated page at [/candidate/:id/procurement](/candidate/mp-3410/procurement), which for every linked company shows:

- Linkage type (representative, director, partner, beneficial owner, procurator, liquidator, declared shareholding)
- Contract count and total value in euros
- A "By year" chart with a legend (bar: €, line: contract count)
- The top five awarders for that company, each linking to its dashboard

A summary line at the top of the page reads *N companies · M contracts · €X total awarded · 2011–2026 (across the full available period)*, so the depth of the trail is visible at a glance.

---

## 8. A worked example — the former MP and the energy-supply company

This is the cleanest high-confidence case in the corpus: the MP himself declared the shareholding to the Audit Office, so the "is this the right person?" question doesn't arise.

### The two sides

- **[Georgi Stoyanov Kadiev](/candidate/mp-3410)** — former three-term MP (40th, 42nd, and 43rd National Assembly), who in his Audit Office filing declared a shareholding in the company below.
- **[ENERGY SUPPLY EOOD](/company/175392783)** (EIK 175392783) — an energy supplier registered in Bulgaria.

The link is **high confidence** — sourced not from a Commerce Registry name match but from the MP's own filing.

### The numbers

Across the full 15-year corpus, [Energy Supply's page](/company/175392783) shows:

- **22 contracts + amendments** from a small set of state buyers
- **Total value ≈ €7.06M**

The top three awarders for this company:

| awarder | total |
|---|---|
| National Railway Infrastructure Company (НКЖИ) | BGN 2.95M |
| Naval Forces Command, Varna | BGN 2.44M |
| Council of Ministers | BGN 1.78M |

This is exactly the scenario the declaration system was designed for: the MP openly registered the interest, the state openly signed the contracts, and a citizen can now see both sides together in a couple of minutes — without downloading hundreds of XML files.

### Why this is high confidence (and why most rows aren't)

Most MP↔company rows on the dashboard sit at *medium* confidence — they rest on a name match against the Commerce Registry's officer list, without further corroboration. A row is **promoted to high** only when at least one of these is true:

1. **The MP self-declared the shareholding** — as Kadiev did here; this is the strongest possible witness because it's the MP themselves saying "yes, this is me."
2. **The company's registered seat overlaps the MP's electoral district** — independent geographic evidence.
3. **A co-partisan MP also declared the same company** — the second declaration corroborates the identity.

What the medium label honestly admits: "the name matches, the rest is up to you." A national pharmaceutical-distributor executive named Dimitar Dimitrov, for example, will share a name with thousands of unrelated Bulgarian citizens; the conservative thing is to flag rather than assert.

### What we actively suppress

Two classes of false positive are stripped before the data ever hits the dashboard:

- **Non-seated profiles**: `parliament.bg` returns a full registry of every name in its database — including electoral-list candidates who never won a seat. With common Bulgarian name combinations, a never-seated profile would otherwise attach to dozens of unrelated Commerce Registry officers. Profiles with no current term, no historical term, no Audit Office declaration, and no parliament-issued photo are excluded automatically.
- **Confirmed name collisions**: where public reporting clearly identifies a different individual behind a Commerce Registry record (a corporate executive with a common name who is demonstrably not the politician), the row is added to a hand-maintained suppression list and never reaches the published data.

---

## 9. Refresh cadence

- **OCDS bundles** — АОП publishes a new fortnightly bundle approximately every 14 days. The scripts walk the [data.egov.bg](https://data.egov.bg/dataset?q=обществени+поръчки) dataset listing, fetch new bundles, and append them to the corresponding month-shard.
- **Legacy contracts (2011–2025)** — backfilled once from the annual CSV bundles on data.egov.bg. No further refresh expected unless АОП publishes a correction.
- **MP cross-reference** — recomputed whenever the MP business graph ([companies-index.json](/articles/2026-05-04-mp-connections)) is refreshed. When the next spring declaration batch arrives from the Audit Office, the MP page tiles, the dashboard, the company pages, and the Sankey all update together.

## 10. Limitations and honest caveats

- **PPA thresholds.** Contracts below the Public Procurement Act thresholds are not subject to publication and are not in the corpus. Real payments to a company that operates below threshold will look smaller than they actually are.
- **Signed contracts, not payments.** The corpus shows *value at signing*, not amounts actually paid. A €10M contract executed at 30% will still appear as €10M.
- **In-house awards.** Contracts under Art. 14(1)(5–7) of the Public Procurement Act (internal awards between public bodies and their entities) pass through the register, but are not economically "public procurement" in the usual sense.
- **Currency conversion.** EUR/BGN at the locked BNB rate (1.95583). USD/GBP/CHF using a single reference average. Fine for ranking; not a substitute for the spot rate on the day of contract.
- **Medium-confidence linkages.** Name match against the Commerce Registry, without further confirmation. Exactly the right place for your scepticism.
- **A 15-year corpus, not "everything ever".** Contracts before 2011 (before АОП's current form) are out of scope. The list of 23,123 companies excludes those that disappeared from the Commerce Registry before 2011.

## 11. What this enables

The intent of the module is not to replace АОП, the Audit Office, or the Anti-Corruption Commission. It is to make a public record *readable* — to turn a quarter-million OCDS bundles into one dashboard where a citizen, journalist or campaign-finance researcher can see in a minute whether a given company has won state contracts, who paid them, and whether a Member of Parliament stands or stood behind them.

Most of what you see here is entirely legal. The point is that "entirely legal" is now also visible — and that the small set of items that deserve a closer look stand out by contrast.

If you spot a wrong record, a false-positive linkage, or a missing year, write to us — the source data and the module's pipeline are open source. Affected parties are welcome to submit corrections if they claim the public record is incorrect.
