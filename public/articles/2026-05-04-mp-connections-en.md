# Following the money trail — MP business connections and declared wealth

Bulgarian voters can already see how an MP votes, where they were elected, and how their party fared in any given polling station. What has been much harder to see — without manually downloading an XML declaration and cross-checking it against the Commerce Registry — is what *companies* sit behind those people, how those companies link MPs to one another, and how much wealth each MP actually declared in the first place.

That is the gap these features fill. As of this writing, the graph contains **5,481 nodes** (605 MPs, 2,087 companies, 2,789 other named persons) joined by **6,568 edges** drawn from two open Bulgarian datasets; the wealth aggregator covers **713 MPs across the cacbg filings** spanning fiscal years 2020–2025; and a derived **`/mp-cars` page** lists every passenger car (570 lifetime, 69 for the 52nd parliament) extracted from those same declarations, sorted by declared BGN value. This article walks through where to find the new pages, what they show, and ends with a worked example: a real cross-party ownership path between two currently sitting MPs.

> **Update (May 2026):** the `/connections` page was rebuilt around a *story-first* layout — a hero sentence with a party × party heatmap, a ranked list of MP↔MP connection chains, a dedicated path-finder tab and an opt-in orbital graph. The old single-canvas view is now one of three tabs.
>
> **Update (May 2026, second pass):** the declarations pipeline now also parses the property/wealth tables of every cacbg filing (real estate, vehicles, cash, bank deposits, receivables, debts, investments, securities) — not just the company-shares tables it originally read. The new feature ships as a **MPs by declared assets** tile on the home and party pages, a per-MP **Declared assets** summary card on every candidate page, a sortable **/mp-assets** page, and a per-candidate details page at **/candidate/:id/assets** that lists every declared asset row with its origin-of-funds note. §6 below describes the asset feature end-to-end.
>
> **Update (May 2026, third pass):** the **MP Business Connections** dashboard tile was split in two and reworked. The "Top companies" column has been retired — at the per-parliament scope nearly every "shared" company has just one or two MPs against it, and the two-MP cases are overwhelmingly family relatives co-owning a single SPV, not the cross-party signal the column suggested. The "Top MPs" column now ranks by **direct co-MP degree** (count of fellow MPs of the same parliament that share at least one declared company with this MP), tooltipped with the wider high-confidence-ties count for context. A new sibling tile **MPs' car makes** sits to its right, ranking the most-declared passenger-car brands per parliament; clicking through opens a sortable page at **/mp-cars** with every declared car ordered by BGN value. Both tiles carry a provenance footnote — *"Declarations YYYY–YYYY · X/Y MPs filed · refreshed Mon YYYY"* — so readers can see exactly how stale the underlying filings are for each parliament. The header link on the connections tile has been renamed *See details* (it always landed on the Strongest ties tab, not the orbital graph). §3 below has been rewritten around the new layout.

---

## 1. What this is, and what it is not

This is a **graph of declared and registered business ties** between sitting and former MPs.

