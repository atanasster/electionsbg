# Module front pages v1 — turning hubs from a rendered menu into a daily front page

Status: **proposal / strategy**, not yet an implementation plan. Drafted 2026-08-02.
Companion to [cross-linking-strategy-v1.md](cross-linking-strategy-v1.md) — that one is about
*joining* the verticals, this one is about *fronting* them.

---

## 1. Diagnosis — what the hubs are today

Every hub in the app is the same object: `TileHubGrid` over a static registry.

| Hub | Source of truth | Tiles | Anything that changes day to day? |
|---|---|---|---|
| `/governance` | `governanceRegistry.ts` | 18 in 4 bands | **No** — no metrics at all |
| `/procurement` | `SUBPAGES` in `ProcurementScreen.tsx` | 11 + sector strip | Numbers only, per `?pscope` |
| `/consumption` | inline in `ConsumptionScreen.tsx` | 16 in 4 bands | Numbers only |
| `/parliamentary/analysis` | `analysisRegistry.ts` | ~12 | Numbers only, per election |
| `/parliamentary/reports` | `reportsHubRegistry.ts` | matrix | Numbers only |
| `/parliament` | hardcoded JSX, no registry | 7 preview tiles | Only when a new session lands |
| `/` (elections) | `DashboardCards` | map + cards | Only per election |
| `/local/:cycle` | per-cycle screen | leaderboards | Only per cycle |

So: **the hub is a menu that has been drawn as cards.** It answers "where can I go", never
"what happened". A returning visitor sees the identical page they saw yesterday, which is
the precise reason there is no reason to return.

### The finding that makes this cheap to fix

The data underneath is already at newspaper cadence, and the news components already exist —
they are just filed one level *below* the front page.

Measured on local Postgres + `data/`, 2026-08-02:

| Stream | Freshest record | Volume | Where it surfaces today |
|---|---|---|---|
| Contracts | `2026-07-31` | 2,814 signed in last 30d; **119–271 newly ingested per normal day** | `LatestContractsTile` — on `/procurement/**overview**`, not the hub |
| Tenders | `2026-07-31` | 1,543 published in 30d; **1,376 with a future deadline** | `LatestTendersTile` — same, one click too deep |
| Annexes | daily | 108 first-seen in 14d | nowhere |
| Prices | `2026-07-31` | daily full basket | `/consumption/deals` only |
| Roll-call votes | `2026-07-31` | per plenary day, with item titles + topics + tallies | `/votes`, and a static tile |
| КЗК appeals | `2026-06-25` | 70 in 90d | `RecentAppealsTile`, also on overview — **and 5 weeks stale** |
| Partial local elections | 392 events | several per year | `/local/chmi` |
| Company / officer changes (ТР) | `2026-07-30` | 260 + 213 in 14d | nowhere |

And there is already a **complete newsroom wire in the database that no frontend consumes**:

```
recent_updates(14, 1000)  →  contract 265 · company 260 · officer 213
                             tender 147 · procurement_annex 108 · dataset 7
```

`recent_updates(days, limit)` (`007_query_builders.sql:95`) returns
`kind · id · eik · name · detail · changed_at · amount_eur`, is served at `/api/db?fn=recent`,
already distinguishes a real daily delta from a bulk backfill (the `summarised` CTE), and has
265 days of `changelog_days` history behind it. `grep` finds **zero** callers in `src/`.

**We do not need to build a news pipeline. We need to point the front pages at the one we have.**

---

## 2. Two honesty constraints, measured, that shape the whole design

These are not caveats to bolt on later — they decide the copy and the sort order.

### 2.1 "Latest" is not "today". The source is ~5 weeks behind.

For contracts genuinely signed in the last 90 days, the gap between `contracts.date` (signed)
and `contract_first_seen.first_seen_at` (when we saw it) is:

```
median 33 days   ·   p90 51 days   ·   n = 11,381
```

So a "Последни договори" rail that says *today* is wrong. Two consequences:

- The card shows the **event date** ("подписан на 26 юни"), and the rail's kicker says
  **"публикувано тази седмица"** — those are different facts and both are true.
