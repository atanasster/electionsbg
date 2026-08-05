# Open calls (отворени процедури / приеми) — source research v1

Status: **source research, verified live 2026-08-05.** No code yet.
Follows the v2 question left open by
[funds-dashboard-magazine-v1.md](funds-dashboard-magazine-v1.md) §8.1.

Everything below was probed directly (HTTP status, byte counts, DOM selectors, parsed
columns), not inferred from documentation.

---

## 0. The one-paragraph answer

**A canonical national source exists and is fully scriptable.** ИСУН 2020's
`/bg/s/Procedure/Active` is the authoritative register of open ЕСИФ procedures — the official
portal `eufunds.bg` links its own "Отворени процедури" menu item straight at it — and it is
**server-rendered HTML, no JS, no auth**: 55 open procedures today, each with a detail page
carrying exact start/end timestamps and machine-fetchable document URLs.

But it answers only half the question. **ИСУН is authoritative for *what* and *when*, and
silent on *how much* and *who may apply*.** Those live in per-procedure DOCX/PDF. The
agriculture stream is the mirror image: ДФЗ/Стратегически план publishes a structured XLSX
with budget, eligible beneficiaries, co-financing rate and max grant per project — but only
*indicative month ranges* for dates. Neither source alone answers a single one of the
Facebook questions; together they answer most.

---

## 1. Tier 1 — canonical, scriptable, verified

### 1.1 ИСУН 2020 — the open-procedures register ⭐ primary

`https://eumis2020.government.bg/bg/s/Procedure/Active`

| Property | Verified value |
|---|---|
| Auth | none |
| Rendering | **server-side HTML** — no JS needed |
| Row selector | `li[data-href^="/bg/s/Procedure/Info/<GUID>"]`, text = `CODE - NAME` |
| Open procedures today | **55** |
| Page size | 81 KB |
| Covers | 2021–2027 programmes (BG05SFPR*, BG14MFPR*, BG16FFPR*, BG16RFPR*, BG65*) — current, not legacy |

Sibling tiers, same markup family:

| Path | Bytes | Purpose |
|---|---|---|
| `/bg/s/Procedure/Active` | 81 KB | **open now** (55 rows) |
| `/bg/s/Procedure/PublicDiscussion` | 24 KB | draft guidance out for consultation = **upcoming**, the earliest warning we can give |
| `/bg/s/Procedure/ArchivedPublicDiscussion` | 1.2 MB | consultation archive |
| `/bg/s/Procedure/Ended` | 2.4 MB | closed/terminated |
| `/bg/s/Procedure/Groups` | 27 KB | programme tree |

> `Ended` / `ArchivedPublicDiscussion` did **not** yield rows with the `li[data-href]`
> selector despite their size — different markup, unresolved. Irrelevant for phase 1 (we want
> open + upcoming), but do not assume the selector generalises.

**Detail page** — `/bg/s/Procedure/Info/<GUID>`, ~30 KB, also server-rendered. Verified
fields on `BG16RFPR001-1.011`:

```
BG16RFPR001-1.011 - Внедряване на иновации в МСП на територията на МИГ
Основна цел / objective paragraph
Срокове за кандидатстване
  Начален срок: 10.07.2026 г. 14:00 ч.
  Краен срок:   14.09.2026 г. 16:30 ч.      ← exact, to the minute
Интернет адрес: https://pkip.egov.bg/...
Документи: Условия за кандидатстване · Условия за изпълнение · Заповед ·
           Обява за откриване · Въпроси и отговори (Дата на актуализация: 03.08.2026 15:18)
```

**Documents are machine-fetchable:**
`/bg/s/Procedure/InfoDownload/<procGUID>?fileKey=<fileGUID>`

**What is NOT on the page:** procedure budget, co-financing %, min/max grant, eligible
applicant type. All of it is inside `Условия за кандидатстване`. See §4.

**Two findings that change the product, not just the pipeline:**

