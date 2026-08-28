# News site v1 — from intake to a publishable product

**Status:** **Every step of Tiers 0–4 that is CODE is shipped** (2026-08-26), and Tier 5's
shared-component half with them. The intake audit's F1–F9 shipped earlier.

⚠️ „Tiers 0–4 are shipped" would over-claim: **T4.2 is not code and has not been run** — see
the note under the table. The distinction matters because T4.2 is the step that produces the
numbers the other three Tier-4 steps exist to compute, so a reader taking the tier as
complete would expect measurements that do not exist yet.

**The one thing left open is Tier 5's `/en` fork, and it is open on purpose** — this plan
says so itself: „The second is a project, not a step. It is not sequenced here because
nothing else in this plan depends on the answer." Nothing built since has changed that.
What DID land is the half that is right under either answer: `SummaryPair` is now the one
path to a rendered summary on both the story and article pages, and
`SummaryPair.gate.test.ts` keeps it that way — a third surface written by hand would render
`summary_bg` and quietly drop the English, which is invisible to anyone reading in
Bulgarian, i.e. everyone who tests this app.

| tier | what shipped | commit |
| --- | --- | --- |
| T5 | one summary component, so the English cannot quietly stop rendering | `7b88436453` |
| T1.1 | `/methodology` — the page that makes the rest publishable | `469a280e58` |
| T1.5 | every news URL gets its own head, and the sitemap is generated | `249e26b955` |
| T1.2 | `/article` — the judgment, its evidence, and the way back to the source | `ffb8364904` |
| T1.4 | a distribution is only drawn where there is one to draw | `ed49ea47bc` |
| T1.3 | `/topics`, ranked by disagreement rather than volume — and reporting that NO topic yet clears the 20-positioned floor | `e684412d78` |
| T2.0 | `mentions` as a sibling of `entities`, refusing rather than grading | `774699b84c` |
| T2.1 | the gazetteer — a surface may only claim an identity it owns | `084de1bef0` |
| T2.2 | `resolve_mentions`, the dictionary pass | `356324c172` |
| T2.3–4 | the analyst may set a role and may not mint an identity | `9d08ace8fe` |
| T2.5 | the reciprocal index, with the evidence strength beside every link | `34d8434b66` |
| T3 | the standalone runner — prompts, GBNF, client, loop, nightly | `d6adb3ef37` |
| T4.1 | the stratified gold set | `8397521e85` |
| T4.4 | review routing, calibrated against what the model actually does | `57424c5670` |
| T4.3 | the per-field scoring harness | `502c60844f` |

**T4.2 — the frontier baseline — is the one Tier 4 step that is not code.** The selector,
the routing and the scoring harness are all built and tested; what remains is to RUN a
frontier model over the 240 gold articles and a 50-article subset twice, which is an
operator action against a paid API, not a step this plan can execute. Everything it will
need is in place.
**Written:** 2026-08-26. **Gap-audited the same day** — §7 records what the first draft missed
and where each correction landed. Every figure was re-measured against `news/data` unless a
source is named. ⚠️ Figures below are as of that date and the corpus moves; re-measure before
quoting one.

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

**The app today.** `newsapp/` has 7 routes on its own Firebase target (`news`, `dist-news`,
`news.electionsbg.com`). Four screens are built — Home (342 lines), Story (435),
Outlet (230), Outlets (192). **Three are 8-line placeholders**: Article, Topics, Methodology.
`newsapp/IDEAS.md` does not exist and never has — `git log --all --diff-filter=A -- '*IDEAS*'`
returns nothing — so there is no prior idea list to verify against; this document takes its
place.

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

⚠️ **The 98% is availability of a per-article image, not of a usable lead photo.** Verified
that no domain reuses one image site-wide (0 of 255 images sit on a domain whose distinct-image
ratio is below 0.8), so these really are per-article — but two shapes in the sample are not
what the grid wants: **dariknews.bg** serves a branding *redirector*
(`mm.netinfo.bg/branding/dbrand.php?p=<base64>`) rather than a stable image URL, and
**e-vestnik.bg** serves the *author's portrait* (`portreti_avtori/…`) rather than the article
photo. Neither is detectable from the URL alone. Treat the field as best-effort and design
the grid to survive a wrong or missing image (T0.6).

Deliberately **not** imported, with the reason recorded so nobody re-proposes them:

- `author_url` — 2%, 3 domains. Too sparse to build a byline page on.
- `paywall` (`isAccessibleForFree`) — **0.4%, one domain**. BG outlets do not emit it; a
  field present on 1 of 261 pages would render as "everything is free", which is a claim.
