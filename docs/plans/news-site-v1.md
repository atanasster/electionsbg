# News site v1 — from intake to a publishable product

**Status:** open. Tiers 0–3 are unbuilt; the intake audit's F1–F9 are shipped.
**Written:** 2026-08-26. Every figure below was re-measured against `news/data` on that date
unless a source is named.

---

## 0. Where this stands

The intake audit (Aug 2026) produced nine findings, all now shipped:

| | finding | commit |
| --- | --- | --- |
| F1 | a record with no body passed every gate and was stored as a complete article | `ee692792ae` |
| F2 | extractor fixes could never reach the articles they were written for | `257953f1ff` |
| F7 | the extractor had no test | `084e18e26c` |
| F4 | publish dates stamped UTC on a corpus published in Sofia; dedupe key was the raw URL | `ec18aea55d` |
| F5 | a structurally stale source stored beside current reporting | `037d9d5432` |
| F6 | every run was a fresh "give me the newest N" with no memory | `578faa72fc` |
| F8 | the crawler wore a fake browser identity | `847c459a1c` |
| F3 | the browser tier was a human driving a browser | `083de0f5f1` |
| F9 | the analysis queue was alphabetical | `051120a541` |
| — | 11 dead registry rows retired; dir.bg kept on evidence | `9e5fb273d7` |

What the audit deliberately deferred is everything downstream of the corpus: the mention
resolver, the local-model runner, and the evaluation harness. Those are Tiers 2–4 here.

**The corpus today.** 4,366 stored articles across 55 domains; 365 analysed (**8.4%**);
86 stories; 59 registry rows, 11 retired. Field fill in the stored record:
`title` 100% · `description` 99% · `content` 98% · `published` 87% · `site_name` 81% ·
`author` 65% · `keywords` 55% · `topic` 43%. Median body 1,697 characters.

**The app today.** `newsapp/` has 7 routes. Four screens are built — Home (342 lines),
Story (435), Outlet (230), Outlets (192). **Three are 8-line placeholders**: Article,
Topics, Methodology. `newsapp/IDEAS.md` does not exist and never has — `git log --all
--diff-filter=A -- '*IDEAS*'` returns nothing — so there is no prior idea list to verify
against; this document takes its place.

---

## 1. The competitive read, and the one seam that matters

| capability | Ground News | AllSides | Improve The News | here |
| --- | --- | --- | --- | --- |
| unit of rating | outlet | outlet | outlet | **article** |
| rating provenance | 3 third-party raters averaged | blind survey + expert panel | editorial | **LLM + quoted evidence per label** |
| story clustering | yes | hand-curated triptych | yes | yes (86 stories) |
| blindspot | signature feature | — | — | shipped (`blindspot_of`) |
| ownership disclosure | 8 categories | — | — | **absent** |
| second political axis | — | — | ~6 sliders | **Russia stance** |
| AI-generated detection | — | — | — | **per article** |
| entity → dossier link | — | — | — | **unbuilt; the differentiator** |
| Bulgarian coverage | none | none | none | 55 domains |

Ground News states its own unit plainly: bias and factuality are averages of AllSides,
Ad Fontes and Media Bias/Fact Check, applied "at the publication level rather than
individual articles."

**Two consequences follow, and they shape every screen below.**

1. **Our outlet position must be derived, never assigned.** An outlet's spectrum is the
   distribution of its own analysed articles. That is stronger than a borrowed rating —
   and it is *worthless below a sample floor*. Blitz.bg has 2 analysed of 96; a spectrum
   bar drawn from 2 articles is a lie told in colour.
2. **We have no third-party shield.** Ground News can point at three raters when
   challenged. Our only authority is that the method is written down and the evidence is
   attached to each label. That makes `/methodology` a **precondition for launch**, not a
   nice-to-have.

The one capability we lack outright is **ownership**. It is not a scraped field — it is a
registry column with a cited source, and this repo already holds the Commerce Registry to
derive it from.

---

## Tier 0 — the field import (small, measured, unblocks every screen)

Availability surveyed over **261 cached pages across 13 domains** in `news/data/_html`.

### T0.1 — add to `extract_record()` in `news/scripts/save_articles.py`

