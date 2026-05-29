# How Bulgarian municipal council votes — and their budgets — get into electionsbg.com

_Draft v2 — May 2026_

Bulgaria has 265 municipalities. Each runs an общински съвет that meets monthly, takes hundreds of decisions a year, and votes on a multi-million-euro annual budget — every municipality publishes some version of both on its own website. There is no central register of these votes or budgets: РМС 436/2017 only mandates the narrow чл.45 ЗМСМА "returned decisions" feed on data.egov.bg, and a sampling we did across 50 municipalities found that fewer than 4 in 10 publish anything in that category, more than 90% of which is just hyperlinks back to the município's own CMS.

So we built our own ingest. As of this draft we cover **16 municipalities for council votes** and **26 municipalities for capital programmes** — every oblast capital except seven, plus secondary cities. The two coverages overlap in 13 municipalities where we have BOTH a council ingest AND a budget ingest, so the dashboard can answer the politically interesting question: "the council voted to approve €3M for the school renovation in village X — who voted for, who voted against, and did the project actually land in the capital programme?"

Across the 16 wired councils we've extracted **2,947 resolutions** with their adopted/rejected status and aggregate vote tallies, and for the six councils where the protokol publishes the per-councillor readout we've also matched **18,300 individual vote rows** to the Court-of-Audit roster (cacbg.bg). Across the 26 wired capital programmes we've itemised roughly **5,800 individual investment projects** worth **€1.06 billion** for fiscal year 2025 alone.

The tables below list every municipality currently in the system. The "Council website" column links to the council's own page — if your municipality is not yet covered, the council site is also where to write to your representatives directly.

## Wired municipalities

| Код | Община | Tier | Decisions | Per-councillor rows | Councillors in roster | Coverage period | Council website |
|------|---------|------|----------:|--------------------:|----------------------:|-----------------|-----------------|
| SOF | Столична община | A | 132 | 2,964 | — | Apr–May 2026 | https://council.sofia.bg/ |
| BGS01 | Община Бургас | A | 319 | 3,966 | 46 | Mar 2025 – Mar 2026 | https://burgascouncil.org/ |
| VTR01 | Община Велико Търново | A | 413 | 5,139 | 35 | Jul 2025 – May 2026 | https://savet.veliko-tarnovo.bg/ |
| SZR12 | Община Казанлък | A | 212 | 3,227 | 35 | Dec 2020 – Jun 2025 | https://obs.kazanlak.bg/ |
| PER32 | Община Перник | A | 464 | 3,004 | 34 | Sep 2025 – Apr 2026 | https://www.obs-pernik.bg/ |
| GAB05 | Община Габрово | A | 244 | — | 30 | Apr–Sep 2024 | https://gabrovo.bg/ |
| SZR01 | Община Стара Загора | A | 50 | — | 51 | Apr–May 2026 | https://www.starazagora.bg/ |
| RSE01 | Община Русе | A | 50 | — | 47 | Mar–Apr 2026 | https://obs.ruse-bg.eu/ |
| PVN01 | Община Плевен | A | 50 | — | 36 | Mar–Apr 2026 | https://obs.pleven.bg/ |
| SLV01 | Община Сливен | A | 50 | — | 40 | Mar–Apr 2026 | https://obs.sliven.bg/ |
| PDV01 | Община Пловдив | B | 30 | — | 50 | Apr–May 2026 | https://plovdiv.bg/obs/ |
| VAR01 | Община Варна | B | 45 | — | 47 | Dec 2025 – Apr 2026 | https://varnacouncil.bg/ |
| HKV34 | Община Хасково | B | 387 | — | 39 | Jan 2022 | https://www.haskovo.bg/ |
| DOB28 | Община град Добрич | B | 50 | — | 41 | Nov–Dec 2023 | https://www.dobrich.bg/ |
| HKV09 | Община Димитровград | B | 197 | — | 32 | Jun 2025 – Apr 2026 | https://www.dimitrovgrad.bg/ |
| RAZ26 | Община Разград | B | 254 | — | 31 | Oct 2025 – May 2026 | https://www.razgrad.bg/ |

