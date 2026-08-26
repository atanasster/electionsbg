---
name: analyze-news-article
description: Analyze one, several, or a queued batch of saved news articles — political leaning, stance toward Russia, AI-generation assessment, entities, party tones, site-topic classification — and attach each to a same-event story cluster (the ground.news model) with per-story aggregates. Use when the user asks to analyze an article or articles, assess bias/leaning or pro/anti-Russia framing, check whether an article looks AI-generated, group articles covering the same event, or build/maintain the news analysis layer under news/data/analysis/. For fetching or saving raw articles first, use fetch-news-articles / save-news-articles.
---

# analyze-news-article

Reads corpus articles from `news/data/<domain>/` and produces the analysis
layer: one analysis record per article, grouped into same-event **stories**
with leaning/russia-stance aggregates per story. The deterministic half is
`news/scripts/analyze_articles.py` (queue, candidate prefilter, validation,
storage, aggregation); the qualitative half — reading the article and judging
leaning, stance, AI-signals, topics, and same-event grouping — is YOU, the
LLM. That judgment is the valuable step; do not skip it by keyword-matching.

## Storage (all under news/data/, deliberately untracked)

| path | what |
| --- | --- |
| `news/data/analysis/articles/<domain>/<corpus-filename>.json` | one analysis record per article, 1:1 with the corpus file |
| `news/data/analysis/stories/<story-id>.json` | same-event cluster: canonical titles, summaries, members, aggregates |
| `news/data/analysis/index.json` | url→analysis/story map + story index (lookup only, `--rebuild` regenerates it) |
| `news/topics.json` | the classification taxonomy (26 categories, ~103 subcategories) — TRACKED |

## The analysis record you write

```
article_path, url, domain            (copied from the corpus record — the script cross-checks)
analyzed_at (ISO), model             (your actual model name), taxonomy_version (from news/topics.json)
quality:    {verdict, notes}         verdict ∈ ok | paywall_shell | client_render_shell | too_short | not_bulgarian | non_article
summary_bg / summary_en              2–4 sentences, bilingual
leaning:    {label, confidence 0–1, evidence}    label ∈ strong_conservative | conservative | neutral | progressive | strong_progressive | not_applicable
russia_stance: {label, confidence, evidence}     label ∈ strong_pro_russia | pro_russia | neutral | anti_russia | strong_anti_russia | not_applicable
ai_generated: {verdict, confidence, signals[]}   verdict ∈ likely_human | unclear | likely_ai
entities:   {people[], parties[], institutions[], companies[], places[]}
party_tones: [{party, tone}]         tone ∈ favorable | unfavorable | neutral | mixed
topics:     [{category, subcategory, primary}]   at most one primary pair, and exactly one when quality is ok
site_relevant: bool                  false exactly when the primary category is not-site-relevant
story:      {action, story_id?, canonical_title_bg/en, summary_bg/en, related_story_ids[]}
```

The script validates every field against this schema AND against the
taxonomy, and rejects the whole record on any error — with the reason in its
JSON output. `story.action` is `none` whenever quality is not `ok` or
site_relevant is false (filler never joins stories).

## Step 1 — resolve the input

- A file path / URL the user names → work on that article.
- A domain ("analyze 20 from dnevnik.bg") → `python3
  news/scripts/analyze_articles.py --next <domain> --limit 20`.
- "analyze unanalyzed articles" → `--next all --limit N`. The order is
  **publication day descending, then outlet rank, then time** — globally, not
  per domain. Queue items carry `outlet_rank` and a `suspect_too_short` flag,
  and the payload declares its own `order`.

  ⚠️ **It used to fill domain-by-domain with the domains ALPHABETICAL**, so
  under a fixed nightly budget 24chasa.bg and bgdnes.bg were judged every
  night and vesti.bg never was — the corpus would have been analysed in
  alphabetical order for ever.

  The DAY granularity of the first key is deliberate: rank is the tiebreak
  WITHIN a day, so the significant outlets go first when the budget runs out,
  while a big outlet's week-old piece never outranks today's news from a small
  one. Ordering by the full timestamp first would make rank almost never
  apply, since two articles rarely share a second. Days are UTC, matching the
  stored `published`.

  ⚠️ **An UNDATED article is ordered by `fetched_at`, interleaved with the
  dated ones — not exiled below them.** 563 of 4,346 records carry no publish
  date and EIGHT outlets are 100% undated, including offnews.bg at registry
  rank 16. Sorting them after every dated record put offnews.bg's first
  position at **3,423 of 3,981** — never analysed under any nightly budget,
  which is the same starvation this ordering exists to cure, on a different
  axis and hitting eight outlets instead of one. Interleaved it is position
  46. `fetched_at` is when WE saw the article, so for a nightly sweep it is
  within a day of publication and for a backfill it is not; every queue item
  therefore carries `order_basis` (`published` / `fetched_at` /
  `future_published`) so a position can be explained.

  A **future** publish date sorts LAST. It would otherwise lead a newest-first
  queue for as long as it stayed in the future and be re-offered every night
  ahead of real news; the corpus holds three (capital.bg conference listings
  dated to 2026-10-13) from before the saver began refusing them.

  `counts` describes THIS call's scope: `--next <domain>` reported
  `unanalyzed: 0` beside `returned: 2` while the analysed figure was the whole
  corpus's. A record that will not parse is named in `unreadable` rather than
  skipped in silence.