| field | source chain | pages | domains |
| --- | --- | --- | --- |
| `image` | `og:image` → `twitter:image` → JSON-LD `image` (`.url`/`.contentUrl`) | **98%** | 13/13 |
| `canonical` | `<link rel=canonical>` → `og:url` | **99%** | 13/13 |
| `language` | `<html lang>` → `og:locale` → JSON-LD `inLanguage` | **92%** | 12/13 |
| `section_path` | JSON-LD `BreadcrumbList` (list of names) | **54%** | 9/13 |
| `updated` | JSON-LD `dateModified` → `article:modified_time` → `og:updated_time` | **47%** | 12/13 |
| `tags` | `meta article:tag` (repeated) | 42% | 3/13 |
| `image_alt` | `og:image:alt` | 5% | 3/13 |

Deliberately **not** imported, with the reason recorded so nobody re-proposes them:

- `author_url` — 2%, 3 domains. Too sparse to build a byline page on.
- `paywall` (`isAccessibleForFree`) — **0.4%, one domain**. BG outlets do not emit it; a
  field present on 1 of 261 pages would render as "everything is free", which is a claim.
- `word_count` — 41% and only 2 domains, against `content_chars` at 100%. Importing a
  worse copy of a field we already compute is a second answer to one question.

Three rules for this step:

- **`image` must be absolutised and validated** against the article's own origin before
  storage. A relative or protocol-relative URL (`//m.netinfo.bg/...`, seen on dariknews.bg)
  renders as a broken image in the app, and a cross-origin CDN host is normal here — so the
  check is that it parses and has a host, not that it matches the domain.
- **`updated` goes through `normalize_date()` like `published`**, including the Sofia-TZ
  and future-skew rules. A second date field with its own parsing is how the first one's
  bugs come back.
- **`canonical` does not replace `canonical_url()`.** The site-declared canonical is a
  *claim*; our normalisation is the identity we key on. Store both — a disagreement between
  them is a signal (syndication, a redirect chain), not an error.

`--reextract` is what makes this reach the corpus without re-fetching. It only covers the
**13 domains with a cached HTML tree (261 pages)**; the other 42 domains acquire the new
fields as they are re-crawled. That partial state must be visible, not silent — see T0.4.

### T0.2 — `outlet_logo` belongs to the outlet, not the article

JSON-LD `Organization.logo` is present on 97% of pages / 11 of 13 domains — but it is a
**per-outlet constant**. Scraping it 4,366 times gives 4,366 chances to disagree with
itself. Resolve it once per domain into a new `logo_url_aug2026` column on
`news/data/bg_news_sites.csv`, written by `update-news-sites`, with a `<link rel="icon">`
fallback (62% / 12 domains) and a two-letter monogram as the final fallback so row heights
never reflow.

### T0.3 — carry the fields through the bundle

`build_app_data.py` currently emits `id, domain, title, url, published, author, topic,
keywords, excerpt, content_chars, story_id, analysis?`. Add `image`, `image_alt`,
`updated`, `section_path`, `language`; add `logo` to each outlet record. Extend
`newsapp/app/data.ts`'s `ArticleRecord` to match.

Note `excerpt` is **already** the imported `description` (99% fill), routed through
`excerpt_of()`. The "short description" the brief asked for is present and simply renamed
on the way into the app — no ingest work needed, only the rename made visible in the type.

### T0.4 — three derived fields, computed not scraped

- **`republication_of`** — 7% of surveyed pages carry an explicit „Източник:" line. Paired
  with near-identical titles inside a story cluster, this answers the aggregator question
  *per article* rather than per site. (This is the honest version of the dir.bg question
  the registry prune left open: the evidence said dir.bg is not an aggregator, and a
  per-article measure is what would settle the next such case without a manual argument.)
- **`scoop_lag`** — `fetched_at` minus the cluster's earliest `fetched_at`. Publication
  timestamps are outlet-controlled and 13% are missing, so "who broke it" must key on
  first-seen, and the UI must say so.
- **`ownership`** — a registry column (owner, category, source URL, checked-on date),
  hand-entered against the Commerce Registry. Ground News's eight categories are a
  reasonable starting vocabulary. **Never inferred.**

### T0.5 — the three future-dated records

