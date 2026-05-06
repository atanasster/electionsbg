# Following the money trail — MP business connections and declared wealth

Bulgarian voters can already see how an MP votes, where they were elected, and how their party fared in any given polling station. What has been much harder to see — without manually downloading an XML declaration and cross-checking it against the Commerce Registry — is what *companies* sit behind those people, how those companies link MPs to one another, and how much wealth each MP actually declared in the first place.

That is the gap these features fill. As of this writing, the graph contains **5,480 nodes** (605 MPs, 2,086 companies, 2,789 other named persons) joined by **6,567 edges** drawn from two open Bulgarian datasets; the wealth aggregator covers **713 MPs across 1,802 cacbg filings** spanning fiscal years 2020 through the first 2026 batch; and a derived [cars page](/mp-cars) lists every passenger car (570 lifetime, 69 for the 52nd parliament) extracted from those same declarations, sorted by declared BGN value. This article walks through where to find the new pages, what they show, and ends with a worked example: a pair of brothers, one currently seated and one former, both MPs of different parties and co-owners of the same company.

---

## 1. What this is, and what it is not

This is a **graph of declared and registered business ties** between sitting and former MPs.

- **Declared ties**: ownership stakes that an MP filed with the [Court of Audit](https://register.cacbg.bg/) on their annual property/interest declaration.
- **Registered ties**: management roles, partnerships and beneficial-ownership entries pulled from the [Commerce Registry](https://portal.registryagency.bg/CR/) (Търговски регистър) for those same companies, plus other companies the same individuals appear on.

It is **not** a list of accusations. Bulgarian law forbids sitting MPs from holding *active* management roles in commercial companies (ЗПК Art. 35), but it does not forbid ownership stakes — and historical management roles linger in the Commerce Registry as part of the public record. Most of what you see here is perfectly legal. The point of the graph is to make that legal-but-public record easy to read.

It is also **not complete**: companies registered abroad, informal beneficial ownership, family vehicles outside Bulgaria, and trusts are out of scope, because none of them are visible to the two source datasets.

## 2. Sources, and how confident the data is

Two source datasets, both open:

| source | what it provides | format | refresh |
|---|---|---|---|
| [register.cacbg.bg](https://register.cacbg.bg/) (Court of Audit) | annual property/interest declarations filed by every MP. The parser reads Tables **1 / 1.1 / 1.2** (real estate — own, agricultural, foreign-used), **3 / 3.1 / 3.2 / 3.3 / 3.4** (vehicles — motor / agricultural / boats-aircraft / other / foreign-used), **4** (cash on hand), **5** (bank accounts & deposits), **6** (receivables > 10k BGN), **7** (debts > 10k BGN), **8** (investment & pension funds, incl. crypto), **9** (securities & financial instruments), **10** (current LLC shares), **11** (transferred shares) and **12** (income). Tables 2 and 3.5 (transferred-out property/vehicles) are intentionally skipped from the asset totals because the holdings have already left the declarant's estate. | XML per declaration | annually each spring |
| [data.egov.bg](https://data.egov.bg/) dataset 2df0c2af-… (Commerce Registry) | daily filings of officers, partners, beneficial owners, status, seat | bulk JSON / incremental | daily, processed in batches |

Why both? Declarations alone show *MP → company* ties, which is enough to build a list. They do not show *MP → MP* ties through shared boards or co-owners, and that is exactly where most of the interesting overlaps live. The Commerce Registry supplies that connecting tissue.

Every edge in the graph carries a **confidence** label that surfaces throughout the UI:

- **High** — name match plus seat-in-region or same-party co-declaration corroboration. There are 4,987 high-confidence edges.
- **Medium** — name match alone, no corroboration. There are 1,580 medium-confidence edges.
- **Low** — surname-only matches. These are dropped before publication, not displayed.

Edge breakdown by source: **730 declared stakes**, **2,722 Commerce Registry ownership/partner edges**, **3,115 Commerce Registry role edges** (manager, director, representative, procurator, liquidator, etc.).

---

## 3. Where the feature appears — the dashboard tiles

The first place a casual reader meets the data is the [**Declarations**](/#declarations) section of the national dashboard, sitting under [*Anomalies*](/#anomalies) and [*Neighborhoods*](/#neighborhoods). The section header carries one shared provenance line (e.g. *Declarations 2021–2026 · 102/240 MPs filed · refreshed May 2026*) so each tile underneath doesn't repeat it. Three tiles sit inside the section: **MP Business Connections** and **MPs' car makes** render side-by-side at the top of the section; **MPs by declared assets** sits in its own row directly below.

### MP Business Connections

![National dashboard tile](/articles/images/connections/01-dashboard-tile.png)

The top tile in the section. A single column ranking the top five **most-connected MPs** of the currently-selected parliament by their **high-confidence neighbourhood size** — corroborated companies plus non-MP associates joined to them through Commerce Registry edges. Hovering the number reveals a fuller tooltip *"M total ties · N co-MP"* where N is the count of fellow MPs of the same parliament this person shares at least one company with (typically zero — the honest signal that genuine MP↔MP business overlaps are rare and mostly family-driven). MPs with no high-confidence ties are dropped from the list entirely; common Bulgarian surnames otherwise float ambiguous name-match-only ties to the top.

The list is filtered to the **currently selected election**: switch the date picker to an older parliament and the rankings reshuffle to the people who actually sat in that body. A click on any name jumps straight into that candidate's profile; the *See details* link in the top-right opens the [connections page](/connections); the *All companies →* link in the footer opens the [flat companies index](/mp/companies). The provenance line is shared across the section header (described above), so the tile itself stays uncluttered. Hovering the section provenance reveals the per-year filing breakdown, e.g. *2025: 80 · 2024: 14 · 2023: 2 · …*. For just-elected parliaments where most MPs haven't filed yet — the 52nd, at the moment, with only 102/240 — that line is the honest disclaimer that the rest of the tile is reading older filings.

The same tile appears on every regional dashboard, intersected with the MIR (multi-mandate region) the dashboard is showing. For example, on the [Sofia dashboard](/sofia#declarations) it unions the three Sofia MIRs and shows only people who actually represented Sofia:

![Sofia regional tile](/articles/images/connections/02-sofia-region-tile.png)

Notice how the ranking reshuffles entirely: every name on the national list either drops out (wrong region) or moves down the order. **Ivaylo Mirchev** (DB) takes the top slot with 7 high-confidence ties — instead of being fourth nationally — because the regional view drops everyone outside Sofia. **Martin Dimitrov** (DB, six tenures spanning 40th–52nd parliament) appears second despite being further down the national list for the same reason. The tooltip on each row still reveals the (usually zero) direct co-MP count, so a reader can see at a glance that a given Sofia MP's wider ties don't necessarily overlap with another sitting Sofia MP's.

### MPs' car makes

A sibling tile to the right of MP Business Connections, ranking the top five most-declared passenger-car brands among MPs of the currently selected parliament. The number next to each make is the count of *distinct MPs* declaring at least one car of that brand — an MP declaring three Volkswagens still counts as one VW, so the ranking is a popularity signal rather than a raw vehicle count. For the 52nd parliament the top entries are **Toyota (7 MPs)**, **Audi (7)**, **Škoda (6)**, **BMW (5)**, **Ford (4)** — German makes dominate the lifetime list nationally (Mercedes-Benz, BMW, Volkswagen, Audi all in the top four) but the per-NS picture is more even.

A *See details →* link in the header opens the [cars page](/mp-cars), covered in §6 below. The provenance line lives on the section header (shared with the other two tiles), so the "as of" date stays consistent across the row.

The make is detected by matching each declarant's free-text *Марка* field against an alias list that handles all the routine Cyrillic spellings (and a long tail of typos: *Фоксваген*, *Фолсваген*, *Фолц Ваген* all collapse to *Volkswagen*; *Митсубиши* collapses to *Mitsubishi*; etc.). Tokens we don't recognise fall through to "unknown" and are added to the list as we spot them. Coverage is currently ≈99% of declared cars; the remaining few are long-tail East European or generic brand names.

### MPs by declared assets

In its own row directly below: same compact top-five ranking, same per-NS scope, but ranked by **net worth in BGN** (declarant + spouse) computed from each MP's most recent filed declaration. Each row shows the MP's avatar and party group, the fiscal year of the latest filing, the BGN net worth in compact form (e.g. *21.7M*, *350K*), and a YoY arrow vs the prior fiscal year so you can see which MPs declared a meaningful change since the last filing. For the 52nd parliament the lead by a wide margin is **Delyan Peevski** (PG DPS, 21.7M BGN, ↓2.5M vs 2023), followed by **Rositsa Kirova** (PG of GERB-SDS, 13.3M BGN, ↑10x vs 2023 driven by a single 3.4M BGN receivable plus a 10M BGN security holding). The full balance-sheet breakdown — total assets, debts, real estate, vehicles, bank accounts, etc. — lives on each MP's candidate page (§4) and on the per-MP details page (§6), not on this dashboard tile. The *All MPs by assets →* link in the tile footer opens the full sortable [assets ranking](/mp-assets).

---

## 4. Where the feature appears — the candidate page

Four blocks were added to every MP profile, in this order:

### Declared assets

A compact balance-sheet card sitting at the top of the connections section. The header reads `Declared assets · fiscal year N` and shows three big numbers: total assets, debts (when present, in red with a minus sign), and net worth in BGN. A YoY chip next to them shows the absolute delta vs the previous fiscal year's filing — green up arrow for net worth that grew since the prior declaration, red down arrow when it shrank.

Below the headline numbers, a 4-column grid breaks the assets out by category — real estate, vehicles, bank accounts, cash, investments, securities, receivables, and (separately, in red) debts. Each tile shows the BGN total, the item count, and — where applicable — how many items the declarant filed *without* a value (typical of inherited real estate or rural plots).

For declarations that include foreign-currency holdings, the card shows the BGN-converted total. Conversions use the BNB fixed peg for EUR (1.95583) and a small lookup table of recent average rates for USD / GBP / CHF / etc. — good enough for ranking, not a substitute for the spot rate on any specific filing date. Holdings whose currency is unknown to the table fall back to the raw amount (rare).

A footer line links straight to the source XML on `register.cacbg.bg` for the same fiscal year, and a *See details* link in the card header opens the full per-row breakdown at `/candidate/:id/assets`. That details page (described in §6) shows every declared item with its location, area, year acquired, holder name, idealna chast (fractional ownership), legal basis and the verbatim *origin of funds* note that the declarant filed — the most journalistically interesting field on the form, because it's where the declarant explains *where the money came from*.

For MPs whose latest declaration includes income above the 10k BGN threshold (Table 12), the card grows an inline **Annual income** breakdown — one row per category (salary, dividends, rents, etc.), declarant column and spouse column. Peevski's 2025 filing for example shows Annual taxable employment income 125,859 BGN plus an "Art. 11" line of 50,616 BGN — both reported by the declarant only, no spouse income.

### Financial declarations

The second block is a per-company summary of declared business interests. Each row links into the company's dedicated page and shows the years the stake was held with its share size and value; if those values changed between filings, the entries are broken out with an arrow between them so the progression is visible. Source XML links for every declaration sit in a footer at the bottom of the card so you can verify what was actually filed.

![Financial declarations on a candidate page](/articles/images/connections/03-candidate-declarations.png)

The example here is **[Dimitar Naydenov](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%9D%D0%B0%D0%B9%D0%B4%D0%B5%D0%BD%D0%BE%D0%B2)** — the most-connected currently-sitting MP, with 14 high-confidence ties. His 2024 filing alone lists nine Burgas-based ОООд and ЕООД companies in the textile and fashion business (БИТЕКС, ДОРЕМИ ПЛЮС, НЕОМАКС 09, СЪНМАКС, ДИТЕКС, ЗЕНИТ КОМЕРС, …) with stakes ranging from 17% to 100%.

### Management roles

The third block lists Commerce Registry roles — both *currently active* and *historical*. For sitting MPs the active list should be sparse by law (ЗПК Art. 35); historical roles are kept because they are part of the public record and routinely matter when reading the network.

![Management roles on a candidate page](/articles/images/connections/04-candidate-management.png)

The orange/green pill on each row shows the matching confidence — the same tier described in section 2. The green "high confidence" badge means the row is corroborated by something more than a bare name match (typically a same-region or same-fiscal-year cross-reference).

### Connections to other MPs

The fourth block answers the question the rest of the feature is built around: **does this MP share a business neighbourhood with any other MP, and if so, through what?**

The candidate page lists, for every other MP reachable within four hops, the shortest path between them as an explicit chain — each chip in the chain links out to the company or person it represents:

![Candidate connections to other MPs](/articles/images/connections/05-candidate-mini-graph.png)

The example above is **[Dimitar Georgiev Dimitrov](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%80%D0%BE%D0%B2)** — a former MP with the densest paths-to-other-MPs neighbourhood in the dataset (**6 paths to 6 other MPs**). Each row reads left-to-right as the chain from the hub MP to the target, with a footer that flags step count, whether every edge along it is currently active, and whether every link is high-confidence or only a name match.

Two of the six paths are direct (length 2 — both MPs touch the same company); the rest are length 4 (a shared associate sitting on two different companies). The path-finder forbids passing through other MP nodes as intermediates, so a chain like *MP A → company → MP B → company → MP C* never appears as a single row — that would double-count the *A↔B* tie that's already a separate row above. Sample rows from his page:

> Dimitrov → **КРУМКООП - 1** → **Georgi Ivanov Georgiev** (GERB-SDS) — *2 steps · currently active · name-match link*
>
> Dimitrov → **АПИС МЕЛИФЕРА БЪЛГАРИЯ** → **Rashid Mehmedov Uzunov** (PB) — *2 steps · currently active · name-match link*
>
> Dimitrov → **УСТРЕМ** → ИВАН ХРИСТОВ ИВАНОВ → **СЛЪНЦЕ БУТОВО** → **Ivan Todorov Ivanov** — *4 steps · currently active · name-match link*

Below the path rows is a small interactive subgraph showing only the nodes that appear in those paths — no orphan companies, no clutter. It uses the same canvas as the orbital page: drag to pan, Ctrl/Cmd+scroll to zoom, click any node for a detail popover that lists the node's metadata (party, legal form, UIC) and its full neighbour list with links.

For MPs whose paths exceed the cap of 10, a "see details" link opens a dedicated page at `/candidate/:id/connections` that groups all of the paths by length — direct shared companies (length 2) first, indirect via a shared associate (length 4) below.

For MPs with **no** paths to any other MP — typical of newly-seated MPs whose declarations have been filed alone, or of MPs whose declared companies share no officer with anyone else's — the tile falls back to a one-hop neighbourhood view so the page still tells you what companies the MP touches.

The avatar styling (party-coloured ring) is shared with the dashboard rankings rows, the path popover, and with the orbital page, so a person's identity stays visually consistent across the whole feature.

---

## 5. The [connections page](/connections)

The centerpiece. The page is built around a single question: *who is connected to whom in this parliament, and through what?* The page lays out as a vertical stack: a hero stat block on top, a chip filter rail beneath it, then three cards in order — strongest connections, most-connected rankings, and the orbital graph.

### The hero block

The first thing on the page is a one-sentence stat with a clickable heatmap underneath:

> **11** MPs in parliament 52 have ties to **14** others through **20** shared companies.

The numbers update with the scope filter (described below). Below the sentence, a **party × party heatmap** shows where MP↔MP ties cross party lines — each cell is the number of pair-paths whose two endpoints belong to those two parties. Cells are log-scaled so a single mega-cluster doesn't drown out everything else, and clicking any cell drills the list below into that exact party crossing. For the 52nd parliament the journalistically interesting cells are the cross-party ones — the brightest single cross-bench cell is *PG of GERB-SDS × PG of PB*, and the *ГЛАСЪ × PG of Vazrazhdane* cell that the worked example in §7 walks through.

### The filter rail

Sitting under the hero block is a chip-style filter rail (Linear/Notion pattern). Every state lives in the URL so a journalist can copy `electionsbg.com/connections?ns=52&crossParty=1` directly into a tweet, and the same chip set drives both the strongest-connections card below and the rankings list, so toggling a chip reshuffles both views in lockstep:

- **Smart entity search** — type any MP or company name; suggestions resolve as you type and selecting one navigates straight to the profile page. Backed by a precomputed search index of 605 MPs + 2,087 companies.
- **Scope chip** (always visible) — defaults to the parliament selected in the global header. Click it to switch to a specific NS folder or the "All parliaments" lifetime view. Once you've picked an explicit scope it sticks even when you change elections in the global header.
- **Cross-party only** — restrict to MP↔MP pairs whose endpoints belong to different parliamentary groups. This is the journalistically interesting filter and it always sits one click away.
- **All current** — drop pairs whose canonical path includes any historical edges (transferred shares, ended TR roles).
- **High confidence** — drop pairs whose canonical path uses any name-match (medium-confidence) link. Useful when you want to be conservative about identity matches.
- **Party-pair chip** — appears automatically when you click a heatmap cell, showing the two parties as a removable chip. Drilldown is one click in, one click out.

### Strongest connections card

A ranked list of MP↔MP connections rendered as **chip chains** — the same `MP → Company → Associate → Company → MP` visualization used on every candidate page. Each row reads at a glance:

- Top pair globally: the **Drenchev brothers** — currently sitting Vazrazhdane MP **Dimo Drenchev** and former *ГЛАСЪ* MP **Nikolay Drenchev** — co-owning *Братя Градеви ООД*. 2 steps · currently active · high confidence. This is the worked example in §7.
- Next: a cross-party medium-confidence bridge running **Georgi Ivanov Georgiev (GERB-SDS) → КРУМКООП-1 → Dimitar Georgiev Dimitrov → АПИС МЕЛИФЕРА БЪЛГАРИЯ → Rashid Mehmedov Uzunov (PB)**. 4 steps · currently active · name-match link — this row drops out the moment you tick *High confidence*.
- And the **Petkov** family (current PP MP and his father, BSP) co-owning *Чеси Инс Брокер ООД*.

Each pair is scored on a small handful of signals: cross-party + both-currently-seated + multiple-shared-companies + currently-active-path + high-confidence-path + shorter-is-better, with high-confidence and cross-party as the dominant ones. Of the 45 distinct MP↔MP pairs in the graph, around 16 touch the 52nd parliament.

A toolbar above the list adds three power-user controls:

- **Compare 51 → 52** — when on, the rows are colour-coded: green for *new* pairs that appear in the selected parliament but not the prior one, neutral for *carried over* (in both), red strikethrough for *ended* (only in the prior). Bulgaria's parliamentary churn makes this view uniquely useful — it surfaces ownership patterns that survive the rotation of MPs.
- **Export CSV** — downloads the current filtered list as a flat CSV with one row per pair, ready to open in Excel or Sheets. Columns mirror what's visible on the page (endpoints, parties, parliaments, shared-company count, full chain).
- **Watchlist stars** — every chip-chain row carries a star next to each MP name. Starred MPs are saved in your browser and rows containing a watched MP get a soft amber ring so you can scan the list for follow-ups without reading every name.

### Most-connected rankings card

Sits directly below the strongest-connections list. A two-column grid: **Top MPs** by high-confidence ties on the left, **Top companies** by MP count on the right, ten rows each. Both lists honour the scope chip in the rail — switch to NS-52 and the top MPs become the same set the dashboard tile shows (Naydenov 14, Apostolov 11, Petkov 8, Mirchev 7, …). A *View all →* link under the companies column goes to the [flat companies index](/mp/companies).

### Orbital graph card

An always-visible force-directed canvas at the bottom of the page. The same data, drawn as nodes and edges. Standard filter set lives just above the canvas — *Hide transfers*, *Largest component only*, *Cluster by party* — and the rail's *Current only* and *High confidence* chips also flow through to the canvas, so the orbital view honours the same filters as the strongest-connections list above. Usual canvas behaviour: drag to pan, Ctrl/Cmd+scroll to zoom, click a node for the detail popover.

![Orbital graph card default view](/articles/images/connections/06-orbital-default.png)

A few seconds of staring at the default view is enough to notice that the picture is *not* one big blob. There are roughly 560 connected components; the largest holds the better part of a thousand nodes, the next two each have a few hundred, and the long tail is small clusters — an MP and their handful of personal businesses — with a handful of dense neighbourhoods where shared officers create cross-MP links.

The **Largest component only** filter is where most of the cross-MP ownership patterns live:

![Largest component only](/articles/images/connections/08-orbital-largest-component.png)

The **Cluster by party** filter pulls each MP node towards its party's slot on the canvas, so intra-party clusters reveal themselves as petals of one colour:

![Cluster by party](/articles/images/connections/07-orbital-cluster-by-party.png)

When a company sits *between* two party clusters, that is a hint worth chasing — and the heatmap on the hero block surfaces those crossings without making you squint at the canvas.

A *Find connection between two MPs* button on this same card flips the canvas into pick mode: click one MP node, then another, and the page BFS-walks the filtered graph to draw the shortest path between them in red. If no path exists the canvas just highlights the two endpoints and prints *"No path between these two MPs"* — useful for confirming a *negative* result, not just a positive one.

### Companies index

The "All companies" link in the dashboard tile opens a [flat, searchable table](/mp/companies) of every company any MP is connected to — currently **2,086** distinct companies. **702** of those are companies an MP declared a stake in directly; the rest are companies an MP holds (or held) a Commerce Registry role at — manager, partner, procurator, etc. The "Linked MPs" column folds both kinds of relationship into a single name list, so a row will list the same MP whether they declared 100% ownership or only an active manager appointment.

![Companies index](/articles/images/connections/09-all-companies.png)

Each row links to the company's dedicated page, which lists the active officers (from the Commerce Registry) and every MP stake declared against it:

![Company detail page](/articles/images/connections/10-company-detail.png)

The example above is **["ПиВи Квантум" ООД](/mp/company/%D0%9F%D0%B8%D0%92%D0%B8-%D0%9A%D0%B2%D0%B0%D0%BD%D1%82%D1%83%D0%BC-%D0%9E%D0%9E%D0%94)** (UIC 206258486, seated in Veliko Tarnovo) — a company small enough that two MPs (Venetsia Ognyanova Netsova-Angova in 48th and 49th NS, and Nikolay Georgiev Angov in 47th NS) each declared a 33–100% stake against it across two fiscal years, including a transferred share in 2022.

---

## 6. The assets pages

Two pages cover the wealth feature end to end.

### The rankings page

The [assets ranking](/mp-assets) is a flat sortable table of every MP whose latest declaration produced a non-zero asset or debt total — currently **713 MPs across 1,802 declarations**. The header carries two scope chips — "Selected parliament" (defaults to the NS picked in the global header) and "All parliaments" (lifetime view) — plus a free-text search that filters by name or party group. Every column is sortable: net worth (default sort, descending), total assets, debts, properties, year of latest filing, name, and the YoY change column.

A small footnote on the properties column flags MPs whose declarations include items without a stated value — `8 (+3 n/v)` reads as "8 declared properties, 3 of them filed with no acquisition price." We don't impute prices for those — that would be editorial — so the rank-by-net-worth column is naturally a slight under-count for MPs whose real estate is mostly unvalued.

### Per-party rollup

The same ranking, scoped to a single party, appears on every party page right under the existing **Top candidates** tile. The list is computed by intersecting the global ranking with the party's candidate roster, so it covers everyone the party fielded — not just current MPs. For coalitions like PP-DB this means the tile naturally shows MPs from both groups, which is usually what a reader wants when comparing across the coalition.

### The details page

The per-candidate details page, reached from the **See details** link in the candidate-page summary card, is the long form. It opens with the same headline numbers (total / debts / net worth) and a direct link to the source XML, then renders one table per asset category that the declarant filed against — typically real estate first, then vehicles, bank accounts, cash, investments, securities, receivables, and (when present) debts.

Each table column carries the verbatim source data:

| column | what it shows |
|---|---|
| Type / description | the cacbg row's "Вид на имота" / "Вид на превозното средство" / receivable type |
| Location | for real estate, settlement + municipality |
| Brand | for vehicles, the make + model |
| Area (m²) | for real estate; the parser extracts the leading number even when the declarant appended a unit suffix like `917 кв.м.` |
| Year | year acquired |
| Holder | the natural person on the title; flagged "(spouse)" when the holder name doesn't match the declarant's |
| Share | idealna chast — the fractional ownership the declarant entered (`1/1`, `1/2`, `1/4`, etc.); preserved as raw text since some declarants enter percentages instead |
| Amount | the value as the declarant filed it, in the declared currency |
| BGN | the BGN-equivalent used for ranking math (FX-converted when needed) |
| Legal basis | the cacbg "Правно основание" cell — `покупко-продажба`, `договор за наем`, `наследство`, etc. |
| Origin of funds | the verbatim "Произход на средствата" note. This is the most journalistically interesting field because it's where the declarant explains where the money came from — `заплата`, `спестявания`, `доходи от дивидент, продажба на акции`, `заеми`, etc. |

Below the asset tables sits the **Annual income** table (Table 12) with one row per income category, declarant + spouse columns and a totals row at the bottom.

### The [cars page](/mp-cars)

Reached from the *See details →* link on the **MPs' car makes** dashboard tile, the cars page is a flat sortable table of every passenger car or jeep extracted from the most recent declaration of every MP — currently **570 vehicles** lifetime, **69 for the 52nd parliament**. Spouse-held cars are included with the holder column flagged accordingly so the same physical car never gets double-counted across the household.

Columns: rank, MP (avatar + link), party group, make (canonical English-cased), declared model text (verbatim), year acquired, declared BGN value, holder (MP / spouse), and a source-link icon to the underlying cacbg XML for each row. The default sort is by BGN value descending; every column header is clickable. A header toggle switches between *Selected parliament* and *All parliaments* scope; a free-text search filters by MP name, make, model, or party group.

A summary line above the table reads, for example, *69 cars · 67 with declared value · combined 1,910,760 BGN* — useful for sense-checking the ranking. The page footer notes the source dataset (cacbg.bg, Court of Audit) and clarifies that motorcycles, trailers and utility vehicles are intentionally excluded so the table compares like-for-like across MPs.

**Why some Model cells show `(1/2 + 1/2)`.** Bulgarian inheritance and household-property rules routinely produce declarations that list the same physical vehicle as two ownership shares filed under different legal acts — a declarant's half plus their spouse's half declared as two rows under the same name, or an inherited share plus a partition share. Faithfully rendering each row would inflate both the make ranking and the cars page (one car would show up twice). When that happens, such rows are collapsed and their fractional shares joined with " + " in the Model column, with the merged-row count available on hover. The summed BGN value is the per-row sum across the merged shares (so when both halves of a half-half declaration carry a value, the row shows the full car's value). The underlying XML is one click away on every row, so the original split is always recoverable.

The most expensive declared car in the lifetime view is a **BMW M760 at 299,891 BGN** filed by former MP Gyunay Hyusmen Hyusmen in 2024 (declared as two halves under the household, which the page collapses into a single row). The next entries are **Zornitsa Mihaylova's BMW X6 M50i at 207,045 BGN** (2020) and **Imren Mehmedova's Mercedes-Benz GLE350d at 185,763 BGN** (2023). For the 52nd parliament the top entry is **Desislava Taneva's Lexus RX 350h at 149,876 BGN** (2024 acquisition), followed by **Valentin Milushev's Toyota at 88,000 BGN**. (One earlier outlier — Ihsan Halil Hakkı's 1999 VW Golf filed at 800,000 BGN — sat at the top of the lifetime list for an embarrassing while; it was an obvious decimal-separator typo and is now corrected to 800 BGN, the same single-row treatment described for the Pavlov 2021 apartment below.)

### Worked example: Delyan Peevski

Peevski's details page is the most data-dense in the dataset — 21.7 M BGN total declared, broken down as:

- **Real estate (8 items, 455,922 BGN)** — every entry is a "къща с двор" (house with yard) or apartment in Sofia-град, all acquired in 2024, all reported under `1/1` ownership, all with the legal basis "договор за наем" (rental contract) and the same origin-of-funds note: *"доходи от дивидент, продажба на акции, както и от продажба на дружествени дялове и получени дивиденти, декларирани и през предходни години"* (dividend income, sale of shares, sale of company stakes and dividends, also declared in previous years).
- **Vehicles (5 items, 169,200 BGN)** — BMW, Audi, Land Rover, Mercedes, Toyota, all acquired 2024, all under contract.
- **Bank accounts (3 items, 1,091,888 BGN)** — one BGN, one EUR, one USD; the latter two get FX-converted on the page.
- **Cash (2 items, 758,400 BGN)** — one BGN, one EUR.
- **Investments (1 item, 83,093 BGN)** — a 42,485 EUR fund holding.
- **Receivables (1 item, 19,092,622 BGN)** — a single declared receivable that dwarfs everything else on the page combined; legal basis "Решение на ЕСК за разпределен дивидент" (board decision on dividend distribution).

Annual income on the same filing: 125,859 BGN taxable employment income + 50,616 BGN under "Art. 11 from the Annex of ПОДНС" — both declarant only.

The YoY chip on the summary card shows ↓ −2.5 M BGN vs the prior fiscal year, driven mostly by changes in the receivables line.

### One known data-entry typo

One MP — Stratsimir Ilkov Pavlov, 2021 declaration — reported a 71m² Varna apartment at 33,383,100 BGN, which is three orders of magnitude above his companion 41m² office in the same building (27,169 BGN). The most plausible reading is a misplaced decimal separator. Rather than let one declarant typo dominate every chart and ranking, this single row is corrected to 33,383 BGN. We never do heuristic value-clamping ("anything over 100k BGN/m² must be wrong") — that would silently rewrite legitimate luxury properties. Each correction is applied to one specific row only, and new typos are added the same way as we find them.

---

## 7. Worked example — a cross-party tie between two MP brothers

This example is not something you have to *find* — it sits at the top of the strongest-connections card the moment you load the [connections page](/connections). The scoring function ranks it first because it satisfies almost every signal at once: cross-party (Vazrazhdane × *ГЛАСЪ*), one endpoint currently seated in the 52nd parliament, every edge currently active, and — unusually for this dataset — every edge is **high confidence** because the surname is a unique match against parliament profiles.

The two endpoints:

- **[Dimo Georgiev Drenchev](/candidate/%D0%94%D0%B8%D0%BC%D0%BE%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D1%80%D0%B5%D0%BD%D1%87%D0%B5%D0%B2)** — currently sitting *PG Vazrazhdane* MP, 52nd parliament
- **[Nikolay Georgiev Drenchev](/candidate/%D0%9D%D0%B8%D0%BA%D0%BE%D0%BB%D0%B0%D0%B9%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D1%80%D0%B5%D0%BD%D1%87%D0%B5%D0%B2)** — former *ГЛАСЪ* MP

The chip chain, exactly as it appears on the page:

> **Dimo Drenchev (ВЪЗРАЖДАНЕ)**
> → company **"Братя Градеви" ООД**
> → **Nikolay Drenchev (ГЛАСЪ)** — *2 steps · currently active · high confidence*

Two brothers, one company they jointly own, both having served as MPs on different sides of the chamber. Every edge is high-confidence because the "Drenchev" surname matches uniquely to a single parliament profile in each case — no disambiguation needed.

This is the **conservative** end of the dataset: identity is unambiguous, the company is currently active, both brothers' shares are still on file. It's exactly the kind of row that survives ticking *High confidence* in the filter rail, where most of the rest of the list drops away.

### A noisier neighbour: the Georgiev → Uzunov bridge

For contrast, the second row down on the same list runs across two intermediate companies and one intermediate MP:

> **Georgi Ivanov Georgiev (GERB-SDS)**
> → company **КРУМКООП - 1** (UIC 108563610, OOD)
> → **Dimitar Georgiev Dimitrov** (former MP)
> → company **АПИС МЕЛИФЕРА БЪЛГАРИЯ** (UIC 204909172, OOD)
> → **Rashid Mehmedov Uzunov (PB)**

A two-hop bridge through one intermediary MP and two cooperatives. Read it left-to-right: a sitting GERB-SDS MP and a sitting PB MP both share a partnership stake (`tr_owner` / `partner` role) in two cooperatives that are in turn co-owned by a former MP (Dimitrov). Uzunov looks unconnected at first glance — his candidate page is sparse:

![Uzunov candidate page](/articles/images/connections/11-orbital-pathfind-attempt.png)

But the precomputed top-pairs list surfaces the bridge directly. Each chip on the row links straight into the relevant entity page, and the *Source: TR* link at the end of the row jumps to the Commerce Registry filing for the first company on the chain so you can verify what is actually filed.

**The honest caveat** — and this is the kind of thing the *High confidence* chip on the filter rail was built for: every edge in *this* row is **medium confidence**. They are name matches against the Commerce Registry without an extra corroborating signal. The chip-chain row footer flags this directly with a *name-match link* warning, and toggling *High confidence* in the rail makes the row disappear entirely, because the bridge (Dimitrov) and the two cooperatives all drop out. That is not a bug — it is the difference between "almost certainly the same person" and "the name fits, look closer." A reader chasing this lead would want to verify the natural-person identities at the Commerce Registry portal before drawing any conclusion (the *Source: TR* link on the row goes there directly). The Drenchev brothers above are what high-confidence looks like; this row is what medium-confidence looks like, side by side on the same list.

If you want to see the densest single MP profile in this regard, **[Naydenov](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%9D%D0%B0%D0%B9%D0%B4%D0%B5%D0%BD%D0%BE%D0%B2)** (14 high-confidence ties — every one of them corroborated) is the right page; he has no MP-to-MP paths because his Burgas textile network does not overlap with any other parliamentarian's, but the management-roles and declarations blocks above the empty-paths state are the longest in the dataset.

---

## 8. Refresh cadence

- **Declarations** — Court of Audit publishes the prior fiscal year's filings each spring. Today's dataset covers fiscal years 2020 through 2025 plus the first six 2026 filings; the rest of the 2026 batch for the just-elected 52nd parliament is still landing — currently 102 of its 240 MPs are on file. Each declaration-driven tile carries a per-NS provenance footnote so the staleness is visible inline rather than buried.
- **Commerce Registry** — incremental refresh; staleness is surfaced via the same per-section provenance footnote.

When the next batch of declarations lands, every page that depends on them — connections graph, asset ranking, cars page, per-MP profiles — refreshes together.

## 9. Limitations and honest disclaimers

- **Foreign-registered companies are invisible.** A Cypriot SPV that an MP owns will not show up unless they declared it on Table 10 — and most don't.
- **Beneficial-ownership chains stop at one hop.** Where the public registries record a holding company as the owner of an operating company, the graph shows the relationship to the holding, not to the ultimate beneficiary.
- **Name matching is heuristic.** Surname-only ties are dropped before publication, not flagged. The medium-confidence tier is exactly where to put your skepticism.
- **Declarations are self-reported and lag by ~12 months.** A change in 2025 ownership will not appear until the May 2026 filing batch is processed.
- **The Commerce Registry is current as of the last incremental refresh.** Filings made after that date are not yet visible.
- **Asset values are at acquisition price, not market value.** A 1999 Varna apartment that cost 33,000 BGN at the time stays in the dataset at 33,000 BGN even if it would sell today for 250k. Net-worth rankings should be read with this in mind — they reflect what was *declared*, not current market.
- **Foreign-currency conversions use a single rate per currency.** EUR uses the BNB fixed peg (1.95583); USD/GBP/CHF/etc use a single recent BNB average. The actual exchange rate on the date the declarant filed was probably different. This is a deliberate ranking-vs-precision tradeoff — fine for ordering MPs, not a substitute for a per-filing rate.
- **Some declarants typo digits.** When the typo is obvious enough to dominate a chart (Pavlov 2021, §6), we add a narrow override; otherwise we trust the declarant's number even when it's surprising.

## 10. What this enables

The intent of the feature is not to replace the Court of Audit or AKF (Anti-Corruption Commission). It is to make a record that is already public *legible* — to turn 605 separate XML files into a single graph that a citizen, a journalist, or a campaign-finance researcher can navigate in 30 seconds instead of 30 hours. Most of what is in here is uneventful. The point is that "uneventful" is now visible too, and that the few non-uneventful things stand out by contrast.

If you spot a wrong edge, a false-positive bridge, or a missing declaration, get in touch — the underlying datasets and the pipeline that builds the graph are open source.