**Tier A** means we extract everything the protocol carries: the decision number, the chair's adopted-or-rejected line, the aggregate vote (за / против / въздържал) and — where the municipality publishes a per-councillor readout — every councillor's individual vote, matched to their cacbg profile. **Tier B** means the same except for the per-councillor readout, because the published protocol records only the chair's announced totals.

The "Decisions" column is what's currently visible in our index. The "Coverage period" shows the freshest and oldest dates we hold — for several Wayback-CDX-sourced councils (Габрово, Хасково, Добрич), the public site doesn't expose older protocols directly, so the dataset is whatever the Internet Archive has crawled.

## Capital programmes (поименен списък на капиталовите разходи)

Council votes tell you _what_ was decided. The capital programme — published every year as Приложение №3 / №4 / №7 to the budget law and re-amended after each council vote that moves money between line items — tells you _how much_ and _where_. We track 26 municipalities here, with the deepest history (2022→2025, four full fiscal years) for the eight municipalities that have published the longest.

Each programme is a list of named investment projects (a school renovation, a road, a sewer-line extension) with a monetary value, a funding source (own funds / state subsidy / EU / carry-over), and — in the best-published programmes — the village or kmetstvo the project lives in. The dashboard reads this to surface a per-município "Капиталова програма" tile with funding-source breakdown, top projects, and the per-settlement rollup for the municipalities that tag projects to specific villages.

| Слъг | Обл. център? | Years | 2025 total (€) | Projects (2025) | Per-village tagging | Source format |
|------|:--:|------|--------:|--------:|--------:|---------------|
| sofia | yes | 2022–2025 | 327.6M | 352 | 0% (paragraph-only) | XLSX (clean) |
| varna | yes | 2022–2025 | 52.3M | 587 | 0% (rasterised scan) | PDF + OCR |
| burgas | yes | 2022–2025 | 86.7M | 104 | 13% (city-quarters from Wikipedia) | XLSX (workbook with funding-source cols) |
| ruse | yes | 2022–2025 | 26.2M | 1,052 | 7% (multi-sheet) | XLSX (per-kmetstvo sheets — highest data quality) |
| stara_zagora | yes | 2022–2025 | 13.7M | 342 | 4% (51 villages tagged "с.") | PDF |
| pleven | yes | 2022–2025 | 9.5M | 92 | 40% | PDF + OCR (fragmented layout) |
| asenovgrad | no (Plovdiv obl.) | 2022–2025 | 22.5M | 229 | 60% | PDF + OCR |
| yambol | yes | 2022–2025 | 7.0M | 184 | 0% (single-settlement município) | RAR/ZIP + PDF + OCR |
| vidin | yes | 2022–2023 only | 17.0M (2023) | 176 | 90% | DOC inside RAR (textutil) |
| sliven | yes | 2025 | 19.7M | 256 | 60% | PDF + OCR |
| dobrich | yes | 2024–2025 | 23.2M | 82 | 0% (single-settlement) | HTML table (scraped) |
| haskovo | yes | 2024 | 21.3M | 268 | 31% | PDF + OCR (multi-line projects) |
| pernik | yes | 2024–2026 | 14.0M (2025) | 159 | 62% | XLS (BGN/EUR currency switch handled) |
| veliko_tarnovo | yes | 2024–2025 | 47.1M | 382 | 70% | XLSX (89 settlements) |
| kardzhali | yes | 2024–2025 | 16.7M | 104 | 70% | PDF + OCR (било/става amendment columns) |
| plovdiv | yes | 2025 | 71.4M | 567 | 0% (paragraph-only) | XLSX |
| gabrovo | yes | 2025 | 8.1M | 299 | 21% | PDF + OCR (Google-indexed URL) |
| shumen | yes | 2025 | 14.9M | 324 | 25% | PDF + OCR (Playwright-harvested) |
| kyustendil | yes | 2025 | 11.0M | 246 | 43% | PDF + OCR (council session annex) |
| montana | yes | 2025 | 29.1M | 9 | 78% | PDF + OCR (consolidated page 5 only) |
| lovech | yes | 2025 | 39.2M | 142 | 33% | PDF + OCR |
| karlovo | no (Plovdiv obl.) | 2025 | 15.0M | 136 | 81% | XLSX (anti-hotlink Referer required) |
| kazanlak | no (Stara Zagora obl.) | 2025 | 7.9M | 201 | 35% | PDF + OCR (Nuxt _payload.json discovery) |
| samokov | no (Sofia obl.) | 2025 | 29.7M | 231 | 74% | PDF + OCR |
| velingrad | no (Pazardzhik obl.) | 2025 | 19.0M | 159 | 74% | PDF + OCR |
| dupnitsa | no (Kyustendil obl.) | 2025 | 6.7M | 137 | 42% | PDF + OCR |