- `word_count` — 41% and only 2 domains, against `content_chars` at 100%. Importing a
  worse copy of a field we already compute is a second answer to one question.

Four rules for this step:

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
- **Every new field needs a fixture expectation.** `news/scripts/tests/fixtures/` holds 18
  frozen pages and `expectations.json` pins what the extractor must produce from each; a new
  field with no expectation is a field with no gate, and the 196-test suite would stay green
  through a total regression of it. Extend `expectations.json` in the same commit — that
  file is the reason F1/F2 could be fixed at all.

`--reextract` is what makes this reach the corpus without re-fetching. It only covers the
**13 domains with a cached HTML tree (261 pages)**; the other 42 domains acquire the new
fields as they are re-crawled. That partial state must be visible, not silent — the
`--intake-report` arm should carry per-field fill so "42 domains have no image yet" is a
number on a report rather than a hole somebody notices in the UI.

### T0.2 — `outlet_logo` belongs to the outlet, not the article

JSON-LD `Organization.logo` is present on 97% of pages / 11 of 13 domains — but it is a
**per-outlet constant**. Scraping it 4,366 times gives 4,366 chances to disagree with
itself. Resolve it once per domain into a new `logo_url_aug2026` column on
`news/data/bg_news_sites.csv`, with a `<link rel="icon">` fallback (62% / 12 domains) and a
two-letter monogram as the final fallback so row heights never reflow.

Two things the first draft got wrong here:

- **`update-news-sites` is a deliberately manual skill** ("registry changes want a human", per
  the intake audit). So the logo column needs a *separate* one-shot resolver script that
  proposes values for review — not a silent write inside the manual skill.
- **The column must exist in `retired_sites.csv` too, or degrade.** `build_app_data.py` has a
  second loop for domains with data but no CSV row, and every retired outlet lands there. Give
  that branch `logo: null` explicitly and let the monogram fallback carry it, rather than
  leaving the key absent and letting the app read `undefined`.

### T0.3 — carry the fields through the bundle, within a stated budget

`build_app_data.py` currently emits `id, domain, title, url, published, author, topic,
keywords, excerpt, content_chars, story_id, analysis?`. Add `image`, `image_alt`,
`updated`, `section_path`, `language`; add `logo` to each outlet record. Extend
`newsapp/app/data.ts`'s `ArticleRecord` to match.

⚠️ **This has a measured payload cost the first draft did not state.** `latest.json` is
**763 KB raw / 179 KB gzip for 600 records**, and every page in the app downloads it.
Simulating the five new fields onto those records: **955 KB raw (+25%), 188 KB gzip (+5%)**.
Gzip absorbs most of it because the values repeat, but raw parse cost does not compress.
Two rules follow:

- **`section_path` and `image_alt` do not belong in `latest.json`.** They are read on the
  article page only. Put them in the per-article file, not the feed.
- **Set the budget before the edit, not after.** `latest.json` gzip is the number to watch;
  if it passes ~220 KB the feed needs paginating rather than widening.

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
  ⚠️ The Commerce Registry records the **registered** owner, which in Bulgarian media is
  frequently a holding company or an offshore vehicle rather than the person in control. The
  column therefore publishes *what the register says on a stated date*, phrased as such, and
  must never be captioned as beneficial ownership — that is a claim about named people this
  corpus cannot support.

### T0.5 — the three future-dated records

`stats.last_published` currently reads **2026-10-13**, seven weeks ahead. Three capital.bg
records are event-announcement pages (a summit, a fish fest, an AI-stack seminar) stored
before `MAX_FUTURE_SKEW` existed; capital.bg is a browser-tier domain with no HTML cache,
so `--reextract` cannot reach them. They are the whole reason the app's freshness figure is
wrong. Fix: a one-off sweep that re-runs `normalize_date()` over stored `published` values
and demotes a refusal to `null` (the record keeps its `fetched_at` ordering), plus a
`--intake-report` arm that counts future-dated records so this cannot silently recur.

**Leave the filenames alone.** `article_filename()` keys the stored name on the published
date, so these three keep names beginning `20261013-`, `20260911-`, `20261006-` after the
value is nulled. Renaming them would orphan their analysis sidecars, which are keyed on the
corpus path. The mismatch is cosmetic and the record is the source of truth.

### T0.6 — images: how they are served, and the credit they carry ⚠️ NEW

> **Superseded for rights policy on 2026-08-28.** The delivery/fallback measurements below
> remain valid, but hotlink success and visible attribution do not establish permission to
> display a photograph. `news-home-experience-v2.md` replaces that assumption with a
> per-article rights record. Read every „hotlink“ decision below as delivery behavior only.