- **МИГ/МИРГ calls are included.** The `Покажи процедурите без МИГ/МИРГ` control is a
  client-side checkbox (`#hide_lag_procedures`, unchecked by default), so the 55 already
  contain them — including `BG16RFPR001-1.011`, **the exact call a consultancy was
  advertising in the Facebook group** ("до 102 500 евро… до 75%"). The source validates
  against observed demand. Whether ИСУН lists each МИГ's own sub-call or only the parent is
  unverified.
- **Most of the 55 are not for the public.** Reading the list: `Техническа помощ` (×4),
  `Бюджетни линии`, rail and road TEN-T investment, `Морско наблюдение`, `Контрол и
  правоприлагане`, border-police specific objectives, desegregation programmes for
  municipalities. These are *конкретни бенефициенти* — ministries, agencies, municipalities.
  Only a handful are competitive calls a business or individual could enter. **Publishing all
  55 undifferentiated would reproduce the exact complaint from the group** — „*от бизнес с
  чушкопеци до баничарници на Луната*". An audience filter is a requirement, not a polish
  item.

### 1.2 ДФЗ / Стратегически план 2023–2027 — the agriculture forward calendar ⭐

`https://www.sp2023.bg/.../indikativen-grafik-za-priemi-prez-2026-g`
→ `https://www.sp2023.bg/images/IGG/Актуализиран_ИГГ_2026.xlsx` (HTTP 200, 21,839 bytes)

Not an HTML table — a single XLSX, one sheet `ЕЗФРСР`, **11 interventions**, parsed
successfully with `openpyxl`. Columns:

`№ · ИНТЕРВЕНЦИЯ · ПРИНОС КЪМ СПЕЦИФИЧНА ЦЕЛ · ВИД НА ПОДКРЕПАТА · БЮДЖЕТ ЗА ПРИЕМ ·`
**`БЕНЕФИЦИЕНТИ`** ` · ТЕРИТОРИАЛЕН ОБХВАТ · ` **`ПЕРИОД НА ПРИЕМ`** ` · `
**`РАЗМЕР НА ФИНАНСОВАТА ПОМОЩ`** ` · ` **`РАЗМЕР НА РАЗХОДИТЕ ЗА ЕДИН ПРОЕКТ`**

This is the structure ИСУН lacks. The row that matters most, verbatim:

> **II.Д.1 — Стартова помощ за установяване на млади земеделски стопани**
> budget €68,716,487.50 · beneficiaries *„Земеделски стопани на възраст от 18 до 40 години"* ·
> whole country · **период: октомври–декември, не по-кратък от 60 дни** · aid **100%** ·
> **40 000 евро, две плащания по 20 000 евро**