**26 municipalities** with capital programmes ingested, covering **20 of Bulgaria's 28 oblast capitals plus 6 secondary cities**. Combined 2025 value: **€1.06 billion** itemised across roughly 5,800 individual projects.

The per-village tagging column varies enormously because it depends on how the município writes the programme. The highest-quality publishers (Ruse, Vidin, Veliko Tarnovo, Karlovo, Samokov, Velingrad) tag every project to a specific settlement via the workbook structure or a "с. <name>" / "гр. <name>" prefix. The lowest-quality publishers (Sofia, Plovdiv, Varna, Dobrich, Yambol) emit a paragraph-level breakdown only — you can see €5M went to "Основен ремонт на дълготрайни материални активи" but not which village it's in. Several intermediate publishers tag part of the list (the school renovations get a village; the centrally-purchased equipment doesn't).

### Capital programmes — what's missing

Eight oblast capitals don't have a capital programme ingested. The reasons cluster:

| Oblast capital | Status | Why |
|----------------|--------|------|
| Благоевград | Not published | The município doesn't expose Приложение №3 / №4 to the budget on its website at all. Same publication gap as the council protokols — see above. |
| Враца | Not published | Council site dormant; no recent budget docket discoverable. |
| Пазарджик | Not published | Budget portal lists annual budget HTMLS, but no separate capital-programme annex with a per-project list. Велинград (in the oblast) IS covered. |
| Разград | Not published | Same gap as the council protokols — the município publishes the аctualisation as appendices to individual decisions but no consolidated annual programme. |
| Силистра | Not published | No capital-programme PDF / XLSX discoverable; the município publishes only the top-level summary. |
| Смолян | Cloudflare-blocked | Same Cloudflare "Just a moment…" challenge as the council site. Unblocking that unlocks both surfaces at once. |
| Търговище | TSPD bot guard | Same WPS-Portal / TSPD pattern as the council site. |
| София (oblast) | n/a | Sofia city's capital programme (under SFO_CITY) covers the same geographic footprint administratively — there's no separate Sofia-oblast programme. |

For the six "Not published" cases the gap is publication policy, not parsing. The municipality publishes the consolidated budget (often as a single PDF), but not the itemised capital-programme list that gives every project a name, value, and funding source. The unblock here is straightforward: ask the council to publish the same Приложение №3 / №4 their bigger peers (Sofia, Plovdiv, Bourgas, Varna) already do.

Vidin is in a special category: the 2025 and 2026 forward plans aren't published as a discrete document — only the year-end execution report (отчет за капиталовите разходи) is available, which is what powers our 2022 and 2023 entries. The municipality has moved to a "report after we spend" cadence that loses prospective transparency.

### Complementary budget surfaces

Two other municipal-finance surfaces sit alongside the capital programmes:

- **Article 53 transfers** — every year the State Budget Law allocates per-município subsidies (Bulgarian: Чл.53 на ЗДБ — обща изравнителна, общи целеви, ВКП от РУП и т.н.). We parse this from the law's HTML annex into `data/budget/municipal_transfers/`. Coverage is **all 265 municipalities** for fiscal years 2020, 2022, 2023, 2024, and 2025 — the only universal-coverage local-finance surface in the system. 2025 combined: **€4.53 billion** in state transfers to local government.

- **Cash-execution actuals** — the município's monthly "Касов отчет" feed that shows what got spent vs what was planned. This is the surface that would close the loop on "did the council actually deliver Project X for €Y or did the money sit unspent?" Currently dormant: only **Русе** (2016–2025) and **Николаево** (2019–2024) publish it in a parseable format. Most municipalities post the monthly cash report as a scanned PDF that gets re-shot every month with a different layout, so there's no stable parsing target without per-município OCR work.

## What we don't have

### Coverage by municipality count vs population

- **16 of 265 общини** (6%) — a thin slice by count.
- **~ 80% of Bulgaria's population** — a thick slice by people, because we've prioritised oblast capitals first.

The shortlist of municipalities NOT yet wired but actively publishing protocols:

| Код | Община | Status | Blocker |
|------|---------|--------|---------|
| BLG03 | Благоевград | Deferred | Legacy URL is dead; the município moved to a SaaS that requires authenticated access. New publication policy needed. |
| SML31 | Смолян | Deferred | Cloudflare "Just a moment…" challenge blocks even headless browsers. Needs CF-clearance cookie tooling (already used by our local-elections skill). |
| VID09 | Видин | Deferred | WPS-Portal site loads the document list via an XHR behind a TSPD bot guard. Captured the data feed once with Playwright, retries hit `ERR_EMPTY_RESPONSE`. |
| TGV35 | Търговище | Deferred | Same WPS-Portal pattern as Видин — document list is in an Atom XML feed gated by TSPD. |
| MON29 | Монтана | Site migrated | Legacy protokol URLs returned 404 after the site rebuild; new publication path not yet discovered. |
| LOV18 | Ловеч | Stale | Latest decision on the council's `os.lovech.bg` site is from September 2019. Effectively dormant. |
| SHU30 | Шумен | Format problem | The município publishes покана / agenda PDFs but no protokol PDFs; the agenda PDFs are PDFium-produced with malformed flate streams that pdftotext can't read. |
| VTR06 | Горна Оряховица | Publication-policy gap | The council publishes agendas but not protokols. Files live on a separate Nextcloud with token URLs we can't enumerate. |

### Per-decision limitations

- **No decision title** for several Tier-B sources (Добрич, Razgrad, Перник). The protocol body opens with the legal preamble "На основание чл.21 ал.1 ...", not a clean subject line, so we surface the resolution by id only. Где could close this gap by extracting "ОТНОСНО:" or "ПО ХХ ТОЧКА" headers — already done for Hkv09; pending for the others.
- **No body text** indexed for conflict-of-interest matching. We have the decision metadata + vote, but the body of each resolution isn't stored — meaning we can't yet flag "councillor X voted on a contract awarded to company Y where they're a director". The pipeline is wired (see `data/officials/derived/councillor_conflicts.json`), but with 0 matches today because no muni's resolution body is indexed.
- **Stale Wayback windows** for Габрово (Apr–Sep 2024), Хасково (Jan 2022 only), Добрич (Nov–Dec 2023). The Internet Archive crawls these sites only occasionally; the dataset will get fresher as Wayback re-crawls.

### What the Tier-B coverage misses

Of the 16 wired councils, **10 are Tier B** — we have the aggregate tally and the result, but not the per-councillor readout. The reason varies:

- **Препис-извлечение format** (Пловдив, Варна, Сливен): the município publishes a decision extract that strips the deliberation portion of the minutes. Tally + adopted/rejected only.
- **Chair-announcement narrative** (Хасково, Димитровград, Добрич, Разград): the protokol records the chair's voiced totals ("Председателят обяви, че решението се приема с 22 за, 0 против, 1 въздържал се"), not the individual readout. Even the full minutes don't carry the per-councillor data.
- **Format-of-record decision**: some councils take their decisions by show of hands and only resort to a named vote on the rare contested motion. The protocol is technically complete.

