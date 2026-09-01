# Elections hub — deep research and product recommendation

**Status:** recommendation, ready for product/design prototyping  
**Date:** 1 September 2026  
**Scope:** parliamentary and local election results and analysis at country, abroad, region, municipality, settlement, and polling-section levels

## Recommendation in one sentence

Build `/elections` as a unified entry into a shared **results-first page system**: a compact election/place header, no more than four outcome facts, a synchronized map and ranked result, then three evidence-backed standouts and progressively deeper analysis.

This should not be a normal KPI hub. The existing product already has unusually rich maps, mayors, council composition, candidates, trends, vote flows, and section-level audit material. The right simplification is to give those things a stable hierarchy—not remove them.

## The design position

The hub should optimize for four questions, in this order:

1. **Who won or governs here?**
2. **What was the complete result?**
3. **Where did that outcome come from?**
4. **What genuinely stands out, and what evidence supports it?**

Official election systems consistently combine outcome, geographic drill-down, tables, and source access. Germany pairs national seats/votes with an accessible result table, geographic levels, and downloads ([Federal Returning Officer, 2025](https://bundeswahlleiterin.de/bundestagswahlen/2025/ergebnisse.html)). Norway combines a search from county down to polling station with party results, seats, change, turnout, ballot quality, and voting mode ([Valgdirektoratet, 2025](https://www.valgresultat.no/valg/)). Australia's Tally Room moves from a searchable division table to turnout, informality, candidate results, swing, vote types, polling places, and preference flow ([AEC division results](https://results.aec.gov.au/31496/Website/HouseDivisionalResults-31496.htm), [AEC local detail](https://results.aec.gov.au/31496/Website/HouseDivisionPage-31496-108.htm)).

The newsroom pattern adds editorial help without replacing the official result. BBC makes “Who won in my area?” the primary task and lets users switch between a geographic map and cartogram ([BBC election lookup, 2024](https://news.files.bbci.co.uk/include/newsspec/38834-uk-general-election-lookup-2024/english/app/amp)). The Guardian combines seats, declaration completeness, a finder, geographic/proportional views, result modes, key seats, and national totals ([Guardian UK results, 2024](https://www.theguardian.com/politics/ng-interactive/2024/jul/04/uk-general-election-results-2024-live-in-full)).

The resulting product principle is:

> Keep the evidence rich; reduce the number of questions competing at the same time.

## What already exists—and should be preserved

The repository is much closer to this model than the navigation suggests:

- The parliamentary country page already opens with four facts and a map/results pair, then covers seats, candidates, flow, trends, geography, anomalies, neighborhood patterns, financing, and polling ([DashboardCards.tsx](../../src/screens/dashboard/DashboardCards.tsx#L109)).
- The local country page correctly keeps mayors and councils distinct: it has two maps, runoffs, split control, independent mayors, council composition, flows, and cross-cycle change ([LocalCountryDashboardCards.tsx](../../src/screens/dashboard/local/LocalCountryDashboardCards.tsx#L77)).
- The requested place ladder already exists for both election types. Parliamentary routes cover country, abroad/region, municipality, settlement, and section; local routes cover the same domestic levels ([routes.tsx](../../src/routes.tsx#L2230), [routes.tsx — parliamentary places](../../src/routes.tsx#L2430)).
- `PlaceViewNav` already preserves place when moving between parliamentary and local views and availability-gates local results ([PlaceViewNav.tsx](../../src/screens/components/PlaceViewNav.tsx#L39)).
- Previous planning explicitly says elections are episodic and that the map remains the lead ([module-front-pages-v1.md](module-front-pages-v1.md#L316)).

The main product gap is that parliamentary and local elections still read as separate modules, while their place pages have accumulated many equally weighted panels.

## Proposed information architecture

### 1. One entry, two result systems

Create `/elections` as the unified entry with:

- latest parliamentary outcome;
- latest regular local outcome;
- one “Find my place” search;
- entry points to analyses, reports, places, and partial local elections;
- explicit election date/status on every preview.

Do **not** immediately move all current result URLs. Preserve `/`, `/local/:cycle`, and current place routes in v1; they carry a large prerender, sitemap, canonical, and internal-link surface. A clean `/elections/:kind/:cycle/...` route family can be evaluated later as a separately tested migration.

### 2. One scope bar on every result page

`ElectionScopeBar` should contain:

- **kind:** Parliamentary / Local;
- **cycle/date:** always encoded in URL or current query contract;
- **round/contest:** only when local context needs it;
- **place breadcrumb and finder;**
- **status:** projection / provisional / final, coverage, update time;
- **source:** CEC result, download, and protocol/audit link where available.

The European Parliament results site is a useful status model: it defines projection, provisional, and final results, timestamps each state, and publishes signed JSON/CSV plus downloadable images ([result status](https://results.elections.europa.eu/en/turnout/), [download datasheets](https://results.elections.europa.eu/en/tools/download-datasheets/)).

Kind switching preserves place where possible. Local is absent abroad. At section level, switching kind should explicitly fall back to the settlement because section identifiers are not stable across cycles; this behavior already exists internally but should be explained to the reader.

### 3. A shared results-first page grammar

Desktop:

```text
┌ Election kind · cycle · round · status · source ──────────────────────┐
│ PLACE / breadcrumb                                      Find my place │
├ Outcome strip: 3–4 facts, each with a stated basis ──────────────────┤
│                                                                      │
│  RESULT MAP / GEOGRAPHY                     RANKED RESULT             │
│  winner · margin · share · change            votes · % · seats       │
│  synchronized selection                      complete accessible view │
│                                                                      │
├ What stands out: outcome/change · participation · review signal ─────┤
│ Outcome detail                                                       │
│ Geography                                                            │
│ Comparison and history                                               │
│ People / representation                                              │
│ Signals for review                                                   │
│ Data, method, downloads, protocols                                   │
└──────────────────────────────────────────────────────────────────────┘
```

Mobile DOM order:

1. election/place/status;
2. outcome strip;
3. ranked result;
4. map;
5. standouts;
6. section previews and deeper links.

The ranked result is not an optional companion. Government accessibility guidance says essential map information must also be available as text/list and that charts need a non-visual equivalent ([DEFRA data visualisation guidance](https://digital.defra.gov.uk/design/data-visualisation)). W3C guidance also requires color-coded information to be available through another channel such as pattern or text ([W3C G111](https://www.w3.org/WAI/WCAG22/Techniques/general/G111)).

### 4. An explicit information budget

Above the fold may contain:

- one election/place identity;
- one status/source line;
- up to four facts;
- one ranked result;
- one map;
- up to three standouts.

It may not contain:

- a second KPI band;
- duplicate numbers in the strip and result panel;
- a carousel of unrelated analyses;
- more than one active map question;
- a statistical flag without scope, baseline, and evidence link.

This is consistent with government dashboard research: dashboards often fail when they leave all interpretation to users, and benefit from careful hierarchy, concise explanation, and an inverted pyramid ([GOV.UK dashboard guidance](https://brand.design-system.service.gov.uk/data/dashboards/), [Government Analysis Function testing guidance](https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-testing-dashboards-for-design-and-accessibility/)).

## What each level should show

| Level            | Parliamentary outcome                                                   | Local outcome                                                                     | Primary geography/browse                        |
| ---------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Country**      | party votes + seats; threshold/wasted vote; turnout                     | mayoral control + council support/seats; runoffs; split control                   | regions; local can also expose municipalities   |
| **Abroad**       | party votes; total votes; countries/cities; vote mode                   | unavailable                                                                       | countries → cities/sections                     |
| **Region**       | party vote/change; elected MPs/candidates                               | municipality mayors + council control; runoffs; split control                     | municipalities                                  |
| **Municipality** | party vote/change/preferences                                           | mayor result/round + council composition; district/settlement mayors              | settlements/urban districts; sections as detail |
| **Settlement**   | party vote/change; leading sections                                     | only contests on that settlement's ballot; clearly labeled parent-council context | polling sections                                |
| **Section**      | complete party/candidate result; turnout; vote mode; comparable history | separate result panel for every ballot present; protocol link                     | no decorative outcome map; result + audit trail |

### Parliamentary outcome contract

- Country: party share and seat outcome are co-primary. Neither can substitute for the other.
- Region/municipality/settlement: lead with party result and change; elected candidates/MPs are the representation layer below.
- Section: lead with the complete result and protocol evidence, not a miniature dashboard.
- Abroad: show participation as **votes cast**, not a normal turnout rate unless a valid eligible-voter denominator exists.

The abroad denominator deserves a hard rule. Bulgarian voters who did not pre-register may still vote in an established foreign section after filing a declaration ([CEC decision 4445, 19 February 2026](https://www.cik.bg/bg/decisions/4445/2026-02-19)). The pre-election list therefore is not the eligible population, so a conventional turnout percentage would mislead.

### Local outcome contract

Local elections are not one result. Bulgaria's official CEC publishes separate municipality-mayor, municipal-council, district-mayor, and settlement-mayor results, across distinct rounds, with numerical data, scanned protocols, video, and open data ([CEC local results](https://results.cik.bg/mi2023/tur1/rezultati/0921.html), [CEC local open data](https://results.cik.bg/mi2023/tur1/opendata/index.html)).

Therefore:

- Country/region: offer **Mayors** and **Councils** as two outcome modes. Keep both summaries visible, but do not load two full maps simultaneously on mobile.
- Municipality: lead with elected mayor or runoff pair and winning margin; beside it show council seats, leading group, and majority threshold. Mark split control explicitly.
- Settlement: show its own mayoral contest only when one existed; otherwise say it is governed through the parent municipality. Do not imply that parent-council votes are a settlement office.
- Section: render separate compact ballot panels. Never add votes across mayoral and council contests.
- Partial elections: show a dated “changes since the regular cycle” layer. Do not silently rewrite the historical regular-election result.

## Maps: keep them prominent, but make their question explicit

Recommended default:

- fill by winner;
- lightness by margin;
- a synchronized sortable result list;
- direct labels and party abbreviations, not color alone.

Available modes should answer one question each:

- winner;
- margin;
- selected party/candidate share;
- change from the named prior comparable election;
- turnout, only where the denominator is valid;
- invalid ballots or review signals.

Conventional choropleths visually overemphasize large land areas. Cartographic research calls this area-size bias and evaluates equal-area/value-by-area alternatives ([Sponge Maps study, 2023](https://link.springer.com/article/10.1007/s42489-022-00127-1)). Keep familiar geography as the default for place recognition, but prototype an equal-weight mode at country and region—hex/tile map, cartogram, or vote-weighted dots—before selecting the final form.

Interaction rules:

- map and result list share selection and keyboard focus;
- no hover-only facts;
- every map mode has a written summary/table;
- party selector and map metric are separate controls;
- a single polling section gets address/context, result, and protocol—not a decorative map.

## “What stands out”: three findings, not an anomaly wall

Select at most one item from each family:

1. **Outcome/change:** largest meaningful movement or control change.
2. **Participation/competition:** turnout movement, closest margin, runoff, or split control.
3. **Review/audit:** invalid-ballot change, recount/protocol discrepancy, or composite review signal.

Every standout must state:

- the measured fact;
- comparison baseline;
- scope and sample size;
- why it was selected;
- link to all supporting rows;
- official source/protocol where available.

Use “unusual pattern” or “signal for review,” never “fraud” or “manipulation,” when the evidence is only statistical. Peer-reviewed work found Benford conformity/deviation unreliable as an election-fraud detector ([Deckert, Myagkov & Ordeshook, _Political Analysis_](https://www.cambridge.org/core/journals/political-analysis/article/benfords-law-and-the-detection-of-election-fraud/3B1D64E822371C461AF3C61CE91AAF6D)). The Venice Commission likewise says statistical tools are probabilistic and administrative errors can be indistinguishable from fraud without complementary evidence ([Venice Commission CDL-AD(2018)009](https://www.venice.coe.int/webforms/documents/default.aspx?pdffile=CDL-AD%282018%29009-e)).

Benford may remain in a methodology/detail view with a prominent limitation; it should never be the headline standout.

## Component and data shape

Suggested shared components:

- `ElectionScopeBar`
- `ElectionOutcomeStrip`
- `ElectionOutcomeCanvas`
- `ElectionMapPanel`
- `ElectionRankedResult`
- `ElectionStandouts`
- `ElectionStatusRow`
- `ElectionSourcePanel`

Drive composition from a small descriptor matrix keyed by `electionKind × placeLevel`. Do not force every level into one universal JSX component, and do not use the ordinary tile-hub registry for the outcome canvas.

The data contract should produce one small route-specific summary payload containing:

- status/source metadata;
- outcome strip values and bases;
- ranked preview;
- map summary/mode availability;
- up to three standouts with evidence destinations.

Lazy-load geometry, full histories, flow analysis, and long evidence tables. This matters because the current election trees are large: the active parliamentary directory is about 719 MB and the 2023 local directory about 117 MB. The page must never discover its headline by loading the full corpus in the browser.

## Delivery sequence

1. **Definitions and prototypes** — freeze status vocabulary, metric denominators, comparisons, and standout thresholds; prototype country and municipality in desktop/mobile.
2. **Unified entry and shell** — `/elections`, combined navigation, scope bar, finder, status/source row; preserve existing result bodies.
3. **Country and region outcome canvas** — parliamentary plus dual local modes.
4. **Municipality** — mayor/runoff + council composition and split-control story.
5. **Settlement and section** — ballot-aware local rendering, protocol-first section page, explicit cross-kind fallback.
6. **Progressive reduction** — convert long current sections to strong previews plus existing “see all” leaves; remove duplication only after task testing.
7. **Optional URL migration** — only after prerender, both sitemap sources, canonical, internal-link, and OG-image parity is demonstrated.

## Acceptance gates

- Country and region have a ranked result **and** a map in the first substantive section.
- Mobile reads result before map; the accessible equivalent never disappears.
- Local country/region exposes both mayor and council outcomes; municipality exposes both when both contests exist.
- Abroad has no turnout percentage without a valid denominator.
- Every map mode has a non-color and non-map equivalent.
- Every standout carries metric, scope, baseline, sample size, evidence destination, and result status.
- Statistical-only signals cannot use causal/fraud language.
- Section pages link to official protocols/source when available.
- The summary payload and entry bundle have explicit budgets; heavy map/chart code stays lazy.
- New canonical routes cannot ship without prerender, sitemap, canonical, internal-link, and OG coverage.

## Validation plan

Test the prototype with four tasks, on phone and desktop:

1. “Who won the latest parliamentary election in my municipality, and by how much?”
2. “Who is mayor, which group leads the council, and are they the same?”
3. “What is the most important unusual result here, and what rows support it?”
4. “Open the official protocol for my polling section.”

Success is not “users saw every chart.” Success is that they answer the first question in seconds, understand the mayor/council distinction, can explain why a standout was selected, and can reach the official evidence without learning the site's historical route vocabulary.

## Limitations

- This research did not include electionsbg.com analytics or direct user interviews; the information budget and mobile ordering are hypotheses to validate with the tasks above.
- A Bulgaria-specific cartogram/equal-weight prototype was not built, so the alternate map form remains a testable option rather than a fixed requirement.
- Local ballot availability varies by place and cycle; the data contract must determine which office panels render.
- The report evaluates product structure, not the political validity of the active 2026 corpus.

## Evidence base

Primary sources were preferred: Bulgaria's CEC, the German Federal Returning Officer, Norway's Valgdirektoratet, Australia's AEC, the European Parliament, [South Africa's Electoral Commission](https://results.elections.org.za/), W3C, and UK government design guidance. BBC and the Guardian were included as newsroom interaction references. Research stopped when these sources converged and targeted follow-up resolved the abroad-denominator and statistical-anomaly questions; further examples were unlikely to change the proposed architecture.

## Source notes

All links were accessed on 1 September 2026.

- **Ergebnisse / Bundestagswahl 2025.** Die Bundeswahlleiterin (German Federal Returning Officer), final results and downloads, 2025. https://bundeswahlleiterin.de/bundestagswahlen/2025/ergebnisse.html
- **Valgresultat / Parliamentary election 2025.** Valgdirektoratet (Norwegian Directorate of Elections), 2025 results interface. https://www.valgresultat.no/valg/
- **Divisional results / 2025 Federal Election.** Australian Electoral Commission Tally Room, updated 10 June 2025. https://results.aec.gov.au/31496/Website/HouseDivisionalResults-31496.htm
- **Bradfield, NSW / 2025 Federal Election.** Australian Electoral Commission Tally Room, updated 4 June 2025. https://results.aec.gov.au/31496/Website/HouseDivisionPage-31496-108.htm
- **2024 European election results: result states, turnout, and datasheets.** European Parliament, updated 2024. https://results.elections.europa.eu/en/turnout/ and https://results.elections.europa.eu/en/tools/download-datasheets/
- **Who won in my area?** BBC 2024 UK general-election lookup, 2024. https://news.files.bbci.co.uk/include/newsspec/38834-uk-general-election-lookup-2024/english/app/amp
- **UK general election results in full.** The Guardian, 5 July 2024; amended 11 November 2024. https://www.theguardian.com/politics/ng-interactive/2024/jul/04/uk-general-election-results-2024-live-in-full
- **Резултати / Местни избори 29 октомври 2023.** Central Election Commission of Bulgaria, official first-round result and protocol interface, 2023. https://results.cik.bg/mi2023/tur1/rezultati/0921.html
- **Отворени данни / Местни избори 29 октомври 2023.** Central Election Commission of Bulgaria, decision 2860-МИ/03.11.2023. https://results.cik.bg/mi2023/tur1/opendata/index.html
- **Decision 4445 / voting outside the country.** Central Election Commission of Bulgaria, 19 February 2026. https://www.cik.bg/bg/decisions/4445/2026-02-19
- **Election results dashboards.** Electoral Commission of South Africa, official national, municipal, and by-election results. https://results.elections.org.za/
- **Data visualisation.** Department for Environment, Food & Rural Affairs Digital Service Manual, accessible map/chart guidance. https://digital.defra.gov.uk/design/data-visualisation
- **Technique G111: Using color and pattern.** W3C Web Accessibility Initiative, updated 15 July 2025. https://www.w3.org/WAI/WCAG22/Techniques/general/G111
- **Dashboards.** GOV.UK Brand Guidelines, dashboard use and limitations. https://brand.design-system.service.gov.uk/data/dashboards/
- **Data visualisation: testing dashboards for design and accessibility.** UK Government Analysis Function, published 2026. https://analysisfunction.civilservice.gov.uk/policy-store/data-visualisation-testing-dashboards-for-design-and-accessibility/
- **“Sponge Maps”: Using the Concept of Value by Area Maps for Avoiding the Area Size Bias in Choropleth Maps.** KN — Journal of Cartography and Geographic Information, 2023. https://link.springer.com/article/10.1007/s42489-022-00127-1
- **Benford's Law and the Detection of Election Fraud.** Joseph Deckert, Mikhail Myagkov, and Peter C. Ordeshook, Political Analysis, published online 4 January 2017. https://www.cambridge.org/core/journals/political-analysis/article/benfords-law-and-the-detection-of-election-fraud/3B1D64E822371C461AF3C61CE91AAF6D
- **Report on the identification of electoral irregularities by statistical methods.** Venice Commission, CDL-AD(2018)009, 2018. https://www.venice.coe.int/webforms/documents/default.aspx?pdffile=CDL-AD%282018%29009-e
