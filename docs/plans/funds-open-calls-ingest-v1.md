# Open calls (отворени процедури / приеми) — implementation plan v1

Status: **implementation plan, approved scope, no code yet.** Drafted 2026-08-05.

Predecessors — read both first:
- [funds-open-calls-sources-v1.md](funds-open-calls-sources-v1.md) — the source research this
  builds on. Every endpoint, selector and column below was verified live on 2026-08-05.
- [funds-dashboard-magazine-v1.md](funds-dashboard-magazine-v1.md) — why we want it, and the
  demand taxonomy it serves.

---

## 1. The invariant that shapes the whole design

Every other dataset in this repo is retrospective, so a stale row is a *wrong number*. Here a
stale row is a **missed deadline** — an active harm to someone who trusted us. One decision
removes almost all of that risk:

> **`open` is computed at QUERY time from `closes_at`, never stored at crawl time.**

The crawler records facts (`opens_at`, `closes_at`, `checked_at`). The serving function decides
status by comparing them to `now()`. Consequences:

| If… | Stored-status design | Query-time design (chosen) |
|---|---|---|
| crawler dies for a week | expired calls keep showing as **open** → harm | expired calls **vanish on their own**; new calls are missing → merely incomplete |
| a call closes early | wrong until next crawl | wrong until next crawl (unavoidable — mitigated by §6.2) |

The worst failure mode becomes **under-reporting**, which is safe and visible (the freshness
stamp says when we last looked). This is not a nicety; it is the reason the feature is
publishable at all, and `open_calls.data.test.ts` asserts it (§7).

Second invariant, equally load-bearing:

> **`date_precision` is a NOT NULL column with a CHECK, not a convention.** `'exact'` (ИСУН
> timestamps) and `'indicative'` (ДФЗ month ranges) must never render through the same
> component or the same word. `'indicative'` may never populate `closes_at`.

---

## 2. Scope of v1

**In:** ИСУН open + upcoming (the spine), the ДФЗ/СП 2023–27 indicative agri calendar, a
serving route, a browse table, a `/funds` band-1 companion module, freshness surfacing, and the
watcher + skill wiring that keeps it current on both local and Cloud SQL.

**Out of v1** (noted so they are not accidentally designed out):
- alerts / email subscriptions (needs an account system — big, separate)
- АХУ and АЗ scrapers (phase D — deliberately after the spine proves out)
- SEDIA / EU-direct programmes (filter syntax unresolved, lowest value here)
- per-call prerendered pages — **deliberately never**: a prerendered expired call is exactly
  the harm §1 exists to prevent. Only the *index* is prerendered.

---

## 3. Data model — migration `134_open_calls.sql`

Highest existing migration is `133_tr_company_place.sql`, so this is **134**.

```sql
CREATE TABLE IF NOT EXISTS open_calls (
  id              serial PRIMARY KEY,
  source          text NOT NULL,           -- 'isun' | 'sp2023' | 'ahu' | 'az'
  source_key      text NOT NULL,           -- ИСУН GUID | intervention code | slug
  code            text,                    -- BG16RFPR001-1.011 | II.Д.1
  title           text NOT NULL,
  programme_code  text,
  programme_name  text,
  objective       text,

  -- DATES. exact ⇒ closes_at NOT NULL; indicative ⇒ closes_at NULL + period_label set.
  date_precision  text NOT NULL CHECK (date_precision IN ('exact','indicative')),
  opens_at        timestamptz,
  closes_at       timestamptz,
  period_label    text,                    -- "В периода октомври-декември, не по-кратък от 60 дни"

  -- MONEY / ELIGIBILITY. NULL until enrichment (§5.3) — never guessed.
  budget_eur      numeric,
  budget_note     text,
  aid_rate_pct    numeric,
  grant_min_eur   numeric,
  grant_max_eur   numeric,
  beneficiaries_raw text,                  -- verbatim source text, always kept
  audience        text[] NOT NULL DEFAULT '{}',  -- derived facets, see below
  territory       text,

  source_url      text NOT NULL,
  docs            jsonb NOT NULL DEFAULT '[]',   -- [{label,url}]
  enrichment      text NOT NULL DEFAULT 'none'
                  CHECK (enrichment IN ('none','auto','reviewed')),

  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  checked_at      timestamptz NOT NULL,
  CONSTRAINT open_calls_source_key UNIQUE (source, source_key),
  CONSTRAINT open_calls_exact_has_close
    CHECK (date_precision <> 'exact' OR closes_at IS NOT NULL),
  CONSTRAINT open_calls_indicative_no_close
    CHECK (date_precision <> 'indicative' OR (closes_at IS NULL AND period_label IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_open_calls_close    ON open_calls (closes_at);
CREATE INDEX IF NOT EXISTS idx_open_calls_source   ON open_calls (source, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_calls_audience ON open_calls USING gin (audience);
CREATE INDEX IF NOT EXISTS idx_open_calls_title_trgm
  ON open_calls USING gin (title gin_trgm_ops);

-- Per-source crawl stamp. One row per source; this is what the UI's freshness
-- banner reads. Separate from the rows so a source that returned ZERO rows is
-- still distinguishable from a source that was never crawled.
CREATE TABLE IF NOT EXISTS open_calls_crawl (
  source        text PRIMARY KEY,
  crawled_at    timestamptz NOT NULL,
  rows_seen     int NOT NULL,
  ok            boolean NOT NULL,
  note          text
);
```

