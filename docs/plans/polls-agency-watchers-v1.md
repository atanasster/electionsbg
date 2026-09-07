# Polls — agency-site watchers, automatic download and parse, presidential polls

**Status:** ready to execute (Tiers 0–4 fully specified against files that exist; Tier 4b is the historical
presidential backfill; Tier 5 carries the ⚑ product decisions in §11)
**Scope:** the seven Bulgarian pollsters that publish on their own site, the three that do not, the 2026
presidential race and the three earlier presidential races the agencies polled, and the orchestrator wiring
(`npm run watch` → `/process-watch-report` → `/update-polls` → `/upload-watch-changes`)
**Version:** v1.2 — v1 written 2026-09-05 from a same-day probe of every agency site (§2), the current corpus
(§1) and the presidential-elections plan (`docs/plans/presidential-elections-v1.md`, cycle id
`<round-1 date>_pvr`, catalogue `presidential_elections.json`, T7.2 skill `update-presidential-elections`).
**v1.1 (2026-09-05)** folded in the first audit (§12: monotonic fingerprints, the fieldwork contract, generic
restamp, re-capture versioning, the AI chat's polls tools, the `data:map` validator, the minified-JSON contract,
the Google-News link limitation, the cross-check's header vocabulary).
**v1.2 (2026-09-06)** folded in the second audit: the presidential tree now EXISTS for all five cycles
(`data/<cycle>_pvr/national_summary.json` + `tickets.json`, §7), so Tier 4 is unblocked and written against the
real shape; the end-to-end presidential ingest checklist (§7.0); the candidate resolver (decision 16); the
results → accuracy coupling through `cik_presidential` (T3.2, T4.7); the polls band on the presidential pages
mirroring the parliamentary one (T4.4); the historical presidential backfill from agency archives (Tier 4b);
agency-coverage completeness against the last five Wikipedia tables (§2.1).
**Operator decision that frames everything:** _BG Wikipedia is not a source of truth — it has many errors;
the agencies' own websites are the source. Wikipedia is kept for verification only._ (2026-09-05)

## 0. Outcome

Every day the watcher tells the operator **which agency published a new electoral poll, with the URL**,
the same way it reports a new roll-call session. `/update-polls` then downloads the publication, extracts
the shares with a quoted-evidence gate, and lands the poll in `data/polls/` locked to the agency's own
publication — no Wikipedia in the path. A presidential poll (candidate columns, party-placeholder candidates,
runoff pairings) lands in a parallel presidential corpus, is scored against `data/<cycle>_pvr/` the moment a
cycle's results land, and renders on `/presidential/<cycle>` in the same „Социологически проучвания" band the
parliamentary dashboard already carries — for 2026 and, through the backfill, for 2016 and 2021. Wikipedia's
polling tables are read only to answer two questions: _is there a poll on Wikipedia that we missed_
(discovery of an agency we do not watch) and _does Wikipedia disagree with the agency's number_ (a hint that
one of the two is wrong — and the corpus already documents which one usually is).

## 1. Where the corpus stands (measured 2026-09-05, presidential tree re-checked 2026-09-06)

