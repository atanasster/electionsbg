# EU-funds module v2 — from open-calls ingest to the dashboard front page

Status: **implementation plan, approved scope, no code yet.** Drafted 2026-08-05.

**Supersedes and replaces** three earlier documents, consolidated here into one build:
`funds-dashboard-magazine-v1.md` (demand research + the magazine template),
`funds-open-calls-sources-v1.md` (source research), `funds-open-calls-ingest-v1.md`
(open-calls implementation). Recover them from git history if needed; everything
load-bearing is carried below.

Still separate and still live:
- [funds-seo-geo-v1.md](funds-seo-geo-v1.md) — the procedure grain and prerender work, partly
  shipped. This plan depends on it (`/funds/procedure/:code` exists because of it).
- [interreg-funds-ingest-v1.md](interreg-funds-ingest-v1.md) — **shipped** (migrations 137/138/139,
  `db:load:interreg:pg`, `/funds/interreg/:keepId`, `InterregTile` on `/funds`). Its own doc's
  "nothing implemented" header is stale. It is the authority on the Interreg corpus; this plan
  covers only how the funds module *integrates and displays* it — see §2.3, §4.4, §5.3.

Template source: [module-front-pages-v1.md](module-front-pages-v1.md).

---

## 0. The plan in one page

We measured what an EU-funds audience actually asks (a 113K-member Facebook group, 2026) and
found a clean mismatch: **their demand is forward-looking and personal — "can *I* get money?" —
while `/funds` is backward-looking and institutional — "who *got* money."** Not one of 47
question posts asked who received EU money.

Two things follow, and this plan does both:

1. **Ingest open calls.** A canonical, scriptable national source exists (ИСУН 2020
   `/bg/s/Procedure/Active`, 55 open procedures, server-rendered, no auth, exact deadlines),
   plus a structured ДФЗ agriculture calendar that carries the money and eligibility fields
   ИСУН omits. Neither alone answers a single question; together they answer most.
2. **Rebuild `/funds` as a module front page** on the five-band template — because the awarded
   corpus (81,910 contracts) supplies the thing an open call cannot: *base rates*. "Има ли
   одобрени?" is a statistical question asked socially because no statistical answer exists.

Open calls answer *what you can apply to now*; awarded history answers *what gets funded and
at what odds*. **The pair is the product.** Shipping either alone leaves the audience where the
Facebook group already is.

---

# PART I — WHY: the demand evidence

## 1.1 Method, and its limits

Read this before trusting any number in §1.2.

`facebook.com/groups/1129398573897982` („Европейски програми и проекти", 113.2K members,
public) **will not paginate its feed for a non-member**: Facebook renders 1–2 posts then serves
skeletons that never resolve, on both sort orders, while every GraphQL call returns 200. A
chronological census was not obtainable.

What worked: **in-group search with `Date posted = 2026`** as a URL filter — 16 queries across
the domain vocabulary. Yield: **~56 distinct 2026 posts — ~47 questions, ~9 supply-side.**

Three limits:
- Facebook caps group search at ~5 results/query — counts are of *distinct posts surfaced*, not
  group volume;
- ranking is recency-biased — this is recent 2026, not Jan–Aug evenly;
- the query set deliberately spanned both "can I get money" **and** "who got the money", so the
  §1.3 negative finding is not an artefact of what was searched for.

**A qualitative taxonomy with indicative weights is sound. A census it is not.**

## 1.2 The taxonomy

Categories overlap (a post can be A + C). Shares are of the ~47 question posts.

| # | Category | n | share | Answerable from our data? |
|---|---|---|---|---|
| **A** | **„Има ли програма за X?"** — activity × place × org form | **32** | **~68%** | **Not as asked. Adjacently, yes — and uniquely** |
| **C** | „Препоръчайте консултант" | 10 | ~21% | Partly, and carefully (§3.2 rule 5) |
| **B** | Eligibility mechanics (need a company first? barred 365 days?) | 7 | ~15% | As an empirical proxy, yes |
| **E** | **„Има ли одобрени?"** — base rates asked socially | 4 | ~9% | **Yes, fully. Nobody publishes this** |
| **F** | „Има ли въобще списък?" — navigation failure | 3 | ~6% | Yes for awarded; open calls after Stage 1 |
| **D** | „Реални ли са тези цифри?" — price/trust | 1–2 | ~3% | Convertible to arithmetic |
| **G** | **„Кой получи парите?"** — accountability | **0** | **0%** | Yes — and nobody asked |

