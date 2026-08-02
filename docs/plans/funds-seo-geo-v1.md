# EU-funds pages: SEO / AIO / GEO — v1

**Symptom (2026-08-02).** GSC shows impressions and zero clicks on the EU-funds pages.
The worked example from the report: query `"2014bg16rfop002"` — 5 impressions, 0 clicks.

**Diagnosis in one line.** We are not losing a ranking contest; we are answering a
different question than the one being asked, on the only 110 URLs we expose from an
81,910-contract corpus — and we serve the whole thing to answer engines as four
sentences of prose.

Everything below was measured against the live site and the committed data on
2026-08-02. Counts come from `data/funds/projects/`.

---

## Findings

### F1 — The query is procedure-level. We have no procedure page. (root cause)

Look at who outranks us on `2014bg16rfop002` in the screenshot: `evgenystefanov.com`,
`giurlata.bg`, `opic.bg`. Every one is a page about **one procedure or one grant** —
`BG16RFOP002-2.089-3686-C01`, `BG16RFOP002-2.095`, `BG16RFOP002-2.002`. These are the
mandated-publicity pages every beneficiary of an ОПИК scheme must publish, so there are
tens of thousands of them and they own the tail.

The searcher typing a code like that wants: *what is this scheme, who got money under it,
did company X get money.* Our page answers *"the whole €2.23bn programme"*. Impression,
no click. That is the entire mechanism.

The procedure grain is **already latent in the corpus** — it is the contract number minus
its last two segments:

| grain | example | our URL | count |
|---|---|---|---|
| programme | `2014BG16RFOP002` | `/funds/programme/:code` ✅ | 46 |
| **procedure** | `BG16RFOP002-2.089` | **none** ❌ | **2,137** |
| contract | `BG16RFOP002-2.089-3686-C01` | `/funds/contract/:number` ⚠️ (see F2) | 81,910 |

> Counts corrected during implementation. The first draft of this table said 16,714
> procedures and 9,112 contracts for `2.073`; both were measured with a derivation that
> required a 4-digit project ordinal, which silently dropped 14,510 rows (17.7% of the
> corpus) and turned each one into a singleton pseudo-procedure. The figures below are the
> shipped ones — see `procedureCodeOf` in `scripts/funds/procedures.ts`.

The two biggest procedures are the COVID SME-support schemes, and they are exactly the
ones in the SERP:

```
BG16RFOP002-2.073  23,622 contracts
BG16RFOP002-2.089   4,356 contracts
BG16RFPR001-2.004   2,273 contracts
BG-RRP-1.015        2,228 contracts
```

The set is small enough to prerender outright: **981 of the 2,137 procedures have ≥3
contracts.**

### F2 — 81,910 contract URLs serve the homepage to crawlers

`/funds/contract/:number` is a working route with a per-contract shard behind it, but it
is not prerendered and not in the sitemap. Verified:

```bash
curl -sL "https://electionsbg.com/funds/contract/BG16RFOP002-2.089-3686-C01" -H "User-Agent: Googlebot"
```
```html
<title>Парламентарни избори 2026 — резултати и анализ от 2005 | electionsbg.com</title>
<meta name="description" content="Пълни резултати от парламентарните избори 2026 …" />
```

Every one of those URLs is, to a crawler, a duplicate of the homepage — and the only path
to them is a JS-rendered link. Same for `/company/:eik` and `/company/:eik/funds`: neither
is prerendered nor in `route_defs.ts`.

This is an *eligibility* bug, not a ranking one. `sitemap_funds.xml` exposes **110 URLs**
for a €43bn corpus with ~30,000 beneficiaries.

### F3 — BG and EN programme pages are near-duplicates, and it is visibly corrupting the SERP

`programNameEn` is absent on **all 46** summary shards, so the English mirror carries the
Bulgarian programme name:

```
BG: Иновации и конкурентоспособност (2014BG16RFOP002) — европейско финансиране | electionsbg.com
EN: Иновации и конкурентоспособност (2014BG16RFOP002) — EU funding | electionsbg.com
```

Same `<h1>`, same figures, only boilerplate differs. The damage is in the screenshot:
Google paired the **Bulgarian title** with an **English snippet** —