| fact                                        | value                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| polls / party rows / agencies               | **124** / 1,140 / 9 (`AF AR CAM GIB MD ML MY SH TR`)                                                                                                                                                                                                                                                                                                   |
| locked to a primary publication             | **124 of 124** (`agency_website` 82, `agency_pdf` 25, `agency_spreadsheet` 8, `third_party_consensus` 9)                                                                                                                                                                                                                                               |
| `source` on Wikipedia                       | **3** (all `third_party_consensus`: MD 2013, MD 2021-11, GIB 2021-07)                                                                                                                                                                                                                                                                                  |
| inter-election waves (`electionDate: null`) | 4 — ML May/Jun/Jul 2026, AR Jul 2026, all hand-added from the agency PDF/site                                                                                                                                                                                                                                                                          |
| `residual` present                          | 123 of 124 — the analyzer's normalisation READS it (undecided + wontSay redistributed), so a missing one is not neutral                                                                                                                                                                                                                                |
| `wiki_polls` watcher                        | fingerprint `113` rows, **unchanged since 2026-05-11** — it surfaced NONE of those four                                                                                                                                                                                                                                                                |
| `state/ingest/update-polls.json`            | `bootstrap: marker seeded, no run` — the skill has never run under the orchestrator                                                                                                                                                                                                                                                                    |
| corpus file format                          | **minified single-line JSON** (`JSON.stringify`, the scraper's comment: „pretty-printing wastes ~25% on the wire") — `npx prettier --check data/polls/*.json` currently FAILS on two of them, so it was never a gate                                                                                                                                   |
| serving path                                | `data/polls/` via `dataUrl("/polls/…")` (bucket). **`public/polls` does not exist** — the skill doc's `public/polls/*.json` is stale                                                                                                                                                                                                                   |
| presidential polls                          | **none** in the corpus; the first of the 2026 cycle (Глобал Метрикс, July) is published and unread                                                                                                                                                                                                                                                     |
| presidential RESULTS tree                   | **exists since 2026-09-05/06** for `2001 2006 2011 2016 2021`: `data/<cycle>_pvr/{national_summary,tickets}.json` + per-round trees; catalogue `src/data/json/presidential_elections.json`; `LATEST_PRESIDENTIAL_CYCLE = "2021_11_14_pvr"`; screens (`/presidential/:cycle`) not yet built (presidential plan Tier 5), the hub tile built and withheld |

The `wiki_polls` line pair is the whole case. The corpus is already agency-sourced by hand; the only automation
that exists watches the one source the operator does not trust, and it missed every poll added since May. The
scraper's own header (`scripts/polls/scrape_polls.ts`) lists the Wikipedia defects it was written around:
renormalised values transcribed as raw, small parties dropped, an outright mislabel (`sh-2024-06-01` „МЕЧ
5.1" for ИТН), publication dates recorded as fieldwork dates.

What the corpus already has and this plan reuses unchanged: the `Poll` / `PollDetail` shapes
(`src/data/polls/pollsTypes.ts`), the `locked` provenance tiers, `genre` (`raw_attitudes` / `forecast` /
`both_published` / `unclear`), `residual` (undecided / wontVote / wontSay / otherNamedMinor), the alias
module shared with the UI (`src/data/polls/aliases.ts`), the accuracy analyzer, the „no target election"
rendering for `electionDate: null`, and the rule that `accuracy.json` stays byte-stable when only an
inter-election wave is added (`project_post_election_polls`).

**Who else reads these files** (found by the sweep this repo's `company-connections` retirement said to
run — `ai/` is invisible to a `src/ scripts/ functions/` grep): the AI chat's `ai/tools/pollsDepth.ts`
(`pollAccuracy`, `agencyProfile`, `latestPolls`, `agencyPolls`) fetches all five files from the bucket;
`computeRiskComposite` reads `accuracy.json`; `buildPollsRoutes()` (`scripts/prerender/dynamicRoutes.ts`)
prerenders `/polls` and one `/polls/<agencyId>` per `agencies.json` row; the sitemap enumerates the same;
`data_map.json` names `wiki_polls` as the polls source; the parliamentary dashboard mounts `PollsTile` +
`AccuracyTrendsTile` inside `DashboardSection id="polling"` (`src/screens/dashboard/DashboardCards.tsx`) — the
band the presidential pages mirror (T4.4). Every one of them is touched below.

## 2. The agency landscape — one probe per site, 2026-09-05

Every row below was measured from this machine (curl, Node fetch, headless Chromium where needed).
`numbers` says where the party shares physically are; `passport` where fieldwork dates and sample size are.

| id  | agency · site                                                  | reachable                                                                                                                                                                                                                                                            | listing / API                                                                                                                                                                                                                                                                                                                          | publication format                                                                                                   | numbers                                                                                                                       | passport                                                                                                                                                                |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR  | Тренд · rctrend.bg                                             | yes, WordPress                                                                                                                                                                                                                                                       | `wp-json/wp/v2/project` (a CPT; 25 newest returned with `date`, `title`, `link`; `after=`/`before=` filters work for archive walks). ⚠ the RSS feed is frozen at **2018** — never use it                                                                                                                                               | HTML text + slide PNGs                                                                                               | **in text** („Прогресивна България остава лидер с 33,2% подкрепа сред заявилите, че ще упражнят правото си на глас")          | **in a slide image**; tesseract `bul` recovers it („1004 ефективни интервюта", „13-16 април 2026", „Възложител: 24 часа")                                               |
| AR  | Алфа Рисърч · alpharesearch.bg                                 | yes, custom CMS                                                                                                                                                                                                                                                      | `/blog/?page=N` (34 pages, 12 posts each, **no dates on the listing**); posts `/post/<id>-<slug>.html`, ids ascending (page 25 ≈ id 743, i.e. the archive reaches ~2020; earlier years only via Wayback). ⚠ **the site carries injected SEO spam** — 6 links per page to `*.go.id` casino pages and spam words inside the article text | HTML text + slide JPGs under `/api/uploads/`                                                                         | **in text** („Прогресивна България – 34.2% от сигурните, че ще гласуват", „ГЕРБ-СДС с 19.5%")                                 | **in text** („в периода 13-15 април 2026", „сред 1000 пълнолетни граждани")                                                                                             |
| ML  | Маркет ЛИНКС · marketlinks.bg                                  | yes, custom PHP                                                                                                                                                                                                                                                      | `/bg/news.html` (+ `category4/5/6/8.html`; the whole listing is ~12 items, ids 35–118 — no deep archive); items `/bg/news/<slug>-<id>.html` titled „Обществено–политически нагласи - <Месец> <Година>", dated `23.07.2026`, each linking ONE PDF (`storage/MarketLINKS Public Opinion Poll Report MM.YYYY.pdf`)                        | **PDF**, 19 pp, born-digital                                                                                         | `pdftotext -layout` yields aligned rows: `Коалиция Прогресивна България 39.2%` / `Коалиция ПП-ДБ 14.4%` / `ГЕРБ – СДС 12.8%`  | in the PDF („Обем на извадката 1002 лица над 18 г.", „Метод на регистрация Пряко-лично интервю и онлайн анкета")                                                        |
| SH  | Сова Харис · sovaharris.com                                    | yes, WordPress                                                                                                                                                                                                                                                       | `wp-json/wp/v2/posts`; categories `Проекти <year>` (2026: id 69) and `Прогнозни <year>` — the archive reaches 2016 (posted retroactively in 2021)                                                                                                                                                                                      | bulletin published as **page JPGs only** (`Buletin_0426_page-000N.jpg`, 12 pages); no PDF (`Buletin_0426.pdf` → 404) | **images only** → OCR                                                                                                         | OCR of page 2 recovers it („Период на провеждане: 2-6 април 2026", „800 души", „Поръчител: Вестник ТРУД") with the usual `%`→`96` artefacts; the party page is untested |
| MY  | Мяра · myara.bg                                                | yes, WordPress                                                                                                                                                                                                                                                       | `wp-json/wp/v2/posts?categories=98` (Електорални нагласи, 6 posts)                                                                                                                                                                                                                                                                     | HTML text + chart JPGs                                                                                               | **in text** („Прогресивна България би спечелила 34,6%, ГЕРБ-СДС – 18,5%, ППДБ – 11,4%")                                       | partly in text (activity), sample not confirmed                                                                                                                         |
| GM  | **Глобал Метрикс** · globalmetrics.eu — NEW, not in the corpus | yes, WordPress                                                                                                                                                                                                                                                       | `wp-json/wp/v2/posts` (rare: one post in 2026 — **the July presidential poll**)                                                                                                                                                                                                                                                        | HTML + **two PDFs** (press release 8 pp, full results 8 pp)                                                          | `pdftotext` yields both framings: `Илияна Йотова 30.9%` and `Кандидат на Прогресивна България 39.7%` … `Кандидат на МЕЧ 2.2%` | in the PDF („1503 пълнолетни български граждани")                                                                                                                       |
| GIB | Галъп Интернешънъл Болкан · gallup-international.bg            | **NO — broken TLS today.** `www` answers „tlsv1 alert protocol version" to curl (LibreSSL 3.3.6), `ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE` to Node and `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` to Chromium; the apex serves an **expired certificate** and 301s to `www` | WordPress (the 15 locked sources are `/<id>/<slug>/` posts)                                                                                                                                                                                                                                                                            | unknown until reachable; Wayback holds snapshots (2021-10-27, 2026-04-12 confirmed)                                  | —                                                                                                                             | —                                                                                                                                                                       |
| MD  | Медиана                                                        | **no website** (mediana.bg parked at sedo.com)                                                                                                                                                                                                                       | Google News RSS `„Медиана" проучване` → 21 items, newest 2026-03                                                                                                                                                                                                                                                                       | via bTV / mediapool / press                                                                                          | third-party only                                                                                                              | third-party only                                                                                                                                                        |
| AF  | АФИС · afis.bg                                                 | static one-pager, no publications                                                                                                                                                                                                                                    | Google News RSS → stale (2021)                                                                                                                                                                                                                                                                                                         | via press                                                                                                            | third-party only                                                                                                              | —                                                                                                                                                                       |
| CAM | ЦАМ                                                            | **no website** (cam-bg.eu is a hosting placeholder)                                                                                                                                                                                                                  | via press (banker.bg, actualno.com — the two locked sources)                                                                                                                                                                                                                                                                           | third-party only                                                                                                     | —                                                                                                                             | —                                                                                                                                                                       |

Also probed, not worth a watcher today: **Екзакта** (exacta.bg — WordPress but `wp-json` returns HTML and the
RSS is empty), **Естат** (estat.bg — publishes business-climate indices, no electoral polls), **НЦИОМ**
(parliament.bg SPA; the `/api/v1/nciom*` guesses return the shell). **Барометър България**, **ИМП** and
**Online solutions** appear in the 2016 presidential Wikipedia table and nowhere else.

**None of the reachable sites is Cloudflare-challenged** (no `cf-chl` / Turnstile on any of them), so no
headed Playwright session and no VPN question in this pipeline — Gallup's failure is a TLS misconfiguration
on the zone, not a challenge, and would not be solved by a browser either (measured).

### 2.1 Coverage completeness — every agency that polled the last five cycles (Wikipedia tables read 2026-09-06)

| cycle                 | agencies in the polling table                                                                                        | not covered by a site watcher                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| parliamentary 2026    | Gallup (7), MarketLinks (11), Myara (6), Trend (6), Alpha Research (6), Sova Harris (3), ЦАМ (2)                     | ЦАМ → `polls_press`                                                      |
| parliamentary 2024-10 | Market Links (5), Alpha Research (2), Trend (2), Exacta (1), Sova Harris (1), Mediana (1)                            | Exacta, Mediana → `polls_press`                                          |
| parliamentary 2024-06 | Gallup, Alpha Research, Trend, Market Links                                                                          | —                                                                        |
| presidential 2021     | ЦАМ, Барометър България, Gallup, Market Links (**no citations on any row**)                                          | ЦАМ, Барометър → `polls_press` / Tier 4b                                 |
| presidential 2016     | Галъп (4), Маркет Линкс (5), Медиана (3), Алфа Рисърч (3), Сова Харис (2), ЦАМ (2), ИМП, Online solutions, Барометър | Медиана, ЦАМ, ИМП, Online solutions, Барометър → `polls_press` / Tier 4b |

So **no active agency lacks a watcher**: every pollster that published in 2024–2026 is either a site source or
a `polls_press` query. The alias map (decision 14) gains `Екзакта`, `Барометър България`, `ИМП` and
`Online solutions` so the press arm and the cross-check recognise them, each with `reach: "press"`.

Three consequences that shape the design:

- **There is no one format.** Text (TR, AR, MY), born-digital PDF (ML, GM), images (SH), and press-only
  (MD, AF, CAM). One extractor per agency, one evidence gate for all of them.
- **The passport and the numbers are often in different media** (TR: text + image; SH: image + image), so a
  poll is assembled from more than one capture and each field carries its own evidence pointer.
- **A press arm is not optional.** Three of the nine corpus agencies have no site at all, and the corpus
  already has a tier for that (`third_party_consensus`, „verified across multiple independent press citations
  that all agree"). Google News RSS answers the discovery half of that with one request per agency — and
  ONLY the discovery half (§6.1).

## 3. What the presidential Wikipedia pages show (verification-only, but they define the SHAPE)

| page | polls table                                                                       | shape                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026 | 1 sortable table, **1 poll** (Глобал Метрикс, 23 юни – 11 юли 2026, n=1503)       | columns are **party placeholders** — „Кандидат на ПБ", „Кандидат на ПП-ДБ", … „Кандидат на МЕЧ", then Други / Не подкрепям никого / Преднина; header „Социологическа агенция / Период на проучването / Извадка"                                                                                                                                                                                                                  |
| 2021 | 1 table (not sortable), 4 polls (ЦАМ, Барометър, Gallup, Market Links)            | **named candidates** (Радев, Герджиков, Карадайъ, Панов, Костадинов …) + Други / Не подкрепям никого; header „**Източник / Дата**"; **no citations at all** — every source must be found elsewhere (Tier 4b)                                                                                                                                                                                                                     |
| 2016 | **two** tables (not sortable): round 1 (12 rows) and **runoff pairings** (9 rows) | R1: named candidates + Други / Не подкрепям никого / Нерешили / Няма да гласува / **Общо** (98.8%, 100.3% — the rows do not sum to 100); runoff: one row per PAIRING, several per agency on one date (Alpha Research 13.10.2016: Цачева–Радев 32.6/31.3 AND Цачева–Каракачанов 31.3/25.1); header „**Агенция / Дата**"; cites: btv, offnews, epicenter, bta, focus-news, and **Wayback captures of the AR and GIB agency pages** |
| 2011 | 1 „Прогнози" table, 3 rows                                                        | named candidates, published-date only; header „**Публикувано / Институт**"                                                                                                                                                                                                                                                                                                                                                       |

So a presidential poll is not a party poll with different labels. It needs: a **candidate** dimension
(named, or a party placeholder before nomination), **runoff pairings** as a separate fact (many per poll),
residual columns that the parliamentary model already has, and a total that is allowed to be ≠ 100. §7
carries the schema. And the cross-check parser needs the four header vocabularies above (§6.5): today's
`parseTable()` recognises only the 2026 one.

## 4. Fixed v1 decisions

1. **Primary source = the agency's own publication. Wikipedia = cross-check, never an ingest input.**
   `scrape_polls.ts` stops writing `polls.json`. It becomes `polls:crosscheck` (§6.5): it reads the
   parliamentary AND presidential cycle pages, diffs against the corpus, and prints (a) polls on Wikipedia
   with no corpus row — an agency we do not watch, or a publication the lister missed — and (b) rows
   whose value differs from the locked corpus value by more than 0.5 pp. It never merges. The
   `--seed-izboriai` path and `mergePolls` are deleted with it; the `locked`/`genre` guard they protected
   is now enforced by there being no writer.
2. **One watcher source per agency, plus one press-discovery source.** Ids `polls_trend`,
   `polls_alpha_research`, `polls_market_links`, `polls_sova_harris`, `polls_myara`, `polls_global_metrics`,
   `polls_gallup`, `polls_press`. Not a composite like `council_minutes`: eight lines in the daily report is
   cheap, an agency's outage (Gallup, today) errors its own line only, and `describe()` names the
   publication. All map to `update-polls`; the orchestrator already dedupes many→one.
3. **Fingerprints are MONOTONIC — the newest electoral publication id, never a hash of the visible set.**
   Every listing here is a bounded window (25 newest projects, 12 posts per blog page, one news page), so a
   set-hash flips when an OLD item scrolls off the page and reports a change nobody made — the twitchy-count
   shape `council_minutes.ts` solved with high-water marks. Publication ids ascend on every site (WordPress
   post ids; AR `/post/1052-`; ML `-118.html`), so `value = String(maxElectoralId)`, `meta.newestId` and
   `meta.items` = the electoral items with `id > prev.meta.newestId` (on first run: every electoral item on
   the first page, which is the backlog T3.4 ingests). `polls_press` has no ascending id and uses
   `max(pubDate)` + that item's GUID. `describe()` = „+N electoral publication(s): <title> (<date>)".
4. **The lister is ONE module per agency, imported by both the watcher and the ingest.** The watcher
   fingerprints from `listPublications()`, and the ingest fetches the items the watcher named. Two copies of
   „what counts as an electoral publication" is how the watcher would flip on a post the ingest then ignores.
   The watcher never opens a post or a PDF — one request per source (the run has a per-source cap and the
   whole `npm run watch` is budgeted), so a lister returns `publishedAt: null` where the listing has no date
   (AR) and the INGEST fills it from the post.
5. **Every number needs quoted evidence, and a fabricated number attached to a real sentence must fail.**
   The gate is `scripts/opencalls/enrich_gate.ts` (`runGate`, `isGrounded`, `valueSupportedByQuote`,
   `MIN_QUOTE_CHARS`), reused: the quote occurs in the extracted text, AND the quote states the label and the
   value. This is what makes an LLM fallback extractor safe to run at all (§6.2). Both checks are
   mutation-tested with the exact cases that plan records (a fabricated `999` cited from a real sentence;
   `0.6` cited from „60 %").
6. **The `fieldwork` string is a CONTRACT, produced by one function.** The analyzer's `parseFieldworkEnd`
   accepts exactly `"Mar 12-20 2026"`, `"Feb 23 - Mar 2 2026"`, `"Mar 19 2026"` and `"through Mar 2 2026"`
   (plus a fuzzy month-only fallback the extractor must never emit), and the poll id is
   `<agency>-<fieldworkEndIso>`. `formatFieldwork(startIso, endIso | null)` lives in `src/data/polls/`
   (DOM-free, the `aliases.ts` precedent) and is the only writer; the extractor stores `fieldworkStart` /
   `fieldworkEnd` as ISO in `provenance` beside the formatted string, and `polls_corpus.test.ts` round-trips
   every `fieldwork` through `parseFieldworkEnd`.
7. **Auto-extracted polls land in an INBOX, and one command promotes them. A locked poll is never
   overwritten.** `data/polls/_inbox/<pollId>.json` carries the draft plus evidence; `npm run polls:accept --
<pollId>` writes `polls.json` / `polls_details.json` with `locked.by` set from the capture kind and
   `locked.note = "auto-extracted; evidence in provenance"`. The skill prints the evidence table and asks
   the operator once per run, the way `enrich-open-calls` promotes one row at a time. `polls:fetch` skips a
   `pubId` whose `SOURCE.json` exists unless `--force`; a re-fetch whose `sha256` differs (an agency
   re-issuing a corrected PDF at the same URL) is captured as `<pubId>.v2` and drafted as `<pollId>.v2`;
   `accept` REFUSES to replace a locked poll unless `--replace`, and then records the superseded values in
   `provenance.supersedes`. An unattended `--auto-accept` is Tier 5 (⚑ §11.2). Inbox drafts are COMMITTED
   (pretty-printed) — an unaccepted draft is a visible debt, the upload-manifest argument — and excluded
   from the bucket (§6.4).
8. **Genre is decided per publication from the BASE PHRASE, recorded verbatim, and „unclear" is a
   first-class answer.** TR „сред заявилите, че ще гласуват" → `raw_attitudes`; AR „от сигурните, че ще
   гласуват" → `raw_attitudes` unless the text says „прогноза" / „прогнозен резултат" (the corpus has AR
   forecast 10 / raw 3, so the agency default is NOT a safe rule); ML „among firm-intent voters, undecided
   N%" → `raw_attitudes` with `residual.undecided`. The phrase is stored as `provenance.basePhrase` so genre
   can be re-derived; a publication whose base phrase the extractor cannot find gets `genre: "unclear"` and
   is flagged in the inbox — never guessed, per the corpus rule. **A `raw_attitudes` draft with no
   `residual` is flagged too**: the analyzer redistributes `undecided + wontSay` before scoring, so a missing
   residual scores the raw shares as-is and inflates that agency's MAE against its peers.
9. **The corpus files stay MINIFIED single-line JSON; drafts are pretty.** `accept` writes with
   `JSON.stringify` like the scraper did (byte-parity with the existing files, ~25% smaller on the wire), and
   `polls_corpus.test.ts` asserts the single-line form — `prettier --check data/polls/*.json` fails today and
   was never the gate the memory note believed it was. `_inbox/*.json` and `provenance` are for humans and
   are pretty-printed.
10. **Presidential polls are a SEPARATE file family** (`data/polls/presidential/`), sharing `agencies.json`,
    never a discriminator on the parliamentary files. Four consumers read `accuracy.json` and key on party
    keys and the parliamentary election list — `PollsScreen`, `PollsTile`, `AccuracyTrendsTile` and
    `computeRiskComposite` (the risk score reads polling accuracy) — and the AI's `latestPolls` reads
    `polls.json` whole; a candidate row leaking into the risk composite is the silent shape this repo warns
    about everywhere.
11. **`electionDate` is assigned from `UPCOMING_ELECTIONS`, an estimated date can never produce a score, and
    RESTAMP is one generic command.** For a presidential poll, `electionDate = 2026-11-08` today
    (`confidence: "estimated"`) and `cycle: null` until the catalogue carries the 2026 entry; the analyzer
    only scores a cycle whose `data/<cycle>_pvr/national_summary.json` exists. Parliamentary polls stay
    `electionDate: null` until a parliamentary vote is `scheduled` — the current behaviour. When a vote of
    either race becomes `scheduled` (or a date moves), `npm run polls:restamp -- --race
<parliamentary|presidential> --to <iso> [--cycle <id>]` stamps every null-dated (or previously-estimated)
    poll of that race whose fieldwork end lies after the previous election of that race and before the new
    date, then runs `polls:analyze` — the corpus convention is that every poll between two elections belongs
    to the later one (the 2017–2019 ML waves carry `2021-04-04`).
12. **Party-placeholder polls are kept and never scored.** „Кандидат на ПБ" measures whoever ПБ will nominate;
    it is a different question from „Илияна Йотова", so a placeholder row is never merged into the named
    candidate's series when the nominee is announced. Scoring uses named-candidate polls only — the same
    rule as `electionDate: null`.
13. **Raw captures are kept on disk under `raw_data/polls/<agency>/<pubId>/`** — the HTML, the PDF, and
    (SH only) the bulletin page images, plus `SOURCE.json` (url, fetchedAt, sha256, bytes; and
    `archiveUrl` when the capture came through Wayback). `.gitignore` lists specific `raw_data/` subtrees, so
    a new one is TRACKED by default; the rule is explicit: `raw_data/polls/**/*.{png,jpg,jpeg}` ignored
    EXCEPT `raw_data/polls/sova_harris/**` (its only primary), text / PDF / `SOURCE.json` tracked (≈0.3–1 MB
    per poll, ~50 polls a year). Whether that is right is ⚑ §11.1; the argument is the presidential plan's
    for its 20 MB — two of these hosts are already gone, and „the agency never archived a primary" is a
    case the corpus has nine times over.
14. **ONE home for the alias map and ONE for the types.** `AGENCY_ALIASES` moves from `scrape_polls.ts` to
    `scripts/polls/lib/agencies.ts` (the id, two alias tiers, a `reach: "site" | "press"` enum, press query
    strings), used by the
    listers, `polls_press`, the cross-check and `accept`; `agencies.json` stays the record store (names,
    website, ЕИК). Scripts import `Poll` / `PollDetail` / `PollLock` from `src/data/polls/pollsTypes.ts`
    (as `analyze_accuracy.ts` already imports `aliases.ts`) instead of the two private copies they carry
    today — the `provenance` and `race` fields would otherwise be added three times.
15. **No Postgres, no `:cloud` command.** `data/polls/` is bucket-served (no `-x` arm in `bucket:sync`
    matches `polls/`; `usePolls` reads `dataUrl("/polls/…")`), so the publish is `--paths polls` on the upload
    manifest and nothing else. If a serving need appears (a per-poll page, a cross-race agency profile) it
    gets a migration with a changelog, per the PG discipline notes.
16. **A presidential candidate is resolved to the ticket's `canonicalKey`, and a shared name is REFUSED, never
    graded.** `tickets.json` keys a ticket on the president's folded three-part name
    (`"румен георгиев радев"`, `"костадин тодоров костадинов"`); a poll prints two („Румен Радев"). The
    resolver folds the poll name, matches its first and last tokens against every ticket of the cycle, and
    accepts only when exactly ONE ticket matches — the `aop_expert_person_links()` rule, for the same reason:
    naming the wrong candidate under an agency's number is the harm. Before ЦИК registers the 2026 tickets
    there is nothing to resolve against, so keys are provisional (`first-last` slugs) and
    `npm run polls:presidential:rekey -- --cycle <id>` re-resolves them once `tickets.json` lands; a name the
    resolver refuses stays a provisional key and is listed, never scored. Because `canonicalKey` is stable
    across cycles (Радев 2016 → 2021 is one key, per the presidential plan), an agency's per-candidate bias
    can be pooled across cycles the way `CANONICAL_KEY` pools ГЕРБ / ГЕРБ-СДС today.
17. **A Wayback capture of the agency's own page is `agency_website`, with the archive URL recorded.** The
    lock tier describes WHOSE publication it is, not which host served the bytes; the 2016 Alpha Research and
    Gallup presidential pages exist only as `web.archive.org` captures (cited by Wikipedia itself), and
    refusing them would push the agency's own numbers into `third_party_consensus`, which describes them
    wrongly. `provenance.archiveUrl` carries the capture; `SOURCE.json` records both URLs. **An exit poll is
    not a pre-election poll** and never enters either corpus — Sova Harris's 06.11.2016 and 13.11.2016 posts
    are exit polls and are excluded by the classifier (⚑ §11.9 for a future exit-poll surface).

## 5. Tier 0 — guards and repointing (½ day)

- **T0.1** Register **Глобал Метрикс** (`GM`, globalmetrics.eu, ЕИК from the Commerce Registry via
  `/company` search) in `data/polls/agencies.json` and the alias map, plus the press-only names §2.1 lists.
  GM's July 2026 poll is the first presidential poll of the cycle and the first entry of the presidential
  corpus (Tier 4). Adding the row prerenders `/polls/GM` and adds its sitemap `<loc>` automatically
  (`buildPollsRoutes`); `PollsAgencyScreen` renders an agency with no `agencyProfile` (its `find` returns
  undefined and the card degrades) — verify once on the preview, since GM has zero scored polls.
- **T0.2** `polls_corpus.test.ts` — the corpus invariants that today hold by hand: every poll `locked`;
  ids unique and equal to `<agency>-<fieldworkEndIso>`; every `fieldwork` round-trips through
  `parseFieldworkEnd` to that id; every detail row's `pollId` exists; per-poll shares sum ≤ 100 + 0.5 unless
  `genre = "forecast"` (forecasts renormalise to 100); no `source` on a Wikipedia host unless
  `locked.by = "third_party_consensus"`; the files are single-line (decision 9); `_inbox/` is ignored.
- **T0.3** Relabel `wiki_polls` → „BG Wikipedia polls (cross-check only)" — the label PREFIX „BG Wikipedia
  polls" is what the orchestrator matches, so it stays — and repoint the `process-watch-report` row and
  `scripts/data_map/model.ts` (`src:wiki` members) so `/data` stops describing Wikipedia as the polls source.
  Add the presidential cycle page to the same source (one more request; `describe()` names the page).
- **T0.4** The cadence invariant: every new source declares `publishes: "weekly"` (campaign rhythm) and
  `cadence: "daily"`; `cadence.test.ts` covers the rest, including its „never regresses the number of sources
  declaring `publishes`" ratchet.
- **T0.5** The single homes (decision 14): move `AGENCY_ALIASES`, import the types, add `formatFieldwork`
  beside `parseFieldworkEnd`'s accepted forms — and move `parseFieldworkEnd` itself into `src/data/polls/`
  so the two halves of the contract sit in one file.

## 6. Tiers 1–3 — the parliamentary pipeline

### 6.1 Tier 1 — listers and watchers (2 days)

`scripts/polls/agencies/<agency>.ts`, each exporting:

```ts
export interface Publication {
  id: number; // ascending on every site — the fingerprint rides it
  url: string;
  title: string;
  publishedAt: string | null; // null where the listing has no date (AR); the ingest fills it
  kind: "html" | "pdf" | "images";
  attachments: string[];
}
export const listPublications: (opts: {
  limit?: number;
  after?: string;
  before?: string;
}) => Promise<Publication[]>;
export const isElectoral: (p: Publication) => boolean; // title/category rule, per agency — presidential titles included
```

| agency | `listPublications`                                                                                                                                          | `isElectoral`                                                                                                | notes                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| TR     | `wp-json/wp/v2/project?per_page=25&_fields=id,date,link,title` (+ `after`/`before` for archive walks)                                                       | title ∋ „електорални нагласи" / „партии" / „избори" / „президент"                                            | the monthly „Обществени нагласи спрямо основните институции, партии …" ALSO carries party support — include it |
| AR     | `/blog/?page=1`, then `<a href="/post/">` inside `#content` **only**; id = the leading number of the slug; `publishedAt: null`                              | title ∋ „нагласи" ∧ (електорал / избор / партии / президент)                                                 | refuse any href outside `alpharesearch.bg` — the injected-spam gate (T1.6)                                     |
| ML     | `/bg/news.html`; id = the trailing `-<n>` of the slug; date from the listing card; PDF href resolved at ingest                                              | title starts „Обществено–политически нагласи" or ∋ „социално-политическите нагласи"                          | the item page carries ONE PDF link                                                                             |
| SH     | `wp-json/wp/v2/posts?categories=<Проекти YYYY, Прогнозни YYYY>` — resolve the category ids by NAME each run (`/categories?per_page=100`), they are per-year | title ∋ „политически нагласи" / „електорални" / „прогноз" / „президент"; **exit polls (∋ „екзит") excluded** | attachments = the `Buletin_*_page-NNNN.jpg` set, read from the post content at ingest                          |
| MY     | `wp-json/wp/v2/posts?categories=98,114` (Електорални нагласи, Electoral attitudes)                                                                          | always                                                                                                       | —                                                                                                              |
| GM     | `wp-json/wp/v2/posts`                                                                                                                                       | title ∋ „нагласи" / „президент" / „избори"                                                                   | attachments = the PDFs in the content, at ingest                                                               |
| GIB    | `wp-json/wp/v2/posts` — **two-arm** (below)                                                                                                                 | title ∋ „electoral" / „политическ" / „партии" / „president"                                                  | —                                                                                                              |

All requests carry a browser `User-Agent` (the watcher default `electionsbg-watch/1.0` is what most CMSes
block, per `council_minutes.ts`); `viaCurl` stays available for a host that fingerprints Node's TLS.

`scripts/watch/sources/polls_<agency>.ts` — decision 3's monotonic fingerprint, `meta.items` = the new
electoral publications (id, url, title, publishedAt) so the ingest reads what to fetch from `state/watch/`,
labels „Polls — Тренд (rctrend.bg)", „Polls — Алфа Рисърч", „Polls — Маркет ЛИНКС", „Polls — Сова Харис",
„Polls — Мяра", „Polls — Глобал Метрикс", „Polls — Галъп (site + press)", „Polls — press discovery (agencies
without a site)" (distinct prefixes; the orchestrator matches on them). Errors throw (the runner's `error`
branch), except:

- **`polls_gallup` is two-armed**: the site (wp-json) and the Google News RSS query
  `"Галъп" проучване партии`. The fingerprint is the union; `detail` names which arm answered; a single arm
  failing is recorded in `meta.armErrors` and only both failing throws. The site is down TODAY with a TLS
  error every client rejects, and a source that errors every day for months is the „cries wolf" failure
  `municipal_fiscal_due.ts` was written to avoid — while the press arm (39 items, current to 2026-08-06)
  keeps reporting the polls Gallup gives to the press. When the site is back, the site arm resumes with no
  code change. A Gallup poll reached only through the press arm is locked `third_party_consensus` like any
  other press-verified poll until the site publication is captured.
- **`polls_press`** covers every alias-map agency with `reach: "press"` — Медиана, АФИС, ЦАМ, Екзакта,
  Барометър, ИМП, and any name added later — and DEDUPES against the site sources by construction (Gallup
  is not queried here): one Google News RSS query per agency (`hl=bg&gl=BG&ceid=BG:bg`), electoral-title
  rule, fingerprint on the newest `pubDate` + GUID. ⚠ **The feed gives discovery, not the article**: each
  item's `<link>` is a `news.google.com/rss/articles/<token>` behind a `consent.google.com` redirect that no
  server-side client resolves (measured), so the usable fields are `<source url>` (the outlet), the title
  and the date. The skill resolves the article on the OUTLET — bTV's `/search/?q=` works (200, results);
  mediapool's and dir.bg's search URLs 404 — or through the Wikipedia cite notes the cross-check prints. A
  flip maps to `update-polls` Step 4 (third-party verification), not to an extractor. Google News RSS is a
  dependency this repo does not have yet — ~7 requests a day; rate-limiting surfaces through the runner's
  `error` branch.

- **T1.6** Gates: one fixture test per lister (a saved listing page / wp-json body → the expected
  `Publication[]`), `isElectoral` truth tables (a presidential title on each site classifies as electoral; an
  exit-poll title does not), the AR spam gate (a listing fixture with the injected links must yield zero of
  them), **fingerprint monotonicity** (a listing fixture with the oldest item removed must NOT change the
  fingerprint; one with a new higher id must), watcher `describe()` tests, the Gallup two-arm union and
  single-arm degrade, and the orchestrator map rows (T3.2).

### 6.2 Tier 2 — capture and extraction (3 days)

`npm run polls:fetch -- [--since <iso>] [--agency TR] [--pub <id>] [--url <u>] [--archive <waybackUrl>]
[--force]` — for each electoral publication newer than the last ingest: save the page HTML, every PDF
attachment, and (SH) the bulletin images under `raw_data/polls/<agency>/<pubId>/`, with `SOURCE.json`; skip
a captured `pubId` unless `--force`; version a changed hash as `.v2` (decision 7). `--url` captures a press
article for the third-party path; `--archive` captures a Wayback snapshot of an agency page (decision 17).

`npm run polls:extract -- [--pub <id>]` — text acquisition, then one extractor per agency, then the gate:

| agency | text acquisition                                                                                                                                                                                 | deterministic extractor                                                                                                                                                  | residual / passport                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| TR     | article container text (`.et_pb_post_content`) + tesseract `bul --psm 6` over the passport slide                                                                                                 | sentence rule: `<party> … <n>,<d>%` within one clause                                                                                                                    | passport from OCR („N ефективни интервюта", „Период на провеждане: D-D месец YYYY", „Възложител"); undecided when the text states it |
| AR     | `#content` text only, spam tokens stripped                                                                                                                                                       | sentence rule                                                                                                                                                            | passport in text („в периода D-D месец YYYY", „сред N пълнолетни"); „не подкрепям никого" / „нерешили" when stated                   |
| ML     | `pdftotext -layout`                                                                                                                                                                              | aligned-row rule: `^\s*(Коалиция )?<label>\s{2,}<n>\.<d>%` in the block after „Ако тази неделя има парламентарни избори"                                                 | passport rows „Обем на извадката", „Метод на регистрация", „Период"; undecided from the „Не съм решил" row of the same block         |
| GM     | `pdftotext -layout` on both PDFs                                                                                                                                                                 | same aligned-row rule; both the candidate-name and the „Кандидат на <party>" framing (presidential, Tier 4)                                                              | passport in the press release                                                                                                        |
| MY     | article text                                                                                                                                                                                     | sentence rule („<party> би спечелила <n>,<d>%", „<party> – <n>,<d>%")                                                                                                    | activity from text; sample when stated, else null and flagged                                                                        |
| SH     | tesseract `bul` over EVERY page image, then keep the pages carrying ≥ 4 party labels; Gemini Vision (`scripts/council/lib/gemini_ocr.ts`, `GEMINI_FLASH`) as the fallback when no page qualifies | table rule over OCR lines; `%`→`96`/`9б` artefacts normalised BEFORE the gate (the quote is checked against the normalised text, and the raw OCR line is kept beside it) | passport from the methodology page (measured recoverable)                                                                            |
| GIB    | when reachable: article text; a Wayback capture reads the same way                                                                                                                               | sentence rule                                                                                                                                                            | —                                                                                                                                    |
| press  | article text of a captured outlet page (`--url`)                                                                                                                                                 | sentence rule; a poll is drafted only when TWO captures from independent outlets agree on every share                                                                    | the second capture's agreement IS the provenance (`third_party_consensus`)                                                           |

Party labels go through `normKey` + `POLL_TO_ACTUAL` (`src/data/polls/aliases.ts`) — the alias table is
extended, never forked; candidate names go through the resolver of decision 16. Then the gate (decision 5):
every share, the sample size and each fieldwork date must carry a quote that (a) occurs in the extracted
text and (b) states that value beside that label. A field failing either is DROPPED and listed under
`refused` in the inbox draft; a draft with no accepted shares is written anyway so the operator sees what
the parser could not read. The draft carries `fieldwork` from `formatFieldwork` (decision 6), `genre` +
`basePhrase` (decision 8), `electionDate` / `cycle` (decision 11), the `race` the classifier chose, and
`provenance = { url, archiveUrl?, fetchedAt, sha256, extractor, fieldworkStart, fieldworkEnd, basePhrase,
quotes }`.

**LLM fallback, gated identically.** When the deterministic extractor yields < 3 shares, or the operator
passes `--llm`, the same text is sent to Gemini (`GEMINI_FLASH`, `scripts/lib/gemini_models.ts`) with the
draft schema and „every value with a verbatim quote"; the output goes through the SAME gate. The
`enrich-open-calls` plan measured why the second check is not redundant — a model that answers from memory
and hunts for a sentence to cite passes the substring test. Claude is not in this path: the skill runs
inside Claude already, and the operator's review IS the Claude pass.

**Inbox and accept.** `data/polls/_inbox/<pollId>.json` = `{ race, poll, details, runoffs?, residual, genre,
evidence, refused, extractor }`. `npm run polls:accept -- <pollId> [--genre forecast] [--election <iso>]
[--cycle <id>] [--replace]` merges into the race's `polls.json` / `polls_details.json` (and `runoffs.json`)
(minified, decision 9), sets `locked = { by, lockedAt, note }` and `provenance`, deletes the inbox file,
refuses a locked target without `--replace` (decision 7). `npm run polls:analyze -- --race <r>` runs from
`accept` ONLY when the accepted poll has a scorable target (an `electionDate` for parliamentary; a `cycle`
whose results tree exists for presidential) — and from `polls:restamp` always — so the byte-stable rule for
inter-election waves is kept by construction rather than by remembering it.

- **T2.7** Gates: fixture per extractor (a saved pdftotext / article text / OCR text → the expected draft —
  the July 2026 ML PDF, the April 2026 TR and AR posts, the April 2026 MY post, one SH bulletin page, the GM
  July 2026 PDFs); the gate's two mutation cases; `accept` round-trip (inbox → corpus → `polls_corpus.test.ts`
  green, single-line output); `accept` refusing a locked target; `restamp` stamping exactly the polls inside
  the window and running the analyzer; a determinism test (extracting the same capture twice is
  byte-identical); the residual flag on a `raw_attitudes` draft without one.

### 6.3 Tier 3 — the skill and the orchestrator (1 day)

- **T3.1** Rewrite `.claude/skills/update-polls/SKILL.md` (and fix its stale `public/polls/*.json` paths —
  the corpus is `data/polls/`): 0. read `state/watch/polls_*.json` (`meta.items`) and `state/ingest/update-polls.json`; list what is new,
  by race;
  1. `polls:fetch`, 2. `polls:extract`, 3. print the evidence table (race · agency · fieldwork · n · genre ·
     residual · shares with quotes · refused fields · unresolved candidate names) and `polls:accept` what the
     operator confirms;
  2. **third-party verification** for `polls_press` flips: resolve the article on the outlet (§6.1), capture
     with `--url`, lock as `third_party_consensus` only when ≥ 2 independent outlets agree on every figure —
     the corpus's existing rule, now with the press arm finding the citations;
  3. `polls:crosscheck` (Wikipedia diff; §6.5) — report only. A run where ONLY `wiki_polls` flipped does
     Steps 0 and 5 and still stamps: the flip was handled, and that is what stops it re-queueing;
  4. narrative (`analysis.json`) — only for a NEW election of either race (a `cik_presidential` flip after
     the results land is the presidential case, T4.7), unchanged from today's Step 4; `agencyTakes` stays
     one-per-`agencyProfiles` entry, so an agency with no scored polls (GM) needs none;
  5. stamp `stamp-ingest update-polls --summary "<BG one-liner, as every other entry>"`,
     `append-data-change update-polls` (its `/polls` link already exists in `linksForSkill`), and the upload
     manifest `--paths polls` (plus `data-changes.json`, `data_map.json` as usual).
     Troubleshooting table = the §2 traps in operator form (frozen TR RSS, AR spam, SH image-only, ML PDF
     name pattern, Gallup TLS, Google News link tokens, a `.v2` capture, a refused candidate name).
- **T3.2** `process-watch-report`: eight new map rows (`polls_*` → `update-polls`), the `wiki_polls` row
  reworded to „cross-check step of update-polls, never an ingest on its own", the presidential race noted as
  the same skill (`--race presidential` on the CLIs, not a second skill), **and one coupling row**:
  `cik_presidential` → `update-presidential-elections` **then** `update-polls` (the presidential accuracy +
  narrative, T4.7) — the same shape as the map's existing `cik_results` → `update-persons` coupling. That
  watcher and skill are the presidential plan's T7.1/T7.2; this plan adds the second hop to the row, and
  §11.10 records that the presidential plan's T7.2 needs the matching last step.
- **T3.3** `scripts/data_map/model.ts`: a new source node `src:pollsters` („Социологически агенции",
  `origin: "primary"`) with the seven site sources and `polls_press`; `src:wiki` keeps `wiki_polls` as a
  cross-check. **This lands in the SAME commit as the watcher sources**: `npm run data:map`
  (`build_manifest.ts`) validates every registered `SOURCES` id against the group members and
  `WATCH_ONLY_SOURCES` and FAILS on an unplaced one, and `data_map.json` is committed and bucket-synced.
- **T3.4** Run it on the real backlog, which is the acceptance test: GIB 2026-08-06 (press arm), GM
  2026-07-28 (presidential — inboxed now, scored never until 2026 results), and every TR / AR / ML / MY / SH
  electoral publication since the last hand-add — the ML Jul 2026 and AR Jul 2026 rows already in the corpus
  must come out IDENTICAL from the extractor (that is a mutation check on the whole pipeline, and it is
  free). The new sources report `first-run` and the marker's bootstrap stamp (2026-05-11) is the `--since`.
- **T3.5** The AI chat: `ai/tools/pollsDepth.ts` keeps working unchanged on the parliamentary files
  (`provenance` is additive), and `ai/tests/regression.ts`'s polls follow-ups are re-run after T3.4 because
  „What do the latest polls show?" changes answer the moment a new wave lands.

### 6.4 The upload

`--paths polls` on the manifest; `/upload-watch-changes` runs `bucket:sync:paths -- polls` (the
`presidential/` subtree rides the same path). No `:cloud` entry. `data/polls/_inbox/` and `raw_data/` never
reach the bucket: `_inbox` joins the sync exclusions in `scripts/bucket_sync_paths.ts` — `isExcluded` and its
`CHILD_EXCLUDES` twin, plus the `-x` arm of `bucket:sync` / `bucket:sync:dry` — the three places
`bucket_sync_paths.test.ts` holds in lockstep; `bucket:gz` (`scripts/bucket_gzip.ts`) imports `isExcluded`
and follows it. `isExcluded("polls")` must keep answering null so the scoped sync of the corpus itself is not
refused.

### 6.5 The cross-check (what Wikipedia is still for)

`npm run polls:crosscheck -- [--race parliamentary|presidential] [--cycle <id>]` reads the cycle pages with
the existing `parseTable()` — extended to the four header vocabularies §3 measured (`Социологическа агенция /
Период на проучването / Извадка`, `Агенция / Дата`, `Източник / Дата`, `Публикувано / Институт`) and to the
residual/total columns (`Нерешили`, `Няма да гласува`, `Общо`), and reading a table whose rows carry exactly
two non-null candidate cells as RUNOFF PAIRINGS — keys rows on `(agency alias, fieldwork end)`, and prints
three lists: **missing here** (on Wikipedia, not in the corpus — with the cite-note URL, which is usually
the agency's own page and therefore the URL `polls:fetch --url` / `--archive` should capture), **missing
there** (in the corpus, not on Wikipedia — informational; Trend's November 2021 presidential poll is one),
and **disagreements** (> 0.5 pp on any label, or a different sample size). Exit 0 always; it is a report.
The skill quotes it in its summary, and Tier 4b uses it as the index of what to source.

## 7. Tier 4 — presidential polls (2 days; unblocked — the results tree exists)

### 7.0 End to end — every stage, what carries it, what proves it

| stage           | mechanism                                                                                                                                                                                                            | gate                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| discover        | the SAME eight watchers — a presidential publication is an electoral publication (`isElectoral` includes „президент" / „president"; `polls_press` queries carry it too)                                              | `isElectoral` truth tables include a presidential title per site (T1.6)                       |
| classify        | `classifyRace(text, title)` → `presidential` on „президент" / „балотаж" / „кандидат за президент" / a candidate-column header; else `parliamentary`; a GM-style publication carrying BOTH framings yields two drafts | GM July 2026 fixture yields a named draft AND a placeholder draft (T4.1)                      |
| extract         | T4.1 arms: named candidates, placeholders, runoff pairings, residuals                                                                                                                                                | extractor fixtures; the evidence gate                                                         |
| resolve         | decision 16 — `canonicalKey` or provisional slug, refusal listed                                                                                                                                                     | resolver uniqueness + mutation test (T4.5)                                                    |
| inbox → accept  | the shared inbox; `accept --cycle`; `runoffs.json` written beside the details                                                                                                                                        | `accept` round-trip on the presidential files                                                 |
| stamp the cycle | `cycle: null` + `electionDate` estimated until the catalogue has 2026; `polls:restamp --race presidential --cycle 2026_<date>_pvr` when the decree lands (decision 11); `polls:presidential:rekey` when tickets land | restamp test; rekey test (a provisional key becomes a `canonicalKey`, an ambiguous one stays) |
| score           | T4.2 — runs from `accept`/`restamp` when the cycle's results tree exists, and from the `cik_presidential` coupling the day results land (T4.7)                                                                       | analyzer fixture over the REAL 2021 tree (T4.5)                                               |
| narrate         | `update-polls` Step 6 for the new cycle                                                                                                                                                                              | `analysis.json` shape test                                                                    |
| render          | T4.4 — the presidential page band, `/polls`, the agency page, the AI arm                                                                                                                                             | prerendered band present in `dist/`; exhaustiveness (T4.5)                                    |
| publish         | `--paths polls`; the prerendered pages ship with hosting                                                                                                                                                             | `bucket_sync_paths.test.ts`                                                                   |
| verify          | `polls:crosscheck --race presidential` against the cycle page                                                                                                                                                        | cross-check vocab test                                                                        |

**Files** — `data/polls/presidential/`:

```
polls.json           Poll + { race: "presidential", cycle: "<round-1 date>_pvr" | null }
polls_details.json   { pollId, agencyId, candidateKey, candidateName_bg, candidateName_en,
                       nominator: string | null, placeholderFor: partyKey | null, support }
                     candidateKey ∈ tickets.json[].canonicalKey | "provisional:<first-last>" | "none" (Не подкрепям никого)
runoffs.json         { pollId, agencyId, a: candidateKey, b: candidateKey, supportA, supportB,
                       residual: PollResidual | null }
candidates.json      per cycle: candidateKey, names, nominator, ticket number once ЦИК registers it
                     (NULL before), colour — a PROJECTION of tickets.json plus the provisional keys,
                     rebuilt by polls:presidential:rekey; never hand-edited
accuracy.json        per cycle: R1 per-candidate errors per agency (last poll), MAE / RMSE,
                     leaderCalled, runoffPairCalled, decidedInRoundCalled, runoff pairing error for the
                     pairing that happened, daysBefore round1Date; agency profiles across cycles keyed
                     on canonicalKey; backfill ledger per cycle (Tier 4b)
analysis.json        narrative, same shape as the parliamentary one, keyed by cycle id
```

- **T4.1** The presidential extractor arms: candidate rows (named), placeholder rows („Кандидат на <party>"
  → `placeholderFor`), runoff pairings („балотаж", „втори тур", „ако на балотажа са X и Y"), and
  `classifyRace`. GM July 2026 is the fixture: the same PDF carries a named row (Йотова 30.9%) and the
  placeholder block (39.7% … 2.2%), and both must come out, separately.
- **T4.2** `scripts/polls/presidential/analyze_accuracy.ts` — reads the REAL files (`nationalSummary.ts`
  types, checked 2026-09-06): `rounds[].ranking[]{ number, president, shareOfValid, votes }`,
  `rounds[].votes.noneOfTheAbove` / `.valid` (the „Не подкрепям никого" actual — a scored row whenever the
  poll carried it), `decidedInRound`, `winner`, `rounds[].outcome.winsOutright`, and `tickets.json[].canonicalKey`
  for the join. Scored, per agency's LAST poll before `round1Date`: per-candidate error (polled −
  `shareOfValid × 100`) over named candidates with actual ≥ 1% plus the polled minors folded into „други";
  MAE / RMSE; `leaderCalled` (polled top-1 = actual top-1); `runoffPairCalled` (polled top-2 set = actual
  top-2 set); `decidedInRoundCalled` (a poll putting the leader > 50% against `winsOutright`); runoff
  error for the pairing that happened (vs round 2 `shareOfValid`), from `runoffs.json`. The winner rule is
  the presidential plan's decision 5 and is NOT re-derived (`decidedInRound` is read, never recomputed).
  Named-candidate polls only (decision 12). The 2021 tree is the fixture: Радев 49.42% round 1, runoff
  Радев–Герджиков, `decidedInRound = 2`.
- **T4.3** `candidates.json` for 2026 is minted from ЦИК's registration when it exists; until then the
  placeholder and provisional keys are the only keys, which is correct — nothing to score yet.
- **T4.4** Surfaces — **mirror the parliamentary dashboard's polling band, not a new idea.**
  `DashboardCards.tsx` mounts `<DashboardSection id="polling">` with `PollsTile` (the selected election's
  agency leaderboard by MAE + the narrative's first headline) and `AccuracyTrendsTile` (MAE per agency across
  elections). The presidential country page (`/presidential/:cycle`, presidential plan Tier 5) gets the same
  band after its outcome panel: `PresidentialPollsTile` (that cycle's agencies by R1 MAE, with the
  leader/runoff-pair calls and the headline) and `PresidentialAccuracyTrendsTile` (per agency across 2011 →
  2016 → 2021 → 2026), both reading `data/polls/presidential/` through a `usePresidentialPolls()` hook family
  keyed on the cycle from the route, never on `ElectionContext.selected`. A cycle with no scored polls
  renders the „no polls verified for this cycle" state with the backfill ledger's count, never an empty
  band. `/polls` gets a presidential section (⚑ §11.3), `PollsAgencyScreen` lists an agency's presidential
  polls under a second heading. Every new string gets a key in BOTH `src/locales/{bg,en}/translation.json`
  (74 `polls_*` keys exist; the `key_usage` gate refuses unreachable ones; `dashboard_section_polling`
  is reused). The presidential PRERENDER body (presidential plan Tier 6, `bodyBuilders`) must read the
  polls files at build time so the band is in the static HTML, as `buildPollsBody` does for `/polls`. The
  `/polls` prerender's `<title>` and JSON-LD say „парламентарни избори" today — widen them, or the page
  declares a narrower scope than it shows. Prerender + sitemap `<loc>` + og:image per the dashboard-hub rule
  (three artifacts) if a new route is chosen; `ogAndSitemapCoverage.test.ts` holds it.
- **T4.5** Gates: extractor fixtures (GM); the resolver — exactly-one match resolves, a name matching two
  tickets is refused (a fixture with two „Иван Иванов" tickets), and a mutation test that removes the
  uniqueness guard and asserts a refusal turns into a wrong resolution; the analyzer over the real 2021
  tree; `polls_corpus.test.ts` run over the presidential files (same invariants, plus: a runoff row's two
  keys exist in `candidates.json` or are placeholders / provisional; no placeholder or provisional row is
  ever scored — a mutation test that inserts one and asserts the analyzer ignores it; `Общо` may be ≠ 100);
  the presidential page band present in `dist/presidential/<cycle>/index.html`; and an exhaustiveness test
  that every parliamentary consumer of `accuracy.json` / `polls.json` — the four screens/tiles,
  `computeRiskComposite`, and `ai/tools/pollsDepth.ts` — reads the parliamentary files only.
- **T4.6** The AI chat: the presidential family is INVISIBLE to `latestPolls` / `agencyPolls` by
  construction (decision 10), so „What do the latest polls show?" would answer parliamentary-only during a
  presidential campaign. Add a `race` argument (or a `latestPresidentialPolls` arm) to `pollsDepth.ts`,
  register it, and add the follow-up + a regression case. ⚑ §11.7 decides whether that ships with Tier 4 or
  waits for the first named-candidate poll.
- **T4.7 Results → accuracy, wired, not remembered.** The day `cik_presidential` flips and
  `update-presidential-elections` writes `data/2026_<date>_pvr/national_summary.json`, two things must
  follow or the pages keep saying „no results yet": (a) that skill's last mechanical step runs
  `npm run polls:analyze -- --race presidential` (the presidential plan's T7.2 needs this line — §11.10),
  and (b) the orchestrator's coupling row (T3.2) queues `update-polls` for the narrative and the stamp.
  The parliamentary side has no such coupling because its results arrive through a hand-run `npm run
prod`; the skill's trigger table keeps „a new election just happened" for that race.

### 7.1 Tier 4b — historical presidential polls, sourced from the agencies (2 days, human-in-the-loop)

The parliamentary pages carry every agency's record back to 2013; the presidential pages must carry the
same for 2016 and 2021 (2011 is ⚑ §11.4), or the band on `/presidential/2021_11_14_pvr` is empty on the
day it ships. The Wikipedia tables are the INDEX of what to source (§6.5's „missing here" list); the numbers
come from the agencies. What today's probes found, per cycle:

| cycle | Wikipedia rows   | agency primaries found                                                                                                                                                                                                                                                                                                                                                                                                                                      | press-only rows                                                                                                                                                                                              |
| ----- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2016  | 12 R1 + 9 runoff | **TR** `rctrend.bg/project/президентски-избори-2016/` (2016-11-02; shares in the `zadl*.png` slides → OCR); **SH** „Политически нагласи в България, Октомври 2016" (site; its 06.11 / 13.11 posts are EXIT polls — excluded); **AR** and **GIB** as Wayback captures of the agency pages Wikipedia cites (`…/20161020…/alpharesearch.bg/…`, `…/20190604…/gallup-international.bg/bg/Публикации/2016/299-Presidential-…`) → `agency_website` per decision 17 | ML (btv, offnews), Медиана (offnews, epicenter), ЦАМ (btv, bta), ИМП / Online solutions / Барометър (offnews) → `third_party_consensus`, each needing a second outlet (bTV search; the outlet's own archive) |
| 2021  | 4, uncited       | **TR** `rctrend.bg/project/нагласи-на-българите-спрямо-предстоя-8/` (2021-11-09, „парламентарни и президентски избори" — NOT on Wikipedia at all; a „missing there" the cross-check will print); **GIB** via Wayback (a 2021-10-27 site snapshot exists); **ML** from the operator's spreadsheet (`agency_spreadsheet`, the tier the 2021-04 ML polls already carry) or press                                                                               | ЦАМ, Барометър → press                                                                                                                                                                                       |
| 2011  | 3                | none on any site                                                                                                                                                                                                                                                                                                                                                                                                                                            | Дневник / Медиапул archives, if kept at all (⚑ §11.4)                                                                                                                                                        |

- **T4b.1** `polls:fetch --archive` for the Wayback captures and `--url` for the press pages; the same
  extractors; the same gate; the same inbox and `accept --cycle`. Nothing here is a second pipeline.
- **T4b.2** `accuracy.json` carries a **backfill ledger** per cycle — every Wikipedia row → the corpus poll id
  it became, or a refusal reason (`no-primary`, `single-outlet`, `exit-poll`, `unresolved-candidate`) — so
  the page can say „11 of 12 polls verified" rather than showing a band that is quietly short, and so the
  cross-check's „missing here" for a backfilled cycle is EXPECTED to equal the ledger's refusals exactly
  (that equality is the gate).
- **T4b.3** The narrative for 2016 and 2021 (Step 6), written from the scored table like every
  parliamentary entry.

## 8. Tier 5 — the ⚑ decisions and the remaining backfills (1–2 days)

- **T5.1** 2011 presidential (3 rows, press-only) if ⚑ §11.4 says yes; otherwise the ledger says
  `no-primary` for the cycle and the band says so.
- **T5.2** `--auto-accept` (decision 7).
- **T5.3** Gallup recovery: when `polls_gallup`'s site arm answers again, backfill the electoral posts since
  the last locked GIB poll (2026-04) through the normal pipeline, and re-capture the press-verified ones
  from the site (a `.v2` with the agency's own numbers supersedes a `third_party_consensus` lock — the one
  `--replace` the corpus rules welcome).

## 9. Gates — the full list

| gate                  | file                                                  | what it holds                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| corpus invariants     | `scripts/polls/polls_corpus.test.ts`                  | every poll locked; ids unique and derived from `fieldwork`; details reference real polls; share sums; Wikipedia hosts only under `third_party_consensus`; single-line files; `_inbox` ignored — run over BOTH families |
| fieldwork contract    | `src/data/polls/fieldwork.test.ts`                    | `formatFieldwork` ↔ `parseFieldworkEnd` round-trip on every accepted form; the fuzzy form is never emitted                                                                                                             |
| listers               | `scripts/polls/agencies/*.test.ts`                    | fixture → `Publication[]`; `isElectoral` truth tables incl. a presidential title and an excluded exit poll; AR spam links refused                                                                                      |
| watchers              | `scripts/watch/sources/polls_*.test.ts`               | monotonic fingerprint (roll-off does not flip, a new id does); `describe()` lines; Gallup two-arm union and single-arm degrade; `polls_press` skips site-reach agencies; `cadence.test.ts` (existing)                  |
| extractors            | `scripts/polls/extract/*.test.ts`                     | fixture text → draft; determinism; residual flag on a raw draft without one; `classifyRace` on both framings                                                                                                           |
| evidence gate         | `scripts/polls/lib/evidence_gate.test.ts`             | the two mutation cases; an OCR `96`-for-`%` line normalised before checking                                                                                                                                            |
| candidate resolver    | `scripts/polls/presidential/resolve.test.ts`          | exactly-one resolves; a shared first+last is refused; the guard-removed mutation turns a refusal into a wrong key; provisional → `canonicalKey` on rekey                                                               |
| accept / restamp      | `scripts/polls/accept.test.ts`                        | inbox → corpus round-trip; the analyzer runs iff the target is scorable; locked target refused without `--replace`; restamp window (both races) and analyzer run                                                       |
| presidential analyzer | `scripts/polls/presidential/analyze_accuracy.test.ts` | the real 2021 tree: Радев 49.42 R1, pair Радев–Герджиков, `decidedInRound 2`; a placeholder / provisional row inserted is ignored; „Не подкрепям никого" scored when polled                                            |
| backfill ledger       | `scripts/polls/presidential/ledger.test.ts`           | for each backfilled cycle, cross-check „missing here" == the ledger's refusals; every accepted row names a capture                                                                                                     |
| pipeline parity       | Tier 3.4                                              | the four hand-added 2026 waves reproduced byte-identical by the extractor                                                                                                                                              |
| cross-check           | `scripts/polls/crosscheck.test.ts`                    | all four header vocabularies parse; a two-candidate row is a pairing; the diff names a missing poll and a disagreement                                                                                                 |
| surfaces              | `src/screens/presidential/*.test.tsx`, prerender      | the polling band renders for a scored cycle and the ledger state for an unscored one; the band is in `dist/presidential/<cycle>/index.html`; parliamentary consumers (incl. `ai/`) read the parliamentary files only   |
| sync exclusions       | `scripts/bucket_sync_paths.test.ts` (existing)        | `polls/_inbox` excluded in all three places; `polls` itself not refused                                                                                                                                                |
| data map              | `npm run data:map` (existing validator)               | every `polls_*` source placed in `src:pollsters`; `wiki_polls` still in `src:wiki`                                                                                                                                     |
| orchestrator map      | `process-watch-report` SKILL                          | eight rows present with the report-label prefixes; `wiki_polls` row says cross-check; the `cik_presidential` row names the second hop                                                                                  |
| AI regression         | `ai/tests/regression.ts`                              | polls follow-ups re-run after the backlog; a presidential case once T4.6 lands                                                                                                                                         |

## 10. Sequencing and effort

Tier 0 (½ d) → Tier 1 (2 d) → Tier 2 (3 d) → Tier 3 (1 d, ends with the backlog run) → Tier 4 (2 d; the GM
poll is inboxed the day Tier 2 lands, the analyzer is written against the 2021 tree that already exists, the
page band waits only for the presidential plan's Tier 5 country page to exist) → Tier 4b (2 d, the operator
confirming each historical row) → Tier 5. About thirteen working days to a system that ingests every
reachable agency, verifies the rest through the press, scores the 2026 presidential race the day its results
land, and shows 2016 and 2021 on their pages.

## 11. Open questions (⚑)

1. **Track `raw_data/polls/` in git?** Recommendation: yes for HTML/PDF and SH images, no for chart images
   (decision 13 spells the rules out).
2. **Unattended accept.** Recommendation: not in v1; the review costs a minute per poll and the corpus's
   whole value is that every number was checked.
3. **Where the presidential polls render on `/polls`** — a section above the parliamentary block, or
   `/polls/presidential`. Recommendation: a section until the 2026 cycle has ≥ 5 polls, then its own route
   with its own og:image. (The presidential PAGE band, T4.4, is not in question — it mirrors the
   parliamentary dashboard.)
4. **Historical presidential backfill scope** — 2016 + 2021 (Tier 4b); 2011 only if its three rows can be
   sourced from an outlet archive in under an hour.
5. **Google News RSS as a dependency** for the press arm — accept, or replace with per-outlet search pages
   (bTV's works; mediapool's and dir.bg's do not) which are more work and no more stable.
6. **Медиана, АФИС, ЦАМ, Екзакта, Барометър** stay press-verified only — unless one of them gets a website.
7. **When the AI chat learns about presidential polls** — with Tier 4, or only once a named-candidate poll
   exists (a placeholder-only answer to „what do the latest polls show" is a claim about nobody).
8. **Wayback captures as `agency_website`** (decision 17) — confirm, or add a fifth lock tier
   `agency_archive`. Recommendation: confirm; the tier names the author, `archiveUrl` names the host.
9. **Exit polls** — excluded from both corpora today; a future „екзит пол vs резултат" surface would want
   them (Sova Harris and Trend publish them for every round). Out of scope here; the classifier's exclusion
   keeps them findable.
10. **Cross-plan item for the presidential plan's owner:** T7.2 of `presidential-elections-v1.md` needs
    `npm run polls:analyze -- --race presidential` as its last step, and the `cik_presidential` map row needs
    the `update-polls` second hop (T3.2 here). Not edited in that plan by this one — it is under active
    implementation by another session (tier4 step 22 committed 2026-09-06).

## 12. Audit log

### v1 → v1.1 (2026-09-05)

| #   | gap in v1                                                                                                                                                      | fixed in              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | fingerprint was a hash of the visible electoral-id SET over a bounded listing — flips when an old item scrolls off, the `council_minutes` twitchy-count defect | decision 3, T1.6      |
| 2   | AR lister said „date from the post body" while the watcher rule said „never open a post"                                                                       | decision 4, §6.1      |
| 3   | no contract for the `fieldwork` string the analyzer parses and the poll id derives from                                                                        | decision 6, T0.5      |
| 4   | `restamp` specified for presidential only; parliamentary null-dated polls had no path to a cycle when a vote is scheduled                                      | decision 11           |
| 5   | nothing said about a re-captured publication with a different hash, or `accept` overwriting a locked poll                                                      | decision 7            |
| 6   | `parseTable()` recognises only the 2026 header vocabulary; the 2021/2016/2011 presidential tables use three others, and 2016 has a runoff table                | §3, §6.5              |
| 7   | `polls_press` and `polls_gallup` would both query „Галъп" and report one poll twice                                                                            | §6.1                  |
| 8   | Google News RSS `<link>` is a consent-walled token, not the article — the press arm cannot hand the skill a URL                                                | §6.1, §11.5           |
| 9   | `AGENCY_ALIASES` and the `Poll` type each exist in two or three copies; adding fields would fork them                                                          | decision 14, T0.5     |
| 10  | presidential candidate join „by ticket number" — no number exists before registration                                                                          | decision 16, §7       |
| 11  | T4.2 depended on `national_summary.json` EXISTING; it depends on its SHAPE (now known — v1.2)                                                                  | T4.2                  |
| 12  | `ai/tools/pollsDepth.ts` reads all five files and was not named — a presidential family is invisible to „latest polls"                                         | §1, T3.5, T4.6, §11.7 |
| 13  | `npm run data:map` fails on an unplaced watcher source — T3.3 must land in the same commit as the sources                                                      | T3.3                  |
| 14  | the corpus files are minified single-line JSON and `prettier --check` on them fails today — the memory note's gate was never one                               | §1, decision 9        |
| 15  | `public/polls` does not exist; the skill doc's paths are stale                                                                                                 | §1, T3.1              |
| 16  | `raw_data/polls/` is tracked by default; the image rule was a recommendation with no `.gitignore` line                                                         | decision 13           |
| 17  | report labels unspecified — the orchestrator matches on the label prefix                                                                                       | §6.1                  |
| 18  | a `wiki_polls`-only flip: does the skill stamp? (yes — otherwise it re-queues daily)                                                                           | T3.1 step 5           |
| 19  | inbox drafts: committed or not, and in which format                                                                                                            | decisions 7, 9        |
| 20  | i18n keys and the `/polls` prerender's declared scope for the presidential section                                                                             | T4.4                  |
| 21  | genre rule for AR stated as an agency default; the corpus shows 10 forecast / 3 raw, so it is per publication                                                  | decision 8            |
| 22  | residual extraction unspecified, while the analyzer's normalisation reads it                                                                                   | §1, decision 8, §6.2  |
| 23  | `bucket:gz` is a fourth publish path; it follows `isExcluded`                                                                                                  | §6.4                  |
| 24  | no Playwright needed — none of the sites is challenge-walled; the plan never said so                                                                           | §2                    |
| 25  | GM with zero scored polls: `/polls/GM` is prerendered automatically and the agency page must render without a profile                                          | T0.1, T3.1 step 6     |

### v1.1 → v1.2 (2026-09-06)

| #   | gap in v1.1                                                                                                                                                                                                                     | fixed in                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 26  | Tier 4 was marked blocked on the presidential plan's Tier 3; that tree now exists for all five cycles, with `canonicalKey` on every ticket and the summary shape in `nationalSummary.ts` — the analyzer is specified against it | §1, §7, T4.2             |
| 27  | no end-to-end statement of the presidential ingest; each stage was scattered across tiers                                                                                                                                       | §7.0                     |
| 28  | `canonicalKey` is a folded THREE-part name and polls print two — no resolver, no uniqueness rule, no provisional keys before registration                                                                                       | decision 16, T4.3, T4.5  |
| 29  | nothing coupled a results ingest (`cik_presidential`) to the accuracy recompute and the narrative; the band would say „no results" indefinitely                                                                                 | T3.2, T4.7, §11.10       |
| 30  | the presidential pages had no polling band; the parliamentary dashboard's `DashboardSection id="polling"` is the pattern and was not named                                                                                      | §1, T4.4                 |
| 31  | historical presidential polls were a one-line Tier 5 item with no sources; the agency archives hold TR/SH/AR/GIB primaries for 2016 (AR/GIB via Wayback) and TR/GIB for 2021, and the 2021 Wikipedia rows carry NO citations    | §2, §3, Tier 4b          |
| 32  | Wayback captures of an agency's own page had no lock tier; exit polls had no exclusion                                                                                                                                          | decision 17, §11.8–9     |
| 33  | agency coverage was asserted, not checked against the tables; Exacta polled 2024-10 and was in no alias entry                                                                                                                   | §2.1, §6.1               |
| 34  | the prerendered presidential body was not required to carry the band — a client-only band leaves the static HTML without it                                                                                                     | T4.4, §9                 |
| 35  | „no polls for this cycle" had no rendering rule; an empty band and a short band look alike                                                                                                                                      | T4.4, T4b.2 (the ledger) |
| 36  | `accept`/`analyze` keyed scorability on `electionDate` alone; a presidential poll is scorable only when its CYCLE's tree exists                                                                                                 | §6.2, decision 11        |

### v1.2 → as-built (2026-09-07, during implementation)

| #   | as-planned                                                                | as-built, and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 37  | `siteSource: boolean` on the alias map                                    | `reach: "site" \| "press"`. A boolean cannot say what Gallup is — site-reach WITH a live press arm, because its own domain is TLS-broken — and `PRESS_ONLY_AGENCIES` has to exclude it so one poll is not reported twice.                                                                                                                                                                                                                                                                                                                      |
| 38  | one flat `aliases` list                                                   | TWO tiers, `aliases` (bare substring, ≥4 chars) and `wordAliases` (whole-word only). Measured on the flat list: „Олимп" and „Импулс" resolved to ИМП, „Trends in Bulgarian politics" to Тренд, „Медианата на доходите" to Медиана, „Политически барометър на НЦИОМ" to Барометър. A non-null match is what keeps a row OUT of `unknownAgencies`, so each was a silent misattribution onto a named third party's accuracy record. `\b` is unusable here (ASCII-only, never fires after Cyrillic), so the boundary is a `\p{L}\p{N}` lookaround. |
| 39  | `matchAgency` returns one agency                                          | It REFUSES when the text names two („Тренд и Галъп с различни данни" — an ordinary headline, and the press arm's input is headlines), because any tie-break would be a property of how verbosely each agency is spelled in the registry rather than of the text. `matchAgencies` reports all of them for a caller that wants to see the ambiguity. The `aop_expert_person_links()` precedent decision 16 already cites.                                                                                                                        |
| 40  | decision 6 assumed every stored poll id derives from its fieldwork string | 18 of 124 are keyed on the PUBLICATION date and one fieldwork string does not parse at all, so the contract binds NEW polls only and the legacy count is frozen by a gate.                                                                                                                                                                                                                                                                                                                                                                     |
| 41  | decision 14 named `Poll` / `PollDetail` / `PollLock`                      | The OUTPUT types (`ElectionAccuracy`, `ElectionAgencyError`, `AgencyProfile`, `BlocId`, `AgencyGrade` → `PollsAccuracy`) were the more dangerous half: `analyze_accuracy.ts` is `accuracy.json`'s only writer and the UI reads that file back through the shared copies, so a field added on one side was invisible to the other with neither side a type error. All ten now come from `@/data/polls/pollsTypes`; verified the emitted artifact is unchanged apart from its timestamp.                                                         |
