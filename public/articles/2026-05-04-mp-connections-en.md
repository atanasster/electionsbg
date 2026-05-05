# Following the money trail — a tour of the new MP business connections feature

Bulgarian voters can already see how an MP votes, where they were elected, and how their party fared in any given polling station. What has been much harder to see — without manually downloading an XML declaration and cross-checking it against the Commerce Registry — is what *companies* sit behind those people, and how those companies link MPs to one another.

That is the gap this feature fills. As of this writing, the graph contains **5,499 nodes** (605 MPs, 2,009 companies, 2,885 other named persons) joined by **6,568 edges** drawn from two open Bulgarian datasets. This article walks through where to find the new pages, what they show, and ends with a worked example: a real cross-party ownership path between two currently sitting MPs.

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

## 5. The orbital page — `/connections`

This is the centerpiece. By default it shows every node and every edge in the graph at once, with the **most-connected** MPs ranked in the panel above the canvas:

![Orbital page default view](/articles/images/connections/06-orbital-default.png)

What the legend means at a glance:

- **MPs**: 605, blue dots
- **Companies**: 2,009, orange dots
- **Other persons**: 2,885, grey dots
- **Edges**: 6,568

A few seconds of staring at the default view is enough to notice that the picture is *not* one big blob. There are **567 connected components**; the largest holds 971 nodes, the second 534, the third 191. Most of the graph is small clusters — an MP and their handful of personal businesses — with a handful of dense neighbourhoods where shared officers create cross-MP links.

### Filters

Across the top of the canvas:

- **Current only** — drop transferred shares (Table 11 of the declaration) and ended Commerce Registry roles. Useful when you are asking "what is true today."
- **Hide transferred** — keep historical roles but drop the 51 declared share-transfers.
- **High confidence only** — restrict to the 4,988 corroborated edges. The 1,580 medium-confidence edges disappear, and so do any nodes that were only attached by a medium edge. Important: this often *fragments* paths that were visible in the default view (we will see one such case in the walkthrough below).
- **Largest component only** — isolate the densest subgraph:

![Largest component only](/articles/images/connections/08-orbital-largest-component.png)

  This view (122 companies, 304 persons, 1,568 edges) is where most of the cross-MP ownership patterns live. It is visually noisy, but every edge in here is part of a single connected web — meaning between any two nodes shown, *some* path through the data exists.

- **Cluster by party** — adds an angular force that pulls each MP node towards its party's slot on the canvas, so intra-party clusters reveal themselves as petals of one colour:

![Cluster by party](/articles/images/connections/07-orbital-cluster-by-party.png)

  When a company sits *between* two party clusters, that is a hint worth chasing.

### Companies index

The "All companies" link below the dashboard tile (or the "View all" link on the orbital page) opens a flat, searchable table of every company that any MP has touched — currently **703** distinct companies:

![Companies index](/articles/images/connections/09-all-companies.png)

Each row links to the company's dedicated page, which lists the active officers (from the Commerce Registry) and every MP stake declared against it:

![Company detail page](/articles/images/connections/10-company-detail.png)

The example above is **["ПиВи Квантум" ООД](/company/%D0%9F%D0%B8%D0%92%D0%B8-%D0%9A%D0%B2%D0%B0%D0%BD%D1%82%D1%83%D0%BC-%D0%9E%D0%9E%D0%94)** (UIC 206258486, seated in Велико Търново) — a company small enough that two MPs (Венеция Огнянова Нецова-Ангова in 48th and 49th NS, and Николай Георгиев Ангов in 47th NS) each declared a 33–100% stake against it across two fiscal years, including a transferred share in 2022.

### Path finder

Two MPs, one button. Pick "Find connection between two MPs," click two MP nodes, and the page runs a BFS over the whole edge set looking for the shortest path. If both MPs are in the same connected component it lights the path up in red. If they are not, it tells you so.

This is the killer feature for understanding the data, because it answers the question that is impossible to answer by reading any single declaration in isolation: *do these two people, who voted on opposite sides of the chamber, share a business neighbourhood?*

The orbital page is the right surface for an *exploratory* path query — pick any two MPs and check. For the targeted version of the same question — *who is this MP connected to?* — the candidate page already answers it without a single click: the offline pipeline runs that BFS up-front and bakes the top shortest paths into every MP's per-page file. See §4 for what that block looks like.

---

## 6. Worked example — a cross-party path between two sitting MPs

Picking the example was not a guess; it was a query. Of the four sitting-MP nodes that fall inside the largest connected component, two come from clearly opposing benches:

- **[Георги Иванов Георгиев](/candidate/%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%20%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2)** — ПГ на ГЕРБ-СДС, 6 high-confidence ties, served NS 48–52
- **[Рашид Мехмедов Узунов](/candidate/%D0%A0%D0%B0%D1%88%D0%B8%D0%B4%20%D0%9C%D0%B5%D1%85%D0%BC%D0%B5%D0%B4%D0%BE%D0%B2%20%D0%A3%D0%B7%D1%83%D0%BD%D0%BE%D0%B2)** — ПГ на ПБ (Periferia / Movement for Rights and Freedoms — New Beginning), 0 high-confidence ties, only 2 management roles

Узунов looks unconnected at first glance — his candidate page is sparse:

![Узунов candidate page](/articles/images/connections/11-orbital-pathfind-attempt.png)

The path-finder on the orbital page picks up the bridge between him and Георгиев, and so does the candidate page for the bridge node itself — the two halves of the chain show up as separate path rows on **[Димитър Георгиев Димитров](/candidate/%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%8A%D1%80%20%D0%93%D0%B5%D0%BE%D1%80%D0%B3%D0%B8%D0%B5%D0%B2%20%D0%94%D0%B8%D0%BC%D0%B8%D1%82%D1%80%D0%BE%D0%B2)**'s "Connections to other MPs" block (the example used in §4). Concatenating those two rows yields the full cross-party chain:

> **Георги Иванов Георгиев (ГЕРБ-СДС)**
> → company **КРУМКООП - 1** (UIC 108563610, OOD)
> → **Димитър Георгиев Димитров** (former MP, 39 total degree, 0 high-confidence)
> → company **АПИС МЕЛИФЕРА БЪЛГАРИЯ** (UIC 204909172, OOD)
> → **Рашид Мехмедов Узунов (ПБ)**

A two-hop bridge through one intermediary MP and two companies. Read it left-to-right: a sitting GERB-SDS MP and a sitting ПБ MP both share a partnership stake (`tr_owner` / `partner` role) in two cooperatives that are in turn co-owned by a former MP (Димитров). Whether that means anything is a journalistic question, not a graph one — but the graph is what surfaces the question.

**The honest caveat** — and this is the kind of thing the confidence filter was built for: every edge in this path is **medium confidence**. They are name matches against the Commerce Registry without an extra corroborating signal. The path footer on Димитров's candidate page flags this directly with a *name-match link* warning, and if you toggle "high confidence only" on the orbital page the path disappears entirely, because both Димитров (the bridge) and the two cooperatives drop off the canvas. That is not a bug — it is the difference between "almost certainly the same person" and "the name fits, look closer." A reader chasing this lead would want to verify the natural-person identities at the Commerce Registry portal before drawing any conclusion.

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
