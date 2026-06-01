---
keywords:
  - Bulgarian municipal councils
  - общински съвет
  - council resolutions
  - per-councillor named votes
  - cacbg councillor roster
  - municipal capital programmes
  - капиталова програма
  - поименен списък
  - Приложение №3 budget
  - local government transparency
  - Sofia municipal council
  - Sofia capital programme
  - Burgas council protokols
  - Veliko Tarnovo councillor votes
  - Pernik per-councillor data
  - Article 53 transfers
  - Чл.53 ЗДБРБ
  - municipal data Bulgaria
  - electionsbg.com local government
  - municipal local taxes
  - property tax for individuals
  - waste collection fee Bulgaria
  - tourist tax bylaws
  - dog tax Bulgaria
  - НОРМД tax bylaw
  - IME 265obshtini
  - obshtini.bg JSON API
---

# How Bulgarian municipal council voting and budget data are integrated into electionsbg.com

![The "Municipal council" tile on a My-Area dashboard — Veliko Tarnovo. Each decision carries its adopted/rejected outcome, the за–против–въздържал tally, and — where the protocol publishes it — every councillor's individual vote as a colour-ringed avatar (ring colour = how they voted, fill = party).](/articles/images/local_government/01-council-tile.png)

Everything described below surfaces in one place: **My Area** — the per-place dashboard on electionsbg.com that every Bulgarian municipality and settlement gets. It pulls together who represents you, how they vote, and where your municipality's money comes from and where it goes. Two of its tiles are the subject of this article: the **"Municipal council"** tile shown above — every council decision with its outcome, the за–против–въздържал tally, and, where the protocol publishes it, each councillor's individual vote — and the **"Capital programme"** tile further down, which itemises every investment project for the year with its value, funding source, and the village it lands in.

The data behind both tiles has to be assembled municipality by municipality, because none of it exists as a national dataset. The rest of this article is an audit of how far we've got — and an honest map of what's still missing, and why.

Bulgaria has 265 municipalities. Each operates a municipal council (**общински съвет**) that convenes monthly, makes hundreds of decisions annually, and votes on a multi-million-euro annual budget — every municipality publishes some version of both on its own website. There is no central register of these votes or budgets: РМС 436/2017 only mandates the narrow чл.45 ЗМСМА "returned decisions" feed on data.egov.bg, and a sampling we did across 50 municipalities found that fewer than 4 in 10 publish anything in that category, more than 90% of which is just hyperlinks pointing back to the municipality's own content management system (CMS).

To address this, we built a custom data ingestion pipeline. Currently, our system covers **16 municipalities for council voting records** and **26 municipalities for capital programmes** — every oblast capital except eight, plus secondary cities. The two coverages overlap in **14 municipalities** where we have BOTH a council ingest AND a budget ingest, so our platform can address politically significant questions, such as: "the council voted to approve €3M for the school renovation in village X — who voted for, who voted against, and did the project actually land in the capital programme?"

Across the 16 integrated councils we've extracted **3,515 resolutions** with their adopted/rejected status and aggregate vote tallies, and for the five councils where the protokol publishes the individual councillor voting records we've also matched **18,300 individual vote rows** to the National Audit Office registry (cacbg.bg). Across the 26 integrated capital programmes we've itemised roughly **6,800 individual investment projects** worth **€957 million** (each municipality's most recent published budget year, 2023–2025).

The tables below list every municipality currently in the system. The "Council website" column links to the council's own page — if your municipality is not yet covered, the council site is also where to write to your representatives directly.

## Wired councils

| Code | Municipality | Tier | Decisions | Per-councillor rows | Councillors in roster | Coverage period | Council website |
|------|---------|------|----------:|--------------------:|----------------------:|-----------------|-----------------|
| SOF | Столична община | A | 132 | 2,964 | — | Apr–May 2026 | https://council.sofia.bg/ |
| BGS01 | Община Бургас | A | 319 | 3,966 | 46 | Jan 2025 – Mar 2026 | https://burgascouncil.org/ |
| VTR01 | Община Велико Търново | A | 413 | 5,139 | 35 | Feb 2025 – May 2026 | https://savet.veliko-tarnovo.bg/ |
| SZR12 | Община Казанлък | A | 333 | 3,227 | 35 | Mar 2020 – Jun 2025 | https://obs.kazanlak.bg/ |
| PER32 | Община Перник | A | 464 | 3,004 | 34 | Jan 2025 – Apr 2026 | https://www.obs-pernik.bg/ |
| GAB05 | Община Габрово | A | 244 | — | 30 | Feb–Sep 2024 | https://gabrovo.bg/ |
| SZR01 | Община Стара Загора | A | 67 | — | 51 | Apr–May 2026 | https://www.starazagora.bg/ |
| RSE01 | Община Русе | A | 58 | — | 47 | Mar–Apr 2026 | https://obs.ruse-bg.eu/ |
| PVN01 | Община Плевен | A | 76 | — | 36 | Mar–Apr 2026 | https://obs.pleven.bg/ |
| SLV01 | Община Сливен | B | 109 | — | 40 | Feb–Apr 2026 | https://obs.sliven.bg/ |
| PDV01 | Община Пловдив | B | 30 | — | 50 | Apr–May 2026 | https://plovdiv.bg/obs/ |
| VAR01 | Община Варна | B | 45 | — | 47 | Dec 2025 – Apr 2026 | https://varnacouncil.bg/ |
| HKV34 | Община Хасково | B | 387 | — | 39 | Jan 2022 | https://www.haskovo.bg/ |
| DOB28 | Община град Добрич | B | 50 | — | 41 | Nov–Dec 2023 | https://www.dobrich.bg/ |
| HKV09 | Община Димитровград | B | 534 | — | 32 | Jan 2024 – Apr 2026 | https://www.dimitrovgrad.bg/ |
| RAZ26 | Община Разград | B | 254 | — | 31 | Aug 2025 – May 2026 | https://www.razgrad.bg/ |