> Иновации и конкурентоспособност. Back to EU funds2014BG16RFOP002. Contracts. 35 332.
> 30092 beneficiaries. Contracted. €2.23B. €1.73B grant (БФП). Paid. €1.66B.

Those strings are verbatim `src/locales/en/translation.json` (`funds_index_title:
"EU funds"`, `funds_program_kpi_grant: "grant (БФП)"`). Google rendered the JS, took the
snippet from the English DOM, and stapled it to the Bulgarian title. A snippet that reads
as broken machine output is a direct CTR tax, independent of position.

Note also *why* the snippet reads as a stat dump with labels split from values
("Contracts. 35 332. 30092 beneficiaries") — Google was scraping the KPI grid, where each
label and figure is a separate DOM node. There is no prose in the rendered DOM to lift.

### F4 — Answer engines (AIO/GEO) see four sentences

`robots.txt` correctly allows GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Applebot,
CCBot and the rest. None of them execute JS. This is the entire prerendered
`#ssg-content` for the €2.23bn programme:

```html
<h1>Иновации и конкурентоспособност</h1>
<p><strong>2014BG16RFOP002</strong></p>
<p>35 332 договора · 30 092 бенефициенти · €2,228,915,357 договорени · €1,662,499,491 изплатени.</p>
<p>Топ договори, бенефициенти и общини за оперативна програма …, извлечени от корпуса на ИСУН 2020.</p>
<p>Виж и <a …>общия преглед</a>, <a …>политическата икономия</a> …</p>
```

Zero of `topBeneficiaries` (20), `topContracts` (20), `topMunis` (10) or
`statusBreakdown` (3) reach the HTML — **even though the prerender already opens and reads
the shard that contains all of them** (`scripts/prerender/routes.ts:4609`). Ask any answer
engine "кой получи най-много по ОПИК" and it has nothing citable from us, so it cites
eufunds.bg. This is the cheapest win on the list: the data is in the file at build time.

### F5 — The description is a noun pile; the structured data is minimal

```
Иновации и конкурентоспособност — оперативна програма от ИСУН 2020.
35 332 договора · 30 092 бенефициенти · €2,228,915,357 договорени · €1,662,499,491 изплатени
```

No verb, no reason to click, and — decisively — **no entity names**. The one thing that
makes a funds snippet clickable is seeing a company or a municipality you recognise.

JSON-LD is `WebPage` + `BreadcrumbList` only. No `Dataset`, on a page that *is* a dataset
view — and `buildDatasetLd()` already exists in `scripts/prerender/jsonLd.ts`, with a
Datasets enhancement report already live in GSC. The breadcrumb also skips a level:
`Начало → Иновации и конкурентоспособност`, with no `/funds` in between.

---

## Plan

Ordered by (impact × confidence) / cost. T1 and T2 are the ones that move the number.

### T1 — Ship `/funds/procedure/:code` (the page the query is actually for)

New route + prerender + sitemap for the 2,137-strong procedure grain, bounded on first
ship to **procedures with ≥3 contracts (981 pages)**; widen later on measured demand.

Page content — the same shape as the programme page, one level down:
- H1 = procedure name + code; parent programme link.
- KPIs: contracts, beneficiaries, contracted, paid, disbursement rate.
- **The full beneficiary list** (paginated in the SPA, top 100 in the prerendered HTML).
  For `BG16RFOP002-2.089` that is 4,356 named companies — every one of them a long-tail
  query, and the exact content the publicity pages that outrank us carry one at a time.
- Municipality split, status split.

Derivation: `contractNumber` minus the trailing `-NNNN[-CNN]`. Needs a procedure title —
check whether ИСУН carries one on the contract record; if not, derive from the modal
contract title prefix and flag it for the ingest to fill properly.

This is the single highest-leverage item: it is the only one that puts a page *on* the
query in the screenshot.

### T2 — Put the shard's data into the prerendered HTML (AIO/GEO + internal linking)

Change `scripts/prerender/routes.ts:4591–4680` to emit `topBeneficiaries`,
`topContracts`, `topMunis` and `statusBreakdown` as real `<table>`s inside `bodyHtml`.
Cost is ~4 KB per page across 92 pages; the shard is already parsed.

Two effects, both large:
1. Answer engines get citable, attributable rows instead of one aggregate sentence.
2. The `topContracts` rows become **JS-free `<a href="/funds/contract/…">` links** — the
   first crawl path into the contract layer that does not require rendering.