The two CHECK constraints are the enforcement half of invariant 2 — a parser that loses a
deadline cannot store the row as `exact`, and an indicative row cannot leak into a
deadline-driven query.

### `audience` — the filter that stops us recreating the noise

The source research found that most of ИСУН's 55 open procedures are for *конкретни
бенефициенти* (ministries, agencies, rail infrastructure, `Техническа помощ`). Showing them
undifferentiated to a small business reproduces the exact complaint from the Facebook group
("*от бизнес с чушкопеци до баничарници на Луната*").

Values: `business` · `farmer` · `municipality` · `ngo` · `individual` · `school` ·
`institution` · `unknown`.

Derivation rules, in order, from `beneficiaries_raw` + `title` + programme:
1. an explicit `Техническа помощ` / `Бюджетни линии` title → `institution`
2. `beneficiaries_raw` keyword map (`земеделски стопани`→farmer, `предприятия|МСП|микро`→business,
   `общини`→municipality, `юридически лица с нестопанска цел`→ngo, `физически лица`→individual,
   `висши училища|научни организации|гимназии`→school)
3. otherwise **`unknown`** — never a guess.

`unknown` renders as "не е уточнено" and is excluded from the "за бизнес" default view. Being
honestly unhelpful beats being confidently wrong about who may apply.

### Serving function (same file)

```sql
CREATE OR REPLACE FUNCTION open_calls_list(
  p_status   text DEFAULT 'open',          -- 'open'|'upcoming'|'indicative'|'all'
  p_audience text DEFAULT NULL,
  p_q        text DEFAULT NULL,
  p_limit    int  DEFAULT 100
) RETURNS TABLE (...) LANGUAGE sql STABLE AS $$
  SELECT …,
    CASE
      WHEN date_precision = 'indicative'                       THEN 'indicative'
      WHEN opens_at  IS NOT NULL AND opens_at  > now()         THEN 'upcoming'
      WHEN closes_at IS NOT NULL AND closes_at < now()         THEN 'closed'
      ELSE 'open'
    END AS status                                   -- ← invariant 1, computed here
  FROM open_calls
  WHERE …
$$;
```

Status is derived **in the function body**, so every consumer — route, browse table, AI tool —
inherits the property. No caller can opt out of it.

---

## 4. Files

```
scripts/opencalls/
  isun_fetch.ts        crawl listing + changed details → raw_data/opencalls/isun/ (gitignored)
  isun_parse.ts        PURE parse (HTML string → OpenCall[]); unit-tested on fixtures
  isun_parse.test.ts   fixtures under __fixtures__/ (committed HTML samples)
  sp2023_fetch.ts      download the XLSX → raw_data/opencalls/sp2023/
  sp2023_parse.ts      PURE parse (XLSX buffer → OpenCall[])
  sp2023_parse.test.ts
  audience.ts          beneficiaries_raw → audience[]  (pure, table-driven)
  audience.test.ts
  types.ts             OpenCall (shared by parsers + loader)
  write_snapshot.ts    OpenCall[] → data/opencalls/<source>.json  (COMMITTED, see below)

scripts/db/
  schema/pg/134_open_calls.sql
  load_open_calls_pg.ts

scripts/watch/sources/
  isun_procedures.ts   cadence daily
  sp2023_indicative.ts cadence weekly

functions/
  db_routes.js         + /api/db/open-calls
  db_table.js          + `open_calls` registry entry

src/
  data/opencalls/useOpenCalls.ts
  screens/funds/OpenCallsTile.tsx        band-1 companion on /funds
  screens/funds/OpenCallsScreen.tsx      /funds/calls browse
  routes.tsx                             + /funds/calls
```