**Tier A** means we extract everything the protocol carries: the decision number, the chairperson's official declaration of adoption or rejection, the aggregate vote (за / против / въздържал) and — where the municipality publishes a individual councillor voting records — every councillor's individual vote, matched to their cacbg profile. **Tier B** means the same except for the individual councillor voting records, because the published protocol records only the chair's announced totals.

The "Decisions" column is what's currently visible in our index. The "Coverage period" shows the freshest and oldest dates we hold — for several councils sourced via the Wayback Machine CDX API (Габрово, Хасково, Добрич), the public site doesn't expose older protocols directly, so the dataset is relying on snapshots captured by the Internet Archive.

## Capital programmes

Council votes tell you _what_ was decided. The capital programme — published every year as Приложение №3 / №4 / №7 to the budget law and re-amended after each council vote that moves money between line items — tells you _how much_ and _where_. We track 26 municipalities here, with the deepest history (2022→2025, four full fiscal years) for the eight municipalities that have published the longest.

Each programme is a list of named investment projects (a school renovation, a road, a sewer-line extension) with a monetary value, a funding source (own funds / state subsidy / EU / carry-over), and — in the best-published programmes — the village or mayoral district (kmetstvo) where the project is located. The platform reads this to surface a per-municipality "Капиталова програма" tile with funding-source breakdown, top projects, and the per-settlement rollup for the municipalities that tag projects to specific villages.

![The "Capital programme" tile for Veliko Tarnovo — €47.1M across 382 projects for 2025, broken down by settlement and listed largest-first, parsed straight from Annex 15 of the municipal budget.](/articles/images/local_government/02-capital-programme.png)

| Slug | Regional (Oblast) Center? | Years | 2025 total (€) | Projects (2025) | Per-village tagging | Source format |
|------|:--:|------|--------:|--------:|--------:|---------------|
| sofia | yes | 2022–2025 | 327.6M | 352 | 0% (paragraph-only) | XLSX (clean) |
| varna | yes | 2022–2025 | 52.3M | 587 | 0% (rasterised scan) | PDF + OCR |
| burgas | yes | 2022–2025 | 86.7M | 104 | 13% (city-quarters from Wikipedia) | XLSX (workbook with funding-source cols) |
| ruse | yes | 2022–2025 | 26.2M | 1,052 | 7% (multi-sheet) | XLSX (per-kmetstvo sheets — highest data quality) |
| stara_zagora | yes | 2022–2025 | 13.7M | 342 | 4% (51 villages tagged "с.") | PDF |
| pleven | yes | 2022–2025 | 9.5M | 92 | 40% | PDF + OCR (fragmented layout) |
| asenovgrad | no (Plovdiv obl.) | 2022–2025 | 22.5M | 229 | 60% | PDF + OCR |
| yambol | yes | 2022–2025 | 7.0M | 184 | 0% (single-settlement municipality) | RAR/ZIP + PDF + OCR |
| vidin | yes | 2022–2023 only | 17.0M (2023) | 176 | 90% | DOC inside RAR (textutil) |
| sliven | yes | 2025 | 19.7M | 256 | 60% | PDF + OCR |
| dobrich | yes | 2024–2025 | 23.2M | 82 | 0% (single-settlement) | HTML table (scraped) |
| haskovo | yes | 2024 | 21.3M | 268 | 31% | PDF + OCR (multi-line project descriptions) |
| pernik | yes | 2024–2026 | 14.0M (2025) | 159 | 62% | XLS (BGN/EUR currency switch handled) |
| veliko_tarnovo | yes | 2024–2025 | 47.1M | 382 | 70% | XLSX (89 settlements) |
| kardzhali | yes | 2024–2025 | 16.7M | 104 | 70% | PDF + OCR (било/става amendment columns) |
| plovdiv | yes | 2025 | 71.4M | 567 | 0% (paragraph-only) | XLSX |
| gabrovo | yes | 2025 | 8.1M | 299 | 21% | PDF + OCR (Google-indexed URL) |
| shumen | yes | 2025 | 14.9M | 324 | 25% | PDF + OCR (harvested via Playwright) |
| kyustendil | yes | 2025 | 11.0M | 246 | 43% | PDF + OCR (council session annex) |
| montana | yes | 2025 | 29.1M | 9 | 78% | PDF + OCR (consolidated page 5 only) |
| lovech | yes | 2025 | 39.2M | 142 | 33% | PDF + OCR |
| karlovo | no (Plovdiv obl.) | 2025 | 15.0M | 136 | 81% | XLSX (requires an anti-hotlink Referer header) |
| kazanlak | no (Stara Zagora obl.) | 2025 | 7.9M | 201 | 35% | PDF + OCR (Nuxt _payload.json discovery) |
| samokov | no (Sofia obl.) | 2025 | 29.7M | 231 | 74% | PDF + OCR |
| velingrad | no (Pazardzhik obl.) | 2025 | 19.0M | 159 | 74% | PDF + OCR |
| dupnitsa | no (Kyustendil obl.) | 2025 | 6.7M | 137 | 42% | PDF + OCR |