- The lag is itself a story we are uniquely able to tell: *"средно 33 дни минават между
  подписването на договор и публикуването му."* That belongs on the procurement front page as a
  recurring stat, not buried. Nobody else in BG publishes it.

### 2.2 A backfill is not news.

On 2026-07-20 the ingest first-saw **46,725** contracts; on a normal day it is 119–271. A naive
"newest by `first_seen_at`" feed shows a wall of 2011 contracts the morning after any backfill.
`recent_updates` already solves this (`rows_new > 500` → one summary line per source-day), and
any new feed **must** reuse that rule rather than re-inventing it.

---

## 3. The model: view → module → sub-module → record

Name the levels, then make every level look the same everywhere.

```
VIEW        Управление · Избори · Местни избори · Парламент · Потребление
  └ MODULE      a front page   /procurement · /budget · /parliament · /consumption · /funds
      └ SUB-MODULE  a destination  /procurement/contracts · /procurement/contractors
          └ RECORD      a thing       /contract/:id · /person/:slug · /company/:eik
```

Today "module" and "sub-module" are the same object (a tile in a grid). The proposal is that a
**module gets a front page template** and a sub-module stays a tile.

### The five-band module template

Every module front page uses the same bands, in the same order, so the layout is learnable once
and reused nineteen times. Bands are optional; the order is not.

| # | Band | BG label | What it is | Changes |
|---|---|---|---|---|
| 0 | **Wire** | *(no heading — one line)* | one-line ticker: "днес: 146 нови договора · 41 поръчки · 3 анекса" → `/data/updates` | daily |
| 1 | **Lead** | Водещо | 1 editorially-weighted item, full width: the biggest new contract, the vote that split a party, the sharpest price move | daily/weekly |
| 2 | **News rail** | Ново · Предстои | 3–4 `NewsCard`s, horizontal scroll on mobile | daily |
| 3 | **Explore — core** | Разгледай | 4–6 tiles, the high-intent destinations | never |
| 4 | **Explore — more** | Още в модула | the long tail, visually quieter | never |
| 5 | **For you** | За теб | watchlist · my area · my basket · following | per user |
| 6 | **Footer** | Данни и метод | sources, last updated, methodology | per ingest |

Bands 3–4 are what exists today, split in two and reordered. Bands 0–2 and 5 are new.

Two rules that keep this from becoming a dashboard:

- **The lead is one item, not a chart.** If a band needs a legend it belongs on a sub-page.
- **A module with no daily stream skips bands 0–2 rather than faking them.** Elections and
  declarations are episodic; a stale "Ново" is worse than none. See §6.

---

## 4. The tile, upgraded — stock · flow · change

`InfographicTile` today carries one `metric` + `metricCaption`. From the screenshot:
**"13 182 / Договори / Сключени договори"** — one number, three words, no motion.

Proposed grammar, three slots, each optional:

| Slot | Question | Example | Where |
|---|---|---|---|
| **stock** | how much is there? | `13 182` | the big overlay number (unchanged) |
| **flow** | in what unit does it matter? | `€2,8 млрд.` | new stat strip, card layout only |
| **change** | is it moving? | `+146 тази седмица` | new delta chip, both layouts |

Rendered:

```
┌──────────────────────────────┐
│  ▁▃▅ scene ▇▅▃               │
│  13 182                      │   ← stock (exists)
│  ДОГОВОРИ                    │   ← caption (exists)
├──────────────────────────────┤
│  Договори          ▲+146 нед.│   ← title + change chip (new)
│  Всеки договор, сключен от   │
│  държавата: кой го спечели,  │   ← blurb (new, replaces the 3-word desc)
│  за колко и по каква процедура│
│  €2,8 млрд. · 3 197 фирми    │   ← flow strip (new)
│  разгледай →                 │
└──────────────────────────────┘
```

### Concrete second numbers, per procurement tile

All of these are one extra field in `hub_stats.json`, computed by the generator that already
runs offline (`scripts/db/gen_procurement/hub_stats.ts`) — no live query, no new route.