- **Declared ties**: ownership stakes that an MP filed with the [Court of Audit](https://register.cacbg.bg/) on their annual property/interest declaration.
- **Registered ties**: management roles, partnerships and beneficial-ownership entries pulled from the [Commerce Registry](https://data.egov.bg/) (Търговски регистър) for those same companies, plus other companies the same individuals appear on.

It is **not** a list of accusations. Bulgarian law forbids sitting MPs from holding *active* management roles in commercial companies (ЗПК Art. 35), but it does not forbid ownership stakes — and historical management roles linger in the Commerce Registry as part of the public record. Most of what you see here is perfectly legal. The point of the graph is to make that legal-but-public record easy to read.

It is also **not complete**: companies registered abroad, informal beneficial ownership, family vehicles outside Bulgaria, and trusts are out of scope, because none of them are visible to the two source datasets.

## 2. Sources, and how confident the data is

Two source datasets, both open:

| source | what it provides | format | refresh |
|---|---|---|---|
| [register.cacbg.bg](https://register.cacbg.bg/) (Court of Audit) | annual property/interest declarations filed by every MP. The parser reads Tables **1 / 1.1 / 1.2** (real estate — own, agricultural, foreign-used), **3 / 3.1 / 3.2 / 3.3 / 3.4** (vehicles — motor / agricultural / boats-aircraft / other / foreign-used), **4** (cash on hand), **5** (bank accounts & deposits), **6** (receivables > 10k BGN), **7** (debts > 10k BGN), **8** (investment & pension funds, incl. crypto), **9** (securities & financial instruments), **10** (current LLC shares), **11** (transferred shares) and **12** (income). Tables 2 and 3.5 (transferred-out property/vehicles) are intentionally skipped from the asset totals because the holdings have already left the declarant's estate. | XML per declaration | annually each May |
| [data.egov.bg](https://data.egov.bg/) dataset 2df0c2af-… (Commerce Registry) | daily filings of officers, partners, beneficial owners, status, seat | bulk JSON / incremental | daily, processed in batches |

Why both? Declarations alone show *MP → company* ties, which is enough to build a list. They do not show *MP → MP* ties through shared boards or co-owners, and that is exactly where most of the interesting overlaps live. The Commerce Registry supplies that connecting tissue.

Every edge in the graph carries a **confidence** label that surfaces throughout the UI:

- **High** — name match plus seat-in-region or same-party co-declaration corroboration. There are 4,988 high-confidence edges.
- **Medium** — name match alone, no corroboration. There are 1,580 medium-confidence edges.
- **Low** — surname-only matches. These are dropped before publication, not displayed.

Edge breakdown by source: **731 declared stakes**, **2,722 Commerce Registry ownership/partner edges**, **3,115 Commerce Registry role edges** (manager, director, representative, procurator, liquidator, etc.).

The graph file ([`/parliament/connections.json`](/parliament/connections.json)) carries a `generatedAt` timestamp so you can see how stale you are looking at — at the time of writing it was rebuilt on 2026-05-04.

---

## 3. Where the feature appears — the dashboard tiles

The first place a casual reader meets the data is a row of three sibling tiles on the national dashboard, sitting under the headline party-results block. The first two — **MP Business Connections** and **MPs' car makes** — render side-by-side; the third — **MPs by declared assets** — sits in its own row directly below.

(The screenshots in this section pre-date the May 2026 split and still show the older combined tile with a "Top companies" column on the right; the live page no longer renders that column. The relevant text below describes the current layout.)

### MP Business Connections

![National dashboard tile](/articles/images/connections/01-dashboard-tile.png)

A single column ranking the **most-connected MPs** of the currently-selected parliament — not by raw graph degree, but by **direct co-MP degree**: how many other MPs of the same parliament this person shares at least one declared company with. The number renders in a muted style when it is zero, which is the typical case for any individual MP. (Most cross-MP business overlaps in the data are family-driven, and the strict count being mostly-zero is the honest signal — see the "Update (May 2026, third pass)" note above for the rationale.) Hovering the number reveals a fuller tooltip *"N co-MP · M total ties"* where M is the MP's wider high-confidence neighbourhood (companies + non-MP associates) — the same number that used to be the headline on this tile.

The list is filtered to the **currently selected election**: switch the date picker to an older parliament and the rankings reshuffle to the people who actually sat in that body. A click on any name jumps straight into that candidate's profile; the *See details* link in the top-right opens `/connections`.

The footer carries an "All companies →" link to the companies index, plus a provenance line that reads, for example, *Declarations 2021–2026 · 102/240 MPs filed · refreshed May 2026* — a one-glance summary of how stale the data is for the parliament currently in scope. (Hovering it reveals the per-year filing breakdown, e.g. *2025: 80 · 2024: 14 · 2023: 2 · …*.) For just-elected parliaments where most MPs haven't filed yet — the 52nd, at the moment, with only 102/240 — that line is the honest disclaimer that the rest of the tile is reading older filings.

The same tile appears on every regional dashboard, intersected with the MIR (multi-mandate region) the dashboard is showing. For example, on the Sofia dashboard it unions the three Sofia MIRs and shows only people who actually represented Sofia:

![Sofia regional tile](/articles/images/connections/02-sofia-region-tile.png)

Notice how the rankings change: **Ivaylo Mirchev** (DB) is now first with 7 ties — instead of being fourth nationally — because the regional view drops everyone outside Sofia. **Martin Dimitrov** (DB, six tenures spanning 40th–52nd parliament) appears second despite being in 8th position nationally for the same reason. (Regional mode falls back to the wider ties count rather than the direct co-MP count, since intersecting the per-NS slice with a region usually leaves nothing to rank by.)

### MPs' car makes

A new sibling tile to the right, ranking the most-declared passenger-car brands among MPs of the currently selected parliament. The number next to each make is the count of *distinct MPs* declaring at least one car of that brand — an MP declaring three Volkswagens still counts as one VW, so the ranking is a popularity signal rather than a raw vehicle count. For the 52nd parliament the top entries are **Toyota (7 MPs)**, **Audi (7)**, **Škoda (6)**, **BMW (5)**, **Ford (4)** — German makes dominate the lifetime list nationally but the per-NS picture is more even.

A *See details →* link in the header opens **/mp-cars**, the dedicated cars page covered in §6.5 below. The footer carries the same provenance footnote as the connections tile, drawing from the same `data-provenance.json` file, so the "as of" date stays consistent across the row.

The make is detected by matching each declarant's free-text *Марка* field against an alias table that handles all the routine Cyrillic spellings (and a long tail of typos: *Фоксваген*, *Фолсваген*, *Фолц Ваген* all collapse to *Volkswagen*; *Митсубиши* collapses to *Mitsubishi*; etc.). When the alias table doesn't recognise a token the row falls through to "unknown" and the unmatched samples are logged on every build so the table can be extended. The current alias map covers ≈99% of declared cars; the remaining few are long-tail East European or generic brand names.

### MPs by declared assets

In its own row directly below: same compact ranking format, same per-NS scope, but ranked by **net worth in BGN** (declarant + spouse) computed from each MP's most recent filed declaration. Each row carries a YoY arrow vs the prior fiscal year so you can see which MPs declared a meaningful change since the last filing. For the 52nd parliament the lead by a wide margin is **Delyan Peevski** (PG DPS, 21.7 M BGN, ↓2.5 M vs 2023), followed by **Rositsa Kirova** (PG of GERB-SDS, 13.3 M BGN, ↑10x vs 2023 driven by a single 3.4 M BGN receivable plus a 10 M BGN security holding). The "All MPs by assets →" link in the tile footer opens the full sortable table at `/mp-assets` (described in §6).

---

## 4. Where the feature appears — the candidate page

Four blocks were added to every MP profile, in this order:

### Declared assets

A compact balance-sheet card sitting at the top of the connections section. The header reads `Declared assets · fiscal year N` and shows three big numbers: total assets, debts (when present, in red with a minus sign), and net worth in BGN. A YoY chip next to them shows the absolute delta vs the previous fiscal year's filing — green up arrow for net worth that grew since the prior declaration, red down arrow when it shrank.

Below the headline numbers, a 4-column grid breaks the assets out by category — real estate, vehicles, bank accounts, cash, investments, securities, receivables, and (separately, in red) debts. Each tile shows the BGN total, the item count, and — where applicable — how many items the declarant filed *without* a value (typical of inherited real estate or rural plots).

For declarations that include foreign-currency holdings, the card shows the BGN-converted total. Conversions use the BNB fixed peg for EUR (1.95583) and a small lookup table of recent average rates for USD / GBP / CHF / etc. — good enough for ranking, not a substitute for the spot rate on any specific filing date. Holdings whose currency is unknown to the table fall back to the raw amount (rare).

A footer line links straight to the source XML on `register.cacbg.bg` for the same fiscal year, and a *See details* link in the card header opens the full per-row breakdown at `/candidate/:id/assets`. That details page (described in §6) shows every declared item with its location, area, year acquired, holder name, idealna chast (fractional ownership), legal basis and the verbatim *origin of funds* note that the declarant filed — the most journalistically interesting field on the form, because it's where the declarant explains *where the money came from*.

For MPs whose latest declaration includes income above the 10k BGN threshold (Table 12), the card grows an inline **Annual income** breakdown — one row per category (salary, dividends, rents, etc.), declarant column and spouse column. Pee	vski's 2025 filing for example shows Annual taxable employment income 125,859 BGN plus an "Art. 11" line of 50,616 BGN — both reported by the declarant only, no spouse income.

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

For every MP, the offline pipeline runs a BFS over the full graph and records — up to four hops away — the shortest path to every other MP that is reachable. Those paths land directly on the candidate page as a stack of explicit chains, with each chip linking out to the company or person it represents:

![Candidate connections to other MPs](/articles/images/connections/05-candidate-mini-graph.png)

The example above is **[Dimitar Georgiev Dimitrov](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%80%D0%BE%D0%B2)** — a former MP and the most-connected node in the graph by paths-to-other-MPs (**7 paths to 7 other MPs**). Each row reads left-to-right as the chain from the hub MP to the target, with a footer that flags step count, whether every edge along it is currently active, and whether every link is high-confidence or only a name match.

Two of the seven paths are direct (length 2 — both MPs touch the same company); the rest are length 4 (a shared associate sitting on two different companies). Sample rows from his page:

> Dimitrov → **КРУМКООП - 1** → **Georgi Ivanov Georgiev** (GERB-SDS) — *2 steps · currently active · name-match link*
>
> Dimitrov → **АПИС МЕЛИФЕРА БЪЛГАРИЯ** → **Rashid Mehmedov Uzunov** (PB) — *2 steps · currently active · name-match link*
>
> Dimitrov → **УСТРЕМ** → ИВАН ХРИСТОВ ИВАНОВ → **СЛЪНЦЕ БУТОВО** → **Ivan Todorov Ivanov** — *4 steps · currently active · name-match link*

Below the path rows is a small interactive subgraph showing only the nodes that appear in those paths — no orphan companies, no clutter. It uses the same canvas as the orbital page: drag to pan, Ctrl/Cmd+scroll to zoom, click any node for a detail popover that lists the node's metadata (party, legal form, UIC) and its full neighbour list with links.

For MPs whose paths exceed the cap of 10, a "see details" link opens a dedicated page at `/candidate/:id/connections` that groups all of the paths by length — direct shared companies (length 2) first, indirect via a shared associate (length 4) below.

For MPs with **no** paths to any other MP — typical of newly-seated MPs whose declarations have been filed alone, or of MPs whose declared companies share no officer with anyone else's — the tile falls back to the one-hop neighbourhood view (the same blob this section used to show before the path computation existed) so the page still tells you what companies the MP touches.

The avatar styling (party-coloured ring) is shared with the dashboard rankings rows, the path popover, and with the orbital page, so a person's identity stays visually consistent across the whole feature.

---

## 5. The connections page — `/connections`

The centerpiece. The page is built around a single question: *who is connected to whom in this parliament, and through what?* Everything is precomputed at build time so the page reads at first glance — no canvas wrangling required, no global graph download just to see the headlines.

### The hero block

The first thing on the page is a one-sentence stat with a clickable heatmap underneath:

> **11** MPs in parliament 52 have ties to **14** others through **20** shared companies.

The numbers update with the scope filter (described below). Below the sentence, a **party × party heatmap** shows where MP↔MP ties cross party lines — each cell is the number of pair-paths whose two endpoints belong to those two parties. Cells are log-scaled so a single mega-cluster doesn't drown out everything else, and clicking any cell drills the list below into that exact party crossing. For the 52nd parliament the brightest cell is *Independent × PG of PB* with 5 ties; the only cross-party-bench tie that involves both a *currently-active group* on each side is *PG of GERB-SDS × PG of PB* — the cell with one tie that the worked example in §7 walks through.

### The filter rail

Sitting above the tabs is a chip-style filter rail (Linear/Notion pattern). Every state lives in the URL so a journalist can copy `electionsbg.com/connections?ns=52&crossParty=1` directly into a tweet:

- **Smart entity search** — type any MP or company name; suggestions resolve as you type and selecting one navigates straight to the profile page. Backed by a precomputed search index of 605 MPs + 2,087 companies.
- **Scope chip** (always visible) — defaults to the parliament selected in the global header. Click it to switch to a specific NS folder or the "All parliaments" lifetime view. Once you've picked an explicit scope it sticks even when you change elections in the global header.
- **Cross-party only** — restrict to MP↔MP pairs whose endpoints belong to different parliamentary groups. This is the journalistically interesting filter and it always sits one click away.
- **All current** — drop pairs whose canonical path includes any historical edges (transferred shares, ended TR roles).
- **High confidence** — drop pairs whose canonical path uses any name-match (medium-confidence) link. Useful when you want to be conservative about identity matches.
- **Party-pair chip** — appears automatically when you click a heatmap cell, showing the two parties as a removable chip. Drilldown is one click in, one click out.

### The three tabs

#### 1. Strongest ties (default)

A ranked list of MP↔MP connections rendered as **chip chains** — the same `MP → Company → Associate → Company → MP` visualization used on every candidate page. Each row reads at a glance:

- Top pair for the 52nd parliament: **Georgi Ivanov Georgiev** (GERB-SDS) → КРУМКООП-1 → Dimitar Georgiev Dimitrov → АПИС МЕЛИФЕРА БЪЛГАРИЯ → **Rashid Mehmedov Uzunov** (PB). 4 steps · currently active · name-match link.
- The next two are family connections — the **Drenchev** brothers (Vazrazhdane ↔ former MP) co-owning *Братя Градеви ООД*, and the **Petkov** family (current PP MP and his father) co-owning *Чеси Инс Брокер ООД*.

Each pair is scored at build time: cross-party + both-currently-seated + multiple-shared-companies + currently-active-path + high-confidence-path + shorter-is-better, with cross-party as the dominant signal. The full scoring formula is documented at the top of `scripts/declarations/build_connections_graph.ts` so the weights can be retuned without rewriting the logic. Of the 49 distinct MP↔MP pairs in the global graph, 16 touch the 52nd parliament.

A toolbar above the list adds three power-user controls:

- **Compare 51 → 52** — when on, the rows are colour-coded: green for *new* pairs that appear in the selected parliament but not the prior one, neutral for *carried over* (in both), red strikethrough for *ended* (only in the prior). Bulgaria's parliamentary churn makes this view uniquely useful — it surfaces ownership patterns that survive the rotation of MPs.
- **Export CSV** — downloads the current filtered list as a flat CSV with one row per pair, ready to open in Excel or Sheets. Columns mirror what's visible on the page (endpoints, parties, parliaments, shared-company count, full chain).
- **Watchlist stars** — every chip-chain row carries a star next to each MP name. Starred MPs are kept in `localStorage` and rows containing a watched MP get a soft amber ring so you can scan the list for follow-ups without reading every name.

#### 2. Find a connection

A first-class autocomplete-driven path finder: pick a *From* MP, pick a *To* MP, and the page runs a BFS over the global graph for the shortest chain between them. Result renders as a single chip-chain row, exactly like the rows on the Strongest ties tab. The autocomplete pool defaults to the selected parliament — clear the scope chip to widen it.

This replaces the old "click two nodes on the canvas" flow, which forced users into the orbital view to do the most useful query the page offers.

#### 3. Explore graph

The original orbital force-directed view, kept as an opt-in tab for power users who want to see the global topology. Same filters as before — *Current only*, *Hide transferred*, *High confidence only*, *Largest component only*, *Cluster by party* — and the same canvas behaviour (drag to pan, Ctrl/Cmd+scroll to zoom, click a node for the detail popover):

![Orbital page default view](/articles/images/connections/06-orbital-default.png)

A few seconds of staring at the default view is enough to notice that the picture is *not* one big blob. There are **567 connected components**; the largest holds 971 nodes, the second 534, the third 191. Most of the graph is small clusters — an MP and their handful of personal businesses — with a handful of dense neighbourhoods where shared officers create cross-MP links.

The **Largest component only** filter (122 companies, 304 persons, 1,568 edges) is where most of the cross-MP ownership patterns live:

![Largest component only](/articles/images/connections/08-orbital-largest-component.png)

The **Cluster by party** filter pulls each MP node towards its party's slot on the canvas, so intra-party clusters reveal themselves as petals of one colour:

![Cluster by party](/articles/images/connections/07-orbital-cluster-by-party.png)

When a company sits *between* two party clusters, that is a hint worth chasing — and the heatmap on the hero block now surfaces those crossings without making the user squint at the canvas.

### Companies index

The "All companies" link in the dashboard tile opens a flat, searchable table of every company that any MP has touched — currently **2,087** distinct companies:

![Companies index](/articles/images/connections/09-all-companies.png)

Each row links to the company's dedicated page, which lists the active officers (from the Commerce Registry) and every MP stake declared against it:

![Company detail page](/articles/images/connections/10-company-detail.png)

The example above is **["ПиВи Квантум" ООД](/company/%D0%9F%D0%B8%D0%92%D0%B8-%D0%9A%D0%B2%D0%B0%D0%BD%D1%82%D1%83%D0%BC-%D0%9E%D0%9E%D0%94)** (UIC 206258486, seated in Veliko Tarnovo) — a company small enough that two MPs (Venetsia Ognyanova Netsova-Angova in 48th and 49th NS, and Nikolay Georgiev Angov in 47th NS) each declared a 33–100% stake against it across two fiscal years, including a transferred share in 2022.

---

## 6. The assets pages — `/mp-assets` and `/candidate/:id/assets`

Two pages cover the wealth feature end to end.

### The rankings page

`/mp-assets` is a flat sortable table of every MP whose latest declaration produced a non-zero asset or debt total — currently **713 MPs across 1,802 declarations**. The header carries two scope chips — "Selected parliament" (defaults to the NS picked in the global header) and "All parliaments" (lifetime view) — plus a free-text search that filters by name or party group. Every column is sortable: net worth (default sort, descending), total assets, debts, properties, year of latest filing, name, and the YoY change column.

A small footnote on the properties column flags MPs whose declarations include items without a stated value — `8 (+3 n/v)` reads as "8 declared properties, 3 of them filed with no acquisition price." We don't impute prices for those — that would be editorial — so the rank-by-net-worth column is naturally a slight under-count for MPs whose real estate is mostly unvalued.

### Per-party rollup

The same ranking, scoped to a single party, appears on every party page right under the existing **Top candidates** tile. The list is computed by intersecting the global ranking with the party's candidate roster, so it covers everyone the party fielded — not just current MPs. For coalitions like PP-DB this means the tile naturally shows MPs from both groups, which is usually what a reader wants when comparing across the coalition.

### The details page

`/candidate/:id/assets`, reached from the **See details** link in the candidate-page summary card, is the long form. It opens with the same headline numbers (total / debts / net worth) and a direct link to the source XML, then renders one table per asset category that the declarant filed against — typically real estate first, then vehicles, bank accounts, cash, investments, securities, receivables, and (when present) debts.

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

### The cars page — `/mp-cars`

Reached from the *See details →* link on the **MPs' car makes** dashboard tile, `/mp-cars` is a flat sortable table of every passenger car or jeep extracted from the most recent declaration of every MP — currently **570 vehicles** lifetime, **69 for the 52nd parliament**. Spouse-held cars are included with the holder column flagged accordingly so the same physical car never gets double-counted across the household.

Columns: rank, MP (avatar + link), party group, make (canonical English-cased), declared model text (verbatim), year acquired, declared BGN value, holder (MP / spouse), and a source-link icon to the underlying cacbg XML for each row. The default sort is by BGN value descending; every column header is clickable. A header toggle switches between *Selected parliament* and *All parliaments* scope; a free-text search filters by MP name, make, model, or party group.

A summary line above the table reads, for example, *69 cars · 67 with declared value · combined 1,910,760 BGN* — useful for sense-checking the ranking. The page footer notes the source dataset (cacbg.bg, Court of Audit) and clarifies that motorcycles, trailers and utility vehicles are intentionally excluded so the table compares like-for-like across MPs.

**Why some Model cells show `(1/6 + 5/6)`.** Bulgarian inheritance routinely produces declarations that list the same physical vehicle as two ownership shares filed under different legal acts — an inherited share + a partition share, or a declarant's half + their spouse's half declared as two rows under the same name. Faithfully rendering each row would inflate both the make ranking and the cars page (one car would show up twice). The build pipeline collapses such rows by `(MP, normalised model, year, holder)` and joins their fractional shares with " + " in the Model column, with `mergedFromCount` available on hover (`Combined from N declaration rows: 1/6 + 5/6`). The summed BGN value is the per-row sum across the merged shares (so when both halves of a half-half declaration carry a value, the row shows the full car's value). The underlying XML is one click away on every row, so the original split is always recoverable.

The most expensive declared car in the lifetime view is a **Volkswagen Golf at 800,000 BGN** filed by former MP Ihsan Halil Hakkı in 2024 — almost certainly a misplaced decimal separator in the original filing rather than a real luxury Golf, and a useful illustration of why the page footer flags that values are exactly as declared (no editorial clamping). For the 52nd parliament the top entry is **Desislava Taneva's Lexus RX 350h at 149,876 BGN** (2024 acquisition), followed by **Valentin Milushev's Toyota at 88,000 BGN**.

### Worked example: Delyan Peevski

Pee	vski's `/candidate/.../assets` page is the most data-dense in the dataset — 21.7 M BGN total declared, broken down as:

- **Real estate (8 items, 455,922 BGN)** — every entry is a "къща с двор" (house with yard) or apartment in Sofia-град, all acquired in 2024, all reported under `1/1` ownership, all with the legal basis "договор за наем" (rental contract) and the same origin-of-funds note: *"доходи от дивидент, продажба на акции, както и от продажба на дружествени дялове и получени дивиденти, декларирани и през предходни години"* (dividend income, sale of shares, sale of company stakes and dividends, also declared in previous years).
- **Vehicles (5 items, 169,200 BGN)** — BMW, Audi, Land Rover, Mercedes, Toyota, all acquired 2024, all under contract.
- **Bank accounts (3 items, 1,091,888 BGN)** — one BGN, one EUR, one USD; the latter two get FX-converted on the page.
- **Cash (2 items, 758,400 BGN)** — one BGN, one EUR.
- **Investments (1 item, 83,093 BGN)** — a 42,485 EUR fund holding.
- **Receivables (1 item, 19,092,622 BGN)** — a single declared receivable that dwarfs everything else on the page combined; legal basis "Решение на ЕСК за разпределен дивидент" (board decision on dividend distribution).

Annual income on the same filing: 125,859 BGN taxable employment income + 50,616 BGN under "Art. 11 from the Annex of ПОДНС" — both declarant only.

The YoY chip on the summary card shows ↓ −2.5 M BGN vs the prior fiscal year, driven mostly by changes in the receivables line.

### One known data-entry typo

One MP — Stratsimir Ilkov Pavlov, 2021 declaration — reported a 71m² Varna apartment at 33,383,100 BGN, which is three orders of magnitude above his companion 41m² office in the same building (27,169 BGN). The most plausible reading is a misplaced decimal separator. Rather than let one declarant typo dominate every chart and ranking, the parser ships with a tiny `REAL_ESTATE_VALUE_OVERRIDES` table (currently one entry, narrowly matched on source URL + location + area + raw value) that corrects this single row to 33,383 BGN and explains why in a code comment. We don't do heuristic value-clamping ("anything over 100k BGN/m² must be wrong") — that would silently rewrite legitimate luxury properties. New typos will be added the same way as we find them.

---

## 7. Worked example — a cross-party path between two sitting MPs

In the redesigned page this example is no longer something you have to *find* — it sits at the top of the Strongest ties tab the moment you load `/connections`. The scoring function ranks it first because it satisfies almost every signal at once: cross-party (PG of GERB-SDS × PG of PB), both endpoints currently seated in the 52nd parliament, every edge currently active. Toggling the *Cross-party only* chip in the filter rail collapses the 16 NS-52 pairs down to this single row.

The two endpoints:

- **[Georgi Ivanov Georgiev](/candidate/%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%20%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2)** — PG of GERB-SDS, served NS 48–52
- **[Rashid Mehmedov Uzunov](/candidate/%D0%A0%D0%B0%D1%88%D0%B8%D0%B4%20%D0%9C%D0%B5%D1%85%D0%BC%D0%B5%D0%B4%D0%BE%D0%B2%20%D0%A3%D0%B7%D1%83%D0%BD%D0%BE%D0%B2)** — PG of PB (Periferia / Movement for Rights and Freedoms — New Beginning)

Uzunov looks unconnected at first glance — his candidate page is sparse:

![Uzunov candidate page](/articles/images/connections/11-orbital-pathfind-attempt.png)

But the precomputed top-pairs list surfaces the bridge between him and Georgiev directly. The chip chain, exactly as it appears on the page:

> **Georgi Ivanov Georgiev (GERB-SDS)**
> → company **КРУМКООП - 1** (UIC 108563610, OOD)
> → **Dimitar Georgiev Dimitrov** (former MP)
> → company **АПИС МЕЛИФЕРА БЪЛГАРИЯ** (UIC 204909172, OOD)
> → **Rashid Mehmedov Uzunov (PB)**

A two-hop bridge through one intermediary MP and two companies. Read it left-to-right: a sitting GERB-SDS MP and a sitting PB MP both share a partnership stake (`tr_owner` / `partner` role) in two cooperatives that are in turn co-owned by a former MP (Dimitrov). Whether that means anything is a journalistic question, not a graph one — but the graph is what surfaces the question. Each chip on the row links straight into the relevant entity page, and the *Source: TR* link at the end of the row jumps to the Commerce Registry filing for the first company on the chain so you can verify what is actually filed.

**The honest caveat** — and this is the kind of thing the *High confidence* chip on the filter rail was built for: every edge in this path is **medium confidence**. They are name matches against the Commerce Registry without an extra corroborating signal. The chip-chain row footer flags this directly with a *name-match link* warning, and toggling *High confidence* in the rail makes the row disappear entirely, because the bridge (Dimitrov) and the two cooperatives all drop out. That is not a bug — it is the difference between "almost certainly the same person" and "the name fits, look closer." A reader chasing this lead would want to verify the natural-person identities at the Commerce Registry portal before drawing any conclusion (the *Source: TR* link on the row goes there directly).

For a more conservative example, the candidate page for currently-sitting Vazrazhdane MP **[Dimo Georgiev Drenchev](/candidate/%D0%94%D0%B8%D0%BC%D0%BE%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D1%80%D0%B5%D0%BD%D1%87%D0%B5%D0%B2)** shows a single direct path:

> Dimo Drenchev (ВЪЗРАЖДАНЕ) → **"Братя Градеви" ООД** → **Nikolay Drenchev** (former MP) — *2 steps · currently active · high confidence*

Two brothers, one company they jointly own, both having served as MPs. Every edge is high-confidence because the natural-person identities are not in dispute — the "Drenchev" name matches uniquely to a single parliament profile in each case. It's a clean illustration of how the same data surfaces both the noisy bridges and the unambiguous ones. The "Connections to other MPs" block on every candidate page (described in §4) is the place to start either kind of investigation.

If you want to see the densest single MP profile in this regard, **[Naydenov](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%9D%D0%B0%D0%B9%D0%B4%D0%B5%D0%BD%D0%BE%D0%B2)** (14 high-confidence ties — every one of them corroborated) is still the right page; he has no MP-to-MP paths because his Burgas textile network does not overlap with any other parliamentarian's, but the management-roles and declarations blocks above the empty-paths state are the longest in the dataset.

---

## 8. Refresh cadence

- **Declarations** — Court of Audit publishes the prior fiscal year's filings each May. Today's dataset covers fiscal years 2020 through 2025 (the early 2026 filings for the just-elected 52nd parliament are starting to land — currently 102 of its 240 MPs are on file). Each tile that depends on declarations carries a per-NS provenance footnote so the staleness is visible inline rather than buried.
- **Commerce Registry** — incremental refresh; the ranking and per-MP files carry their own `generatedAt` timestamps so you can see staleness directly.

When the next batch of declarations lands, the pipeline can be re-run via the project's `update-connections` script. Both the connection graph and the asset / car rankings + per-MP wealth files regenerate from the same offline pass.

## 9. Limitations and honest disclaimers

- **Foreign-registered companies are invisible.** A Cypriot SPV that an MP owns will not show up unless they declared it on Table 10 — and most don't.
- **Beneficial-ownership chains stop at one hop.** Where the public registries record a holding company as the owner of an operating company, the graph shows the relationship to the holding, not to the ultimate beneficiary.
- **Name matching is heuristic.** Surname-only ties are dropped before publication, not flagged. The medium-confidence tier is exactly where to put your skepticism.
- **Declarations are self-reported and lag by ~12 months.** A change in 2025 ownership will not appear until the May 2026 filing batch is processed.
- **The Commerce Registry is current as of the last incremental refresh** — the timestamp is in `generatedAt`. Filings made after that date are not yet visible.
- **Asset values are at acquisition price, not market value.** A 1999 Varna apartment that cost 33,000 BGN at the time stays in the dataset at 33,000 BGN even if it would sell today for 250k. Net-worth rankings should be read with this in mind — they reflect what was *declared*, not current market.
- **Foreign-currency conversions use a single rate per currency.** EUR uses the BNB fixed peg (1.95583); USD/GBP/CHF/etc use a single recent BNB average. The actual exchange rate on the date the declarant filed was probably different. This is a deliberate ranking-vs-precision tradeoff — fine for ordering MPs, not a substitute for a per-filing rate.
- **Some declarants typo digits.** When the typo is obvious enough to dominate a chart (Pavlov 2021, §6), we add a narrow override; otherwise we trust the declarant's number even when it's surprising.

## 10. What this enables

The intent of the feature is not to replace the Court of Audit or AKF (Anti-Corruption Commission). It is to make a record that is already public *legible* — to turn 605 separate XML files into a single graph that a citizen, a journalist, or a campaign-finance researcher can navigate in 30 seconds instead of 30 hours. Most of what is in here is uneventful. The point is that "uneventful" is now visible too, and that the few non-uneventful things stand out by contrast.

If you spot a wrong edge, a false-positive bridge, or a missing declaration — the graph file is a static JSON in the repository, and the pipeline that generates it is in `scripts/declarations/` and `scripts/smetna_palata/`. The whole thing is open source.