Do the same on `/funds/focus/:slug` and the new procedure pages.

### T3 — Stop serving the homepage on `/funds/contract/*` and `/company/*`

Two options; recommend (b).

**(a) Bounded prerender.** Contracts ≥€200k = 14,092 pages (≥€100k = 23,008; ≥€1M =
3,131). Safe, but arbitrary, and it leaves the rest on the homepage title. Note the
453k-file dist deploy ceiling — BG+EN doubles any figure here.

**(b) Cloud-Function head injection** on `/funds/contract/*` (and `/company/*`), reading
`fund_payloads` and returning the SPA shell with correct `<title>`, description, canonical,
JSON-LD and an `#ssg-content` body. **The repo already does exactly this for `/officials/*`**
(`firebase.json` rewrites `/officials/*` and `/en/officials/*` to the `db` function), so
the pattern, the function and the deploy order are established. Covers all 81,910 with
zero dist growth.

Share one body/head builder between the prerender and the function so the two paths cannot
drift.

Sitemap: add contract URLs for the ≥€200k slice regardless of which option ships — a
sitemap entry for a URL the function now serves properly is valid either way.

### T4 — Fix the BG/EN duplication

Populate `programNameEn` on all 46 summary shards from the official English operational-
programme names (these are published; it is a one-time curated table in the funds ingest).
Until that lands, drop the `/en/funds/programme/*` mirrors from `sitemap_funds.xml` and
point their canonical at the BG URL — a near-duplicate with a Bulgarian H1 earns nothing
and is actively producing the mixed-language SERP in F3.

Add a prerender test asserting no programme page ships an English title containing a
Cyrillic programme name.

### T5 — Rewrite titles and descriptions for the searcher

Current title is 88 chars and spends 18 of them on `| electionsbg.com`, which Google
truncates or rewrites anyway. Lead with the code and the answer.

```
title:  Иновации и конкурентоспособност (2014BG16RFOP002) — 35 332 договора, €2.23 млрд.
desc:   Кой получи парите по ОПИК: всички 35 332 договора по програма и процедура, по
        бенефициент, община и статус. Най-големи получатели: Фонд мениджър на финансови
        инструменти, … · €2.23 млрд. договорени, €1.66 млрд. изплатени (ИСУН 2020).
```

The load-bearing change is **naming the top beneficiaries in the description**. Entity
names are what make a funds snippet clickable, and they are what answer engines quote.

### T6 — Structured data

- `Dataset` JSON-LD on every programme, procedure and focus page via the existing
  `buildDatasetLd()` — Google Dataset Search is precisely the surface for a query like
  `2014BG16RFOP002`.
- `ItemList` of the top beneficiaries.
- Fix `BreadcrumbList` to carry the `/funds` level:
  `Начало → Европейски средства → {programme} → {procedure}`. `staticPage()` hardcodes a
  two-item breadcrumb (`routes.ts:441`); it needs an optional parent.

---

## Verification

**Immediate (build-time, in the prerender test suite):**
- no funds URL in any sitemap serves a `<title>` belonging to another page;
- every programme/procedure page's prerendered body contains ≥10 beneficiary rows;
- no English page carries a Cyrillic programme name in its title;
- every `<loc>` in `sitemap_funds.xml` resolves to real prerendered HTML (the existing
  sitemap-validity gate).

**4–8 weeks (GSC):** the honest metric is not CTR on the programme pages — it is
*impressions on procedure and contract URLs*, which today are structurally zero. Watch:
impressions/clicks split by URL grain, and queries containing a `-N.NNN` procedure suffix.

**AIO/GEO:** ask ChatGPT/Perplexity/Claude "кой получи най-много по ОПИК 2014BG16RFOP002"
before and after T2. Today we are not citable; after T2 we are the only source with the
ranked list in crawlable HTML.

---

## Sizing

| item | pages added (BG+EN) | notes |
|---|---|---|
| T1 procedures ≥3 contracts | 1,962 | 981 × BG+EN |
| T2 richer bodies | 0 | ~4 KB each on 92 existing pages |
| T3 (a) contracts ≥€200k | 28,184 | mind the 453k-file dist ceiling |
| T3 (b) function rewrite | 0 | covers all 81,910 |