**`data/opencalls/*.json` is COMMITTED**, and this is a deliberate departure from the
funds/agri precedent (gitignored, PG-only). Reasons specific to this dataset:
- it is ~55 + 11 rows, kilobytes — the size objection that drives PG-only for the 81,910-row
  contracts corpus does not apply;
- **git history then becomes a free archive of what was open when.** Nobody in Bulgaria
  publishes that, and it makes the corpus reproducible after the source rotates a GUID;
- it keeps the parse reviewable in a diff, which matters most in the first months.

It does **not** violate `feedback_no_json_from_pg` — that rule forbids generating JSON *from*
Postgres. Here JSON is the ingest artifact and Postgres is the serving layer, which is the
same direction as every other loader.

---

## 5. Phases

### Phase A — ИСУН spine (the only phase that must ship whole)

1. **`isun_parse.ts`** — pure. From the listing: `li[data-href^="/bg/s/Procedure/Info/"]`,
   text `CODE - NAME`, programme from the enclosing group node. From a detail page:
   `Начален срок` / `Краен срок` (`DD.MM.YYYY г. HH:MM ч.` → timestamptz, Europe/Sofia),
   objective paragraph, and doc links `a[href*="/Procedure/InfoDownload/"]` → `{label,url}`.
2. **`isun_fetch.ts`** — politeness is a requirement, not a courtesy (§6.1): one listing GET,
   then detail GETs **only** for GUIDs that are new or whose `Въпроси и отговори (Дата на
   актуализация: …)` moved. Serial, ≥1 s apart, descriptive User-Agent
   (`electionsbg-opencalls/1.0 (+https://electionsbg.com)`), `AbortSignal.timeout`.
   Tiers crawled: `/Active` → candidate `open`, `/PublicDiscussion` → `consultation`.
3. **`write_snapshot.ts`** → `data/opencalls/isun.json`.
4. **`load_open_calls_pg.ts`** — applies `005` (changelog) + `134` itself so a cold DB needs
   nothing else. **Stage merge, not TRUNCATE** (`scripts/db/lib/stage_merge.ts`;
   `reference_stage_merge_reload` — this table is on a serving path from the moment the route
   ships). Then `recordIngestBatch({ source: 'open_call', keyExpr: "t.source || ':' || t.source_key", … })`
   per `feedback_pg_changelog_required`, and an `open_calls_crawl` upsert.
5. **Two guards in front of the merge**, modelled on `load_kzk_decisions_pg.ts` — and here they
   are the difference between a bad deploy and an empty page:
   - **shrink guard**: `mergeFromStage` runs an anti-join DELETE, so a markup change that
     parses to 0 rows would silently empty the table and exit 0. Abort if the build shrinks the
     source's rows by >`SHRINK_TOLERANCE` (25%; the set is small and genuinely lumpy) unless
     `--allow-shrink`.
   - **parse-rate guard**: abort if >15% of listing rows failed to yield a detail parse.
   Both fail *before* the transaction opens, so a bad run costs nothing.
6. **npm scripts**
   ```
   opencalls:isun            tsx scripts/opencalls/isun_fetch.ts
   db:load:open-calls:pg     tsx scripts/db/load_open_calls_pg.ts
   db:load:open-calls:pg:cloud  DATABASE_URL=…5434… npm run db:load:open-calls:pg
   ```
7. **`db:refresh` membership** — the loader reads a **committed** JSON, so it belongs *in* the
   chain (not in `REFRESH_EXCLUSIONS`). Insert after `db:load:funds:pg`. No `ORDER_PAIRS` entry
   is needed: `open_calls` has no cross-table input. `refresh_coverage.test.ts` enforces
   membership automatically once the script exists.

### Phase B — ДФЗ / СП 2023–27 indicative calendar