## How to move forward

### Short term (technical unblocks)

1. **TSPD / Cloudflare bypass** — Видин, Търговище, Смолян, and four others sit behind enterprise bot guards. Our local-elections skill already handles this for ЦИК via a Playwright session with a persistent `cf_clearance` cookie; folding the same pattern into the council ingest unlocks at least 3 more oblast capitals (Видин, Търговище, Смолян + likely Кърджали, Кюстендил, Враца).
2. **Body indexing for Tier A councils** — store each resolution's body text under `data/council/bodies/<obshtina>/<id>.json`. Powers conflict-detection (councillor ↔ company tie) and full-text search over the corpus.
3. **Title extraction for the three remaining Tier-B sources** — port the agenda-header logic from the Димитровград parser (which extracts the "ПО ПЪРВА ТОЧКА … ОТНОСНО: …" block) to Добрич and Разград. A 30-minute change per muni, gives every decision a human-readable subject in the My-Area "Последна активност" feed.

### Medium term (data publication itself)

Most of what's missing isn't a parsing problem; it's a publication-policy problem. Two municipalities (Благоевград, Горна Оряховица) publish their session agendas but never make the protokols public. Lovech's site stopped updating in 2019. Montana migrated its CMS without preserving permanent URLs. These aren't technical gaps — they're transparency gaps.

This is where readers can help directly. If your municipality is in the table above, you can verify our data against the source. If it's NOT in the table, this is where to ask your council representatives to publish (or to start publishing again):

| Код | Община | Council website / contact |
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

The big-population councils above account for the heavy lifting; the next 50 we'd target are the secondary administrative centres (Велинград, Карлово, Дупница, Самоков, Кърджали, Видин — once unblocked — and similar). After that the count climbs into small rural municipalities where the council meets quarterly or less and where the marginal civic value of per-councillor coverage is lower. Our staged plan is to keep doubling the population-weighted coverage every quarter, rather than chasing the muni-count number for its own sake.

## What you see in the My-Area dashboard today

Every municipality with at least one decision in our index gets:

- A **"Общински съвет" tile** on the My-Area page showing the freshest 3 decisions, each with its title (where parsed), date, adopted/rejected status, and the aggregate vote (за–против–въздържал).
- An expandable view that shows the per-councillor breakdown when the council publishes it — one mini-avatar per councillor, coloured by their vote, with the cacbg-roster profile link on hover.
- A **"Standouts" strip** for the Tier-A councils — the top dissenters and the lowest-attendance councillors in the last 6 months, computed from the votes shard at `data/council/votes/<obshtina>.json`.
- A council-search affordance in the global header — every councillor in the cacbg roster is searchable by name across the 16 wired municipalities.
- An "Последна активност" timeline that mixes the freshest council decisions with the município's EU-funds disbursements, procurement awards, capital programme additions, and local-election results — one unified feed of "what just happened in your municipality".

When a new protokol lands on any of the 16 council websites, the daily watcher (running on a cron) flips its fingerprint, the orchestrator re-runs the ingest pipeline, and within a single processing cycle the new decisions appear on the dashboard.

---

_Open questions and editor's notes:_
- Should we expand the council + capital-programmes tables with a population column to make the population-weighted coverage claim visible?
- Should we cross-reference the council ↔ capital-programme overlap explicitly? 13 municipalities have both — that's the dashboard's sweet spot for "did the council vote on the project that ended up in the capital programme?" stories.
- Should the "How to ask your council to publish" section include a sample email template in BG?
- Worth a separate section on the **Article 53 transfers** (the universal-coverage surface) — every município's annual envelope from the state budget, broken down by transfer category? That's already on the dashboard but not surfaced as a comparable per-município page.
- BG translation pass after content lock-in.