An article photo is somebody else's copyrighted work, and the first draft was silent on both
how we serve it and what we say about it. **Measured**, requesting each domain's `og:image`
with our own bot UA and a `news.electionsbg.com` referer:

| result | domains |
| --- | --- |
| serves normally (`206`/`200`) | **10 of 13** — 168chasa, actualno, dariknews, dir.bg, fakti, kmeta, money.bg, podtepeto, segabg, vesti |
| **`403` on a foreign referer** | **mediapool.bg, novavarna.net** |
| `404` | e-vestnik.bg (on the sampled URL) |

So hotlinking works for roughly three quarters of outlets and **fails silently for the rest**
— a broken image in the grid, with nothing red anywhere.

**Decisions:**

- **Hotlink; do not copy.** Serving the outlet's own URL makes no reproduction, sends them
  the request, and means a photo they take down disappears here too. Copying to our bucket
  would be a reproduction needing a licence we do not have, and would freeze a photo past
  the point the outlet withdrew it.
- **Every image renders a visible credit — this is a requirement, not an option.** The
  home-page grid, the outlet list and the article page all show `© <Outlet>` beneath or
  overlaid on the image, and the credit is a **link to the source article**, not to our own
  page. The outlet name comes from the registry (`outlet`), falling back to `site_name`, then
  the domain. No image is ever rendered without one.
- **A four-step fallback ladder, because 3 of 13 will fail.** (1) the outlet's image;
  (2) on load error, the outlet's logo tile on a muted ground; (3) with no logo, the
  two-letter monogram; (4) the card lays out identically in all four cases so nothing
  reflows. Implement the error transition in the component (`onError`), because the failure
  is per-request and per-referer and cannot be predicted at build time.
- **Record the outlets that refuse.** A `hotlink_ok_aug2026` column on the registry, filled
  by the same probe used above, lets the grid skip straight to the logo tile for
  mediapool.bg rather than requesting an image that will 403. Re-probed whenever the registry
  is refreshed; a `403` is a policy signal, and skipping the request is the polite response
  to it.
- **`referrerPolicy="no-referrer-when-downgrade"`, never `no-referrer`.** Stripping the
  referer would hide from the outlet that the traffic is ours, which is the opposite of what
  an attribution-carrying link is for.
- **The `<img>` carries `alt`** from `image_alt` where present (5%), else the article title.
  `loading="lazy"` and an explicit aspect ratio on every card, so a 600-item feed does not
  fetch 600 photos and nothing shifts as they arrive.

`/methodology` gains one line under „Кое НЕ правим": we do not host or re-host photographs;
each image is served by its publisher and credited to them.

### T0.7 — stamp the site changelog

`data/data-changes.json` is the site-wide per-skill feed behind `/data/updates`, written by
`process-watch-report`. It has entries for `update-persons`, `update-nzok` and the rest —
**and nothing for news**. A nightly intake that never appears in the update feed is invisible
to the one surface that exists to say what moved. The news skills should stamp it like every
other source. (The PG `recent_updates` half of the two-changelog convention does **not**
apply — the news corpus is static JSON, not a Postgres table.)

---

## Tier 1 — the three unbuilt screens, and the SEO they all need

Full mockups, per-screen rationale and the measured field table are in the design brief
artifact (published 2026-08-26). The decisions that must survive implementation:

### T1.1 — `/methodology` (ships first)

The page that makes the rest publishable. Five blocks:

1. **What the corpus does not cover — first, accent-bordered, before any number.** 8.4%
   analysed; two outlets refuse bots and are absent entirely; no TV or radio; 13% of
   articles carry no publication date.
2. The two axes, each with its five-step legend rendered from the *same* `labels.ts` META
   the cards use, so the explanation cannot drift from the thing it explains.
3. **„Кое НЕ правим"** — five refusals, each enforced in code today: no truth/falsity
   verdict; no single outlet score; no link on an ambiguous name; no CAPTCHA solving and no
   fake browser identity; **no hosting or re-hosting of photographs** (T0.6).
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
- **The lead image carries its credit** (T0.6) — here at full width, so the credit line is
  unmissable.
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

### T1.5 — prerender + a real sitemap ⚠️ NEW, and it affects screens already shipped

The first draft filed this as an open question scoped to `/article`. It is larger than that
and it is already live:

`vite.config.news.ts` writes a **four-URL sitemap** — `/`, `/outlets`, `/topics`,
`/methodology` — and the app is a plain SPA with a single catch-all rewrite. So **every
`/story/:id` and every `/outlet/:domain` currently serves the SPA shell's `<title>`,
description and canonical**, i.e. to a crawler all 86 story pages and all 55 outlet pages
are duplicates of the homepage. That is precisely the shape CLAUDE.md documents for
`/funds/contract/**` and `/company/**` on the main site, and the reason those two families
are function-served.