`sp2023_fetch.ts` downloads `https://www.sp2023.bg/images/IGG/Актуализиран_ИГГ_2026.xlsx`
(verified 200, 21,839 bytes); `sp2023_parse.ts` maps sheet `ЕЗФРСР` columns →
`budget_eur` (parse `€` amounts from `БЮДЖЕТ ЗА ПРИЕМ`, keep the raw string in `budget_note`
— several rows are prose like *"остатъчният бюджет след…"*), `beneficiaries_raw` ←
`БЕНЕФИЦИЕНТИ`, `period_label` ← `ПЕРИОД НА ПРИЕМ`, `aid_rate_pct` ←
`РАЗМЕР НА ФИНАНСОВАТА ПОМОЩ`, `grant_max_eur` ← `РАЗМЕР НА РАЗХОДИТЕ ЗА ЕДИН ПРОЕКТ`,
`territory` ← `ТЕРИТОРИАЛЕН ОБХВАТ`. All rows `date_precision='indicative'`.

**The filename carries a year and the word „Актуализиран" — it will change.** Resolve the
link by scraping the schedule page for `a[href$=".xlsx"]` rather than hardcoding, and fail
loudly if zero or >1 candidate is found.

This phase is what makes the feature answer the largest Facebook cluster (young farmers, small
holdings, agri processing) with real money figures.

### Phase C — enrichment: money + eligibility for ИСУН rows