| Tile | stock (today) | flow (proposed) | change (proposed) |
|---|---|---|---|
| Обзор | €2,8 млрд. | 13 182 договора | Δ% vs предх. период |
| Договори | 13 182 | €2,8 млрд. · среден €213k | +N публикувани тази седмица |
| Изпълнители | 3 197 | €X към топ 10 (=Y%) | +N нови изпълнители |
| Поръчки (процедури) | 5 622 | €X прогнозна стойност | **N с изтичащ срок ≤7 дни** |
| Свързани лица | 107 | €X спечелени от свързани фирми | +N нови връзки |
| Жалби | 420 | N уважени (Y%) | +N нови решения |
| НПО | 331 | €X финансиране | — |
| По място | 330 | €X на жител, медиана | — |
| Сигнали за риск | 714 | €X засегната стойност | +N нови сигнала |
| Проектни досиета | N досиета | €X проследени | — |
| Моят списък | N следени | N с нова активност | (already live) |

The "изтичащи срокове" number on the Поръчки tile is the single most actionable figure on the
whole page for a business visitor, and it is one `WHERE submission_deadline BETWEEN now() AND
now()+7d` away — 1,376 tenders already carry a future deadline.

### Descriptions

Current descs are ≤6 words and label the page ("Сключени договори"). Proposal: two tiers.

- `desc` — stays, ≤6 words, used by the **mobile row** where there is no room.
- `blurb` — new, 100–160 chars, card layout only, answers *"what question does this page answer
  for me?"* Written as a promise, not a label.

| Tile | today | proposed blurb |
|---|---|---|
| Договори | Сключени договори | Всеки договор, сключен от държавата: кой го спечели, за колко, по каква процедура. Търси по фирма, възложител или предмет. |
| Изпълнители | Фирми, спечелили поръчки | Класация на фирмите по спечелени публични пари — с дял на пазара, свързаност с политици и история на обжалванията. |
| Свързани лица | Депутати и длъжностни лица | Депутати, министри и общински съветници, чиито фирми печелят обществени поръчки — с размер и възложител. |
| По място | По община и област | Колко публични пари влизат във всяко населено място — на жител, спрямо съседите и през годините. |
| Сигнали за риск | КЗК · обжалвани поръчки | Поръчки с признаци за проверка: един кандидат, повтарящ се изпълнител, анекс над 50%. **Сигнал, не нарушение.** |

That last bold clause is not decoration — see §7.

---

## 5. Ordering: core first, fringe last

### 5.1 How to decide the order (and being honest that I cannot measure it from here)

There is no analytics export in the repo, so any ordering I give is a **hypothesis**. The design
response is to make the order a one-line data change:

- add `weight: number` and `tier: "core" | "more"` to every hub registry entry;
- order bands by `weight` at render time, never by array position;
- revisit `weight` from Search Console + GA once bands 3/4 ship.

The one hard piece of evidence we do have (`project_seo_discovery_gap`, GSC Nov 2025–May 2026):
`/party`, `/sections`, `/articles`, `/reports`, `/sofia` earn impressions; procurement, budget,
funds, indicators, parliament, votes, governments, connections earned **zero** — because the
homepage body linked to none of them. That is a discovery fact, not a demand fact, so it argues
for *promoting* the money modules, not demoting them.

### 5.2 The ordering principle

**Look-up beats read.** People arrive wanting to find a thing (a company, their town, a
contract). Analytical dashboards are a destination you reach *after* the look-up, not an entry
point. Today `/procurement` opens with **Обзор** (analysis) as tile #1 — that is backwards.

Ranking rule, high to low:
1. **Search/browse a record** (contracts, contractors, persons, products)
2. **My thing** (my area, my watchlist, my basket)
3. **A ranked list** (leaderboards, by place)
4. **A risk/story view** (flags, connections)
5. **An analytical dashboard** (overview, concentration, benchmarks)
6. **A tool** (simulator, calculator)
7. **Methodology / meta**

### 5.3 Proposed order, per module

**`/procurement`** *(today: Обзор · Договори · Изпълнители · Свързани · Поръчки · Жалби · НПО · По място · Сигнали · Досиета · Списък)*