Tier 1 makes it worse by adding `/article/**` (potentially 4,366 URLs) and `/topics/**`.

The options, in the order they should be considered:

1. **Prerender the finite families** — `/outlet/:domain` (55) and `/topics` subcategories
   (~103) are small and static between builds. Cheapest correct fix.
2. **Prerender stories** (86 today, growing) — same mechanism, needs a growth check.
3. **`/article/**` is the one that needs a decision.** 4,366 and growing is the file-count
   question CLAUDE.md records for the main site (a 453k-file `dist` has failed to deploy);
   `dist-news` is a separate target and has never been measured against it. Either
   prerender with a cap (analysed articles only — 365 today), or serve heads from a small
   function the way `spa_page.js` does.
4. **The sitemap must be generated from the bundle**, not hard-coded, so a new story cannot
   be invisible to a crawler by omission.

⚠️ Whatever is chosen, **`<loc>` and prerendered file must agree** — the main site's
`families.data.test.ts` exists because they once did not.

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

### ⚠️ T2.0 — `mentions` is a NEW block. `entities` stays exactly as it is.

**The first draft said "extend the analysis record from bare strings to resolved mentions".
That would break two things at once, and both are silent-ish failures worth spelling out.**

- **`validate_analysis()` hard-rejects it.** It requires every `entities.<bucket>` value to
  be a *non-empty string* and rejects any key outside `ENTITY_BUCKETS`. Objects under
  `entities`, or a sixth bucket named `mentions`, fails **every record in the corpus** on
  re-validation.
- **`entities` is load-bearing for story clustering, not display.**
  `story_candidates()` scores each candidate with `ENTITY_BUCKET_WEIGHTS` by iterating
  `entry["entities"][k]` and calling `name.lower()` and `entity_in_text(name, haystack)`.
  A dict there raises `AttributeError`, and the clustering that produces all 86 stories
  stops working.

So: `mentions` is a **sibling key** beside `entities`, `entities` keeps its string
contract, and `validate_analysis` gains a *separate* validator for the new block. The two
must never be merged, and the reason belongs in a comment at both sites. A later step may
*derive* `entities` from `mentions` for the clustering scorer — but only by projecting the
surface strings back out, never by changing what the scorer reads.

