# Home dashboard research v1 — Bulgaria in data

**Status:** product recommendation, ready for design and implementation planning
**Date:** 1 September 2026
**Scope:** the public root page, its durable navigation, a national “what changed” feed, and the relationship between elections, places, prices, public money, and sectors
**Not in scope:** implementing or restyling the page in this phase

## Recommendation in one sentence

Replace `/` with a **state-of-Bulgaria front door**: four dated pulse facts, one place/subject finder, eight high-intent destinations, and a typed **“Какво се промени”** rail; preserve the current rich parliamentary dashboard under `/elections`, and temporarily promote elections on the home page only when an election is active.

This is a change of hierarchy, not a reduction of the product. Elections remain a first-tier destination. They stop being the only frame through which the rest of the platform is discovered.

## Executive decision

The durable home-page order should be:

1. **Prices and promotions** — persistent, household-level intent and a daily data stream.
2. **My area** — the strongest route from a national overview to personally relevant local evidence.
3. **Elections** — high peaks and a core product strength, but episodic outside election periods.
4. **State budget** — the national revenue, spending, balance, and debt picture.
5. **Contracts and tenders** — transactional search intent and daily changes.
6. **EU funds and open calls** — projects, beneficiaries, available funding, and deadlines.
7. **Schools, pensions, health, roads, energy, and agriculture** — concrete sector language rather than an abstract “sectors” label.
8. **Parliament, people, and power** — votes, officials, connections, declarations, and institutional oversight.

The leading national summary should contain no more than four comparable, dated facts. It should not invent a composite “state score” and it should not total the 19 sector surfaces, whose money bases overlap and differ.

The changing-content section should initially be called **“Какво се промени”**, not “News”. The underlying items are detected from structured public data; they are evidence of change, not a claim that an editor has selected or reported a complete news agenda.

---

## 1. Research method and limits

### Demand evidence

The demand research uses public Google Trends comparisons for Bulgaria, captured on 1 September 2026, over both a trailing year and five years. It compares broad nouns with qualified, task-oriented phrases because a generic term such as `договори` or `община` is ambiguous.