Verbatim evidence for each category is in [Appendix A](#appendix-a--verbatim-demand-evidence).

## 1.3 The finding that reorders the page

**Zero of 47 posts asked who received EU money, what a municipality absorbed, or whether a
beneficiary was politically connected.** `усвоени средства` returned no exact-match post at
all; `измама` returned one — a consultant's own ad.

That is precisely the framing `/funds` leads with today. The conclusion is about **ordering, not
content**: demote the accountability tiles a band, do not delete them. `/funds/political` and
`/funds/integrity` are why the corpus is trustworthy and what distinguishes us from a
consultancy blog.

## 1.4 Competitive context (the ~9 supply-side posts)

- The **group's own admin** launched **Konsultiram.eu**, an AI pre-eligibility scorer, pitched
  on exactly categories A+B: *„Допустим ли е кандидатът? Какъв резултат при оценяването? Има ли
  реален шанс да бъде финансиран?"* The owner has already productised the demand.
- Consultancies post scheme announcements as marketing (HumanConsulting on the Стратегически
  план processing measure; Astra Solutions on МИГ innovation, *„до 102 500 евро… до 75%"*).
- A lawyer posts ЗОП/ЗУСЕСФУ explainers (методика за оценка, финансова корекция).
- **A member built a free monitor of „13+ официални сайта… ИСУН, ЦАИС ЕОП, ДФЗ"**
  (`tools.gdprcheck.bg`) with e-mail alerts.

**Read:** the *alerting* layer is being built by others. The unmet piece is the **historic
outcome corpus** — which is ours and hard to copy.

---

# PART II — WHAT WE CAN AND CANNOT ANSWER

## 2.1 The hard constraint

Before this plan, we ingest ИСУН's **awarded** registers only
(`scripts/watch/sources/isun_eu_funds*.ts` — beneficiary rollup + signed contracts) and there
is **no open-calls feed anywhere in the repo**. Stage 1 fixes that. What it does **not** fix:

> Even with open calls ingested, we are an **index**, not the authority. The application always
> happens at ИСУН/ДФЗ, every row links its primary source, and we never infer a deadline we did
> not read.

## 2.2 Source inventory (verified live 2026-08-05)

### Tier 1 — canonical, scriptable

**ИСУН 2020 — the open-procedures register.** `https://eumis2020.government.bg/bg/s/Procedure/Active`

| Property | Verified |
|---|---|
| Auth | none |
| Rendering | **server-side HTML** — no JS |
| Row selector | `li[data-href^="/bg/s/Procedure/Info/<GUID>"]`, text `CODE - NAME` |
| Open procedures | **55** · page 81 KB |
| Covers | 2021–2027 programmes (BG05SFPR*, BG14MFPR*, BG16FFPR*, BG16RFPR*, BG65*) |

Tiers: `/Active` 81 KB (**open**) · `/PublicDiscussion` 24 KB (draft guidance out for
consultation = **upcoming**, our earliest possible signal) · `/Ended` 2.4 MB ·
`/ArchivedPublicDiscussion` 1.2 MB · `/Groups` 27 KB (programme tree).
⚠ `Ended` / `ArchivedPublicDiscussion` did **not** yield rows with that selector despite their
size — different markup, unresolved. Irrelevant for v1; do not assume the selector generalises.

Detail page `/bg/s/Procedure/Info/<GUID>` (~30 KB, also server-rendered) carries code, name,
objective, and **exact timestamps** — verified on `BG16RFPR001-1.011`:
`Начален срок: 10.07.2026 14:00` → `Краен срок: 14.09.2026 16:30`. Documents are
machine-fetchable at `/bg/s/Procedure/InfoDownload/<procGUID>?fileKey=<fileGUID>`.

**Not on the page:** budget, co-financing %, min/max grant, eligible applicant type. All inside
`Условия за кандидатстване`. See §2.4 and Stage 7.

Two findings that shape the product, not just the pipeline:
- **МИГ/МИРГ calls are included** — `#hide_lag_procedures` is a client-side checkbox
  (unchecked by default), so the 55 contain them, including `BG16RFPR001-1.011`, **the exact
  call a consultancy was advertising in the group**. The source validates against observed
  demand. Whether each МИГ's own sub-call is listed, or only the parent, is unverified.
- **Most of the 55 are not for the public** — `Техническа помощ` ×4, `Бюджетни линии`, rail and
  road TEN-T, `Морско наблюдение`, `Контрол и правоприлагане`, border-police objectives,
  municipal desegregation programmes. These are *конкретни бенефициенти*. Publishing all 55
  undifferentiated reproduces the group's own complaint — *„от бизнес с чушкопеци до баничарници
  на Луната"*. Hence `audience` (§4.2) is a requirement, not polish.

**ДФЗ / Стратегически план 2023–27 — the agriculture forward calendar.**
`sp2023.bg/.../indikativen-grafik-za-priemi-prez-2026-g` → `Актуализиран_ИГГ_2026.xlsx`
(HTTP 200, 21,839 bytes). Not an HTML table — one XLSX, sheet `ЕЗФРСР`, **11 interventions**,
parsed clean. Columns:

`№ · ИНТЕРВЕНЦИЯ · ПРИНОС КЪМ СПЕЦИФИЧНА ЦЕЛ · ВИД НА ПОДКРЕПАТА · БЮДЖЕТ ЗА ПРИЕМ ·`
**`БЕНЕФИЦИЕНТИ`** ` · ТЕРИТОРИАЛЕН ОБХВАТ · ` **`ПЕРИОД НА ПРИЕМ`** ` · `
**`РАЗМЕР НА ФИНАНСОВАТА ПОМОЩ`** ` · ` **`РАЗМЕР НА РАЗХОДИТЕ ЗА ЕДИН ПРОЕКТ`**

This is the structure ИСУН lacks. The decisive row, verbatim:

> **II.Д.1 — Стартова помощ за установяване на млади земеделски стопани** — budget
> €68,716,487.50 · *„Земеделски стопани на възраст от 18 до 40 години"* · whole country ·
> **октомври–декември, не по-кратък от 60 дни** · aid **100%** · **40 000 евро, две плащания
> по 20 000 евро**

A complete answer to „*Програмата Млад фермер отворена ли е?*", asked three times.
⚠ The date is a **month range**, and the file is already an *„Актуализиран"* revision — it
moves. Forecast, never a deadline.

**ДФЗ прием announcements.** `dfz.bg/bg/web/guest/open-support-measures` (per-year nav shell;
rows one level down) — what converts an indicative month range into a real opening.

### Tier 2 — needed for coverage, one scraper each

| Source | Answers | Shape | Evidence |
|---|---|---|---|
| **АХУ** `ahu.mlsp.government.bg` | ТЕЛК/disability self-employment — **5 posts** | `/portal/page/4` + ~6 `Проекти/програми` subpages | 2026 конкурс opened **06.02.2026** |
| **Агенция по заетостта** `az.government.bg` | Youth / 55+ employment — **4 posts** | published as **news items**, not a register → feed scrape + classifier | „Младежка заетост+ Комп.2" from **16.02.2026**; repo already touches this host |

### Tier 3 — supplementary, and one useful negative

- **EU Funding & Tenders (SEDIA) API** — free-text **works** (`text=innovation` →
  `totalResults: 303121`, `apiVersion 2.150`); the structured `query` filter **500s** on all
  three shapes tried, with and without `sort`/`languages`. Reachable, not yet usable well.
  Lowest value for this audience — park it.
- **`eufunds.bg`** — a portal, not a source: its own "Отворени процедури" menu item points at
  `eumis2020.../Procedure/Active`. **That is the strongest available evidence that Tier 1 is
  canonical.** Residual value: programme context, `/bg/tender-procedures`.
- **The саниране cluster has no source because the programme does not exist yet.** Second-largest
  cluster (~6 posts). Verified: single-family Декарбонизация has **not launched** — expected
  **June 2026**, ~**€1.248bn** to 2029 via the National Decarbonisation Fund; fund manager to be
  selected by **30.04.2026**; guidance to appear on `mrrb.bg`. **"Nothing is open yet, here is
  when and where" is a valuable answer nobody in that group is giving**, and it costs nothing.
  Treat an authoritative negative as a first-class result.
- **`eufunds.media`** — private news site, prompt on these calls. Worth a watcher as a
  **discovery tripwire** (if it reports a call our crawlers missed, we have a hole). Never a
  citation source.

## 2.3 Interreg — a second awarded corpus, and a third open-calls source we do not have

Shipped since this plan was first drafted: **Interreg** (migrations 137/138/139,
`db:load:interreg:pg`, ~1,954 operations / 12,141 partnerships / €396.39m), plan in
[interreg-funds-ingest-v1.md](interreg-funds-ingest-v1.md). It changes three things here.

**(a) The awarded corpus is now two corpora, and „EU money" needs a declared basis.**
`fund_projects` (82,011 rows, €44bn, ИСУН + EEA/Norway) holds **zero** Interreg rows —
Interreg runs on **Jems**, not ИСУН, so the gap is a system boundary, not a filter. Migration
139 exists precisely to fold them: `funds_muni_combined_v` + a combined per-capita ranking.
Consequence for every figure this plan puts on a tile: **state which basis.** Measured harm
from getting it wrong — on a 5.5% sample, 29 municipalities gain money and **all 29 sit in a
border oblast**; Ветово moves +18 places on €/жител, Сапарева баня +17. An ИСУН-only
per-capita figure silently understates the poorest, most depopulated municipalities in the
country.

**(b) Interreg calls will never appear in ИСУН `/Active`** — same system boundary. So the
canonical source in §2.2 is canonical *for ЕСИФ*, not for all EU money reaching Bulgaria.
The programmes publish their own calls (Jems, and the МРРБ programme subdomains). This is a
**known hole in v1's open-calls coverage**, and it falls disproportionately on the border
municipalities — i.e. exactly the place-bound askers in §1.2. Two honest responses, in order:
say so in band 6 (we cover ЕСИФ + agri, not Interreg calls), and treat a Jems/МРРБ calls
scraper as the strongest **Stage 8** candidate alongside АХУ and АЗ. Do **not** let
`/funds/calls` imply completeness it does not have.

**(c) Interreg titles are English-only, and that constrains display.** keep.eu carried `{en}`
for 107 of 107 sampled operations, no `bg`. The shipped rule (interreg plan §7): store
`title_en` NOT NULL, `title_bg` NULL until a source exists, **never machine-translate**, and
render the English title on BG pages with a visible marker plus the keep.eu attribution.
Anything in this plan that mixes corpora — the resolver (Stage 4), the combined search tier,
a leaderboard — inherits that rule: an English row in a Bulgarian list must be marked, not
silently mixed and not invented into Bulgarian.

## 2.4 The structural finding

| | identity + dates | money + eligibility |
|---|---|---|
| **ИСУН `/Active`** | ✅ exact, to the minute | ❌ absent — inside DOCX/PDF |
| **СП 2023–27 XLSX** | ⚠️ indicative month range | ✅ budget · beneficiaries · % · max per project |

Two consequences:
1. **Neither source alone answers a Facebook question.** A v1 shipping only ИСУН produces
   institutional procedure names with dates and no money — no improvement for the asker.
2. **55 rows is small enough for a curated enrichment layer** — the opposite of the
   81,910-contract corpus. Cheapest machine path is the short **`Обява за откриване на
   процедурата`** doc, not the multi-annex `Условия`. See Stage 7.

## 2.5 The six reframings (what the awarded corpus answers)

| They ask | We answer, from data we already hold |
|---|---|
| „Има ли програма за X?" (A) | **„Финансирано ли е нещо като X"** — N contracts, which procedures, which firms, what sums: full-text over contract titles × org form × place |
| „Има ли одобрени?" (E) | **Base rates per procedure** — beneficiaries, median grant, status mix (приключен/прекратен), disbursement rate |
| „Трябва ли ми фирма?" (B) | **Org-form mix of actual winners** — „96% ЕООД/ООД, 3% ЕТ, 0 физически лица". Empirical proxy, labelled as such |
| „4000 € + 5% реални ли са?" (D) | **Median grant per procedure** → „5% от медианния грант тук = €X". Unanswerable trust question → arithmetic |
| „Кой може да ми помогне?" (C) | **Peers, not consultants** — who in *my* obshtina already won under this procedure (§3.2 rule 5) |
| Place-bound asks (Ямбол, Бургас, В. Търново, Перник/Кюстендил/Благоевград, „малко населено място") | Per-muni and per-EKATTE attribution + per-capita rank, already in `muni-map.json` |

---

# PART III — RULES

These are gating requirements, not caveats. Two families: the open-calls invariants (harder
than anything else we publish, because a missed deadline is a harm rather than a stale number)
and the editorial rules for an automated front page.

## 3.1 Open-calls invariants

**Invariant 1 — `open` is computed at QUERY time from `closes_at`, never stored at crawl time.**

| If… | Stored-status design | Query-time design (chosen) |
|---|---|---|
| crawler dies for a week | expired calls keep showing as **open** → harm | expired calls **vanish on their own**; new ones missing → merely incomplete |
| a call closes early | wrong until next crawl | wrong until next crawl (unavoidable; mitigated by §6.2) |

The worst failure mode becomes **under-reporting** — safe, and visible via the freshness stamp.
This is why the feature is publishable at all. Derived inside `open_calls_list()` so no
consumer can opt out. `open_calls.data.test.ts` asserts it.

**Invariant 2 — `date_precision` is a NOT NULL column with CHECK constraints, not a
convention.** `'exact'` (ИСУН) and `'indicative'` (ДФЗ month ranges) may never render through
the same component or the same word, and `'indicative'` may never populate `closes_at`.

**Invariant 3 — a past-deadline row disappears from „отворени"**, not greyed out. Carry a
visible `проверено на <ts>`; if the last successful crawl is older than the SLA (48 h for
ИСУН), **say so instead of implying the list is current**.

**Invariant 4 — always link the primary source, per row** (§2.1).

**Invariant 5 — filter by who may actually apply.** Until eligibility is populated, label
audience `unknown` rather than implying "you can apply" (§4.2).

**Invariant 6 — this is not advice.** A parsed eligibility line is an indication to check
against the official `Условия`, never a determination. Say it once, near the filter.

**Invariant 7 — a consultation is not a call.** `/PublicDiscussion` rows ship publicly
(decision §8.3.6) but `kind='consultation'` never appears in the same list as `kind='call'`.
A consultation's date is a **comment** deadline, not an application deadline; its figures are
**draft**; and it can be withdrawn or materially changed before opening. Its section says so,
and says what you *can* do now — comment on the draft guidance. The default view is
`kind='call'`.

**Invariant 8 — an unreviewed figure never enters a sortable or filterable numeric column.**
Stage 7 extraction may surface the **verbatim quote** it found (that is evidence) but must not
populate `budget_eur` / `grant_max_eur` / `aid_rate_pct` until a human sets
`enrichment='reviewed'` — otherwise an unverified number silently drives the page's ranking and
range filters.

## 3.2 Editorial rules for the front page

The moment a feed puts a named company or person on a front page we are publishing, not
displaying. All five derive from existing scar tissue.

1. **Signal ≠ finding.** Every risk item carries *сигнал* and links to methodology
   (`reference_risk_score_circularity`).
2. **Event date, not ingest date.** The awarded corpus lags: median **33 days**, p90 **51**,
   between `contracts.date` and first-seen (n=11,381). A card shows the event date; the rail's
   kicker says „публикувано тази седмица". Different facts, both true — and the lag is itself a
   story nobody else in BG publishes.
3. **A backfill is not news.** Reuse `recent_updates`' `summarised` rule (`rows_new > 500` →
   one line); never re-derive the threshold.
4. **Named private individuals never auto-headline.** Public-figure roles yes; a company officer
   surfaced by a ТР delta, no — the company headlines, the person is one click in.
5. **A beneficiary is not a suspect, and „peers" must not become a directory.** Showing *„7
   фирми в община Бургас са получили по тази процедура"* with names publishes a fact from a
   public register. Framing it as *„обърнете се към тях"* builds lead-gen on named private
   companies without consent. **Ship the fact; never the solicitation.**

---

# PART IV — DATA MODEL

## 4.1 Migration `142_open_calls.sql`

Highest existing is `141_shlyo_query_fold.sql`, so this is **142**. (An earlier draft of this
plan said 134 — that number was taken by `134_rollcall.sql` while this plan sat unbuilt, and
135–141 have since gone too. Re-check `ls scripts/db/schema/pg/ | tail -1` before creating the
file; a plan is not a reservation.)

```sql
CREATE TABLE IF NOT EXISTS open_calls (
  id              serial PRIMARY KEY,
  source          text NOT NULL,           -- 'isun' | 'sp2023' | 'ahu' | 'az'
  source_key      text NOT NULL,           -- ИСУН GUID | intervention code | slug
  code            text,                    -- BG16RFPR001-1.011 | II.Д.1
  -- 'call' = a real application procedure · 'consultation' = draft guidance out for
  -- public comment (ИСУН /PublicDiscussion). NEVER mixed in one list — invariant 7.
  kind            text NOT NULL DEFAULT 'call'
                  CHECK (kind IN ('call','consultation')),
  title           text NOT NULL,
  programme_code  text,
  programme_name  text,
  objective       text,

  -- DATES. exact ⇒ closes_at NOT NULL; indicative ⇒ closes_at NULL + period_label set.
  date_precision  text NOT NULL CHECK (date_precision IN ('exact','indicative')),
  opens_at        timestamptz,
  closes_at       timestamptz,
  period_label    text,                    -- "В периода октомври-декември, не по-кратък от 60 дни"

  -- MONEY / ELIGIBILITY. NULL until enrichment (Stage 7) — never guessed.
  budget_eur      numeric,
  budget_note     text,
  aid_rate_pct    numeric,
  grant_min_eur   numeric,
  grant_max_eur   numeric,
  beneficiaries_raw text,                  -- verbatim source text, always kept
  audience        text[] NOT NULL DEFAULT '{}',
  territory       text,

  source_url      text NOT NULL,
  docs            jsonb NOT NULL DEFAULT '[]',   -- [{label,url}]
  enrichment      text NOT NULL DEFAULT 'none'
                  CHECK (enrichment IN ('none','auto','reviewed')),
  -- Provenance for Stage 7: {model, extracted_at, doc_url, quotes:{field: verbatim}}.
  -- A field with no quote is never stored — see Stage 7's grounding gate.
  enrichment_meta jsonb NOT NULL DEFAULT '{}',

  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL,    -- last crawl that still found this row
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

-- Per-source crawl stamp — what the freshness banner reads. Separate from the rows
-- so "returned zero rows" stays distinguishable from "never crawled".
CREATE TABLE IF NOT EXISTS open_calls_crawl (
  source        text PRIMARY KEY,
  crawled_at    timestamptz NOT NULL,
  rows_seen     int NOT NULL,
  ok            boolean NOT NULL,
  note          text
);
```

The two CHECKs enforce invariant 2: a parser that loses a deadline cannot store the row as
`exact`, and an indicative row cannot leak into a deadline-driven query.

## 4.2 `audience` — the filter that prevents recreating the noise

Values: `business` · `farmer` · `municipality` · `ngo` · `individual` · `school` ·
`institution` · `unknown`. Derived in order from `beneficiaries_raw` + `title` + programme:

1. `Техническа помощ` / `Бюджетни линии` title → `institution`
2. keyword map on `beneficiaries_raw`: `земеделски стопани`→farmer · `предприятия|МСП|микро`→business ·
   `общини`→municipality · `юридически лица с нестопанска цел`→ngo · `физически лица`→individual ·
   `висши училища|научни организации|гимназии`→school
3. otherwise **`unknown`** — never a guess.

`unknown` renders „не е уточнено" and is excluded from the default „за бизнес" view. Being
honestly unhelpful beats being confidently wrong about who may apply.

## 4.3 Serving function

```sql
CREATE OR REPLACE FUNCTION open_calls_list(
  p_status text DEFAULT 'open',   -- 'open'|'upcoming'|'indicative'|'consultation'|'closed'|'all'
  p_kind   text DEFAULT 'call',   -- 'call'|'consultation'|'all'   (default excludes drafts)
  p_audience text DEFAULT NULL, p_q text DEFAULT NULL, p_limit int DEFAULT 100
) RETURNS TABLE (...) LANGUAGE sql STABLE AS $$
  SELECT …,
    CASE
      WHEN kind = 'consultation'                        THEN 'consultation'
      WHEN date_precision = 'indicative'                THEN 'indicative'
      WHEN opens_at  IS NOT NULL AND opens_at  > now()  THEN 'upcoming'
      WHEN closes_at IS NOT NULL AND closes_at < now()  THEN 'closed'
      ELSE 'open'
    END AS status                              -- ← invariants 1 + 7, computed here
  FROM open_calls WHERE …
$$;

-- The flat view the DbDataTable registry binds to (§6). Kept in this migration so
-- `base: "open_calls_table"` can never point at a relation that does not exist.
CREATE OR REPLACE VIEW open_calls_table AS
  SELECT * FROM open_calls_list('all', 'all', NULL, NULL, 100000);
```

## 4.4 Stage 4's precompute (the resolver)

The „финансирано ли е нещо като моето" resolver aggregates over the awarded corpus. It
**must** follow the 123/124 pattern in `CLAUDE.md`: precompute into one `fund_payloads` kind
(activity × place × org-form rollup at procedure grain), one PK seek per request, degrade to
empty. A free-text aggregate computed live on a `db-g1-small` is the exact shape that produced
the `procurement-overview` / `procurement-flow` 500s.

**It must span BOTH corpora — `fund_projects` ∪ `interreg_operations`/`interreg_partners`** —
and this is the one place where getting it wrong reintroduces the exact bias §2.3 measured. The
resolver's whole promise is "has anything like mine been funded near me"; built on ИСУН only it
answers **"no"** to a border-municipality asker whose neighbours have Interreg money, which is
worse than not answering at all. Three constraints follow:

- **Declare the basis in the payload**, not only in the UI — one field naming which corpora the
  rollup covers, so no consumer can render a combined figure as ИСУН-only or the reverse.
- **Tier L only for the EIK arm.** 2014-2020 Interreg carries no EIK (~a third of the money is
  unreachable by company), so an org-form breakdown over the Interreg arm is partial. That
  belongs in the caption, per the interreg plan's own rule.
- **English titles carry the §2.3(c) marker** wherever an Interreg operation appears in a
  Bulgarian result list. Never machine-translate to make the list look uniform.

The interreg plan's §4 rule — *do not write Interreg into `fund_payloads`* — is about not
polluting the **existing** ИСУН-basis payload kinds. A **new** kind whose declared basis is
"combined" is the intended way to serve both; `funds_muni_combined_v` (139) is the precedent.

---

# PART V — FILES AND BUILD STAGES

## 5.1 Files

```
scripts/opencalls/
  isun_fetch.ts        crawl listing + changed details → raw_data/opencalls/isun/ (gitignored)
  isun_parse.ts        PURE parse (HTML → OpenCall[]); unit-tested on committed fixtures
  isun_parse.test.ts   + __fixtures__/
  sp2023_fetch.ts      resolve + download the XLSX → raw_data/opencalls/sp2023/
  sp2023_parse.ts      PURE parse (XLSX buffer → OpenCall[])
  sp2023_parse.test.ts
  audience.ts          beneficiaries_raw → audience[]  (pure, table-driven)
  audience.test.ts
  enrich_extract.ts    Stage 7 — doc text → {field:{value,quote}}
  enrich_gate.ts       Stage 7 — deterministic quote-in-source check (the guarantee)
  enrich_gate.test.ts
  types.ts             OpenCall — shared by parsers + loader
  write_snapshot.ts    OpenCall[] → data/opencalls/<source>.json  (COMMITTED)

ai/tools/
  funds.ts             + openCalls tool          (registry.ts already has fundsOverview/Projects)

.claude/skills/
  update-open-calls/SKILL.md    crawl + load + the :cloud publish step
  enrich-open-calls/SKILL.md    Stage 7 — LLM extraction → review queue, never a direct write

scripts/db/
  schema/pg/142_open_calls.sql
  load_open_calls_pg.ts

scripts/watch/sources/
  isun_procedures.ts      cadence daily
  sp2023_indicative.ts    cadence weekly

functions/
  db_routes.js         + /api/db/open-calls          (+ the Stage 4 resolver route)
  db_table.js          + `open_calls` registry entry

src/
  data/opencalls/useOpenCalls.ts
  screens/funds/OpenCallsTile.tsx      band-1 companion on /funds
  screens/funds/OpenCallsScreen.tsx    /funds/calls browse
  screens/funds/FitResolverTile.tsx    Stage 4 — "финансирано ли е нещо като моето"
  routes.tsx                           + /funds/calls
```

**`data/opencalls/*.json` is COMMITTED** — a deliberate departure from the funds/agri PG-only
precedent, on three grounds specific to this dataset: it is ~66 rows of kilobytes (the size
objection driving PG-only for 81,910 contracts does not apply); **git history then becomes a
free archive of what was open when**, which nobody in Bulgaria publishes and which makes the
corpus reproducible after a source rotates a GUID; and it keeps the parse reviewable in a diff,
which matters most in the first months. It does **not** violate `feedback_no_json_from_pg` —
that forbids generating JSON *from* Postgres; here JSON is the ingest artifact and Postgres the
serving layer, the same direction as every other loader.

## 5.2 The `/funds` front page, in bands

`FundsScreen.tsx` today is the object [module-front-pages-v1.md](module-front-pages-v1.md) §1
diagnoses, plus one extra problem:

| Template band | `/funds` today |
|---|---|
| 0 Wire | **absent** |
| 1 Lead | 4 KPI cards — *an aggregate, i.e. analysis-first* |
| 2 News rail | **absent** |
| 3 Explore — core | **absent as a band. No search box anywhere on the page** |
| 4 Explore — more | 7 `DashboardSection`s in array order |
| 5 For you | **absent** |
| 6 Data & method | one-line `SourceFooter` ✅ |

Three failures: **look-up is impossible** (the ranking rule is *search a record > my thing >
ranked list > risk view > analytical dashboard*; `/funds` opens with the dashboard);
**the order is arbitrary** (Red flags and Focus outrank the leaderboards and the place split —
the 0%-demand framing outranking the 68% one); **every number is all-time and static**.

Target:

| Band | Content | Stage |
|---|---|---|
| **0 Wire** | `обновено 31 юли · N нови договора · €X новоподписани · N отворени процедури` → `/data/updates` | 5 |
| **1 Lead** | **two modules, side by side** — „Какво е отворено сега" (open calls, soonest first) + „Финансирано ли е нещо като моето" (the resolver) | 2, 4 |
| **2 News rail** | най-големи нови договори · процедури, приключили наскоро · къде отидоха парите този месец · най-нисък % изплатени | 5 |
| **3 Explore core** | Търси договори · Бенефициенти · По процедура · По място | 0 |
| **4 Explore more** | today's sections demoted intact — incl. the shipped **Interreg** section (`InterregTile`, `FundsScreen.tsx:421`), which stays here rather than moving up: it is a distinct corpus, not a competing lead | 0 |
| **5 За теб** | Моята община · Моят сектор · Следя тази процедура | 9 |
| **6 Данни и метод** | what ИСУН covers, **what it does not (open calls ≠ awarded)**, the `muni-share-even-split` caveat, ingest date | 2 |

The band-1 lead is the whole thesis rendered: *what can I apply to* next to *what actually gets
funded*.

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│ ОТВОРЕНО СЕГА              12 бр.    │ ФИНАНСИРАНО ЛИ Е НЕЩО КАТО МОЕТО?    │
│ ──────────────────────────────────── │ ──────────────────────────────────── │
│ Внедряване на иновации в МСП (МИГ)   │ [дейност: „къща за гости"  ] [общ.▾] │
│   до 14.09.2026 · 40 дни остават     │                                      │
│ Млад фермер (очаква се окт–дек)      │ → 412 договора · €38,4 млн.          │
│   €40 000 · 100% · възраст 18–40     │   медиана €62 100                    │
│ …                                    │   форма: 91% ЕООД/ООД · 0 физ. лица  │
│                     виж всички 12 →  │   статус: 74% приключени             │
│ проверено на 05.08, 07:12            │ ⚠ ИСУН = подписани договори          │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

**Three sections, never one list** (invariants 2 and 7):

| Section | Rows | Wording | What the reader can do |
|---|---|---|---|
| **Отворено сега** | `kind='call'`, status `open`/`upcoming` | `краен срок` + countdown | apply |
| **Очаквани приеми** | `date_precision='indicative'` (agri) | `очаква се` — no countdown | prepare |
| **Проекти на насоки — обсъждане** | `kind='consultation'` | `коментари до` | **comment on the draft** |

The consultation section is the one nobody else offers, and it is why `/PublicDiscussion` is
worth publishing: it appears weeks before a call opens, it directly answers „предстоящи мерки?",
and the useful action is not "apply" but "influence the guidance while it is still a draft".
It must state plainly that applications are not open, that the figures are draft, and that a
draft can be withdrawn or changed.

## 5.3 Tile grammar — stock · flow · change

Apply module-front-pages §4. Each is one extra field in the existing offline generator; no live
query.

Every row also declares a **basis** — which corpus the figure is over — because since Interreg
shipped (§2.3) „EU money" has two possible meanings and a tile that does not say which is
`project_sector_hub_kpi_basis`'s exact failure mode.

| Tile | stock | flow | change | basis |
|---|---|---|---|---|
| Отворени процедури | 12 | €X общ бюджет (`reviewed` only) | **N затварят до 7 дни** | ЕСИФ + agri (no Interreg — §2.3b) |
| Договори | 82 011 | €44 млрд. · медиана €X | +N нови този месец | ИСУН + EEA |
| Бенефициенти | ~30 000 | €X към топ 10 (=Y%) | +N нови | ИСУН + EEA |
| Процедури | 2 137 | €X по 10-те най-големи | N приключили | ИСУН |
| Interreg | 1 954 операции | €396,4 млн. · 1 493 БГ партньора | — | keep.eu / Jems |
| **По място** | 265 общини | €X на жител, медиана | — | **combined (`funds_muni_combined_v`, 139)** |
| Свързани лица | `cr.mpCount` | €X договорени | +N нови връзки | ИСУН |
| Интегритет | N сигнала | €X засегната стойност | +N нови | ИСУН |

Two notes that are easy to get wrong:
- „N затварят до 7 дни" is the most actionable figure on the page and is one
  `WHERE closes_at BETWEEN now() AND now()+7d` away.
- **„По място" must use the combined basis.** It is the one tile where the ИСУН-only figure is
  actively misleading (§2.3a: 29 of 29 gaining municipalities are in border oblasti), and it is
  also the tile a border-municipality reader is most likely to check.

## 5.4 Stages

**Stage 0 — tile grammar and order (no backend).** `blurb` + `stats` + `delta` on the funds
tiles; split bands 3/4 and reorder by `weight`/`tier`; add the contracts search box to band 3.
Biggest visible gain per line changed, and it ships crawlable body text on a zero-impression
prefix (`project_seo_discovery_gap`).

**Stage 1 — the open-calls spine** (ИСУН + agri). The only stage that must ship whole.
1. `isun_parse.ts` — pure. Listing: `li[data-href^="/bg/s/Procedure/Info/"]`, programme from the
   enclosing group node. Detail: `Начален/Краен срок` (`DD.MM.YYYY г. HH:MM ч.` → timestamptz,
   Europe/Sofia), objective, docs `a[href*="/Procedure/InfoDownload/"]`.
2. `isun_fetch.ts` — one listing GET, then detail GETs **only** for GUIDs that are new or whose
   `Въпроси и отговори (Дата на актуализация: …)` moved. Serial, ≥1 s apart, UA
   `electionsbg-opencalls/1.0 (+https://electionsbg.com)`, `AbortSignal.timeout`.
   `/Active`→open candidates, `/PublicDiscussion`→consultation.
3. `sp2023_fetch.ts` — **resolve the XLSX link by scraping the schedule page for
   `a[href$=".xlsx"]`**, never hardcode: the filename carries a year and the word
   „Актуализиран". Fail loudly on 0 or >1 candidate. `sp2023_parse.ts` maps the columns in
   §2.2; all rows `date_precision='indicative'`; keep prose budgets („остатъчният бюджет след…")
   in `budget_note`.
4. `write_snapshot.ts` → committed `data/opencalls/{isun,sp2023}.json`.
5. `load_open_calls_pg.ts` — applies `005` + `142` itself so a cold DB needs nothing else.
   **Stage merge, not TRUNCATE** (`scripts/db/lib/stage_merge.ts`,
   `reference_stage_merge_reload`). Then `recordIngestBatch({ source:'open_call',
   keyExpr:"t.source || ':' || t.source_key", … })` per `feedback_pg_changelog_required`, plus an
   `open_calls_crawl` upsert.

6. **UPSERT ONLY — no anti-join DELETE.** This is the one place where copying
   `load_kzk_decisions_pg.ts` wholesale would be wrong. The crawler reads `/Active`, so **a call
   that closes vanishes from the source** — an anti-join delete would therefore erase exactly the
   closed calls we want to keep, and would do it silently. Three reasons to accumulate instead:
   - invariant 1 already hides closed rows at query time, so keeping them costs nothing;
   - they are the base-rate and „затвори наскоро" material (Stage 6);
   - it is the archive the committed snapshot only half-provides (git has the JSON, but the
     *table* would forget).

   So: `stageUpsertSql` only, and **`first_seen_at` must be excluded from the merge `cols`** or
   every run would reset it. `last_seen_at` is set to the crawl time for rows present in this
   crawl and left untouched otherwise — that, not deletion, is how "no longer listed" is
   recorded. A row absent for >30 days with no `closes_at` is reported for review, never
   auto-deleted.

7. **Two guards, in front of the merge**, modelled on `load_kzk_decisions_pg.ts`. With no
   delete they no longer protect against data loss, but they still stop a garbage vintage from
   overwriting good rows: **shrink guard** — abort if the crawl yields >25% fewer rows for a
   source than its last successful crawl (`open_calls_crawl.rows_seen`), unless
   `--allow-shrink`; **parse-rate guard** — abort if >15% of listing rows yield no detail parse.
   Both fail *before* the transaction opens.

8. **Two parsing hazards that will silently produce wrong data if unhandled:**
   - **Timezone.** `DD.MM.YYYY г. HH:MM ч.` is Sofia **local** time, and Sofia observes
     EET/EEST. Parsing with a fixed `+02:00` puts every summer deadline an hour early — on a
     `16:30` cut-off that is a real, wrong countdown. Resolve the offset per date (or store the
     wall-clock plus an explicit `Europe/Sofia` conversion), and unit-test one winter and one
     summer date.
   - **Currency.** The agri XLSX column is literally
     `БЮДЖЕТ ЗА ПРИЕМ До левовата равностойност на:` — some amounts are **lev**, not euro, even
     though most rows print „евро". Per `feedback_bg_uses_eur`, convert at ingest at
     **1 EUR = 1.95583 BGN**, keep the raw string in `budget_note`, and **drop the figure rather
     than guess** when the unit is ambiguous. A lev amount stored as euro overstates by 1.96×.

9. npm scripts + `db:refresh` membership (see §7.1).

**Stage 2 — serving + the band-1 open-calls module.** Route, browse table, `/funds/calls`,
`OpenCallsTile`, freshness banner, band 6 copy. Details in §6.

**Stage 3 — watcher, skill, and the five integrations that are easy to forget.**
`isun_procedures.ts` (daily, `publishes:"irregular"`, fingerprint = `sha256Short(sorted GUID
set)` + count + max Q&A stamp, detail like `"55 отворени · 3 нови · 1 затваря след 6 дни"`);
`sp2023_indicative.ts` (weekly, XLSX bytes hash + row count); new skill
`.claude/skills/update-open-calls/SKILL.md` **including the `:cloud` publish step**; two mapping
rows in `process-watch-report`.

Then the wiring a new dataset needs and this plan originally omitted:

1. **`scripts/bucket_sync_paths.ts` — add an `isExcluded` entry for `opencalls/`.** `data/` is
   walked wholesale and uploaded to GCS; `funds/` and `procurement/` are excluded precisely
   because they are Cloud-SQL-served. `open_calls` is too, so without the exclusion every
   `bucket:sync` publishes a second copy of the snapshot to a path nothing reads — a spare
   serving surface that can go stale, which is the failure class
   `reference_procurement_bucket_boundary` exists to prevent.
2. **AI chat tool.** `ai/tools/registry.ts` already carries `fundsOverview` and `fundsProjects`;
   add an `openCalls` tool (filter by audience/status, return soonest deadlines) in
   `ai/tools/funds.ts` + a harness test. „Има ли отворена програма за X" is the single most
   likely question the assistant will now be asked, and without a tool it will answer from the
   awarded corpus and be wrong about what is open. **Declare the tool's basis in its
   description** — the interreg plan §8-T3(5) flags `placeEuProjects`, `ai/tools/fiscal.ts`,
   `regional.ts` and `environment.ts` as reading `fund_payloads` and therefore still answering on
   the ИСУН-only basis; do not add a sixth tool with an undeclared basis.
3. **My-Area.** `scripts/myarea/build_alerts.ts` — open calls whose `territory` names the user's
   obshtina (or that are national) are the most actionable alert we could add. Not full
   subscriptions (out of scope), just the existing alert surface. ⚠ **This file is already known
   to be on a stale basis**: interreg plan §8-T3(4) records that it reads the on-disk
   `data/funds/projects/by-muni` + `changes/` rather than Postgres, so it misses Interreg
   entirely. Add open calls from PG — and do not deepen the JSON path while doing it.
4. **`/data` map + sources.** A `DatasetDef` in `scripts/data_map/model.ts` and a `/data/sources`
   row (`reference_two_changelogs`).
5. **i18n / EN mirror.** BG + EN keys in `src/locales/` and `public/locales/`. Heed
   [funds-seo-geo-v1.md](funds-seo-geo-v1.md) F3: the funds pages already shipped an English
   mirror carrying Bulgarian names, and Google paired a Bulgarian title with an English snippet.
   Procedure titles are Bulgarian-only at source, so the EN page must either translate the
   chrome and label the title as the official Bulgarian name, or not exist — **not** silently
   mirror.

**Stage 4 — the resolver** („финансирано ли е нещо като моето"). Answers categories A, B, E and
F from the awarded corpus at procedure grain; precompute per §4.4. **No new-data dependency** —
can be built in parallel with Stages 1–3 by a second person.

**Stage 5 — wire + news rail** (bands 0 and 2). Reuse `recent_updates`' backfill suppression;
event date on the card, publication week in the kicker (§3.2 rules 2–3).

**Stage 6 — base-rate cards + reference price.** Per `/funds/procedure/:code`: beneficiaries,
median grant, status mix, disbursement, org-form mix; and „5% от медианния грант тук = €X".
Also the strongest AIO/GEO asset — [funds-seo-geo-v1.md](funds-seo-geo-v1.md) F4 is unresolved.

**Stage 7 — enrichment: money + eligibility for ИСУН rows. LLM-backed, driven by a skill**
(decision §8.3.7).

New skill **`.claude/skills/enrich-open-calls/SKILL.md`** — deliberately separate from
`update-open-calls` rather than a step inside it, because the two have different risk profiles:
crawl+load is mechanical and safe to run unattended, while enrichment spends tokens per document
and **must not publish a figure without human sign-off**. Keeping them apart means the daily
refresh can never quietly ship an unreviewed number.

The pipeline, per procedure with `enrichment='none'`:

1. **Pick the document.** The short `Обява за откриване на процедурата` from the
   `InfoDownload?fileKey=` URL already captured in `docs` — not the multi-annex `Условия`.
   ⚠ **Unverified: the file format.** ИСУН's `Условия за кандидатстване и приложения към тях` is
   very likely a ZIP/RAR bundle; the `Обява` is probably a single PDF or DOCX. Probe the
   `Content-Type` and a few real files **before** writing an extractor, and handle "archive" as a
   skip-with-reason rather than a crash. Text extraction: the `anthropic-skills:pdf` skill for
   PDFs, and the repo already parses DOCX/PDF elsewhere (НЗОК НРД tariffs, ministry Отчет
   reports) — reuse rather than add a dependency.
2. **Extract to a strict schema**, one object per procedure, every field paired with a
   `quote` — the verbatim span from the document that supports it:
   ```
   { budget_eur: {value, quote}, aid_rate_pct: {value, quote},
     grant_min_eur: {value, quote}, grant_max_eur: {value, quote},
     beneficiaries: {text, quote}, audience: [..] }
   ```
   A field the model cannot quote is **omitted, not guessed**.
3. **Deterministic grounding gate — the load-bearing step.** Before anything is stored, a plain
   substring check (whitespace-normalised) verifies **every** `quote` actually occurs in the
   extracted document text. A quote that does not match drops its field and is reported. This is
   the mechanical half of `project_ai_chat_grounding_gate`: the guarantee comes from the check,
   **not** from trusting the model. Also re-run the §8.1 currency rule here — a lev figure
   quoted correctly is still wrong if stored as euro.
4. **Store as `enrichment='auto'`** with `enrichment_meta = {model, extracted_at, doc_url,
   quotes:{…}}`. Per **invariant 8**, `auto` may render its verbatim quote plus the document
   link, but **must not populate the sortable/filterable numeric columns**.
5. **Human review promotes to `'reviewed'`**, which is what lets the figure into `budget_eur` &
   co. and therefore into sorting, range filters and the tile's „€X общ бюджет". The skill's
   output is a review queue — a diff of proposed values with their quotes — not a write.

At ~55 rows this is a small job per run (only genuinely new procedures are touched), which is
what makes a human gate affordable. Re-run when `update-open-calls` reports new GUIDs.

**Stage 8 — АХУ + АЗ + Interreg calls.** ~6 АХУ programme pages; АЗ needs a news-feed scrape
plus a classifier and is the least reliable arm — label its provenance clearly. **Interreg
calls (Jems / the МРРБ programme subdomains) belong here too and are arguably the highest-value
of the three**, because they are the one gap that falls on a specific, identifiable population —
the border municipalities §2.3a measured — rather than diffusely. Until it ships, band 6 must say
that `/funds/calls` covers ЕСИФ + agri and not Interreg.

**Stage 9 — За теб** (band 5).

**Out of scope, noted so they are not designed out:** alerts/subscriptions (the most-wanted
thing in that group; needs an account system), SEDIA (§2.2 Tier 3), and **per-call pages —
deliberately never**: a prerendered page that becomes actively misleading on a known date is
exactly the harm invariant 3 exists to prevent. Only the *index* is prerendered.

---

# PART VI — SERVING AND UI

**Route `/api/db/open-calls`** in `functions/db_routes.js`. Degrade contract copied exactly from
the 123/124 precedent: degrade to an **empty list** on `42P01` (absent), `55000` (present,
unpopulated), `42501`, `55P03`; **`57014` must NOT be in the degrade set** — that is the pool's
own `statement_timeout`, and falling back after burning the full budget turns a 10 s failure
into a 20 s one. Log `oc:not-built` / `oc:read-failed` once per process.

**`db_table.js` registry entry** for the `/funds/calls` browser, following the compact
`admin_services` shape:

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

**UI conventions** (all from memory, not negotiable): no tabs — tiles or stacked sections
(`feedback_no_tabs_ux`); the shared Radix `Select` only, never native
(`feedback_no_radix_select_scroll_lock`); dashboard shell copied from the homepage, no
`max-w-5xl` cap (`feedback_dashboard_layout`); shared `useTooltip` with `{tooltip}` rendered
outside any relative box; measured-width charts with **no** fallback width.

**Prerender / sitemap:** `/funds/calls` gets a static index (BG + EN) via
`scripts/sitemap/route_defs.ts`. **No per-call `<loc>`.** Bands 3–6 prerender; bands 0–2 are
client-only — which is also the SEO-correct split (index the durable grid and its blurbs, not a
rail of ephemeral links).

---

# PART VII — GATES, DEPLOY, SEQUENCING

## 7.1 Chain membership

`db:load:open-calls:pg` reads a **committed** JSON, so it belongs *in* `db:refresh` (not in
`REFRESH_EXCLUSIONS`). Insert after `db:load:funds:pg`. No `ORDER_PAIRS` entry is needed —
`open_calls` has no cross-table input. `refresh_coverage.test.ts` enforces membership
automatically once the script exists.

```
opencalls:isun               tsx scripts/opencalls/isun_fetch.ts
opencalls:sp2023             tsx scripts/opencalls/sp2023_fetch.ts
db:load:open-calls:pg        tsx scripts/db/load_open_calls_pg.ts
db:load:open-calls:pg:cloud  DATABASE_URL=…5434… npm run db:load:open-calls:pg
```

## 7.2 Tests

| Layer | File | Asserts |
|---|---|---|
| unit | `isun_parse.test.ts` | committed HTML fixtures → exact timestamps; **one winter + one summer date** (EET/EEST, §5.4 Stage 1.8); doc links; codes; a fixture missing `Краен срок` is **rejected, not defaulted**; a `/PublicDiscussion` fixture yields `kind='consultation'` |
| unit | `sp2023_parse.test.ts` | the 11 rows; `II.Д.1` → €68,716,487.50 / 18–40 / 100% / €40,000; every row `indicative`; **a lev-denominated amount converts at 1.95583, an ambiguous one is dropped** |
| unit | `audience.test.ts` | `Техническа помощ`→institution · `земеделски стопани`→farmer · unmapped→`unknown`; **and `unknown` ≤40% of live rows** — a keyword map that resolves nothing makes the facet useless, so this is an acceptance threshold, not a unit assertion |
| unit | `enrich_gate.test.ts` | a fabricated quote is rejected; a whitespace-differing real quote is accepted; a field without a quote never reaches output |
| **data** | `scripts/db/tests/open_calls.data.test.ts` | **no row where computed status = `open` and `closes_at < now()`** (invariant 1) · **no `consultation` row in a `kind='call'` result** (invariant 7) · **no `enrichment != 'reviewed'` row with a non-NULL `budget_eur`/`grant_max_eur`/`aid_rate_pct`** (invariant 8) · every row has `source_url` · exact ⇒ `closes_at` present · indicative ⇒ `closes_at` NULL · `isun` source non-empty · `first_seen_at` never moves for an existing key across two loads · `open_calls_crawl` fresher than the SLA · `open_calls_list` under a buffer ceiling (`reference_pg_query_performance`) |
| functions | `db_routes.opencalls.test.js` | degrades on 42P01/55000/42501/55P03; **rethrows 57014**; logs once per process. Runs under `npm run functions:test` (`node --test`), not vitest |
| chain | `refresh_coverage.test.ts` | `db:load:open-calls:pg` is in `db:refresh` |
| cadence | `watch/cadence.test.ts` | daily vs irregular sampling invariant |
| bucket | `bucket_sync_paths` test | `opencalls/` is excluded from GCS sync (Stage 3.1) |
| SEO | `sitemap/families.data.test.ts` | `/funds/calls` `<loc>` resolves to real `dist/` HTML; **no per-call `<loc>` exists** |

The data test deliberately does **not** skip on an empty `isun` source — that is one of the two
states it exists to catch.

**Local verification before each commit** (`reference_typecheck_tsc_build` — `tsc --noEmit`
checks nothing here, the root tsconfig is a references stub):

```bash
npx tsc -b && npm run lint && npm run test:unit && npm run functions:test
```

`npm run test:data` covers the Postgres gates and needs `npm run db:pg:up`. Note
`reference_test_data_flaky_under_load`: re-run a single red file alone before believing it.

## 7.3 Deploy order

Hosting-before-function is the one ordering that breaks a working page (`CLAUDE.md`), and the
migration must precede its writer:

```bash
npm run db:load:open-calls:pg:cloud   # 1 — migration + first load (loader applies 005 + 142)
npm run deploy:db                     # 2 — the function that serves it
npm run deploy                        # 3 — hosting (/funds/calls + the tile)
```

The route degrades a missing table to an empty list, so 2–3 are safe in either order on a first
deploy — but step 1 first keeps the page non-empty from the moment it is reachable.

Recurring, per `update-open-calls`:
```bash
npm run opencalls:isun && npm run db:load:open-calls:pg   # local
npm run db:load:open-calls:pg:cloud                        # prod — NOT automatic
```

## 7.4 Sequencing

| Stage | Deliverable | Depends on |
|---|---|---|
| 0 | tile grammar, band split/reorder, contracts search in band 3 | — |
| 1a | `142_open_calls.sql` + `types.ts` | — |
| 1b | `isun_parse.ts` + fixtures + tests | 1a |
| 1c | `isun_fetch.ts` + `write_snapshot.ts` → committed `data/opencalls/isun.json` | 1b |
| 1d | `sp2023_fetch/parse` + tests → `data/opencalls/sp2023.json` | 1a |
| 1e | `load_open_calls_pg.ts` (stage merge, both guards, changelog, crawl stamp) | 1c, 1d |
| 1f | npm scripts + `db:refresh` membership + `open_calls.data.test.ts` | 1e |
| 2a | `/api/db/open-calls` + degrade test | 1f |
| 2b | `db_table.js` entry + `open_calls_table` view | 1f |
| 2c | `OpenCallsTile` (band 1) + the **three sections** (call / indicative / consultation) + `/funds/calls` + freshness banner + band 6 copy | 2a, 2b |
| 2d | prerender/sitemap for `/funds/calls` + SEO gate | 2c |
| 3 | watcher sources + `update-open-calls` skill (**with `:cloud`**) + process-watch-report rows, **plus the five integrations**: bucket-sync exclusion · `openCalls` AI tool · My-Area alerts · `/data` map · i18n/EN | 1f, 1d |
| 4 | the resolver + its `fund_payloads` kind (**parallelisable with 1–3**) | 0 |
| 5 | wire (band 0) + news rail (band 2) | 2c, 4 |
| 6 | base-rate cards on `/funds/procedure/:code` + reference price | 4 |
| 7 | enrichment — `enrich-open-calls` skill: extract → quote gate → review queue → `reviewed` | 1f |
| 8 | АХУ + АЗ | 3 |
| 9 | За теб (band 5) | 2c, 4 |

**Stages 0–4 are the shippable unit.** They answer *what can I apply to right now*, *what's
coming in agriculture*, and *what actually gets funded and at what odds* — with correct dates,
honest gaps, and a page that leads with look-up instead of an aggregate.

---

# PART VIII — RISKS, DECISIONS, OPEN QUESTIONS

## 8.1 Crawl politeness (verified 2026-08-05)

| Host | robots.txt | Verdict |
|---|---|---|
| `eumis2020.government.bg` | none (404 → SPA shell) | no restrictions |
| `www.sp2023.bg` | Joomla defaults (`/administrator/`, `/api/`, `/cache/`…) | our paths (`/index.php/bg/…`, `/images/IGG/*.xlsx`) allowed |
| `ahu.mlsp.government.bg` | none (404) | no restrictions |
| `www.az.government.bg` | CMS defaults (`/admin/`, `/core/`…) | `/bg/news/` allowed |

Nothing we need is disallowed. Still: ≤56 requests/day, serial, ≥1 s apart, identifying UA,
conditional detail fetches. A government host being technically crawlable is not a licence to
hammer it.

## 8.2 Risk register

| Risk | Mitigation |
|---|---|
| **ИСУН markup change → 0 rows parsed** | no anti-join delete, so the previous vintage survives (Stage 1.6); shrink + parse-rate guards abort before the tx; data test asserts a non-empty `isun` source |
| **A consultation read as an open call** | `kind` + CHECK, separate section, separate wording, default view excludes drafts (invariant 7) |
| **An LLM-extracted figure ships unreviewed** | deterministic quote-in-source gate; `auto` barred from numeric columns (invariant 8); data test asserts it |
| **Lev amount stored as euro (1.96× overstatement)** | Stage 1.8 conversion rule + a parser test |
| **An „EU money" figure with an undeclared basis** (ИСУН-only vs combined) | every tile row declares a basis (§5.3); „По място" pinned to `funds_muni_combined_v`; the resolver payload carries its basis as a field |
| **`/funds/calls` read as complete** while Interreg calls are absent | band 6 states the coverage boundary; Stage 8 closes it |
| **A call closes earlier than published** | unavoidable from any source; daily cadence + per-row `source_url` + never presenting ourselves as the authority |
| **Crawler dies silently** | invariant 1 self-hides expired rows; the freshness banner degrades the page; the watcher reports `error` |
| **XLSX filename/URL rotates** | resolve via page scrape, fail loudly on 0 or >1 candidate |
| **`indicative` mistaken for a deadline** | CHECKs forbid `closes_at` on indicative rows; separate section; separate wording |
| **Institutional procedures shown as opportunities** | `audience` facet; `unknown` never claimed as eligible |
| **Prod stale while local is green** | the cloud publish step is written into the skill (Stage 3) — the `reference_migrated_family_watch_reload` failure class, and the single most likely way this rots |
| **Enrichment publishes an unverified € figure** | `enrichment='auto'` never renders as a figure (Stage 7) |
| **Live resolver aggregate 500s on prod** | precompute per §4.4 — the `procurement-overview`/`-flow` failure |

## 8.3 Decisions taken as read (flag now if wrong)

1. **`data/opencalls/*.json` is committed** (§5.1) — departs from the funds/agri PG-only
   precedent; justified by size and archive value.
2. **No per-call pages, ever** (Stage 8 note) — costs long-tail SEO, refuses to publish a page
   that becomes misleading on a known date.
3. **`/funds/calls`, not a top-level `/calls`** — keeps open calls attached to the awarded
   corpus that gives them base rates.
4. **v1 has no alerts** — most-wanted, needs an account system, would delay the spine. (The
   existing My-Area alert surface does get open calls — Stage 3.3.)
5. **Accountability tiles are demoted, not deleted** (§1.3).
6. **`/PublicDiscussion` ships publicly** — as its own section, its own wording, never in the
   open-calls list (invariant 7). Decided 2026-08-05.
7. **Stage 7 enrichment is LLM-backed and driven by its own skill**
   (`.claude/skills/enrich-open-calls/`), with a deterministic quote-in-source gate and a human
   promotion step to `'reviewed'`. Decided 2026-08-05. Hand-curation is no longer the plan of
   record, but the `enrichment` column still supports it as a fallback.
8. **`open_calls` accumulates; the loader never anti-join deletes** (§5.4 Stage 1.6).

## 8.4 Open questions

1. **Do we mirror the documents?** Linking is cheaper and always current; mirroring survives a
   source reorganisation. Given ИСУН's GUID-keyed URLs, linking is probably right.
2. **МИГ granularity** — does ИСУН carry each local action group's own sub-call or only the
   parent? Determines whether we cover ~64 МИГ territories or just the umbrella.
3. **Resolver keyed on free text or a curated taxonomy?** `themes.json` / `taxonomy.json` already
   exist in `data/funds/`. Free text ships sooner; a taxonomy gives stable URLs — and stable URLs
   are what earn the long-tail impressions `funds-seo-geo-v1` is chasing.
4. **Is the reference price defensible?** „5% от медианния грант" is arithmetic on our own data,
   but publishing it positions us against the consultancies who are the group's loudest voices.
   Decide deliberately rather than discovering.
5. **Consultation → call continuity.** When a draft in `/PublicDiscussion` opens as a real
   procedure, does it keep its ИСУН GUID? If it does, the row flips `kind` in place and we can
   show "this is the draft you commented on". If it gets a new GUID we will hold two unlinked
   rows and need a code-based join. **Verify against one procedure that has made the transition
   before Stage 2 ships** — it determines whether `source_key` is stable across the lifecycle.
6. **Which sitemap shard** does `/funds/calls` join — `sitemap_funds.xml` (topical, currently
   110 URLs) or the static-pages shard? Trivial, but `families.data.test.ts` needs to know.
7. **Do we ingest Interreg calls, and from where?** Jems has no public calls API that we have
   checked; the МРРБ programme subdomains publish them as pages. This is the one remaining
   coverage hole that lands on an identifiable population (§2.3b). Needs the same source-research
   pass §2.2 got — until then Stage 8 is a placeholder, not a plan.
8. **Does the combined per-capita basis change the published Малко Търново post?** The interreg
   plan says its figures move €4,105→€4,309/жител and №3→№2, and that the live draft is
   conservative. If „По място" switches to the combined basis, the tile and the post should agree
   — check before switching, not after.

## 8.5 Audit log — gaps found reviewing this plan, and what changed

A pass over the consolidated plan against the repo on 2026-08-05 (after folding in the
`/PublicDiscussion` and LLM-enrichment decisions) found nine real gaps. All are now patched
above; recorded here so the reasoning is not lost.

| # | Gap | Severity | Fix |
|---|---|---|---|
| 1 | **The loader would have deleted its own history.** `mergeFromStage`'s anti-join DELETE, copied from `load_kzk_decisions_pg.ts`, removes every live row the build did not produce — but the crawler reads `/Active`, so a call that closes is *absent by design*. Every closed call would have been silently erased, destroying the base-rate and archive value the plan claims. | **high** | Upsert only, no delete; `last_seen_at` records absence (§5.4 Stage 1.6) |
| 2 | `first_seen_at` in the merge `cols` would be **reset on every run**, so „ново" would be permanently true | **high** | excluded from `cols`; data test asserts it never moves |
| 3 | **Currency.** The agri XLSX header is `БЮДЖЕТ ЗА ПРИЕМ До левовата равностойност на:` — some amounts are lev. Storing them as euro **overstates by 1.96×** | **high** | convert at 1.95583, drop when ambiguous, keep raw in `budget_note` (Stage 1.8) |
| 4 | **Timezone.** A fixed `+02:00` offset puts every summer deadline an hour early against a real `16:30` cut-off | medium | resolve per date; test one winter + one summer date |
| 5 | `db_table.js` bound to `base: "open_calls_table"`, a **view the migration never created** | medium | view added to 142 (§4.3) |
| 6 | **`bucket_sync_paths.ts` exclusion missing.** `data/` is walked wholesale; without an entry, every `bucket:sync` would publish a spare GCS copy of a Cloud-SQL-served dataset | medium | Stage 3.1 + a test |
| 7 | **No AI chat tool.** `registry.ts` has `fundsOverview`/`fundsProjects`; without an `openCalls` tool the assistant answers „има ли отворена програма" from the *awarded* corpus — confidently wrong | medium | Stage 3.2 |
| 8 | **No My-Area integration**, though `scripts/myarea/build_alerts.ts` exists and place-scoped calls are the most actionable alert available | low | Stage 3.3 |
| 9 | **i18n/EN unspecified**, on a page family that has already shipped a Bulgarian-title/English-snippet SERP bug (`funds-seo-geo-v1` F3) | low | Stage 3.5 |

A second pass on 2026-08-08, after Interreg shipped, found two more:

| # | Gap | Severity | Fix |
|---|---|---|---|
| 10 | **Migration number was wrong.** The plan reserved `134`; `134_rollcall.sql` took it while this plan sat unbuilt, and 135–141 have since gone too. A plan is not a reservation | **high** (would have collided on creation) | renumbered to **142**, with a note to re-check before creating the file (§4.1) |
| 11 | **Interreg unaccounted for on both sides.** The awarded corpus is now two corpora with a combined view (139), and Interreg calls run on Jems so they can never appear in ИСУН `/Active` — so the resolver would have answered „no" to border-municipality askers, „По място" would have understated 29-of-29 border municipalities, and `/funds/calls` would have implied completeness it lacks | **high** | new §2.3; resolver spans both corpora (§4.4); per-tile basis column (§5.3); coverage boundary in band 6; Interreg calls added to Stage 8 |

Two claims checked and **dismissed** rather than patched: `type: "date"` *is* a valid
`db_table.js` column type (8 existing uses), and `recordIngestBatch` handles the changelog
correctly as specified. One item was reclassified from a gap to an **acceptance threshold**: the
`audience` keyword map needs a measured `unknown` rate (≤40%), since a map that resolves nothing
would pass every unit test while making the facet useless.

---

## Appendix A — verbatim demand evidence

### A.1 Category A — „Има ли програма за X?" (32 posts)

> туристическа агенция (дигитализация, маркетинг, техника, обучение, разширяване) · къща за
> гости ×3 (incl. довършителни на груб строеж: саниране, термопомпа, солари) · саниране на
> еднофамилна къща / Декарбонизация ×4 · енергийна ефективност на еднофамилни къщи, София ·
> дигитализация на строителна фирма (наемане на ИТ подизпълнител) · „нещо като Индустрия 4.0
> през 2026" — CNC, лазери · внедряване на AI · млад фермер ×3 (incl. „за цветя") ·
> новосъздадени/„новоизлюпени" земеделски производители ×2 · 700–800 m² трева, дипломиран
> агроном · фотоволтаици за продажба на ел. енергия (микро фирма, собствени парцели, Ст. Загора)
> · изкопна извозваща дейност, Ямбол (багер, самосвал) · кредитно посредничество (наем, ток,
> интернет, оборудване) · хранителни продукти, оборот 15 000 €/мес., собствено хале 300–500 m² ·
> микро предприятие в Западна България (Перник/Кюстендил/Благоевград), райони в преход · смесен
> магазин — наемане на работници над 55 г. · младежка заетост ×2 · специализирано почистване и
> пожаробезопасност · млади дизайнери с рециклирани материали · частна галерия/арт център в малък
> областен град · ремонт на читалище в малко населено място · детски културно-развлекателни
> центрове извън урбанизирани места · хора с ТЕЛK ×4 (АХУ) · „Избирам България" Компонент 1 ·
> автосервиз, В. Търновска област

### A.2 Category E — base rates asked socially

> „Някой кандидаствал ли е? Удобрен ли е бил?" · „Има ли одобрени по тази програма в групата?" ·
> „Има ли някой кандидатствал по Избирам България — Компонент 1 и да е бил одобрен?" · „Срещал
> съм познати, които са печелили такъв проект, но нямам идея какъв точно е процеса"

### A.3 Category F — the navigation failure

> „**Има ли въобще списък какви програми се предлагат?** — Защото тук чета от бизнес с чушкопеци
> до баничарници на Луната?"

> „Къде да отида да попитам? Кои са фирмите, които могат да ми съдействат? Какви са правилата?
> **Къде мога да намеря точна информация и разяснение по този казус?** Никога не съм ползвал
> такива програми и съм много невеж."

> „…от ИСУН не ми пратиха повече информация за развитие на райони в преход."

### A.4 Category D — the trust question

> „Обърнах се към фирма, която ще ми съдейства. **Поискаха ми първоначално 4000 €, платими на
> два пъти, и ако бъда одобрен — 5% от сумата. Това реални цифри ли са?**"

Answered in the same group by the supply side: „Цената се заплаща **преди** спечелването на
проекта, а не след това." An information asymmetry with no reference price — hence Stage 6.
