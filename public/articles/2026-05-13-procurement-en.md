---
keywords:
  - public procurement
  - АОП
  - data.egov.bg
  - state contracts
  - MP-connected companies
  - Sofarma Trading
  - Ministry of Health
  - CAIS EOP
  - cacbg
  - Commerce Registry
  - conflict of interest
  - 52nd National Assembly
---
# The state's money — a new module for public procurement, and which MP-connected companies have been paid

For years Bulgarian voters have been able to see *how* a given MP voted, *where* they were elected from, and *what* they declared as assets or shareholdings. What was missing — without manually downloading thousands of JSON bundles from data.egov.bg and cross-checking against the [MP business graph](/connections) — was the other side of the redistribution ledger: **which companies the state actually pays, how much they have been paid, and which of those companies have a recorded link to a sitting or former MP**.

The new [Public procurement](/procurement) module fills exactly that gap. The corpus currently holds **244,556 contracts and amendments** from **3,369 awarders** to **23,123 contractors**, covering **2011 through 2026**. During the post-2026-04-19 period (the 52nd National Assembly), 7 MPs have connected companies that received a combined €1.4M. Across the full 15-year corpus — **77 MPs are linked to 91 companies that together have received over €2.6B in state contracts**.

This article walks through the data sources, the four new pages (full corpus, company, awarder, MP), and ends with a worked example: a former MP whose Commerce Registry record names him as representative and director of Bulgaria's largest pharmaceutical distributor — a company with nearly 4,000 state contracts totalling €1.59B.

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

## 5. The contractor page — [/company/:eik](/company/103267194)

A dashboard-style page for every contractor company. Four KPI cards at the top (total awarded, contracts, awarders, MP-connected), beneath them a "MP linkages" tile (when applicable), a dual-axis "By year" chart (bars for euro value, line for contract count), and two side-by-side tiles at the bottom:

- **Top contracts** — the company's ten largest contracts by value, with date, awarder, amount, and a direct link to [CAIS ЕОП](https://app.eop.bg/) for each. The *See all →* link opens the full paginated table at [/company/:eik/contracts](/company/103267194/contracts).
- **Top awarders** — which state institutions have paid this company the most, with total amount and contract count for each.

A footer line at the bottom of the page cites the source and links to data.egov.bg.

## 6. The awarder page — [/awarder/:eik](/awarder/115576405)

A mirror dashboard of the contractor page, but from the buyer side — what is this institution's total state spending, to which contractors, in which years, and which of those contractors are MP-linked. When the awarder is a municipality or central government institution, the page lists in a dedicated card exactly the contractors with connected persons in parliament — along with the total each has been paid.

## 7. The MP page — [/candidate/:id](/candidate/mp-2237)

In the profile of every MP whose recorded-linked companies appear in the corpus, a new **"Connected companies with public procurement"** tile has been added. It lists every such company with the linkage type (management role or shareholding), the total contract value, and a link to the company's own page. The *See full details →* link opens a dedicated page at [/candidate/:id/procurement](/candidate/mp-2237/procurement), which for every linked company shows:

- Linkage type (representative, director, partner, beneficial owner, procurator, liquidator, declared shareholding)
- Contract count and total value in euros
- A "By year" chart with a legend (bar: €, line: contract count)
- The top five awarders for that company, each linking to its dashboard

A summary line at the top of the page reads *N companies · M contracts · €X total awarded · 2011–2026 (across the full available period)*, so the depth of the trail is visible at a glance.

---

## 8. A worked example — the former MP and the pharmaceutical distributor

This example sits at the top of the [Top MPs by connected procurement](/procurement/mps) ranking the moment you open the module. It is also the densest single case in the entire corpus.

### The two sides

- **[Dimitar Georgiev Dimitrov](/candidate/mp-2237)** — former MP, recorded in the Commerce Registry as *representative* and *director* of the company below.
- **[SOPHARMA TRADING AD](/company/103267194)** (EIK 103267194) — Bulgaria's largest pharmaceutical distributor.

The link is a name match against the Commerce Registry (confidence: medium — as is the case for most Commerce Registry-only entries) and is currently active.

### The numbers

Across the full 15-year corpus, [Sopharma Trading's page](/company/103267194) shows:

- **3,985 contracts + amendments** from **50 state awarders**
- **Total value €1.58B** (€228M in EUR after the eurozone transition + 2.64B leva for 2011–2025)
- The "By year" chart shows a steady run of around €70–100M per year through 2011–2019, then a sharp jump in 2022 — €280M across 580 contracts (the bar tooltip for 2022 confirms the numbers).

The top five awarders for this company:

| awarder | total | contracts |
|---|---|---|
| [Ministry of Health](/awarder/000695317) | €132.2M | 734 |
| [University Hospital "Sveti Georgi" EAD (Plovdiv)](/awarder/115576405) | €111.5M | 71 |
| [Military Medical Academy](/awarder/129000273) | €111.3M | 96 |
| University Hospital "Dr Georgi Stranski" EAD (Pleven) | €131.1M | 89 |
| Specialised Hospital for Active Treatment of Haematological Diseases EAD | €106.2M | 45 |

In other words: more than half of Bulgaria's largest oncology and university hospitals have paid this company under public procurement. That **is not in itself surprising** — Sopharma Trading is a national distributor of medicines, diagnostics and medical devices, and oncology therapies and hospital supply are markets where a small number of registered distributors cover the whole country. But the fact that the company's representative and director (per the Commerce Registry record) was a Member of Parliament is worth seeing — and that is precisely what this module is for.

### Why medium confidence

The link is labelled "medium confidence" because the name match against the Commerce Registry is purely textual — without cross-confirmation from electoral district or co-declaration. This is the *conservative* part of the system: it includes any record whose name matches unambiguously, and leaves it to the reader to verify whether it is in fact the same physical person. The source link to the Commerce Registry record is one click away on the company page's "MP linkages" tile.

By contrast, *high-confidence* links are confirmed by at least one additional signal — typically a co-declaration in [register.cacbg.bg](https://register.cacbg.bg/) or a clear cross-reference from a party list.

### What is (and isn't) visible

What *is* visible in the data: a former MP is recorded in the public Commerce Registry as representative and director of a company that between 2011 and 2026 has won close to 4,000 state contracts totalling €1.59B, of which a quarter comes from the Ministry of Health alone.

What is **not** visible: whether those contracts were won by tender or directly awarded, whether prices were above market, whether a management role here implies active involvement in bidding or merely formal corporate representation before the state. The module *does not answer* those questions — they are answered by [АОП](https://app.eop.bg/), [CAIS ЕОП](https://app.eop.bg/) and the Competition Protection Commission, not by the chart here.

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