| Band | Tiles |
|---|---|
| Ново | последни договори · нови обявени поръчки · **изтичащи срокове** · нови анекси |
| Търси (core) | Договори · Изпълнители · Поръчки · По място |
| Анализ и риск | Сигнали за риск · Свързани лица · Обзор |
| Още | Възложители · Жалби (КЗК) · НПО · Проектни досиета |
| За теб | Моят списък · Моят регион |
| Сектори | (keep the FeaturedStrip as-is — it works) |

**`/governance`** *(today: 4 bands, 18 tiles, of which 8 are indicator themes)*

The indicators band is the largest area on the page and the least-used content on the site. It
outranks procurement and budget purely by tile count.

| Band | Tiles |
|---|---|
| Ново | cross-module wire: 3 items drawn from every module (see §8) |
| Пари | Обществени поръчки · Бюджет · Еврофондове · **Субсидии** · Сектори |
| Хора и власт | Хора · Парламент · **Свързани лица** · Декларации · Правителства |
| Показатели | **one** Показатели tile + a compact inline link row for the 6 themes + Демография + Сравнение с ЕС |
| Инструменти | Данъчен калкулатор · Симулатор на бюджета |
| Национален преглед | (keep) |

Two gaps found while reading `governanceRegistry.ts`: **`/connections` and `/subsidies` are not
tiles on the governance hub at all** — `/connections` is arguably the most distinctive page on
the site (162k-edge graph) and is reachable only from procurement and the menu.

**`/consumption`** — already the best-ordered hub. Two changes: hoist **Моята кошница** into the
lead slot (highest-frequency personal intent, currently 8th), and add the news rail.

| Band | Tiles |
|---|---|
| Ново | най-голямо поскъпване (7д) · най-голямо поевтиняване · промоции днес · нов ИПЦ |
| За теб | Моята кошница · Промоции · Моят регион |
| Разгледай цените | Продукти · Категории · Вериги · Карта · € на килограм · Кошница |
| Анализи | Анализ · Виновно ли е еврото · Инфлация · Достъпност |
| Спрямо Европа | ЕС · Горива · Ток · Газ |

---

## 6. News tiles per module — what is real, what is not

Feasibility: **A** = data already in PG/`data/`, query only · **B** = needs a precompute ·
**C** = needs new ingest.

### 6.1 Обществени поръчки — genuine daily cadence

| Tile | Source | Feas. |
|---|---|---|
| Последни договори | `LatestContractsTile` **already built** — move to hub | A |
| Нови обявени поръчки | `LatestTendersTile` **already built** — move to hub | A |
| Изтичащи срокове (≤7 дни) | `tenders.submission_deadline` — 1,376 future | A |
| Нови анекси | `procurement_annexes` — 108/14d. *"Цената скочи с X% след подписването"* — the best recurring scoop we own | B |
| Нови сигнали за риск | `risk_grade ∈ D..F` ∩ first-seen ≤7d | B |
| Нови решения на КЗК | `RecentAppealsTile` **already built** — but source is 5 weeks stale; fix ingest before promoting | A + ingest |
| Средно закъснение на публикуване | §2.1, 33 дни median | A |

### 6.2 Парламент — daily while in session

| Tile | Source | Feas. |
|---|---|---|
| Последни гласувания | `public/parliament/votes/sessions/YYYY-MM-DD.json` — item titles, topics, tallies, fresh to 2026-07-31 | A |
| Приети закони | final-adoption (second-reading) items only — the convention is already established (`feedback_article_vote_links`) | A |
| Разцепления | `derived/dissents.json` — *"кой гласува срещу своята група"*, the most newspapery recurring item we have | A |
| Отсъствия тази седмица | `derived/attendance.json` | A |
| Внесени законопроекти | not ingested | C |

### 6.3 Потребление — daily

| Tile | Source | Feas. |
|---|---|---|
| Най-голямо поскъпване / поевтиняване (7д) | `price_product_days` / `price_payloads` | B |
| Промоции днес | `/consumption/deals` **already built** | A |
| Нов ИПЦ | `data/macro.json` monthly | A |
| Кошницата днес vs 2 януари | `price_payloads` overview | A |