`stats.last_published` currently reads **2026-10-13**, seven weeks ahead. Three capital.bg
records are event-announcement pages (a summit, a fish fest, an AI-stack seminar) stored
before `MAX_FUTURE_SKEW` existed; capital.bg is a browser-tier domain with no HTML cache,
so `--reextract` cannot reach them. They are the whole reason the app's freshness figure is
wrong. Fix: a one-off sweep that re-runs `normalize_date()` over stored `published` values
and demotes a refusal to `null` (the record keeps its `fetched_at` ordering), plus a
`--intake-report` arm that counts future-dated records so this cannot silently recur.

---

## Tier 1 — the three unbuilt screens

Full mockups, per-screen rationale and the measured field table are in the design brief
artifact (published 2026-08-26). The decisions that must survive implementation:

### T1.1 — `/methodology` (ships first)

The page that makes the rest publishable. Five blocks:

1. **What the corpus does not cover — first, accent-bordered, before any number.** 8.4%
   analysed; two outlets refuse bots and are absent entirely; no TV or radio; 13% of
   articles carry no publication date.
2. The two axes, each with its five-step legend rendered from the *same* `labels.ts` META
   the cards use, so the explanation cannot drift from the thing it explains.
3. **„Кое НЕ правим"** — four refusals, each enforced in code today: no truth/falsity
   verdict; no single outlet score; no link on an ambiguous name; no CAPTCHA solving and no
   fake browser identity.
4. Collection: the two tiers, robots.txt honouring, the retirement rules.
5. **Model accuracy — shipped empty, saying „предстои".** Until Tier 4 exists, a blank that
   says so is the honest content; a placeholder implying a number is worse.

### T1.2 — `/article/:domain/:id`

The most consequential screen and the emptiest. It publishes a judgment about a named
outlet's specific piece of work.

- **Evidence beside the label, never behind a tooltip.** Each axis renders its quoted
  Bulgarian sentence and its confidence in the open. This is the one thing no competitor
  does; hiding it wastes it.
- **The outbound link is a card, not a footnote.** We publish a reading; the outlet
  publishes the article. That is both the ethical position and what keeps outlets tolerant
  of being measured.
- **A refused mention is rendered** — „Радев · 15 възможни, без връзка" — carrying over the
  `aop_expert` rule verbatim. Dropping it silently reads as "nobody was mentioned".
- **Framing comparison is three real headlines**, with the spectrum bar above as the index.
- **Model and analysis date printed.** A judgment with no attribution is not checkable.
- **The unanalysed state matters more than the analysed one at 8.4%**: title, image,
  excerpt, source link, and one line — „още не е анализирана" — with no badges at all.

### T1.3 — `/topics`

- **Sorted by disagreement, not volume.** Volume ranks „шоубизнес" first and teaches
  nothing.
- **The axis is chosen per topic** — Ukraine splits on the Russia axis, the budget on the
  political one. One forced axis renders the wrong disagreement.