### The rest of the tier

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
  ⚠️ **That block crosses a hosting boundary.** `/person` and `/company` are served from the
  main target — the person page from Postgres via `/api/db`, the company page from
  `spa_page.js`. A static JSON under `news.electionsbg.com` is a *different origin*. Decide
  the mechanism before building the index: bucket-serve the mention shards under the main
  site's data origin (simplest, matches how the main site reads static data), or load them
  into Postgres with a `db:load:news-mentions:pg:cloud` (the convention every migrated family
  follows, per CLAUDE.md — a JSON→PG family with no `:cloud` loader goes stale on prod with
  every row count reconciling). Do **not** cross-origin fetch the news target from the main
  app.

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
news/scripts/run_nightly.sh         the seven stages, in order, with a report
```

Nightly sequence: **retry** whatever `intake.json` holds → **harvest** (both tiers) →
**resolve mentions** (deterministic, no model, so it never fails for LLM reasons) →
**filter** (small model: quality, topics, site relevance — decides what the judge may spend
time on) → **judge** (12B over the `ok ∧ site_relevant` subset only) → **bundle** →
**report** one JSON line: domains attempted/succeeded/failed, articles saved, thin-body
rejects, per-domain freshness, per-field fill (T0.1), LLM records written, validator
rejects, every stale-source flag — **and a stamp into `data/data-changes.json`** (T0.7).
Nobody is watching, so the run has to say what it did.

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

## Tier 5 — the language decision ⚠️ PARTLY RESOLVED

`newsapp/` is **Bulgarian-only**: no i18n, no `useTranslation`, `Intl` hardcoded
to `bg-BG`, `<html lang="bg">`, no `/en` mirror and no `hreflang`. The main site
is fully bilingual, so the news app is the odd one out.

⚠️ **The gap audit overstated this and the correction matters.** G5 said the app
was "producing the English and rendering none of it". That is false: the rubric
produces `summary_en` for all 365 analysed records, and **`StoryScreen` renders
it**, in a `<details>` disclosure labelled „Резюме на английски". What is true is
narrower — the *article* page will need the same treatment, and the app has no
English MODE.

**Done (2026-08-26):** the treatment is now a shared `SummaryPair` component
rather than a block inside `StoryScreen`, so `/article/:domain/:id` (T1.2)
renders the English through the same path instead of a second copy that
quietly stops rendering it — a failure invisible to anyone reading in
Bulgarian, i.e. everyone who tests it. That component is deliberately the part
that is right under **either** answer below.

**Still open, and genuinely a fork:**

- **stay BG-only** — the UI, the corpus, the rubric's evidence strings and every
  label are Bulgarian, and `summary_en` stays a courtesy for a non-Bulgarian
  reader rather than a product surface; or
- **mirror the main site** — an `/en` route tree, the `hreflang` pair, a
  translated UI corpus, and `summary_en` becomes the reason the corpus is worth
  having in English at all.

The second is a project, not a step. It is not sequenced here because nothing
else in this plan depends on the answer.

## Sequencing, and why

**T0 → T1.1 → T1.5 → T1.2 → T1.4 → T1.3 → T2 → T3 → T4**. T5's shared-component half
is done; its `/en` half is not sequenced, because nothing else here depends on it.

⚠️ Within Tier 0, **T0.6 lands with T0.1** — an imported image with no attribution must never
render, so the credit ships in the same breath as the field. (Both are now shipped; the
constraint is recorded because it binds any future field of the same kind.)

- **T0 first** because every screen renders its fields and it is a day's work with a
  measured payoff — the lead image at 98% availability is the difference between a database
  dump and a news page.
- **T1.1 (`/methodology`) before any other screen** because it is what makes publishing
  judgments about named organisations defensible. It ships with the accuracy card empty.
- **T1.5 (prerender) before the new screens, not after**, because it is already wrong for
  two shipped families and every screen added before it is fixed adds URLs to the problem.
- **T1.3 (`/topics`) last of the screens** because it needs a disagreement metric with a
  defensible definition, and that is a decision, not an implementation.
- **T2 before T3** because the mention resolver is deterministic and testable, and putting it
  in the nightly chain ahead of the model means the highest-value output does not depend on
  the least reliable component.
- **T4 last, and not earlier.** Building the baseline before the corpus is real would measure
  both models on text neither can see — which is exactly why F1/F2 were sequenced ahead of
  it in the intake audit.

---

## 7. What the gap audit found

Recorded so the corrections are not silently absorbed. Each was checked against the code,
not inferred.

| # | gap in the first draft | where it landed |
| --- | --- | --- |
| G1 | "extend entities to resolved mentions" would fail `validate_analysis` on every record **and** break story clustering (`name.lower()` on a dict) — entities are load-bearing, not display | **T2.0**, new |
| G2 | images: no serving model, no fallback, **no attribution**. Measured 3 of 13 domains refuse a foreign referer | **T0.6**, new |
| G3 | the news app ships a **4-URL sitemap** and no prerender, so 86 story pages and 55 outlet pages already serve the homepage's head | **T1.5**, promoted from an open question |
| G4 | `latest.json` is 763 KB / 179 KB gzip and every page loads it; the new fields add **+25% raw**, unbudgeted | **T0.3** |
| G5 | the app is BG-only while the rubric generates `summary_en` for every record | **Tier 5** — ⚠️ overstated: `StoryScreen` DOES render it; corrected there |
| G6 | the news corpus never stamps `data/data-changes.json`, so it is absent from `/data/updates` | **T0.7**, new |
| G7 | new extractor fields with no `expectations.json` entry are fields with no gate | **T0.1**, rule 4 |
| G8 | `update-news-sites` is manual, and retired outlets have no CSV row to hold a logo | **T0.2** |
| G9 | nulling a future `published` does not rename the file it is keyed on | **T0.5** |
| G10 | the Commerce Registry gives the *registered* owner, not the beneficial one | **T0.4** |
| G11 | the `/person` „в новините" block crosses a hosting boundary and needs a mechanism | **T2.5** |

## Open questions

1. **The 20-article floor for an outlet spectrum** is proposed, not derived. It should be set
   from the measured variance of a distribution as the sample grows, not picked.
2. **The disagreement metric for `/topics`** — see T1.3.
3. **Ownership vocabulary** — Ground News's eight categories are a starting point, not
   obviously the right partition for Bulgarian media. Needs one pass against the actual
   ownership structures before the column is created.
4. **Tier 5's language decision** — a full `/en` mirror, or stay BG-only.
   ⚠️ NOT "stop paying for `summary_en`", which an earlier draft offered: the English IS
   rendered (in a disclosure, by `SummaryPair`), so dropping it would remove a live surface
   and make that component dead code.
5. **`/article/**` prerender vs. a head-serving function** — needs `dist-news`'s file count
   measured against the Firebase ceiling first.