That is a complete answer to „*Програмата Млад фермер отворена ли е? … Удобрен ли е бил?*",
asked three separate times in the group. Also present: II.Д.2 very-small-farms (€20,000),
II.Г.14 timber first-processing (65%, micro/small/medium), II.И.1 advisory services (open to
*„всички физически и юридически лица"*).

**Caveat that must reach the UI:** the date is a **month range**, and the file is already an
*„Актуализиран"* (updated) revision — i.e. it moves. This is a forecast, never a deadline.

### 1.3 ДФЗ — actual прием announcements

`https://www.dfz.bg/bg/web/guest/open-support-measures` — a per-year navigation shell
(2021→2026); the measure rows sit one level down. Also
`.../support-measures-have-ended` and `https://www.dfz.bg/en/important-dates-and-deadlines`.
This is what converts an indicative month range into a real opening. Needs a small crawler,
not a single fetch.

---

## 2. Tier 2 — required for Facebook coverage, one scraper each

These carry the clusters ИСУН does not, and each is a bespoke page rather than a register.

| Source | What it answers | Shape | Evidence |
|---|---|---|---|
| **АХУ** `ahu.mlsp.government.bg` | ТЕЛК / disability self-employment — **5 group posts** | `/portal/page/4` (Конкурси) + `Проекти/програми` subpages: Самостоятелна стопанска дейност · Достъпна среда · чл.49 работодатели · Рехабилитация и интеграция · НПЗ чл.44 · ЦЗЗ | 2026 конкурс opened **06.02.2026**; ~6 page parsers |
| **Агенция по заетостта** `az.government.bg` | Youth / 55+ employment subsidies — **4 group posts** | published as **news items**, not a register (`/bg/news/view/...`) → needs a feed scrape + classifier | „Младежка заетост+ Компонент 2" прием from **16.02.2026**; repo already touches this host (`indicators_az.ts`) |

---

## 3. Tier 3 — supplementary, and one negative result worth having

### 3.1 EU Funding & Tenders Portal (SEDIA) — reachable, filter syntax unresolved

`POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=…`

- Free-text search **works**: `text=innovation` → `totalResults: 303121`, `apiVersion 2.150`.
- The structured `query` filter **500s** on all three shapes tried
  (`{"bool":{"must":[{"terms":{"type":["1","2"]}}]}}`, single-type, bare `terms`), with and
  without `sort`/`languages`. Error body is a generic `{"type":"throwable"}`.

So: usable, not yet usable *well*. Low priority — this audience asks about national schemes,
not Horizon. Park it.

### 3.2 `eufunds.bg` — a portal, not a source

Reachable (HTTP 200 via curl; WebFetch fails on TLS, a tool artefact — not a site problem).
Its own "Отворени процедури" menu item points at
`eumis2020.government.bg/bg/s/Procedure/Active`, which is the strongest available evidence
that §1.1 *is* the canonical list. Residual value: programme-level context and
`/bg/tender-procedures`.

### 3.3 The саниране cluster has no source because **the programme does not exist yet**

Second-largest group cluster (Декарбонизация / еднофамилни къщи, ~6 posts, incl. „*Къде се
подават документи по Декарбонизация за еднофамилни къщи?*"). Verified status: the
single-family scheme has **not launched**. Expected **June 2026**, ~**€1.248bn** to 2029, via
the National Decarbonisation Fund; the Fund's board must **select a fund manager by
30.04.2026**; application guidance to be published on `mrrb.bg`.

**"Nothing is open yet, here is when it is expected and where it will be published" is a
genuinely valuable answer** — and one nobody in that group is giving. It also costs nothing
to serve. Treat an authoritative *negative* as a first-class result, not a gap.

### 3.4 `eufunds.media` — useful tripwire, not authoritative

A private news site covering these calls promptly (it carried both АХУ 2026 конкурси and the
2026 agri schedule). Worth a watcher as a **discovery tripwire** — if it reports a call our
Tier-1/2 crawlers missed, our coverage has a hole. Never a citation source.

---

## 4. The structural finding that shapes the design

| | identity + dates | money + eligibility |
|---|---|---|
| **ИСУН `/Active`** | ✅ exact, to the minute | ❌ absent — inside DOCX/PDF |
| **СП 2023–27 XLSX** | ⚠️ indicative month range | ✅ budget · beneficiaries · % · max per project |

Two consequences:

1. **Neither source alone answers a Facebook question.** "Има ли програма за X, колко дават,
   и допустим ли съм" needs both halves. Any v1 that ships only ИСУН will produce a page of
   institutional procedure names with dates and no money — which is not an improvement on the
   status quo for the asker.
2. **55 rows is small enough for a curated enrichment layer.** This is the opposite of the
   81,910-contract corpus: at this volume a human (or a one-shot LLM extraction reviewed by a
   human) can fill budget / eligible-applicant / max-grant per open procedure and keep it
   current. The cheapest machine path is the **`Обява за откриване на процедурата`** document
   — a short announcement that normally carries budget and eligible applicants — rather than
   the full multi-annex `Условия за кандидатстване`.

---

## 5. Honesty constraints — stricter than anything else we publish

Every other dataset on the site is retrospective. A missed deadline is a *harm*, not a stale
number, so these are gating requirements, not caveats.

1. **A shown call must be currently open, or explicitly labelled otherwise.** `Краен срок` is
   authoritative to the minute; a row past it must **disappear from "отворени"**, not linger
   greyed out. Carry a visible `проверено на <ts>` stamp, and if the last successful crawl is
   older than the freshness SLA, say so instead of showing the list.
2. **Never present indicative as certain.** The СП month ranges and anything from the
   Декарбонизация timeline are *forecasts*. Separate visual treatment, separate wording
   (`очаква се` vs `краен срок`), never merged into one "deadline" column.
3. **Always link the primary source, per row.** We are the index; ИСУН/ДФЗ is the authority.
   The application itself must happen there.
4. **Filter by who may actually apply.** Publishing `Техническа помощ` and rail TEN-T
   procedures to a small-business audience recreates the noise the group complains about.
   Until eligibility is populated (§4), the safer default is to *label* audience as unknown
   rather than to imply "you can apply".
5. **This is not advice.** An eligibility signal derived from a parsed document is an
   indication to check against the official `Условия`, never a determination.

---

## 6. Recommended ingest shape

Reuse the established repo patterns rather than inventing: a `scripts/watch/sources/*.ts`
fingerprint per source, `stage_merge` for the served table (it is on a serving path), a
`recent_updates` changelog wiring per `feedback_pg_changelog_required`, and the
degrade-don't-fail route contract.

| Phase | Scope | Cadence | Notes |
|---|---|---|---|
| **A** | ИСУН `/Active` + `/PublicDiscussion` → `open_calls` table (code, name, programme, objective, start_ts, end_ts, guid, source_url, docs[]) | **daily** | Deadlines are time-critical — this is the one ingest that must not run weekly. Fingerprint on (row count, GUID set, max Q&A update ts) |
| **B** | СП 2023–27 XLSX → agri forward calendar (money + beneficiaries + % + max, month range) | weekly | 11 rows; `openpyxl`-equivalent parse verified |
| **C** | Enrichment: parse `Обява за откриване` per open procedure for budget / eligible applicants / max grant; human review gate | on new procedure | 55 rows makes this tractable; §4 |
| **D** | АХУ (~6 parsers) + АЗ news classifier | daily/weekly | The two clusters ИСУН misses |
| **E** | SEDIA once the `query` filter is solved | weekly | Lowest value for this audience |

Serve it as **Band 1's companion**, not its replacement: the resolver
("финансирано ли е нещо като моето", from the 81,910 awarded contracts) answers *what gets
funded and at what odds*; `open_calls` answers *what you can apply to right now*. The pair is
the product — awarded history gives the base rates that make an open call worth reading.

---

## 7. Open questions

1. **Daily crawl of 55 detail pages + change detection — acceptable politeness?** ~56 requests
   per run against a government host. Suggest one listing fetch, and detail fetches only for
   GUIDs that are new or whose Q&A update stamp moved.
2. **Enrichment: LLM extraction or hand-curation?** At 55 rows hand-curation is feasible and
   auditable; LLM extraction scales to Tier D but needs the grounded-number gate
   (`project_ai_chat_grounding_gate`) and a human sign-off before a money figure ships.
3. **Is `/PublicDiscussion` worth surfacing publicly?** It is the earliest possible signal
   (weeks before opening) and directly answers „*предстоящи мерки?*" — but a draft can change
   or be withdrawn, so it needs its own label and possibly its own tab.
4. **Do we mirror the documents?** Linking is cheaper and always current; mirroring survives
   the source reorganising. Given ИСУН's GUID-keyed URLs, linking is probably right.
5. **МИГ granularity** — does ИСУН carry each local action group's own sub-call, or only the
   parent procedure? Determines whether we cover ~64 МИГ territories or just the umbrella.