- **A below-threshold topic states its shortfall** („3 от нужните 5"), never a greyed row.
- **„Не е по темата на сайта" is shown, dashed, and counted** — 96 of 365 analysed articles
  land there, and deleting the card leaves the categories not summing.

⚠️ **"Disagreement" needs a definition that survives review** — a distribution's spread with
a stated minimum sample. Until that number is fixed and gated, this screen is decoration.
That definition is part of T1.3, not a follow-up.

### T1.4 — `/outlets` and `/outlet/:domain` rework

- **Coverage is a column, not a caption**, and below a **20-analysed-article floor** the
  row renders a sentence instead of a bar. This is the single rule these two screens exist
  to enforce.
- **Retired outlets stay visible and greyed**, with their reason. Their articles were
  collected in good faith and still count in stories.
- **Behaviour beats position on the profile.** 90% of Actualno's analysed articles carry no
  political label, so the spectrum says almost nothing; republication rate, byline rate and
  silent-edit rate discriminate, each computed from a T0 field and each clickable through
  to the articles that produced it.
- **Never a single trust score** — three separate meters with the corpus mean beside each.

---

## Tier 2 — mentions: the feature that joins news to the rest of the site

Entities are extracted today as **bare strings in five buckets with no identifier of any
kind**. Measured over the 365 analyses: 178 people, 181 institutions, 262 places, 36
companies, 8 parties — and only **31% of analysed articles carry any entity at all**.

**Names cannot be matched.** The identity layer stores three-part Bulgarian names;
newsrooms write two. Seventeen corpus names tested against `person_search`: **zero matched
exactly**, and every one matched ambiguously when folded to first+last — Пеевски 2
candidates, Борисов 7, Радев 15, Цветан Василев 21. Corpus-wide, 60,151 of 313,105 distinct
first+last keys (19.2%) are shared by more than one person.

This is the `aop_expert` rule one dataset over, and CLAUDE.md already records the
resolution: **refuse rather than grade**. Picking the highest-ranked candidate would be
right for Пеевски and wrong for Цветан Василев, and the two are indistinguishable in the
output.

**Invert the design.** Resolve first against dictionaries the repo owns; let the model do
only what a dictionary cannot.

- **T2.1 `build_gazetteer.py`** → `news/data/gazetteer.json`. People: current MPs, cabinet,
  party leaders, oblast-centre mayors, ВСС and constitutional court, sanctions and ДС
  registers — a few hundred hand-verified rows, each with the full name, the two-part form,
  and the bare surname **only where unique within the roster**. Institutions from
  `awarder_search` (10,550). Places from `place_dim` (5,720). Parties from
  `data/canonical_parties.json`. **Companies: no gazetteer** — 1.02M `tr_companies` rows
  cannot be matched by name; match only on an explicit EIK in the text, or an exact hit on a
  curated list of firms already in the procurement and funds corpora.
- **T2.2 `resolve_mentions.py`** — Aho-Corasick or a compiled alternation over the surface
  forms, **with Cyrillic-aware boundaries**. Python's `\b` is ASCII-only and never matches
  after a Cyrillic letter; use `(?<![\w])`/`(?![\w])` under `re.UNICODE`, or the
  `(?![\p{L}\p{N}])` shape the subcontracting parser uses. Runs over title + description +
  body, before the model, costing no tokens.
- **T2.3 the model does the three things a dictionary cannot** — in-document coreference
  („Пеевски" in ¶4 after „Делян Пеевски" in ¶1, resolved *within the document, never across
  the roster*), role in the story (subject / source / passing mention, which decides whether
  a link is worth rendering), and unknown entities emitted as unresolved strings queued for
  roster review.
- **T2.4 store the resolution with its basis.** `basis ∈ {gazetteer_exact, coref_resolved,
  ambiguous_refused, not_in_gazetteer}`. **A value meaning "resolved by rank-picking must
  not exist."** Unresolved mentions are kept and counted, so "we found no link" is never
  confused with "nobody was mentioned".
- **T2.5 the reciprocal index.** `build_app_data.py` emits `mentions/<kind>/<id>.json`, and
  the main site gains a „в новините" block on `/person/:slug` and `/company/:eik`. This is
  what makes the news corpus worth having *next to* the procurement and declarations layers
  rather than beside them.

---

## Tier 3 — the standalone runner

The blocker is that the **skills, not the scripts, hold the branching logic**. There is no
LLM client in `news/scripts` and no prompt asset — the rubric exists only as prose in
`analyze-news-article/SKILL.md`. The decision procedure has to become code; only the rubric
stays as prompt text.

```
news/prompts/analyze_system.md      the rubric, extracted from SKILL.md, versioned
news/prompts/analyze_schema.gbnf    generated from the record schema — a hard output constraint
news/prompts/taxonomy_compact.json  labels only (~2k tokens, against topics.json's ~11k)
news/scripts/llm_client.py          OpenAI-compatible POST to localhost; retry, timeout, token cap
news/scripts/analyze_local.py       --next → prompt → llm → --save-batch, in one loop
news/scripts/run_nightly.sh         the six stages, in order, with a report
```

Nightly sequence: **retry** whatever `intake.json` holds → **harvest** (both tiers) →
**resolve mentions** (deterministic, no model, so it never fails for LLM reasons) →
**filter** (small model: quality, topics, site relevance — decides what stage 5 may spend
time on) → **judge** (12B over the `ok ∧ site_relevant` subset only) → **bundle** →
**report** one JSON line: domains attempted/succeeded/failed, articles saved, thin-body
rejects, per-domain freshness, LLM records written, validator rejects, every stale-source
flag. Nobody is watching, so the run has to say what it did.

**Model.** Gemma 4 12B is the size that fits a 16 GB Mac mini; the repo already evaluates
`google/gemma-4-31b-it` in `ai/llm/fcEval.cloud.ts`, which is out of reach on that box.
Two models, not one: a small filter and a 12B judge. **Grammar-constrained decoding is
worth more than the choice of model** — `analyze_articles.py` rejects a whole record on any
schema or taxonomy violation, and a 12B asked to free-form nested JSON with enum labels will
fail that gate often enough to matter. Start on llama.cpp for GBNF; re-evaluate MLX after.

Two inputs must be capped: the compact taxonomy above, and article bodies truncated to
~6,000 characters (p50 is 2,144 and p90 is 6,625, so this touches roughly a tenth of
articles and only their tails).

---

## Tier 4 — baseline, then measurement

**The 365 records on disk cannot be the baseline.** They were produced by GLM-5.3, a third
of them were `too_short` because of F1 (measuring the extractor, not the rubric), and the
label distribution is degenerate — `leaning` is `not_applicable` on 90%, `russia_stance` on
94%, `ai_generated` is `likely_human` on 99.7%. A classifier that always answers
`not_applicable` scores ~90%, so agreement metrics on this set are meaningless.

- **T4.1 a stratified gold set of 200–300 articles.** Not random — a random draw inherits
  the 90% skew. Stratify by outlet tier and topic category and deliberately oversample the
  rare-but-important cells: pro-Russia framing, strong leaning either way, and articles
  carrying three or more linkable entities. Include the quality-gate classes (paywall
  shell, listing page, non-Bulgarian) so the gate itself is measured.
- **T4.2 a frontier baseline, with self-agreement as the ceiling.** Analyse the gold set to
  the current rubric, then re-analyse a 50-article subset independently. **Where a frontier
  model disagrees with itself, the rubric is underspecified** — no small model beats that
  ceiling, and the fix is the rubric, not the model. That number is the honest upper bound
  on everything measured afterwards.
- **T4.3 score per field, never as one number.** `quality` accuracy + per-class recall;
  `topics` top-1 on the primary category; `mentions` precision and recall against the
  gazetteer-resolved set (**precision is what matters — a wrong link is worse than a missing
  one**); `leaning`/`russia_stance` macro-F1 and ordinal-weighted Cohen's κ, so
  conservative-for-strong_conservative is a near miss and progressive-for-conservative is
  not; story clustering as pairwise F1, scored separately because the prefilter does most of
  the work.
- **T4.4 a per-field routing threshold and an escape hatch in the schema now.** The outcome
  will not be "good enough" or "not" — it will be field-by-field. Expect the small model to
  own quality, topics and mentions, and leaning/Russia stance either to clear a κ bar or be
  escalated. A record the local model marks low-confidence goes to a review queue. **A
  pipeline that knows what it does not know is worth more than one confidently wrong on 10%
  of political framing calls.**

---

## Sequencing, and why

**T0 → T1.1 → T1.2 → T1.4 → T1.3 → T2 → T3 → T4.**

- **T0 first** because every screen renders its fields and it is a day's work with a
  measured payoff — the lead image at 98% availability is the difference between a database
  dump and a news page.
- **T1.1 (`/methodology`) before any other screen** because it is what makes publishing
  judgments about named organisations defensible. It ships with the accuracy card empty.
- **T1.3 (`/topics`) last of the screens** because it needs a disagreement metric with a
  defensible definition, and that is a decision, not an implementation.
- **T2 before T3** because the mention resolver is deterministic and testable, and putting it
  in the nightly chain ahead of the model means the highest-value output does not depend on
  the least reliable component.
- **T4 last, and not earlier.** Building the baseline before the corpus is real would measure
  both models on text neither can see — which is exactly why F1/F2 were sequenced ahead of
  it in the intake audit.

## Open questions

1. **The 20-article floor for an outlet spectrum** is proposed, not derived. It should be set
   from the measured variance of a distribution as the sample grows, not picked.
2. **The disagreement metric for `/topics`** — see T1.3.
3. **Ownership vocabulary** — Ground News's eight categories are a starting point, not
   obviously the right partition for Bulgarian media. Needs one pass against the actual
   ownership structures before the column is created.
4. **Whether `/article/:domain/:id` needs its own prerender.** It is a per-article page over
   a corpus of thousands, i.e. the `/funds/contract/**` shape — but the news app is a
   separate Firebase target and the file-count ceiling has not been checked against it.