- Already-analyzed articles are never re-queued. The script prints ONE JSON
  object; exit 2 means unknown domain, 3 bad usage, 4 internal/corrupt-index
  (see Step 4).

## Step 2 — the work item, then READ THE ARTICLE

    python3 news/scripts/analyze_articles.py --candidates news/data/<domain>/<file>.json

Gives you the article's metadata, a 400-char content preview, and up to 6
**candidate stories** (prefiltered by title-token overlap, entity mentions,
date proximity — score ≥ 3, so a date match alone never surfaces). Then
actually Read the full corpus file. On the first run there are no candidates
— that is normal, everything is a new story.

## Step 3 — THE VALUABLE STEP: write the analysis (rubric)

**Quality gate first.** A garbage record must be labeled, not analyzed:
- `paywall_shell` — body is a donor/registration wall. Measured shape
  (mediapool, 5 of 99 files, 666 chars): starts "Благодарим, че не ни
  оставяте да я плащаме сами. / Станете месечен дарител на Mediapool…",
  no article text. ⚠️ The same boilerplate trails EVERY full mediapool
  article as a footer — a shell is when the content CONSISTS ONLY of the
  boilerplate, not when it merely contains it.
- `client_render_shell` — body is a client-render failure (dnevnik's
  "Моля, опитайте отново по-късно.").
- `too_short` — `content_chars < 400` with no substance (the queue flags
  these via `suspect_too_short`).
- `not_bulgarian` — non-Bulgarian text (measured: English files in
  bgnes.bg; bgnes.com is not part of the corpus).