### 6.4 Местни избори — episodic but recurring

| Tile | Source | Feas. |
|---|---|---|
| Последни частични избори | `data/local_chmi_history.json` — 392 dated events | A |
| Предстоящи частични избори | ЦИК announcement feed | C |
| Нови решения на общински съвети | `update-council-minutes` skill / `data/council/` | A |

### 6.5 Парламентарни избори — **not a daily module, and should not pretend to be**

The last election was 2026-04-19; the next is unscheduled. Its cadence is *publication*-driven,
not data-driven. So band 2 here carries **what we published**, not what happened:

| Tile | Source | Feas. |
|---|---|---|
| Ново в анализите | `public/articles/` (dated filenames) | A |
| Нови социологически проучвания | `data/polls/polls.json` (124 polls) | A |
| Частични избори от последните избори | chmi feed | A |
| Последни избори — резюме | `PollsLatestElectionTile` already exists | A |

And the lead slot stays the **map**. `/` is the highest-authority page on the site; the news
band goes *below* the existing `DashboardCards`, never in front of it.

### 6.6 Modules that get no news band

Декларации, Показатели, Демография, Сектори, Правителства, Бюджет (annual + monthly КФП only).
Give them bands 3–6 and a "последно обновено" line in band 6. **Do not manufacture a rail.**

---

## 7. Editorial rules — non-negotiable for an automated front page

The moment a feed puts a named company or person on a front page, we are publishing, not
displaying. Four rules, all derived from existing scar tissue in this repo:

1. **Signal ≠ finding.** Every risk item carries the word *сигнал* and links to methodology.
   `reference_risk_score_circularity` already establishes that the composite mixes procedural
   and vote-distribution signals; an auto-promoted "at risk" headline without that caveat is a
   defamation surface, not a feature.
2. **Event date, not ingest date** (§2.1). Never let a 2019 contract read as today's news.
3. **Backfill suppression** (§2.2). Reuse `recent_updates`' `summarised` rule; never re-invent
   the threshold.
4. **Named private individuals never auto-headline.** Public-figure roles (MP, mayor, minister,
   magistrate) yes; a company officer surfaced by a ТР delta, no — the company headlines, and the
   person is reachable one click in. The `person_browse_table` public-figure facet is the gate,
   and `graph_payloads.data.test.ts` already enforces the analogous rule on `/connections`.

---

## 8. Implementation shape

Extend the existing kit. Nothing here replaces `TileHubGrid` / `InfographicTile`.

### 8.1 Frontend

```
src/ux/infographic/
  InfographicTile.tsx      + blurb?: string
                           + stats?: { value: string; label: string }[]   // max 2, card only
                           + delta?: { value: string; dir: "up"|"down"|"flat"; label: string }
  NewsRail.tsx      NEW    heading + "виж всички →" + horizontal-scroll row
  NewsCard.tsx      NEW    kicker (time-ago + kind) · headline · meta · amount · tone
  LeadCard.tsx      NEW    the full-width band-1 item
  ModuleFrontPage.tsx NEW  composes bands 0–6 from a ModuleDefinition
```

**One normalized feed item type for every module** — this is the load-bearing decision. One
type → one component → nineteen modules:

```ts
export interface FeedItem {
  id: string;
  kind: string;                 // "contract" | "tender" | "deadline" | "vote" | "price_move" | …
  at: string;                   // ISO — the EVENT date (§2.1)
  seenAt?: string;              // ISO — when we ingested it; drives the "публикувано" kicker
  title: string;
  subtitle?: string;
  amountEur?: number;
  deltaPct?: number;
  to: string;                   // route
  badge?: string;               // "риск D" · "срок след 3 дни"
  tone?: "neutral" | "alert" | "positive";
}
```

Registries gain `weight`, `tier`, `blurbKey`, `feeds` — and the existing `hubRegistry.test.ts`
pattern extends to gate the new fields (a tile with a `feeds` entry that no route serves must
fail at commit time, exactly as a missing scene does today).

### 8.2 Serving — precompute, degrade, never 500