ИСУН's page gives no budget, rate or max grant. Cheapest machine path is the short **`Обява за
откриване на процедурата`** document (not the multi-annex `Условия за кандидатстване`), fetched
from the `InfoDownload?fileKey=` URL already captured in `docs`.

Rules:
- extraction writes `enrichment='auto'`;
- **an `auto` money figure never renders as a figure** — the UI shows "не е публикувано тук"
  plus the document link until a human promotes the row to `enrichment='reviewed'`;
- reuse the grounded-number discipline from `project_ai_chat_grounding_gate` if an LLM does the
  extraction: a figure that cannot be quoted from the document is dropped, not rounded.

At ~55 rows, hand-curation is a legitimate alternative and probably faster to trust. Decide at
implementation time; the `enrichment` column supports either.

### Phase D — АХУ + АЗ (post-spine)

АХУ: ~6 programme pages under `ahu.mlsp.government.bg` (`Самостоятелна стопанска дейност`,
`Достъпна среда`, `чл.49 работодатели`, `Рехабилитация и интеграция`, `НПЗ чл.44`, `ЦЗЗ`).
АЗ: calls are **news items** (`az.government.bg/bg/news/view/…`), so this needs a feed scrape
plus a classifier and is the least reliable arm — schedule it last and label its rows'
provenance clearly.

### Phase E — serving + UI

**Route `/api/db/open-calls`** in `functions/db_routes.js`. Degrade contract, copied exactly
from the 123/124 precedent in `CLAUDE.md`:
- degrade to an **empty list** on `42P01` (table absent), `55000` (present, unpopulated),
  `42501`, `55P03`;
- **`57014` must NOT be in the degrade set** — that is the pool's own `statement_timeout`, and
  falling back after burning the full budget turns a 10 s failure into a 20 s one;
- log `oc:not-built` / `oc:read-failed` once per process.

**`db_table.js` registry entry** `open_calls` for the `/funds/calls` browser — following the
`admin_services` shape (small table, text search on `title`, `in` facets on `source` /
`audience` / `status`, `range` on `closes_at`):

```js
open_calls: {
  base: "open_calls_table",           // view wrapping open_calls_list('all')
  scopeCols: [],
  columns: {
    id: { type: "int" },
    title: { type: "text", sort: true, filter: "text", search: true },
    code: { type: "text", filter: "text" },
    status: { type: "text", sort: true, filter: "in" },
    audience: { type: "text", filter: "in" },
    source: { type: "text", filter: "in" },
    closes_at: { type: "date", sort: true, filter: "range" },
    budget_eur: { type: "number", sort: true, filter: "range", agg: "sum" },
  },
  select: ["id","title","code","status","audience","source","closes_at","budget_eur"],
  defaultSort: [["closes_at", "asc"]],   // soonest deadline first — the useful order
  aggregates: [{ fn: "count" }],
  maxPageSize: 100,
}
```

**UI.** Two surfaces, both honouring `feedback_no_tabs_ux` (tiles/stacked sections, no tabs)
and the shared Radix `Select` rule:
- `OpenCallsTile` — the band-1 companion on `/funds`: соonest-closing calls for the chosen
  audience, count by audience, and the freshness line.
- `/funds/calls` — the full browse (`DbDataTable`), default sort soonest deadline.

**Freshness is a UI requirement, not telemetry.** Read `open_calls_crawl`; render
`проверено на <ts>`; and if the newest successful crawl is older than the SLA (48 h for ИСУН),
**say so in place of implying the list is current**.

`indicative` rows render in a visually separate section headed „Очаквани приеми" with
`очаква се` wording — never in the same list as dated calls, never with a countdown.

**Prerender / sitemap:** `/funds/calls` gets a static index page (BG + EN) via
`scripts/sitemap/route_defs.ts`. **Individual calls get no page and no `<loc>`** — §2.

### Phase F — watcher + skill wiring (ships with A)

- `scripts/watch/sources/isun_procedures.ts` — `cadence: "daily"`, `publishes: "irregular"`;
  fingerprint = `sha256Short(sorted GUID set)` + row count + max Q&A-update stamp; `detail`
  like `"55 отворени · 3 нови · 1 затваря след 6 дни"`. `cadence.test.ts` accepts
  daily/irregular.
- `scripts/watch/sources/sp2023_indicative.ts` — `cadence: "weekly"`, fingerprint on the XLSX
  bytes hash + row count.
- **New skill `.claude/skills/update-open-calls/SKILL.md`**, and two mapping rows in
  `.claude/skills/process-watch-report/SKILL.md` (`isun_procedures`, `sp2023_indicative` →
  `update-open-calls`), including the **cloud publish step** — per
  `reference_migrated_family_watch_reload`, a PG-served family whose watch skill lacks
  `db:load:*:cloud` goes stale on prod while local stays green. That is the single most likely
  way this feature rots.
- **`/data` map** — a `DatasetDef` entry in `scripts/data_map/model.ts` plus a `/data/sources`
  row, per `reference_two_changelogs`.

---

## 6. Responsibilities and risks

### 6.1 Crawl politeness (verified)

`robots.txt` checked on all four hosts on 2026-08-05:

| Host | robots.txt | Verdict |
|---|---|---|
| `eumis2020.government.bg` | none (404 → SPA shell) | no restrictions |
| `www.sp2023.bg` | Joomla defaults — `/administrator/`, `/api/`, `/cache/`… | our paths (`/index.php/bg/…`, `/images/IGG/*.xlsx`) allowed |
| `ahu.mlsp.government.bg` | none (404) | no restrictions |
| `www.az.government.bg` | CMS defaults — `/admin/`, `/core/`… | `/bg/news/` allowed |

Nothing we need is disallowed. Still: ≤56 requests/day, serial, ≥1 s apart, identifying
User-Agent, conditional detail fetches. A government host being technically crawlable is not a
licence to hammer it.

### 6.2 Risk register

| Risk | Mitigation |
|---|---|
| **ИСУН markup change → 0 rows parsed, table emptied** | shrink + parse-rate guards abort before the tx (§5.A.5); data test asserts a non-empty `isun` source |
| **A call closes earlier than published** | unavoidable from any source; mitigated by daily cadence, the per-row `source_url` ("проверете в ИСУН"), and never presenting us as the authority |
| **Crawler dies silently** | invariant 1 means expired rows self-hide; the freshness banner degrades the page; the watcher reports the source as `error` |
| **XLSX filename/URL rotates** | resolve via page scrape, fail loudly on 0 or >1 `.xlsx` candidate (§5.B) |
| **`indicative` mistaken for a deadline** | CHECK constraints forbid `closes_at` on indicative rows; separate UI section; separate wording |
| **Institutional procedures shown as opportunities** | `audience` facet, `unknown` never claimed as eligible (§3) |
| **Prod goes stale while local is green** | cloud publish step written into the skill (§5.F) — the `reference_migrated_family_watch_reload` failure class |
| **Enrichment publishes an unverified € figure** | `enrichment='auto'` never renders as a figure (§5.C) |

### 6.3 Not advice

An `audience` tag or a parsed eligibility line is an **indication to check against the official
`Условия за кандидатстване`**, never a determination. The UI says so once, near the filter, not
buried in a footer.

---

## 7. Tests and gates

| Layer | File | Asserts |
|---|---|---|
| unit | `scripts/opencalls/isun_parse.test.ts` | committed HTML fixtures → exact timestamps (incl. Europe/Sofia offset), doc links, codes; a fixture with a missing `Краен срок` is rejected, not defaulted |
| unit | `scripts/opencalls/sp2023_parse.test.ts` | the 11 rows; `II.Д.1` → €68,716,487.50 / 18–40 / 100% / €40,000; every row `indicative` |
| unit | `scripts/opencalls/audience.test.ts` | `Техническа помощ`→institution; `земеделски стопани`→farmer; unmapped→`unknown` |
| **data** | `scripts/db/tests/open_calls.data.test.ts` | **no row where computed status = `open` and `closes_at < now()`** (invariant 1) · every row has `source_url` · exact ⇒ `closes_at` present · indicative ⇒ `closes_at` NULL · `isun` source non-empty · `open_calls_crawl` fresher than the SLA · `open_calls_list` under a buffer ceiling (`reference_pg_query_performance`) |
| functions | `functions/db_routes.opencalls.test.js` | degrades on 42P01/55000/42501/55P03; **rethrows 57014**; logs once per process |
| chain | `scripts/db/refresh_coverage.test.ts` | `db:load:open-calls:pg` is in `db:refresh` (automatic once the script exists) |
| cadence | `scripts/watch/cadence.test.ts` | daily vs irregular sampling invariant |
| SEO | `scripts/sitemap/families.data.test.ts` | `/funds/calls` `<loc>` resolves to real `dist/` HTML; **no per-call `<loc>` exists** |

The data test deliberately does **not** skip when the table is empty on the `isun` source —
that is one of the two states it exists to catch.

---

## 8. Deploy order

Hosting-before-function is the one ordering that breaks a working page (`CLAUDE.md`), and the
migration must precede its writer:

```bash
# 1 — migration + first load on Cloud SQL (the loader applies 005 + 134 itself)
npm run db:load:open-calls:pg:cloud

# 2 — the function that serves it
npm run deploy:db

# 3 — hosting (the /funds/calls page + the tile)
npm run deploy
```

The route degrades a missing table to an empty list, so steps 2–3 are safe in either order on
a *first* deploy — but step 1 first keeps the page non-empty from the moment it is reachable.

Recurring, per `update-open-calls`:
```bash
npm run opencalls:isun && npm run db:load:open-calls:pg      # local
npm run db:load:open-calls:pg:cloud                           # prod — NOT automatic
```

---

## 9. Sequencing and estimate

| Step | Deliverable | Depends on |
|---|---|---|
| A1 | `134_open_calls.sql` + `types.ts` | — |
| A2 | `isun_parse.ts` + fixtures + unit tests | A1 |
| A3 | `isun_fetch.ts` + `write_snapshot.ts` → committed `data/opencalls/isun.json` | A2 |
| A4 | `load_open_calls_pg.ts` (stage merge, both guards, changelog, crawl stamp) | A3 |
| A5 | npm scripts + `db:refresh` membership + `open_calls.data.test.ts` | A4 |
| B | sp2023 fetch/parse/tests → `data/opencalls/sp2023.json` | A1, A4 |
| E1 | `/api/db/open-calls` + degrade test | A5 |
| E2 | `db_table.js` entry + `open_calls_table` view | A5 |
| E3 | `OpenCallsTile` on `/funds` + `/funds/calls` + i18n + freshness banner | E1, E2 |
| E4 | prerender/sitemap for `/funds/calls` + SEO gate | E3 |
| F | watcher sources + `update-open-calls` skill + process-watch-report rows + `/data` map | A5, B |
| C | enrichment (auto → reviewed) | A5 |
| D | АХУ + АЗ | F |

A+B+E+F is the shippable unit — it answers "what can I apply to right now, and roughly what's
coming in agriculture" with correct dates and honest gaps. C and D widen coverage afterwards.

---

## 10. Decisions I am taking as read (flag now if wrong)

1. **`data/opencalls/*.json` is committed** (§4) — departs from the funds/agri PG-only
   precedent, justified by size and by the archive value. Say so now if you'd rather keep the
   `data/` tree free of it.
2. **No per-call pages, ever** (§2) — costs some long-tail SEO; refuses to publish a page that
   becomes actively misleading on a known date.
3. **`/funds/calls`, not a top-level route.** Open calls are a funds sub-module; band 1 on
   `/funds` is the entry point. A top-level `/calls` would earn its own impressions but splits
   the story from the awarded corpus that gives it base rates.
4. **v1 has no alerts.** It is the most-wanted feature in that Facebook group and needs an
   account system; designing it in now would delay the spine.