- `non_article` — listing/gallery/landing page that slipped through.
Everything else is `ok`. Non-ok records keep the FULL record shape —
leaning/russia = not_applicable with a one-line evidence note (e.g. "body
is paywall boilerplate, no positions taken"), an ai_generated verdict,
site_relevant, empty entity lists; topics may be empty (at most one
primary, never required) and story.action is `none` — so the article is
never re-queued, but never joins stories.

**Political leaning** — judge the POSITIONS the article takes or amplifies
in its own text, never the outlet's reputation, never a bare party mention.
An article that reports "GERB proposed X" neutrally is `neutral`; it becomes
`conservative`/`progressive` only through evaluative framing, selective
sourcing, or loaded wording. Bulgarian-context anchors:
- conservative: tradition/family/church framing, sovereignty-first,
  anti-"gender" discourse, fiscal restraint as moral virtue, suspicion of
  "external diktat" (when aimed at EU/liberal West, not Russia).
- progressive: rights-based framing (minorities, Roma, LGBTQ), EU-social
  liberal norms, anti-corruption-as-system-change, welfare expansion.
- strong_* : the framing dominates the text, no counterweight.
- `not_applicable` when the article takes no political position — a weather
  report is NOT `neutral`, it is `not_applicable`. Use `neutral` only for
  genuinely political topics handled even-handedly.
Every label needs `evidence` — a verbatim quote or a concrete paraphrase.

**Russia stance** — how the text frames Russia and Russian state policy
where the story touches it: sanctions, Ukraine aid, energy dependence,
"външен фактор", Soviet-nostalgia framing, NATO/EU-as-threat vs
Russia-as-aggressor. pro_russia = amplifies Russian state positions or
apologetics; anti_russia = framing that treats Russia as aggressor/threat
and supports containment; strong_* = dominant, one-sided. `not_applicable`
when Russia is not referenced (most domestic stories).

**AI-generated assessment** — probabilistic, hedged, never proof. Signals:
no byline + no local specifics + uniform paragraph rhythm + generic
marketing register + translated-artifact phrasing. IMPORTANT distinction:
verbatim or near-verbatim БТА/agency wire copy across outlets is `wire_copy`
(agency journalism, NOT AI) — list it as a signal, keep the verdict
`likely_human` unless the text around the wire is machine-ish.

**Entities** — named people, parties (canonical spellings from
`data/canonical_parties.json` — "ГЕРБ", "Възраждане", not "Герб"/"реваншите"),
institutions (ЦИК, КЗК, НИМХ, МВР…), companies, places
(city/oblast names). Only entities actually central to THIS article.

**Party tones** — for each party meaningfully covered: how THIS article
treats it (favorable/unfavorable/neutral/mixed), with the same
position-in-text logic as leaning.

**Topics** — Read `news/topics.json` (26 categories, subcategories, keyword
hints). Exactly ONE primary pair per ok article; add secondary pairs only
when genuinely cross-cutting (e.g. a КЗК fine over an energy deal =
procurement/kzk-appeals primary + energy secondary). Use
`not-site-relevant` for weather/sports/celebrity/crime-blotter filler —
never force a civic category. Corruption-adjacent crime (official
investigations, КПКОНПИ) is NOT crime-blotter.

**Story decision** — group by SAME EVENT, ground.news-style. The test: same
core actors doing the same act in the same news cycle (the КЗК fine, the
cabinet resignation, the flood in Tsaribrod). Follow-ups, reactions and
developments of that event join the same story. A thematically similar but
different event (a DIFFERENT КЗК fine) is a new story — link them with
`related_story_ids`. When candidates are offered, compare canonical titles,
entities and dates; when in doubt, prefer a new story with a related link
over a muddy merge — merges of distinct events cannot be undone
automatically. `new_story` requires canonical_title_bg/en (short, factual,
no outlet spin) and summary_bg/en (2–4 sentences).

**Language rules** — summary_bg reads like native Bulgarian journalism;
summary_en carries no Cyrillic (transliterate names); quotes stay verbatim
in the language they were spoken.

**Honesty rules** — confidence reflects evidence strength; when you cannot
tell, say `unclear`/lower confidence rather than guessing. These are
assessments of individual texts with cited evidence, never verdicts about
outlets or people.

## Step 4 — save

Write the record(s) to a temp file (or stdin) and run:

    python3 news/scripts/analyze_articles.py --save-batch /tmp/analyses.json
    # or one: --save-analysis /tmp/one.json / '-'

Exit 0 = all saved; exit 3 = some failed with per-record `errors` — read
them, fix the records, re-run (the batch is idempotent by url; the index is
flushed after every record). Exit 4 = internal/IO error or a corrupt
index/story file — stop saving and recover first:

    python3 news/scripts/analyze_articles.py --rebuild

(the analysis records on disk are the source of truth; the index and all
story aggregates are regenerated), then retry the save. The output reports
`stories_created`, `stories_updated`, `stories_deleted` — say in your
report which story each article joined. Re-analysis moves an article
between stories cleanly (detach + recompute), so improving an earlier
judgment later is safe.

## Step 5 — batch mode and cost

Analyze in batches of 10–20 articles: per batch, run `--next`, Read the
articles (batch the Reads), write all records, one `--save-batch`. ⚠️ Say
the cost out loud: each article is a full read + judgment; the standing
corpus is ~4,900 articles across 60 domains. The first backfill sweep added
all of it in one day (2026-08-22); steady-state daily growth is NOT yet
measured — take a dated count before planning any sweep and assume
hundreds per day, not dozens. Analysis TRAILS the corpus by design: do not
attempt to close the gap in one sitting, and never run analysis sweeps
back-to-back without a pause (same anti-hammering rule as
fetch-news-articles-all). New articles land via save-news-articles first;
this skill only reads what is already saved.

## Verify

    python3 news/scripts/analyze_articles.py --stats
    # analyzed vs corpus, leaning/russia distributions, story sizes
    python3 news/scripts/analyze_articles.py --candidates news/data/<domain>/<file>.json
    # a fresh article on a just-analyzed event must surface the story as candidate
    python3 news/scripts/test_analyze_articles.py   # if the script itself was touched

Consistency check after any rubric change: re-analyze 5 known articles and
diff — labels must not flip without new evidence.

## What this skill does NOT do

- No outlet-level editorial ratings — per-article evidence only; outlet
  profiles may later be DERIVED from aggregates (≥20 articles), hedged.
- No CAPTCHA solving or fetching — corpus articles only, saved by others.
- AI-generation is a hedged assessment, never a proof or an accusation.
- Does not rewrite, "fix" or publish article content; analysis only.
- Does not commit anything — the corpus and news/data/analysis/ are
  deliberately untracked; the tracked items under news/ are topics.json,
  the scripts, and the site registry (bg_news_sites.csv). Ask before
  changing the taxonomy or the scripts.

## File map

| path | what |
| --- | --- |
| `news/scripts/analyze_articles.py` | the deterministic half — queue, work item, validation, stories, aggregates, stats, rebuild (this skill) |
| `news/scripts/test_analyze_articles.py` | 13-test regression suite for the script — run it after touching the script |
| `news/topics.json` | classification taxonomy, versioned; the script validates records against it |
| `news/data/analysis/*` | the analysis layer — articles/, stories/, index.json (untracked) |
| `news/data/<domain>/*.json` | the raw corpus (read-only for this skill) — see save-news-articles |
| `data/canonical_parties.json` | canonical party spellings for entities/party_tones |