Google Trends is sampled, relative, normalized data—not absolute monthly search volume, polling, or market share. A value of 100 is the peak inside a particular comparison; an average of 10 in one comparison cannot be compared with an average of 10 in a different comparison. Very small series can round to zero without meaning “nobody searched”. Google documents these constraints in its [FAQ about Trends data](https://support.google.com/trends/answer/4365533?hl=en) and distinguishes literal search terms from broader [topics](https://support.google.com/trends/answer/17309543).

Google’s official 2025 Year in Search country selector lists [Bulgaria as unavailable](https://trends.withgoogle.com/bg/year-in-search/2025/). Therefore this report does **not** claim to provide an absolute ranking of every Bulgarian search. It gives a directional comparison of the product topics the team named, then checks that signal against public-opinion evidence, national relevance, and the platform’s actual data strength.

### Product evidence

The product audit covers:

- the current React root and static prerender/SEO surface;
- existing module hubs and precomputed figures;
- municipal alerts and browser-local watchlists;
- the database change wire and operator update log;
- live price, procurement, funds, council, macro, budget, and debt update paths.

The repository has no current Search Console or analytics export. The proposed order is therefore a strong launch hypothesis, not a substitute for observing real home-page click-through and organic entry data after release.

### Evidence hierarchy

1. Repository code, generated state, and source-specific ingestion rules.
2. Primary public sources: Google Trends/Google help, European Commission, Eurostat, and official dashboard guidance.
3. Secondary sources only for discovering primary documents; none is needed to support the recommendation.

---

## 2. What Bulgarians search for within this topic set

### 2.1 Durable demand: prices and place

In a same-request trailing-year comparison, the average Bulgarian interest was:

| Search term | Relative average |
|---|---:|
| `цени` | 13 |
| `община` | 10 |
| `избори` | 4 |
| `бюджет` | 2 |
| `данъци` | 2 |

Source: [Google Trends, Bulgaria, 1 Sep 2025–1 Sep 2026](https://trends.google.com/trends/explore?date=2025-09-01%202026-09-01&geo=BG&q=%D1%86%D0%B5%D0%BD%D0%B8,%D0%BE%D0%B1%D1%89%D0%B8%D0%BD%D0%B0,%D0%B8%D0%B7%D0%B1%D0%BE%D1%80%D0%B8,%D0%B1%D1%8E%D0%B4%D0%B6%D0%B5%D1%82,%D0%B4%D0%B0%D0%BD%D1%8A%D1%86%D0%B8).

This is not a reason to turn the home page into a price-comparison site. It is a reason to open the national picture with the household economy and to make the local route immediately visible. Both are persistent needs, unlike an election result that dominates for a short interval and then recedes.

The external context reinforces this result. In Standard Eurobarometer 104, 50% of Bulgarian respondents named rising prices, inflation, or cost of living among the two most important national issues ([European Commission survey](https://europa.eu/eurobarometer/surveys/detail/3378)). Following Bulgaria’s euro introduction, 66% expected the euro to increase inflation, and the Commission recommended continued price supervision through the mandatory dual-display period ([European Commission report](https://economy-finance.ec.europa.eu/document/download/367ac2a1-a357-46aa-a89a-585897735fe3_en?filename=COM_2026_175_1_EN_ACT_part1_v2.pdf)). The Commission also describes daily monitoring of 101 frequently purchased products ([Bulgaria and the euro](https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro/bulgaria-and-euro_en)).

### 2.2 Elections: enormous peaks, weak baseline

Election interest is sharply episodic. Across the five-year comparison:

| Query | Mean | Median | Peak | Peak week |
|---|---:|---:|---:|---|
| `избори` | 3.7 | 1 | 100 | 29 Oct 2023 |
| `резултати избори` | 0.8 | 0 | 36 | 19 Apr 2026 |
| `местни избори` | 0.2 | 0 | 29 | 29 Oct 2023 |
| `кмет` | 1.7 | 1 | 34 | 29 Oct 2023 |
| `общински съвет` | 0.4 | 0 | 5 | 29 Oct 2023 |

Source: [Google Trends election/local comparison, Bulgaria, five years](https://trends.google.com/trends/explore?date=2021-09-01%202026-09-01&geo=BG&q=%D0%B8%D0%B7%D0%B1%D0%BE%D1%80%D0%B8,%D1%80%D0%B5%D0%B7%D1%83%D0%BB%D1%82%D0%B0%D1%82%D0%B8%20%D0%B8%D0%B7%D0%B1%D0%BE%D1%80%D0%B8,%D0%BC%D0%B5%D1%81%D1%82%D0%BD%D0%B8%20%D0%B8%D0%B7%D0%B1%D0%BE%D1%80%D0%B8,%D0%BA%D0%BC%D0%B5%D1%82,%D0%BE%D0%B1%D1%89%D0%B8%D0%BD%D1%81%D0%BA%D0%B8%20%D1%81%D1%8A%D0%B2%D0%B5%D1%82).

Product consequence: the latest result and a place finder belong on the home page permanently, but the entire root should not remain an election dashboard between elections. An explicit election status can switch the root into a temporary “election mode” when voting is announced, under way, counting, or newly certified.

### 2.3 Consumption: “promotions” is the stable task

Qualified terms reveal a more actionable need than the broad word `цени`:

| Query | Five-year mean | Median | Peak |
|---|---:|---:|---:|
| `промоции` | 12.2 | 12 | 20 |
| `цени на горивата` | 5.6 | 4 | 100 |
| `инфлация` | 4.4 | 4 | 27 |
| `цена на тока` | 2.8 | 3 | 8 |
| `цени на храните` | too low/noisy | 0 | low |

Source: [Google Trends price/consumption comparison, Bulgaria, five years](https://trends.google.com/trends/explore?date=2021-09-01%202026-09-01&geo=BG&q=%D1%86%D0%B5%D0%BD%D0%B8%20%D0%BD%D0%B0%20%D1%85%D1%80%D0%B0%D0%BD%D0%B8%D1%82%D0%B5,%D1%86%D0%B5%D0%BD%D0%B0%20%D0%BD%D0%B0%20%D1%82%D0%BE%D0%BA%D0%B0,%D1%86%D0%B5%D0%BD%D0%B8%20%D0%BD%D0%B0%20%D0%B3%D0%BE%D1%80%D0%B8%D0%B2%D0%B0%D1%82%D0%B0,%D0%B8%D0%BD%D1%84%D0%BB%D0%B0%D1%86%D0%B8%D1%8F,%D0%BF%D1%80%D0%BE%D0%BC%D0%BE%D1%86%D0%B8%D0%B8).

`промоции` has the strongest steady baseline; fuel and inflation show event-driven spikes. The consumption destination should therefore lead with **find a product / compare a price / see active deals**, while the change rail can carry statistically meaningful movements, new deals, expiring deals, and official inflation releases.

Eurostat’s 2025 household-consumption comparison puts Bulgaria’s price level at 63% of the EU average, with housing at 41% ([Eurostat](https://ec.europa.eu/eurostat/web/products-eurostat-news/w/ddn-20260618-2)). That is valuable context, but it should not displace the user’s immediate task of seeing actual local prices and changes.

### 2.4 Procurement: people search the systems and tasks

The generic phrase undercounts practical intent. In a five-year same-request comparison:

| Query | Relative average |
|---|---:|
| `търгове` | 50 |
| `АОП` | 48 |
| `ЦАИС ЕОП` | 39 |
| `договори` | 27 |
| `обществени поръчки` | 24 |

Source: [Google Trends procurement comparison, Bulgaria, five years](https://trends.google.com/trends/explore?date=2021-09-01%202026-09-01&geo=BG&q=%D0%BE%D0%B1%D1%89%D0%B5%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%B8%20%D0%BF%D0%BE%D1%80%D1%8A%D1%87%D0%BA%D0%B8,%D0%A6%D0%90%D0%98%D0%A1%20%D0%95%D0%9E%D0%9F,%D0%90%D0%9E%D0%9F,%D1%82%D1%8A%D1%80%D0%B3%D0%BE%D0%B2%D0%B5,%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%B8).

The words are partly ambiguous, so their exact order should not be over-read. The robust finding is that navigation and transaction language is stronger than “procurement analysis”. Tile copy should promise: **find a contract, buyer, supplier, tender, or deadline**. The change rail should prioritize newly published tenders with live deadlines and material awards—not merely the largest historical totals.

This is also a high-public-value topic independent of consumer search volume. The Commission’s 2026 Bulgaria country report cites 41% single-bidder procurement and 27% direct awards in 2025, both among the EU’s worst competition signals ([European Commission country report](https://economy-finance.ec.europa.eu/economic-surveillance-eu-member-states/country-pages-including-country-reports/country-report-bulgaria_en)).

### 2.5 EU funds: open calls and ISUN, not abstract “absorption”

The comparable five-year averages were `ИСУН 52`, `субсидии 11`, `европейски програми 1`; `европроекти` and `европейско финансиране` rounded to zero in that comparison ([Google Trends](https://trends.google.com/trends/explore?date=2021-09-01%202026-09-01&geo=BG&q=%D0%B5%D0%B2%D1%80%D0%BE%D0%BF%D0%B5%D0%B9%D1%81%D0%BA%D0%B8%20%D0%BF%D1%80%D0%BE%D0%B3%D1%80%D0%B0%D0%BC%D0%B8,%D0%B5%D0%B2%D1%80%D0%BE%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%D0%B8,%D0%B5%D0%B2%D1%80%D0%BE%D0%BF%D0%B5%D0%B9%D1%81%D0%BA%D0%BE%20%D1%84%D0%B8%D0%BD%D0%B0%D0%BD%D1%81%D0%B8%D1%80%D0%B0%D0%BD%D0%B5,%D0%98%D0%A1%D0%A3%D0%9D,%D1%81%D1%83%D0%B1%D1%81%D0%B8%D0%B4%D0%B8%D0%B8)).

The product entry should lead with **open calls, deadlines, projects, and beneficiaries**. Absorption and programme analysis remain important evidence after the user enters the module. Bulgaria’s 2021–2027 cohesion allocation is €10.7bn, or €12.9bn with national co-financing—about 12% of 2024 GDP—so the topic also deserves first-tier placement on public-value grounds ([European Commission country report](https://economy-finance.ec.europa.eu/economic-surveillance-eu-member-states/country-pages-including-country-reports/country-report-bulgaria_en)).

### 2.6 Sectors: use the public’s nouns

Exact institutional labels do not fully represent sector intent. In one comparison, `образование 15`, `пенсии 10`, `земеделие 6`, `здравеопазване 1`, and `енергетика 1`. A more concrete comparison gave `пенсии 10`, `училища 8`, `пътища 4`, `болници 2`, and `субсидии 1` ([sector labels](https://trends.google.com/trends/explore?date=2021-09-01%202026-09-01&geo=BG&q=%D0%B7%D0%B4%D1%80%D0%B0%D0%B2%D0%B5%D0%BE%D0%BF%D0%B0%D0%B7%D0%B2%D0%B0%D0%BD%D0%B5,%D0%BE%D0%B1%D1%80%D0%B0%D0%B7%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5,%D0%BF%D0%B5%D0%BD%D1%81%D0%B8%D0%B8,%D0%B5%D0%BD%D0%B5%D1%80%D0%B3%D0%B5%D1%82%D0%B8%D0%BA%D0%B0,%D0%B7%D0%B5%D0%BC%D0%B5%D0%B4%D0%B5%D0%BB%D0%B8%D0%B5), [concrete lookups](https://trends.google.com/trends/explore?date=2021-09-01%202026-09-01&geo=BG&q=%D0%B1%D0%BE%D0%BB%D0%BD%D0%B8%D1%86%D0%B8,%D1%83%D1%87%D0%B8%D0%BB%D0%B8%D1%89%D0%B0,%D0%BF%D0%B5%D0%BD%D1%81%D0%B8%D0%B8,%D0%BF%D1%8A%D1%82%D0%B8%D1%89%D0%B0,%D1%81%D1%83%D0%B1%D1%81%D0%B8%D0%B4%D0%B8%D0%B8)).

The home page should say **Училища**, **Пенсии и социална подкрепа**, **Здраве и болници**, **Пътища и транспорт**, **Енергетика**, and **Земеделие и субсидии**. The complete 19-sector directory stays one click away. Search language should shape labels, not dictate which public systems deserve coverage.

### Demand conclusion

There are three different intent shapes, and the home page should reflect all three:

- **persistent household/local need:** prices, promotions, municipality, schools, pensions;
- **episodic national need:** elections, inflation shocks, budgets, tax changes, debt events;
- **transactional/professional need:** tenders, contracts, ISUN, open calls, buyers, suppliers, beneficiaries.

A durable home page cannot be optimized for only one of them.

---

## 3. What the product currently does

### The root is still an election product

[DashboardScreen.tsx](../../src/screens/DashboardScreen.tsx) is a title/SEO wrapper around [DashboardCards.tsx](../../src/screens/dashboard/DashboardCards.tsx). The card body is exclusively parliamentary: election summaries, map/results, mandates, candidates, vote flow, trends, geography, anomalies, neighborhood patterns, financing, polls, and articles.

The mismatch also exists outside React. The root entry in [scripts/prerender/routes.ts](../../scripts/prerender/routes.ts) still has a parliamentary title, body, structured data, and social preview. A new client-side shell alone would leave crawlers and link previews describing the old page. Root React, prerender, title, canonical/JSON-LD, sitemap, and OG imagery must migrate together.

The current election material should not be discarded. The companion [elections-hub research](elections-hub-research-v1.md) recommends a unified `/elections` entry and a results-first system. That is the right destination for the existing root depth.

### The wider platform is already mature enough for a global front page

The platform already has substantive destinations for:

- `/governance` and `/governance/sectors`;
- `/budget`;
- `/procurement`;
- `/funds` and `/open-calls`;
- `/consumption`;
- `/indicators`;
- `/parliament`;
- `/my-area`;
- `/companies` and `/persons`.

The home page should fold a small number of figures from these destination-owned data products. It should not recompute competing “home totals” that can drift from module definitions. The earlier [module front-page plan](module-front-pages-v1.md) already defines the shared lead/news/tile pattern and a normalized feed item; this proposal extends that pattern to the root and updates the earlier assumption that budget had no change stream.

---

## 4. Proposed home-page information architecture

### First viewport

```text
България в данни                                      Обновено: date/time
Данните за държавата, парите и мястото, в което живеете

[ Намери моето място ]  [ Търси продукт, фирма, договор, човек… ]

[ БВП ]  [ Инфлация ]  [ Безработица ]  [ Държавен дълг ]
 value     value          value             value
 period    period         period            period
 context   context        context           context

Бързи връзки
[ Цени ] [ Моето място ] [ Избори ] [ Бюджет ]
[ Поръчки ] [ Еврофондове ] [ Сектори ] [ Власт ]
```

### Following sections

```text
Какво се промени
[Prices] [Local] [Contract] [Fund] [Budget/debt] [Parliament/election]

Моето място                          Последни избори
[choose or return to place]          [compact result + find place]

Популярни теми
[Schools] [Pensions] [Health] [Roads] [Energy] [Agriculture] [All sectors]

Coverage · sources · date bases · methodology
```

The changing rail should sit below the national pulse and durable quick links. A burst of contracts must not push the primary map of the product below the fold.

### Four state-pulse facts

Use four macro facts that are understandable together and give each a value, direction/comparison, period, data basis, and destination link. The current source snapshot in [data/macro.json](../../data/macro.json) could support:

| Fact | Current example | Required caption |
|---|---:|---|
| Real GDP growth | +2.7% y/y | Q2 2026 |
| Inflation | +4.4% y/y | July 2026; monthly release |
| Unemployment | 3.0% | June 2026; seasonally adjusted |
| Government debt | 28.5% of GDP | Q1 2026 |

These are examples from the 1 September data state, not values to hard-code into the component. If freshness or comparability fails, the card should degrade explicitly rather than silently retain an old number.

Do not place the quarterly budget balance beside these figures without a seasonal warning. The separately sourced cash-execution balance belongs in the budget destination or a clearly labelled evidence row.

Good national dashboards make a small, dated theme summary and retain explanations rather than presenting an undifferentiated KPI wall. CBS uses a summary plus eight well-being themes and separates present condition, distribution, and resilience ([CBS Monitor of Well-being](https://www.cbs.nl/en-gb/visualisations/monitor-of-well-being-and-the-sustainable-development-goals/well-being-here-and-now)). GOV.UK similarly warns that dashboards can overwhelm users and leave them to infer the conclusion; it recommends clear hierarchy and concise explanation ([dashboard guidance](https://brand.design-system.service.gov.uk/data/dashboards/)).

### Quick-tile specification

| Order | Bulgarian label | Main promise | Destination | Useful direct actions |
|---:|---|---|---|---|
| 1 | Цени и промоции | Compare what households pay now | `/consumption` | Products, deals, basket |
| 2 | Моето място | See public decisions and money near me | `/my-area` | Municipality finder |
| 3 | Избори | Results, map, mandates, and local outcomes | `/elections` | Latest result, find place |
| 4 | Държавен бюджет | Revenue, spending, balance, and debt | `/budget` | Execution, ministries, debt |
| 5 | Договори и търгове | Search buyer, supplier, contract, or deadline | `/procurement` | Contracts, tenders, companies |
| 6 | Еврофондове и приеми | Find a project, beneficiary, or open call | `/funds` | `/open-calls`, programmes |
| 7 | Училища, пенсии и сектори | Follow services people use | `/governance/sectors` | Six concrete sector links |
| 8 | Парламент, хора и власт | Votes, officials, interests, and connections | `/governance` | `/parliament`, persons |

Each tile should contain one destination-owned current figure and one plain-language task. It should not become a miniature dashboard. Links must be canonical, preserve explicit scope where required, and omit trailing slashes.

### Election mode

Election prominence should be data-driven, not manually improvised on launch night.

| Status | Home treatment |
|---|---|
| No scheduled election | Normal tile + latest-result compact card |
| Announced/campaign | Add date/countdown and finder shortcut |
| Voting/counting | Promote election result canvas below pulse; show completeness/source time |
| Newly certified | Keep promoted for a defined window; link to full analysis |
| Historic | Return to durable order |

The status must come from an explicit election calendar/result lifecycle, not from a guessed presence of partial data.

---

## 5. “Какво се промени”: a national evidence wire

### Editorial contract

Every item must answer four questions without opening it:

1. **What changed?**
2. **When did the real-world event happen?**
3. **Where or whom does it affect?**
4. **What official/source record supports it?**

The rail should show at most six items on the root and preserve category diversity. A separate `/today` or module feed can expose more. The root should never be a raw dump of the latest six database rows.

### Normalized event fields

```ts
type HomeEvent = {
  id: string;
  kind: HomeEventKind;
  scope: "national" | "oblast" | "municipality" | "sector" | "entity";
  scopeId?: string;
  sectorId?: string;
  titleKey: string;
  factArgs: Record<string, string | number>;
  occurredAt?: string;
  publishedAt?: string;
  firstSeenAt: string;
  dateBasis: "occurrence" | "publication" | "first_seen" | "period_end";
  sourceName: string;
  sourceUrl?: string;
  coverageAsOf: string;
  route: string;
  amountEur?: number;
  previousValue?: number;
  currentValue?: number;
  deadlineAt?: string;
  isBackfill: boolean;
  verification: "automatic" | "verified" | "editorial_review";
  importance: number;
  actionability: number;
};
```

`occurredAt`, `publishedAt`, and `firstSeenAt` must never be collapsed into one misleading “date”. Copy should be generated from structured facts and translated templates, not copied from the mixed-language operator log.

### Event categories and kinds

| Root category | Event kinds | Current feasibility |
|---|---|---|
| Prices and deals | `price_move_7d`, `deal_started`, `deal_ending`, `basket_threshold`, `cpi_release` | Daily sources exist; threshold/dedup precompute needed |
| Local | `council_resolution`, `capital_program_published`, `local_election_result`, `partial_election_announced` | Most builders exist; schedule coverage needs expansion |
| Procurement | `contract_awarded`, `contract_annex`, `tender_opened`, `tender_cancelled`, `tender_deadline` | Existing detection is strong; date semantics need normalization |
| Funds | `fund_project_new`, `fund_project_modified`, `open_call_opened`, `open_call_closing` | Existing ingestion/builders; deadlines make the feed actionable |
| Budget and debt | `budget_execution_release`, `budget_document_promulgated`, `budget_figure_change`, `debt_auction`, `eurobond_issued`, `debt_stock_release` | Domestic/KFP/document signals exist; some events need verification |
| Parliament and elections | `parliament_vote`, `plenary_mention`, `election_announced`, `election_result_published`, `election_result_certified`, `poll_released` | Most result/vote data exists; formal calendar/status is a gap |

Sector should normally be a dimension on these events, not a duplicated set of event kinds. A hospital contract is still a contract, tagged `health`.

### Ranking and diversity

Rank by a documented combination of:

- recency on the correct date basis;
- materiality/importance;
- actionability, especially a live deadline;
- geographic or watched-subject relevance;
- editorial override for exceptional national events.

Then apply category caps. Procurement volume is much higher than other streams and would otherwise occupy every slot. Suppress individual backfill rows and publish a clearly labelled batch summary when a source imports more than its normal daily range.

Recommended root policy:

- maximum six cards;
- maximum two from one category;
- at least three categories when eligible items exist;
- one nationally material override slot;
- no event outside its declared freshness window;
- no “new today” language when only `firstSeenAt` is known.

### Budget and debt alert precision

Domestic BNB auction detection and parsing are already automated, so `debt_auction` is feasible now. KFP monthly execution is also a reliable release event. Budget-law and State Gazette watchers can safely say **a document was published/promulgated**.

They cannot automatically say **the budget increased by X** until the changed figures have been parsed and verified. Use a two-stage model:

1. immediate `budget_document_promulgated` with official source and no inferred amount;
2. later `budget_figure_change` only after a deterministic, reviewed comparison.

International Eurobond entries remain curated and their watcher is a delayed signal. They should require verification before appearing as a final `eurobond_issued` item.

---

## 6. Alerts implementation review

### 6.1 Municipal alerts: useful foundation, not a national feed

[scripts/myarea/build_alerts.ts](../../scripts/myarea/build_alerts.ts) already composes council resolutions, procurement awards and annexes, tenders, EU-fund projects, Interreg, open calls, regular/partial local elections, capital programmes, and parliamentary keyword mentions into bilingual per-municipality JSON.

That is valuable reuseable logic, but the stored payload is deliberately optimized for “My area”:

- it is capped at 30 and globally date-sorted;
- quiet municipalities retain yesterday’s row, so row presence is not freshness;
- some dates are period labels or source timestamps rather than occurrence dates;
- national open calls are intentionally excluded from local payloads;
- many ISUN records lack territory, so local open-call coverage can be empty.

The national wire should reuse source rules and typed events, not aggregate the 265 stored municipal payloads.

### 6.2 Confirmed contract defect: `open_call`

The builder emits the kind `open_call`, but [useMyAreaAlerts.tsx](../../src/data/myarea/useMyAreaAlerts.tsx) omits it from `MyAreaAlertKind` and from the kind-to-icon/color records. Runtime fallbacks prevent an obvious crash, but the event is silently treated as a generic grey alert and the producer/consumer contract has drifted.

**Priority 0 fix:** add the kind and its visual/copy treatment, then add a test that every emitted backend kind has a frontend renderer. Prefer a shared schema or generated exhaustive fixture rather than two manually maintained unions.

### 6.3 Procurement watchlist: aggregate change is too coarse

The browser-local watchlist supports company, awarder, person, place, and contract. Its activity signature is only count, total euro amount, and latest date, and it marks activity when count or total rises. It therefore misses:

- cancellations and status changes;
- decreases/corrections;
- amendments that do not increase the aggregate;
- tender deadlines;
- price, fund, budget, debt, election, or sector subjects.

Unread state updates only after the watchlist is opened, and the query is cached indefinitely. This is a saved filter with a coarse activity hint, not a general alert system.

The next version should subscribe to event kinds for a subject and persist the last seen event cursor. Keep it browser-local unless the product explicitly chooses accounts, email, or push; the current implementation does not support those promises.

### 6.4 `recent_updates()` is a detection substrate

The Postgres `recent_updates()` function in [007_query_builders.sql](../../scripts/db/schema/pg/007_query_builders.sql) already detects first-seen contracts, tenders, fund projects, companies, officers, and datasets, and summarizes unusually large backfills. That is exactly the right base behavior.

Its timestamp usually means registry/first-seen time, not the real-world occurrence time, and its kind coverage is incomplete. Reuse its detection/backfill mechanics inside the typed event model; do not present `changed_at` as “happened today”.

### 6.5 `/data/updates` is an operator log

[DataUpdatesScreen.tsx](../../src/screens/DataUpdatesScreen.tsx) renders [data/data-changes.json](../../data/data-changes.json), which records ingestion work. Recent entries prove that price, contract, open-call, fund, council, macro, and debt streams are alive.

The prose is mixed Bulgarian/English and some entries point to generic or unrelated routes. It is a transparency/change log for operators, not ready-made home-page news. A home card should be rebuilt from a source event with a verified destination.

### 6.6 Other UX/freshness fixes

- Internal municipal alert routes should use the application router; opening every item in a new tab is appropriate only for external source URLs.
- `staleTime: Infinity` should be replaced by artifact-version or freshness invalidation for alerts/watch activity.
- Empty state must distinguish “no eligible event in this window” from “source has not refreshed” and “coverage unavailable”.
- The UI should surface coverage-as-of and date basis on demand, especially for first-seen/backfill records.

### Alert priorities

| Priority | Change |
|---|---|
| P0 | Fix `open_call` producer/consumer drift and add exhaustive-kind gates |
| P0 | Separate occurrence, publication, first-seen, and period dates |
| P0 | Define freshness/backfill policy before home exposure |
| P1 | Replace aggregate watch signatures with event-level cursors |
| P1 | Invalidate on artifact/version change; remove indefinite freshness assumptions |
| P1 | Use internal links for internal routes and explicit source links for external records |
| P1 | Show coverage and honest quiet/stale states |
| P2 | Add watched subjects: product/category/chain, programme/call, sector, budget/debt, election/place |

---

## 7. Data contract for the global picture

Build one precomputed `home_payload` artifact or equivalent API response. It should contain:

- `generatedAt` and source coverage/freshness declarations;
- four state-pulse facts folded from canonical module sources;
- quick-tile figures folded from destination-owned fixtures;
- the six eligible `HomeEvent` cards plus a feed cursor;
- latest parliamentary and local election status/summary;
- six popular-sector previews;
- localized copy keys, never arbitrary operator prose.

The home payload must not:

- sum overlapping sector bases;
- mix budget, procurement, payout, and headcount values into one ranking;
- infer occurrence from ingestion time;
- block the page when one module is stale;
- issue one request per tile.

Each folded value should carry `source`, `measuredAt`, `basis`, `destination`, and `freshnessState`. The page can then render an honest partial state if one corpus is delayed.

---

## 8. Implementation sequence

### Phase 0 — make change semantics trustworthy

- Fix the `open_call` contract drift.
- Define and test the normalized event schema and date bases.
- Add exhaustive producer-to-renderer tests.
- Set freshness, backfill, and category-cap rules.

**Gate:** a fixture containing every event kind renders with correct copy, icon, route, source, and date label.

### Phase 1 — establish the new hierarchy

- Create the global root shell, four pulse facts, finder, and eight quick tiles.
- Create `/elections` and place the existing parliamentary depth there without feature loss.
- Preserve current election URLs where needed; do not redirect `/`, because it becomes genuinely new content.
- Migrate root prerender, SEO title/description, JSON-LD, sitemap entries, and OG image/content in the same release.

**Gate:** client render, prerendered HTML, structured data, social preview, and canonical links all describe the same global page; `/elections` is indexed and internally linked.

### Phase 2 — ship “Какво се промени”

- Build the precomputed national feed from structured source events.
- Start with procurement, funds/open calls, councils, parliamentary votes, and domestic debt/KFP releases.
- Apply date-basis labels, category diversity, and backfill suppression.
- Degrade to a transparent empty/stale state.

**Gate:** no item claims an occurrence date that is only a first-seen date; high-volume procurement cannot occupy the whole rail.

### Phase 3 — add household and fiscal event types

- Add statistically meaningful price movement, deal start/end, basket thresholds, and CPI releases.
- Add verified budget-figure changes, debt-stock releases, and reviewed international debt events.
- Add sector tags across event kinds.

**Gate:** thresholds are deterministic, deduplicated, documented, and tested against noisy daily data.

### Phase 4 — local relevance and saved subjects

- Personalize the feed by selected municipality and browser-local watched subjects.
- Use event cursors for unread state.
- Keep national material events visible and clearly separate from personal relevance.

**Gate:** the system does not imply account sync, email, or push notification support that does not exist.

### Phase 5 — election mode and tuning

- Add the explicit election lifecycle and temporary promotion rules.
- Tune tile order and feed weights from observed use rather than from Trends alone.

**Gate:** election promotion starts and ends deterministically; historic election depth remains accessible and searchable.

---

## 9. Measurement plan

Before launch, export the current route-level Search Console and analytics baseline if available. Then measure:

- click-through rate for each quick tile and direct action;
- use and completion of the place/subject finder;
- feed click-through by event kind and date basis;
- return visits to `/` and `/my-area`;
- organic impressions and clicks transferred to `/elections`;
- stale, invalid, suppressed-backfill, and missing-destination event counts;
- empty-state frequency by category and source.

Run five task tests with Bulgarian users:

1. Find what changed in my municipality.
2. Compare a product price and find a live promotion.
3. Find a new public contract or tender deadline.
4. Find an open funding call and its deadline.
5. Find the latest election result for my place and explain the four national pulse facts.

Treat the first tile order as a stable launch registry with explicit weights. Reorder only after enough observed clicks/search entries exist to distinguish genuine demand from election-week or news-cycle spikes.

---

## 10. Acceptance principles

The new root is successful when:

- a first-time visitor can understand Bulgaria’s current national picture in one viewport;
- a resident can reach their municipality in one action;
- prices, elections, budget, procurement, funds, and sectors are all first-class but none owns the whole page;
- every changing item states what its date means;
- the page remains useful on a quiet day and honest on a stale one;
- election depth is preserved under a clear destination;
- root React, static HTML, metadata, structured data, social preview, and sitemap agree;
- all totals retain their source, basis, time, and destination.

## Final product position

The strongest home page is not a catalogue of every dataset and not a permanent election night. It is a readable national pulse with three exits:

1. **what affects me now** — prices, deals, place;
2. **what changed in public life** — contracts, funds, budget, debt, votes, elections;
3. **where can I investigate further** — sectors, institutions, companies, and people.

That structure reflects both Bulgarian search behavior and the platform’s distinctive advantage: it can connect a national fact to the underlying contract, programme, vote, company, person, or municipality.
