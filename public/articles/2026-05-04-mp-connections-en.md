# Following the money trail — a tour of the new MP business connections feature

Bulgarian voters can already see how an MP votes, where they were elected, and how their party fared in any given polling station. What has been much harder to see — without manually downloading an XML declaration and cross-checking it against the Commerce Registry — is what *companies* sit behind those people, and how those companies link MPs to one another.

That is the gap this feature fills. As of this writing, the graph contains **5,481 nodes** (605 MPs, 2,087 companies, 2,789 other named persons) joined by **6,568 edges** drawn from two open Bulgarian datasets. This article walks through where to find the new pages, what they show, and ends with a worked example: a real cross-party ownership path between two currently sitting MPs.

> **Update (May 2026):** the `/connections` page has been rebuilt around a *story-first* layout — a hero sentence with a party × party heatmap, a ranked list of MP↔MP connection chains, a dedicated path-finder tab and an opt-in orbital graph. The old single-canvas view is now one of three tabs. §5 below describes the new design end-to-end; the older orbital screenshots remain as references for the "Explore graph" tab.

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
| [register.cacbg.bg](https://register.cacbg.bg/) (Court of Audit) | annual property/interest declarations — Tables 10 (current stakes) and 11 (transferred shares), filtered to the "Народни представители" declarant category | XML per declaration | annually each May |
| [data.egov.bg](https://data.egov.bg/) dataset 2df0c2af-… (Commerce Registry) | daily filings of officers, partners, beneficial owners, status, seat | bulk JSON / incremental | daily, processed in batches |

Why both? Declarations alone show *MP → company* ties, which is enough to build a list. They do not show *MP → MP* ties through shared boards or co-owners, and that is exactly where most of the interesting overlaps live. The Commerce Registry supplies that connecting tissue.

Every edge in the graph carries a **confidence** label that surfaces throughout the UI:

- **High** — name match plus seat-in-region or same-party co-declaration corroboration. There are 4,988 high-confidence edges.
- **Medium** — name match alone, no corroboration. There are 1,580 medium-confidence edges.
- **Low** — surname-only matches. These are dropped before publication, not displayed.

Edge breakdown by source: **731 declared stakes**, **2,722 Commerce Registry ownership/partner edges**, **3,115 Commerce Registry role edges** (manager, director, representative, procurator, liquidator, etc.).

The graph file ([`/parliament/connections.json`](/parliament/connections.json)) carries a `generatedAt` timestamp so you can see how stale you are looking at — at the time of writing it was rebuilt on 2026-05-04.

---

## 3. Where the feature appears — the dashboard tile

The first place a casual reader meets the data is the **MP Business Connections** tile on the national dashboard:

![National dashboard tile](/articles/images/connections/01-dashboard-tile.png)

Two columns:

- **Top MPs** — ranked by **high-confidence** ties (the strict number, not the inflated medium-confidence one). The list is filtered to the **currently selected election**: switch the date picker to an older parliament and the list reshuffles to the people who actually sat in that body.
- **Top companies** — ranked by how many distinct MPs declared a stake in them. The five entries above (ПиВи Квантум, Елеборейт, ЛЕД МАРК, ФАКЛА, Инолед) each have **two** MPs attached — that is the bar for being on this list at all.

A click on any name jumps straight into that candidate's profile; a click on the "Graph" link in the top-right takes you to the orbital page (covered below).

The same tile appears on every regional dashboard, intersected with the MIR (multi-mandate region) the dashboard is showing. For example, on the Sofia dashboard it unions the three Sofia MIRs and shows only people who actually represented Sofia:

![Sofia regional tile](/articles/images/connections/02-sofia-region-tile.png)

Notice how the rankings change: **Ивайло Мирчев** (ДБ) is now first with 7 ties — instead of being fourth nationally — because the regional view drops everyone outside Sofia. **Мартин Димитров** (ДБ, six tenures spanning 40th–52nd parliament) appears second despite being in 8th position nationally for the same reason.

---

## 4. Where the feature appears — the candidate page

Three blocks were added to every MP profile, in this order:

### Financial declarations

The first block is a per-company summary of declared business interests. Each row links into the company's dedicated page and shows the years the stake was held with its share size and value; if those values changed between filings, the entries are broken out with an arrow between them so the progression is visible. Source XML links for every declaration sit in a footer at the bottom of the card so you can verify what was actually filed.

![Financial declarations on a candidate page](/articles/images/connections/03-candidate-declarations.png)

The example here is **[Димитър Найденов](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%9D%D0%B0%D0%B9%D0%B4%D0%B5%D0%BD%D0%BE%D0%B2)** — the most-connected currently-sitting MP, with 14 high-confidence ties. His 2024 filing alone lists nine Burgas-based ОООд and ЕООД companies in the textile and fashion business (БИТЕКС, ДОРЕМИ ПЛЮС, НЕОМАКС 09, СЪНМАКС, ДИТЕКС, ЗЕНИТ КОМЕРС, …) with stakes ranging from 17% to 100%.

### Management roles

The second block lists Commerce Registry roles — both *currently active* and *historical*. For sitting MPs the active list should be sparse by law (ЗПК Art. 35); historical roles are kept because they are part of the public record and routinely matter when reading the network.

![Management roles on a candidate page](/articles/images/connections/04-candidate-management.png)

The orange/green pill on each row shows the matching confidence — the same tier described in section 2. The green "high confidence" badge means the row is corroborated by something more than a bare name match (typically a same-region or same-fiscal-year cross-reference).

### Connections to other MPs

The third block answers the question the rest of the feature is built around: **does this MP share a business neighbourhood with any other MP, and if so, through what?**

For every MP, the offline pipeline runs a BFS over the full graph and records — up to four hops away — the shortest path to every other MP that is reachable. Those paths land directly on the candidate page as a stack of explicit chains, with each chip linking out to the company or person it represents:

![Candidate connections to other MPs](/articles/images/connections/05-candidate-mini-graph.png)

The example above is **[Димитър Георгиев Димитров](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%80%D0%BE%D0%B2)** — a former MP and the most-connected node in the graph by paths-to-other-MPs (**7 paths to 7 other MPs**). Each row reads left-to-right as the chain from the hub MP to the target, with a footer that flags step count, whether every edge along it is currently active, and whether every link is high-confidence or only a name match.

Two of the seven paths are direct (length 2 — both MPs touch the same company); the rest are length 4 (a shared associate sitting on two different companies). Sample rows from his page:

> Димитров → **КРУМКООП - 1** → **Георги Иванов Георгиев** (ГЕРБ-СДС) — *2 steps · currently active · name-match link*
>
> Димитров → **АПИС МЕЛИФЕРА БЪЛГАРИЯ** → **Рашид Мехмедов Узунов** (ПБ) — *2 steps · currently active · name-match link*
>
> Димитров → **УСТРЕМ** → ИВАН ХРИСТОВ ИВАНОВ → **СЛЪНЦЕ БУТОВО** → **Иван Тодоров Иванов** — *4 steps · currently active · name-match link*

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

The numbers update with the scope filter (described below). Below the sentence, a **party × party heatmap** shows where MP↔MP ties cross party lines — each cell is the number of pair-paths whose two endpoints belong to those two parties. Cells are log-scaled so a single mega-cluster doesn't drown out everything else, and clicking any cell drills the list below into that exact party crossing. For the 52nd parliament the brightest cell is *Independent × ПГ на ПБ* with 5 ties; the only cross-party-bench tie that involves both a *currently-active group* on each side is *ПГ на ГЕРБ-СДС × ПГ на ПБ* — the cell with one tie that the worked example in §6 walks through.

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

- Top pair for the 52nd parliament: **Георги Иванов Георгиев** (ГЕРБ-СДС) → КРУМКООП-1 → Димитър Георгиев Димитров → АПИС МЕЛИФЕРА БЪЛГАРИЯ → **Рашид Мехмедов Узунов** (ПБ). 4 steps · currently active · name-match link.
- The next two are family connections — the **Дренчев** brothers (Възраждане ↔ former MP) co-owning *Братя Градеви ООД*, and the **Петков** family (current ПП MP and his father) co-owning *Чеси Инс Брокер ООД*.

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

The example above is **["ПиВи Квантум" ООД](/company/%D0%9F%D0%B8%D0%92%D0%B8-%D0%9A%D0%B2%D0%B0%D0%BD%D1%82%D1%83%D0%BC-%D0%9E%D0%9E%D0%94)** (UIC 206258486, seated in Велико Търново) — a company small enough that two MPs (Венеция Огнянова Нецова-Ангова in 48th and 49th NS, and Николай Георгиев Ангов in 47th NS) each declared a 33–100% stake against it across two fiscal years, including a transferred share in 2022.

---

## 6. Worked example — a cross-party path between two sitting MPs

In the redesigned page this example is no longer something you have to *find* — it sits at the top of the Strongest ties tab the moment you load `/connections`. The scoring function ranks it first because it satisfies almost every signal at once: cross-party (ПГ на ГЕРБ-СДС × ПГ на ПБ), both endpoints currently seated in the 52nd parliament, every edge currently active. Toggling the *Cross-party only* chip in the filter rail collapses the 16 NS-52 pairs down to this single row.

The two endpoints:

- **[Георги Иванов Георгиев](/candidate/%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%20%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2)** — ПГ на ГЕРБ-СДС, served NS 48–52
- **[Рашид Мехмедов Узунов](/candidate/%D0%A0%D0%B0%D1%88%D0%B8%D0%B4%20%D0%9C%D0%B5%D1%85%D0%BC%D0%B5%D0%B4%D0%BE%D0%B2%20%D0%A3%D0%B7%D1%83%D0%BD%D0%BE%D0%B2)** — ПГ на ПБ (Periferia / Movement for Rights and Freedoms — New Beginning)

Узунов looks unconnected at first glance — his candidate page is sparse:

![Узунов candidate page](/articles/images/connections/11-orbital-pathfind-attempt.png)

But the precomputed top-pairs list surfaces the bridge between him and Георгиев directly. The chip chain, exactly as it appears on the page:

> **Георги Иванов Георгиев (ГЕРБ-СДС)**
> → company **КРУМКООП - 1** (UIC 108563610, OOD)
> → **Димитър Георгиев Димитров** (former MP)
> → company **АПИС МЕЛИФЕРА БЪЛГАРИЯ** (UIC 204909172, OOD)
> → **Рашид Мехмедов Узунов (ПБ)**

A two-hop bridge through one intermediary MP and two companies. Read it left-to-right: a sitting GERB-SDS MP and a sitting ПБ MP both share a partnership stake (`tr_owner` / `partner` role) in two cooperatives that are in turn co-owned by a former MP (Димитров). Whether that means anything is a journalistic question, not a graph one — but the graph is what surfaces the question. Each chip on the row links straight into the relevant entity page, and the *Source: TR* link at the end of the row jumps to the Commerce Registry filing for the first company on the chain so you can verify what is actually filed.

**The honest caveat** — and this is the kind of thing the *High confidence* chip on the filter rail was built for: every edge in this path is **medium confidence**. They are name matches against the Commerce Registry without an extra corroborating signal. The chip-chain row footer flags this directly with a *name-match link* warning, and toggling *High confidence* in the rail makes the row disappear entirely, because the bridge (Димитров) and the two cooperatives all drop out. That is not a bug — it is the difference between "almost certainly the same person" and "the name fits, look closer." A reader chasing this lead would want to verify the natural-person identities at the Commerce Registry portal before drawing any conclusion (the *Source: TR* link on the row goes there directly).

For a more conservative example, the candidate page for currently-sitting Възраждане MP **[Димо Георгиев Дренчев](/candidate/%D0%94%D0%B8%D0%BC%D0%BE%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D1%80%D0%B5%D0%BD%D1%87%D0%B5%D0%B2)** shows a single direct path:

> Димо Дренчев (ВЪЗРАЖДАНЕ) → **"Братя Градеви" ООД** → **Николай Дренчев** (former MP) — *2 steps · currently active · high confidence*

Two brothers, one company they jointly own, both having served as MPs. Every edge is high-confidence because the natural-person identities are not in dispute — the "Дренчев" name matches uniquely to a single parliament profile in each case. It's a clean illustration of how the same data surfaces both the noisy bridges and the unambiguous ones. The third block on every candidate page (described in §4) is the place to start either kind of investigation.

If you want to see the densest single MP profile in this regard, **[Найденов](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%9D%D0%B0%D0%B9%D0%B4%D0%B5%D0%BD%D0%BE%D0%B2)** (14 high-confidence ties — every one of them corroborated) is still the right page; he has no MP-to-MP paths because his Burgas textile network does not overlap with any other parliamentarian's, but the management-roles and declarations blocks above the empty-paths state are the longest in the dataset.

---

## 7. Refresh cadence

- **Declarations** — Court of Audit publishes the prior fiscal year's filings each May. Today's data set covers fiscal years 2022, 2023 and 2024; the 2025 filings should appear in May 2026.
- **Commerce Registry** — incremental refresh; the ranking and per-MP files carry their own `generatedAt` timestamps so you can see staleness directly.

When the next batch of declarations lands, the pipeline can be re-run via the project's `update-connections` script and the rankings + per-MP files regenerate from there.

## 8. Limitations and honest disclaimers

- **Foreign-registered companies are invisible.** A Cypriot SPV that an MP owns will not show up unless they declared it on Table 10 — and most don't.
- **Beneficial-ownership chains stop at one hop.** Where the public registries record a holding company as the owner of an operating company, the graph shows the relationship to the holding, not to the ultimate beneficiary.
- **Name matching is heuristic.** Surname-only ties are dropped before publication, not flagged. The medium-confidence tier is exactly where to put your skepticism.
- **Declarations are self-reported and lag by ~12 months.** A change in 2025 ownership will not appear until the May 2026 filing batch is processed.
- **The Commerce Registry is current as of the last incremental refresh** — the timestamp is in `generatedAt`. Filings made after that date are not yet visible.

## 9. What this enables

The intent of the feature is not to replace the Court of Audit or AKF (Anti-Corruption Commission). It is to make a record that is already public *legible* — to turn 605 separate XML files into a single graph that a citizen, a journalist, or a campaign-finance researcher can navigate in 30 seconds instead of 30 hours. Most of what is in here is uneventful. The point is that "uneventful" is now visible too, and that the few non-uneventful things stand out by contrast.

If you spot a wrong edge, a false-positive bridge, or a missing declaration — the graph file is a static JSON in the repository, and the pipeline that generates it is in `scripts/declarations/` and `scripts/smetna_palata/`. The whole thing is open source.