**26 municipalities** with capital programmes ingested, covering **20 of Bulgaria's 28 oblast capitals plus 6 secondary cities**. Combined value (each municipality's most recent published year): **€957M** itemised across roughly 6,800 individual projects.

The extent of per-village tagging varies significantly, depending entirely on the municipality's documentation practices. The highest-quality publishers (Ruse, Vidin, Veliko Tarnovo, Karlovo, Samokov, Velingrad) tag every project to a specific settlement via the workbook structure or a "с. <name>" / "гр. <name>" prefix. The lowest-quality publishers (Sofia, Plovdiv, Varna, Dobrich, Yambol) emit a paragraph-level breakdown only — you can see €5M went to "Основен ремонт на дълготрайни материални активи" but not which village it's in. Several intermediate publishers tag part of the list (the school renovations get a village; the centrally-purchased equipment doesn't).

### Capital programmes — what's missing

Eight oblast capitals don't have a capital programme ingested. The reasons cluster:

| Oblast capital | Status | Why |
|----------------|--------|------|
| Благоевград | Not published | The municipality doesn't expose Приложение №3 / №4 to the budget on its website at all. Same publication gap as the council protokols — see below. |
| Враца | Not published | Council site dormant; no recent budget docket discoverable. |
| Пазарджик | Not published | Budget portal lists annual budget HTMLs, but no separate capital-programme annex with a per-project list. Велинград (in the oblast) IS covered. |
| Разград | Not published | Same gap as the council protokols — the municipality publishes amendments as appendices to individual decisions but no consolidated annual programme. |
| Силистра | Not published | No capital-programme PDF / XLSX discoverable; the municipality publishes only the top-level summary. |
| Смолян | Cloudflare-blocked | Same Cloudflare "Just a moment…" challenge as the council site. Unblocking that unlocks both surfaces at once. |
| Търговище | TSPD bot guard | Same WPS-Portal / TSPD pattern as the council site. |
| София (oblast) | n/a | Sofia city's capital programme (under SFO_CITY) covers the same geographic footprint administratively — there's no separate Sofia-oblast programme. |

For the six "Not published" cases the gap is publication policy, not parsing. The municipality publishes the consolidated budget (often as a single PDF), but not the itemised capital-programme list that gives every project a name, value, and funding source. The solution here is straightforward: ask the council to publish the same Приложение №3 / №4 their bigger peers (Sofia, Plovdiv, Burgas, Varna) already do.

Vidin is in a special category: the 2025 and 2026 forward plans aren't published as a discrete document — only the year-end execution report (отчет за капиталовите разходи) is available, which is what powers our 2022 and 2023 entries. The municipality has moved to a "report after we spend" reporting cadence that sacrifices forward-looking transparency.

### Complementary budget data domains

Two other municipal-finance surfaces sit alongside the capital programmes:

- **Article 53 transfers** — every year the State Budget Law allocates subsidies to each municipality (Bulgarian: Чл.53 на ЗДБРБ — обща изравнителна, общи целеви, ВКП от РУП и т.н.). We parse this from the law's HTML annex into `data/budget/municipal_transfers/`. Coverage is **all 265 municipalities** for fiscal years 2020, 2022, 2023, 2024, and 2025 — the only universal-coverage local-finance surface in the system. 2025 combined: **€4.53 billion** in state transfers to local government.
- **Actual cash execution** — the municipality's monthly "Касов отчет" feed that shows what got spent vs what was planned. This is the surface that would close the loop on "did the council actually deliver Project X for €Y or did the money sit unspent?" Currently dormant: only **Русе** (2016–2025) and **Николаево** (2019–2024) publish it in a parseable format. Most municipalities post the monthly cash report as a scanned PDF that gets scanned each month with a varying layout, so there's no stable parsing target without per-municipality OCR work.

## Council votes — what's missing

### Coverage by municipality count vs population

- **16 of 265 общини** (6%) — a small fraction by count.
- **~ 80% of Bulgaria's population** — a substantial portion of the population, because we've prioritised oblast capitals first.

The shortlist of municipalities NOT yet wired but actively publishing protocols:

| Code | Municipality | Status | Blocker |
|------|---------|--------|---------|
| BLG03 | Благоевград | Deferred | Legacy URL is dead; the municipality moved to a SaaS that requires authenticated access. New publication policy needed. |
| SML31 | Смолян | Deferred | Cloudflare "Just a moment…" challenge blocks even headless browsers. Needs CF-clearance cookie tooling (already used by our local-elections skill). |
| VID09 | Видин | Deferred | The WPS-Portal site loads the document list via XHR, protected by a TSPD bot guard. Captured the data feed once with Playwright, retries hit `ERR_EMPTY_RESPONSE`. |
| TGV35 | Търговище | Deferred | Same WPS-Portal pattern as Видин — document list is in an Atom XML feed gated by TSPD. |
| MON29 | Монтана | Site migrated | Legacy protokol URLs returned 404 after the site rebuild; new publication path not yet discovered. |
| LOV18 | Ловеч | Stale | Latest decision on the council's `os.lovech.bg` site is from September 2019. Effectively dormant. |
| SHU30 | Шумен | Format problem | The municipality publishes покана / agenda PDFs but no protokol PDFs; the agenda PDFs are PDFium-produced with malformed flate streams that pdftotext can't read. |
| VTR06 | Горна Оряховица | Publication-policy gap | The council publishes agendas but not protokols. Files live on a separate Nextcloud with token URLs we can't enumerate. |

### Per-decision limitations

- **No decision title** for two remaining Tier-B sources (Добрич, Разград). Title extraction via "ОТНОСНО:" / "ПО ХХ ТОЧКА" agenda headers is wired for Димитровград; **Разград** is the next candidate (its докладна записка carries a clean structured "ОТНОСНО: <subject>" line), but its titles are **not yet populated** — every Разград resolution still surfaces by id. Добрич is harder: its protocol is a verbatim stenographic transcript where "относно" appears in councillors' spoken discussion ("относно цените…"), not as a structured field, so the title has to come from a different anchor (the докладна subject) — a separate parser task, not a quick port. Where no title is recovered, the resolution surfaces by id.
- **No body text** indexed for conflict-of-interest matching. We have the decision metadata + vote, but the body of each resolution isn't stored — meaning we can't yet flag "councillor X voted on a contract awarded to company Y where they're a director". The processing pipeline is implemented (see `data/officials/derived/councillor_conflicts.json`), but with 0 matches today because no municipality's resolution body is indexed.
- **Stale Wayback windows** for Габрово (Feb–Sep 2024), Хасково (Jan 2022 only), Добрич (Nov–Dec 2023). The Internet Archive crawls these sites only occasionally; the dataset will get fresher as Wayback re-crawls.

### What the Tier-B coverage misses

Of the 16 integrated councils, **7 are Tier B** — we have the aggregate tally and the result, but not the individual councillor voting records. The reason varies:

- **Препис-извлечение format** (Пловдив, Варна, Сливен): the municipality publishes a decision extract that strips the deliberation portion of the minutes. Tally + adopted/rejected only.
- **Chairperson's verbal summary** (Хасково, Димитровград, Добрич, Разград): the protokol records the chair's voiced totals ("Председателят обяви, че решението се приема с 22 за, 0 против, 1 въздържал се"), not the individual readout. Even the full minutes don't carry the per-councillor data.
- **Show-of-hands decision making**: some councils take their decisions by show of hands and only resort to a named vote on the rare contested motion. The protocol is technically complete.

## How to move forward

### Short term (resolving technical barriers)

1. **TSPD / Cloudflare bypass** — Видин, Търговище, Смолян, and four others sit behind enterprise bot guards. Our local-elections skill already handles this for ЦИК via a Playwright session with a persistent `cf_clearance` cookie; applying this same pattern to the council data ingestion would unlock at least 3 more oblast capitals (Видин, Търговище, Смолян + likely Кърджали, Кюстендил, Враца).
2. **Body indexing for Tier A councils** — store each resolution's body text under `data/council/bodies/<obshtina>/<id>.json`. This enables conflict-of-interest detection (councillor ↔ company tie) and full-text search over the corpus.
3. **Title extraction for the remaining Tier-B sources** — the two cases aren't equally easy (verified against live sessions). **Разград** is the more tractable: its protocol carries clean structured "ОТНОСНО: …" blocks (e.g. "Наредба за изменение и допълнение на Наредба № 30…"), so porting the Димитровград agenda-header logic is direct — but its titles are **not yet populated** in the current data (every Разград resolution still surfaces by id, pending a working ingest). **Добрич** is harder: its verbatim transcript scatters conversational "относно …" that isn't a title field, so the title must come from a different anchor (the докладна subject) — a separate parser task, not a 30-minute port. Either way, once wired each decision gets a human-readable subject in the My-Area "Последна активност" feed.

### Medium term (data publication itself)

Most of what's missing isn't a parsing problem; it's a publication-policy problem. Two municipalities (Благоевград, Горна Оряховица) publish their session agendas but never make the protokols public. Lovech's site stopped updating in 2019. Montana migrated its CMS without preserving permanent URLs. These aren't technical gaps — they're transparency gaps.

This is where readers can help directly. If your municipality is in the table above, you can verify our data against the source. If it's NOT in the table, this is where to ask your council representatives to publish (or to start publishing again):

| Code | Municipality | Council website / contact |
|------|---------|--------------------------|
| BLG03 | Благоевград | https://blagoevgrad.bg/header-menu/resheniia-na-obshtinski-suvet |
| SML31 | Смолян | https://www.smolyan.bg/bg/menu/sl/10 |
| VID09 | Видин | https://vidin.bg/wps/portal/vidin-municipality/obshtinski-savet/ |
| TGV35 | Търговище | https://targovishte.bg/wps/portal/municipality-targovishte/municipal-council/ |
| MON29 | Монтана | https://www.montana.bg/ |
| LOV18 | Ловеч | https://os.lovech.bg/ |
| SHU30 | Шумен | https://obs.shumen.bg/ |
| VTR06 | Горна Оряховица | https://savet.gornaoryahovitsa.bg/ |

A concrete ask works well: "Publish the full protokol of session N as a downloadable PDF or DOCX with the per-councillor vote readout, the same way Велико Търново / Бургас / Перник already do." Every council that follows that pattern becomes ingestable in days.

### Long term (the rest of the 256)

The big-population councils above account for the bulk of the population coverage; the next 50 targets would be secondary administrative centers (Велинград, Карлово, Дупница, Самоков, Кърджали, Видин — once unblocked — and similar). After that the count climbs into small rural municipalities where the council meets quarterly or less and where the marginal civic utility of per-councillor coverage is lower. Our staged plan is to keep doubling the population-weighted coverage every quarter, rather than chasing the muni-count number for its own sake.

## Where the two data domains intersect: the 14-municipality overlap

The most useful single feature of the platform isn't either surface in isolation — it's the **overlap**. Fourteen municipalities have BOTH a council ingest and a capital-programme ingest: Sofia, Burgas, Veliko Tarnovo, Kazanlak, Pernik, Gabrovo, Stara Zagora, Ruse, Pleven, Sliven, Plovdiv, Varna, Haskovo and Dobrich. In those fourteen the platform can answer the question that matters most for a citizen looking at a council vote: _did the project this resolution authorises actually land in the capital programme — and at what amount?_

### Concrete example — Велико Търново, 5 March 2026

On 5 March 2026, Veliko Tarnovo's council took up agenda item Решение №914: "Индикативен разчет на капиталови разходи за 2026 г." — the formal indicative reckoning of the capital expenditure for the 2026 fiscal year. This is the resolution that approves the year's capital programme as a block.

The aggregate vote was **30 за – 2 против – 4 въздържал → adopted**. With our per-councillor data, we can name everyone who didn't vote yes:

- **Against**: Александра Тодорова Тодорова, Венцислава Маринова Йорданова
- **Abstain**: Дончо Иванов Бораджиев, Калоян Милков Янков, Лили Матева, Стефан Николаев Войчев

That's six councillors who, in March 2026, didn't endorse the 2026 capital programme as written. The platform surfaces this on each of their `/officials/<slug>` profile pages — a "voted against the 2026 capital programme" line item with the vote-row, the link to the decision, and the date.

The other half of the story is what's IN the programme they were voting on. The 2025 capital programme (the most recent we have fully itemised) lists **382 projects worth €47.1M total**. The top eight by amount:

| Amount (€) | Settlement | Project |
|------:|---|---|
| 5,266K | с. Беляковец | Проектиране на водопровод и изграждане на ВиК мрежа на с. Беляковец — фаза 1 |
| 4,602K | гр. Велико Търново | Проектиране и основен ремонт с мерки за енергийна ефективност на ДКС „Васил Левски" |
| 3,426K | гр. Велико Търново | Реконструкция на ул. „Никола Габровски" (ОК 233 – ОК 72) |
| 2,562K | гр. Велико Търново | Реформиране на Дома за стари хора „Венета Ботева" |
| 2,546K | гр. Велико Търново | Реконструкция на ул. „Мармарлийска" |
| 2,213K | с. Водолей | Общински път VTR1012 — с. Водолей – с. Дичин |
| 1,778K | гр. Велико Търново | Модернизация на Профилирана езикова гимназия „Проф. д-р Асен Златаров" |
| 1,684K | гр. Велико Търново | Изграждане на обслужващи улици: 8905-8907; 8909-8908; 8906-8911 |

The per-settlement rollup is the second half of the data integration: of the 382 projects, **203 are tagged to гр. Велико Търново**, **18 to гр. Дебелец**, **15 to гр. Килифарево**, plus 6 villages with at least 2 projects each (Балван, Ресен, Самоводене, Ветринци, Ново село, Водолей). A citizen in с. Беляковец can now see: my village got the largest single line item in the 2025 capital programme; here are the six councillors who didn't endorse the 2026 programme; here's how each of those six voted on the other 25 capital-related decisions of the mandate.

This is the kind of cross-domain insight that no Bulgarian municipal site or central register exposes today — and it's the core analytical value proposition of the platform.

### Consistent pattern across every municipality

The pattern repeats across all fourteen overlap municipalities:

- **Sofia** — 33 capital-related decisions in the council ingest (out of 132 with titles), against a capital programme of €327.6M / 352 projects.
- **Burgas** — 54 capital-related decisions, against €86.7M / 104 projects.
- **Stara Zagora**, **Ruse**, **Pleven**, **Varna**, **Plovdiv** — same shape, smaller absolute numbers, all under €100M annual programmes.

Where the council still publishes only aggregate tallies (Tier B — Plovdiv, Varna, Sliven, Haskovo, Dobrich, Dimitrovgrad, Razgrad), the platform shows the for–against–abstain numbers without councillor names, but the link from the decision back to the projects in the capital programme is intact.

## Article 53 — the universal counterpart

The capital programmes are about how each municipality _spends_ its money. The third major surface — the only one with universal coverage — is about how each municipality _gets_ its money. Article 53 of the State Budget Law (Чл.53 ЗДБРБ) carries the annual envelope of state transfers to every one of Bulgaria's 265 municipalities, broken down into five transfer categories. We parse this from the law's HTML annex into `data/budget/municipal_transfers/`.

| Fiscal year | Grand total (€) | Munis covered |
|:--:|--------:|:--:|
| 2020 | 2.15 B | 265 |
| 2022 | 2.87 B | 265 |
| 2023 | 3.56 B | 265 |
| 2024 | 3.99 B | 265 |
| 2025 | 4.53 B | 265 |

The 2025 €4.53 billion breaks down by category like this:

| Category | Amount (€) | What it is |
|---|------:|---|
| **Delegated activities** (delegated) | 4.04 B (89%) | Pre-set per-pupil / per-pensioner / per-protected-person rates the state subsidises directly. Mostly schools and social services. The municipality has no discretion over how this is spent. |
| **Equalisation transfer** (equalization) | 235 M (5%) | The redistributive transfer that balances capacity-to-revenue disparities between rich and poor municipalities. Free-use money. |
| **Capital transfer** (capital) | 232 M (5%) | The state's contribution to the municipality's own capital programme. Pairs with the capital-programmes surface above. |
| **Winter maintenance** (winter) | 25 M (0.6%) | Targeted transfer for the road-clearing / heating season; only the relevant municipalities get it. |
| **Other targeted** (otherTargeted) | 36 M (0.8%) | Catch-all category for specific targeted programmes. |

The top recipients by total transfer in 2025:

| Code | Municipality | 2025 transfer (€) | Of which delegated | Of which capital |
|---|---|------:|------:|------:|
| SOF | Столична община | 652.0M | 638.6M | 12.9M |
| PDV22 | Пловдив | 206.8M | 200.2M | 3.0M |
| VAR06 | Варна | 183.4M | 180.1M | 3.2M |
| BGS04 | Бургас | 136.8M | 132.7M | 2.2M |
| SZR31 | Стара Загора | 95.1M | 87.6M | 3.2M |
| RSE27 | Русе | 84.8M | 78.9M | 1.9M |
| SLV20 | Сливен | 77.4M | 70.1M | 3.1M |
| PVN24 | Плевен | 69.4M | 65.1M | 2.0M |
| PAZ19 | Пазарджик | 63.9M | 57.9M | 1.9M |
| VTR04 | Велико Търново | 62.9M | 59.0M | 2.3M |

Sofia gets roughly **€652M** in state transfers; the five smallest municipalities (Мирково, Грамада, Антон, Макреш, Чавдар) each get under **€2M**. The story isn't the absolute amounts — it's the structure: 89% of every municipality's envelope flows to delegated activities the council has no real discretion over, leaving the equalisation transfer + the capital transfer as the approximate scope of the council's discretionary fiscal decisions for the year. For Велико Търново in 2025 that's **€2.27M capital + €1.36M equalisation = €3.6M of "council-discretionary" state money**, against the €47.1M total capital programme — so roughly 92% of the capital programme comes from somewhere _other_ than the state's transfer (own revenue, EU programmes, debt).

Universal coverage means this is the one place in the system where you can compare every municipality to every other on the same axis. The five-fiscal-year time series also gives a clean view of how the envelope has changed across cabinet mandates — the **more than doubling between 2020 and 2025 (+111% growth, or 2.1×)** is one of the most-quoted figures from the platform, and the structural split lets you see how much of that came from inflation-driven delegated raises versus genuine fiscal expansion.

## Local taxes and fees

Capital programmes and Article 53 transfers describe money flowing _from_ the state _to_ the municipality. Local taxes and fees describe the reverse flow — what the resident pays out-of-pocket to their own municipality. There are two layers of coverage here, together describing nine separate per-resident numbers.

**Tier A — IME (Institute for Market Economics).** Annual Freedom of Information (FOI) collected survey of the five most-cited local taxes, published on [265obshtini.bg](https://www.265obshtini.bg/) — the only universal-coverage surface in the category:

- Property tax (legal entities), ‰ of tax-assessment value
- Property-transfer tax, %
- Vehicle tax (74–110 kW band), €/kW
- Patent tax — retail ≤ 100 m², €
- Patent tax — taxi, €

We re-fetch all five CSVs from `https://www.265obshtini.bg/downloadCSV/{ipiId}`, normalise the municipality name to a canonical obshtina code via `scripts/local_taxes/lib/match_obshtina.ts`, and compute a per-indicator national rank ascending by rate (#1 = lowest = cheapest for the taxpayer). **265 of 265 municipalities are successfully matched on the first pass** for the 2021–2025 window — five consecutive fiscal years, no missing rows. IME paused the taxi patent indicator after 2023 (monitoring shelved following the 2024 amendments to ЗМДТ Art. 61з), so for that row we surface 2023 as the latest available year with a dedicated label in the tile.

**Tier B — municipality-specific bylaws.** Four additional fields that IME doesn't track because they depend on each municipal council's annual vote. We parse them directly from **both bylaws** of each municipality — the bylaw determining the size of local taxes (НОРМД — *Наредба за определяне размера на местните данъци*) and the bylaw on local fees and service prices (НОАМТЦУ — *Наредба за определяне и администриране на местните такси и цени на услуги*):

- **Property tax for individuals** — the actual rate citizens pay. IME formally tracks the legal-entities row; for most municipalities both rates coincide under a common ЗМДТ Art. 22 clause, but not all (Petrich, for instance, has a separate 2.3 ‰ rate for non-residential of enterprises and 3 ‰ for all citizen-owned property).
- **Residential garbage fee** (ТБО) — the basis flag (promille of tax valuation / per user / floor area / waste volume) plus the rate when the bylaw publishes one. Most large municipalities defer the actual rate to an annual council resolution rather than codifying it in the bylaw — in that case we store the basis with an honest "set annually by council resolution" note.
- **Tourist tax** — per-night rate by star category, lifted from the "1 star / 2 stars / …" tariff inside the tax bylaw. When the bylaw publishes dual BGN/EUR values we prefer the EUR side; converted-from-BGN values carry a small "(conv. from BGN)" qualifier in the tile.
- **Dog tax** — annual fee. Lives in the fees bylaw (НОАМТЦУ) as a *такса* under ЗМДТ Art. 175(2) (veterinary-medicine authority), not in the tax bylaw — so extracting this data requires retrieving both documents.

Tier B currently covers **10 municipalities**: Sofia, Plovdiv, Varna, Burgas, Stara Zagora, Razgrad, Samokov, Maglizh, Balchik and Petrich. The data sources are heterogeneous:

| Code | Municipality | Fees bylaw (НОАМТЦУ) | Tax bylaw (НОРМД) | Fetch method |
|------|---------|------------------|----------------|----------|
| SOF00 | Sofia | iisda.government.bg (PDF) | sofia.obshtini.bg/doc/385434 | pdftotext + obshtini.bg JSON API |
| PDV22 | Plovdiv | plovdiv.obshtini.bg/doc/388893 | plovdiv.obshtini.bg/doc/388894 | obshtini.bg JSON API |
| VAR06 | Varna | varna.bg (PDF) | varna.obshtini.bg/doc/345772 | pdftotext + obshtini.bg JSON API |
| BGS04 | Burgas | burgascouncil.org (DOCX) | burgascouncil.org legacy .doc | DOCX + macOS textutil |
| RAZ26 | Razgrad | razgrad.obshtini.bg/doc/6505930 | razgrad.obshtini.bg/doc/6505934 | obshtini.bg JSON API |
| SFO39 | Samokov | samokov.obshtini.bg/doc/5993006 | samokov.obshtini.bg/doc/5992724 | obshtini.bg JSON API |
| SZR22 | Maglizh | maglizh.obshtini.bg/doc/5853991 | maglizh.obshtini.bg/doc/5822281 | obshtini.bg JSON API |
| DOB03 | Balchik | balchik.obshtini.bg/doc/6563059 | balchik.obshtini.bg/doc/6563060 | obshtini.bg JSON API |
| BLG33 | Petrich | petrich.obshtini.bg/doc/4416578 | petrich.obshtini.bg/doc/3103531 | obshtini.bg JSON API |
| SZR31 | Stara Zagora | starazagora.obshtini.bg/doc/564999 | starazagora.obshtini.bg/doc/338011 | obshtini.bg JSON API |

Current rates from the extracted bylaws (latest published bylaw per municipality, full 10/10 coverage on all four slots):

| Municipality | Property (individuals) | ТБО basis | Tourist | Dog |
|---|---:|---|---:|---:|
| Sofia | 1.875 ‰ | promille | €0.51/night | €12.27/yr |
| Plovdiv | 1.8 ‰ | waste volume | €0.20/night | €15.34/yr |
| Varna | 2.0 ‰ | promille (1.5 ‰) | €0.26/night | €12.27/yr |
| Burgas | 1.75 ‰ | promille (1.3 ‰) | €0.26/night | €15.34/yr |
| Razgrad | 3.0 ‰ | promille | €0.31/night | €10.23/yr |
| Samokov | 2.5 ‰ | promille | €0.45/night | €5.11/yr |
| Maglizh | 3.5 ‰ | waste volume | €0.10/night | €10.23/yr |
| Balchik | 2.5 ‰ | waste volume | €0.31/night | €5.11/yr |
| Petrich | 3.0 ‰ | waste volume | €0.26/night | €10.23/yr |
| Stara Zagora | 1.7 ‰ | waste volume | €0.30/night | €12.27/yr |

Euro values are computed at the fixed conversion rate 1 EUR = 1.95583 BGN adopted for the 2026-01-01 transition. Where the bylaw still publishes only lev, we convert and tag the unit "(conv. from BGN)" — so the user can see the math was ours, not the municipality's.

### Local taxes — what's missing

Tier A covers all 265 municipalities; Tier B only ten. The reasons cluster:

- **The obshtini.bg platform** (hosted by Apis for client municipalities) carries many municipalities. These are parseable via the same JSON API we already use for the ones listed above — each new municipality is a ~10-line config: canonical obshtina code, subdomain slug, and two `uniqueId`s for the fees and tax bylaws. The `scripts/local_taxes/probe_obshtini_all.ts` discovery script transliterates municipality names by the official BG-to-ASCII rules and probes which subdomains respond. The catch is the slug: auto-discovery only finds municipalities whose subdomain matches their transliterated name — probing all 263 municipalities surfaced about ten of them. The most recent addition is **Stara Zagora**, which the earlier version missed because it tried only the underscore form (`stara_zagora`) instead of the concatenated `starazagora`; the probe now tests all three variants (concatenated / underscore / hyphenated). The remaining platform tenants use slugs that don't match their name and require manual discovery.
- **The remaining ~100 municipalities** publish bylaws on their own websites in mixed formats — PDF, DOCX, legacy .doc (Word 2003), Drupal modules, Joomla attachments. Each requires individual investigation. Burgas's tax bylaw is a legacy .doc converted via macOS `textutil` (Linux operators swap in `antiword`); extracting the property-tax rate also requires a manual pin, because Article 18's text uses an anaphoric reference ("The tax is determined on the tax valuation…") rather than the canonical "property tax on real estate" anchor the generic extractor requires. Scaling to those 100 municipalities takes a dedicated parser per bylaw.
- **Varna's tourist tax tariff** lives in a separate Приложение № 2 not returned by the obshtini.bg JSON. The table above carries Varna's "2 stars" tier (`€0.26/night` — the lowest the bylaw declares inline), but the full schedule for registered "class B" accommodations is missing.

A notable positive side effect of the open obshtini.bg platform is that municipalities on it can revise their bylaws mid-year (as they often do after ЗМДТ amendments), and our weekly monitoring script detects changes immediately — HEAD-probing each of the two bylaws of each of the ten municipalities, plus the IME CSV for Tier A. Municipalities publishing PDFs on their own sites typically push only a new year-end version, so the lag can be up to 4 months until the annual cycle refreshes.

### Integration within the platform

The **"Local taxes"** tile on the My-Area page renders for any of the 265 municipalities that has at least an IME block. It shows the five IME rows with colour-coded national rank (green = bottom quintile, red = top), plus a row for ТБО (basis and rate when published), plus a row each for tourist tax and dog tax when we have Tier B coverage for that municipality.

For users from the 10 Tier-B municipalities, the **"Where do my taxes go?"** tile on the same My-Area page combines these rates with a stylised household profile (apartment with €30,000 tax valuation + 85 kW vehicle) and shows the estimated annual local-tax bill — property tax, residential garbage fee, vehicle tax, and the one-time property-transfer tax. Next to it sits the distribution of the personal income tax (10%) across COFOG budget functions, so the user sees their whole personal tax-and-fee profile in one place.

## What you see in the My-Area platform today

Every municipality with at least one decision in our index gets:

- A **"Общински съвет" tile** on the My-Area page showing the freshest 3 decisions, each with its title (where parsed), date, adopted/rejected status, and the aggregate vote (за–против–въздържал).
- An expandable view that shows the per-councillor breakdown when the council publishes it — one mini-avatar per councillor, coloured by their vote, with the cacbg-roster profile link on hover.
- A **"Standouts" strip** for the Tier-A councils — the top dissenters and the lowest-attendance councillors in the last 6 months, computed from the votes shard at `data/council/votes/<obshtina>.json`.
- A council search feature in the global header — every councillor in the cacbg roster is searchable by name across the 16 wired municipalities.
- An "Последна активност" timeline that mixes the freshest council decisions with the municipality's EU-funds disbursements, procurement awards, capital programme additions, and local-election results — one unified feed of "what just happened in your municipality".

When a new protokol lands on any of the 16 council websites, the daily watcher (running on a cron) detects a change in the fingerprint, the orchestrator re-runs the ingestion pipeline, and within a single processing cycle the new decisions appear on the platform.