The scar tissue in `CLAUDE.md` is unambiguous: live per-request aggregates on a cold
`db-g1-small` hit the 10 s `statement_timeout` and 500. `procurement-overview` and
`procurement-flow` both did, which is why migration 124 exists.

So the feed follows the **123/124 pattern exactly**:

- one table `feed_payloads(module text, kind text, key text, payload jsonb)`, PK `(module,kind,key)`;
- refreshed by the loaders that move its inputs, declared in a `SCOPED_MATVIEWS`-style list so
  "the feed changed" and "the precompute matches" cannot be two states;
- one route `/api/db?fn=feed&module=…&kind=…` that is **one PK seek**;
- **degrades to an empty rail** on a missing/unpopulated table (`55000` in the degrade set,
  `57014` *not* — the exact two SQLSTATE details 123 had backwards), logging `feed:not-built`
  once per process. The front page must render fully without any feed.
- JSON-backed modules (parliament votes, chmi, articles, polls) emit a committed
  `data/<module>/feed.json` at ingest instead — no DB round trip.

### 8.3 Deltas

`db:gen-hub-stats` gains the `flow` and `change` fields. It already runs offline against local
PG and its output is committed + bucket-synced. Requirement to state loudly: **it must join the
daily ingest flow**, or the "change" chips freeze while the stock numbers move — the exact
"green locally, stale on prod" trap CLAUDE.md documents a dozen times.

### 8.4 Prerender / SEO

Hubs are prerendered (`scripts/prerender/`). A daily-changing rail baked into static HTML goes
stale between deploys. Rule: **bands 3–6 prerender, bands 0–2 are client-only.** That is also
the SEO-correct split — Google should index the durable tile grid and its blurbs (which is new
crawlable body text on exactly the zero-impression prefixes from
`project_seo_discovery_gap`), not a rail of ephemeral links.

---

## 9. Phasing

| Phase | Scope | New data? | Why this order |
|---|---|---|---|
| **0** | Tile grammar (`blurb` + `stats` + `delta`) and reordering on all existing hubs; `weight`/`tier` in the registries | none | Biggest visible gain per line changed; touches no backend; ships the crawlable blurb text that closes the discovery gap |
| **1** | `/procurement` front page: bands 0–2 wired to the **already-built** Latest/Tenders/Appeals tiles + the two new feeds (deadlines, annexes) | `feed_payloads` for 2 kinds | One module proves the template; procurement has the strongest daily stream and the components already exist |
| **2** | `/consumption` + `/parliament` front pages; `/parliament` rebuilt on a registry like every other hub | price movers (B), votes feed (A) | Two more daily streams; kills the last hardcoded hub |
| **3** | `/` (elections) and `/local/:cycle` — the episodic variant (publication-driven rail, map stays the lead) | chmi + articles + polls feeds (A) | Highest-authority pages, so they move last and least |
| **4** | `/governance` cross-module wire + a global **`/днес`** page: the whole corpus's day in one column | union over `feed_payloads` | Only worth building once ≥3 modules produce feeds |

Phase 0 alone changes how the site reads. Phases 1–4 are what make it worth opening daily.

---

## 10. Open questions for you

1. **Fifth view?** Парламент is currently a *module inside* Управление but has enough surface
   (votes, attendance, cohesion, similarity, embedding, dissents, MPs, declarations) to be a
   top-level view beside Избори / Местни избори. Promote it, or leave it nested?
2. **Is `/днес` a page or is it the homepage?** A cross-corpus daily column is the strongest
   "come back tomorrow" object we could build — but `/` is our SEO crown jewel and is currently
   the election map. Separate route, or a band on `/`?
3. **Lead selection: rules or editorial?** A rule ("largest new contract this week") is free and
   never wrong; a human pick is far better and does not scale. Suggest: rule-based by default,
   with a committed `data/leads.json` override that wins when present — the same shape as the
   pinned-post mechanism in the `naiasno-post` skill.
4. **Do we fix КЗК first?** `RecentAppealsTile` is built and its data is 5 weeks stale. Promoting
   a stale feed to a front page is worse than not having it — the `update-kzk-appeals` ingest
   should be green before phase 1 ships.
