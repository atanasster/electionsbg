---
name: save-news-articles
description: Download the latest N full articles (default 100) from one or every registry site and store each as its own JSON file under news/data/{domain}/ — title, full body text, publish date, URL, plus author/topic/keywords/description when the page carries them. Use when the user asks to download, save, or archive full articles to disk, build an article corpus/dataset, or "store the latest N articles from each site". For a quick title/URL/date lookup with nothing written to disk, use fetch-news-articles instead.
---

# save-news-articles

Downloads full articles — not just headlines — and persists them, one JSON
file per article, under `news/data/<domain>/`. Built on
[fetch-news-articles](../fetch-news-articles/SKILL.md): it shells out to
`news/scripts/fetch_latest_articles.py` for the article LIST (same tested
feed dispatch, date sort, dedupe), then fetches each article page itself
and extracts the full record.

## What gets stored

One file per article, named `<YYYYMMDD|nodate>-<url-slug>-<md5_8>.json`
(date from the extracted publish date; hash guarantees uniqueness). Fields,
in priority order JSON-LD → `og:`/`article:` meta → DOM:

```
domain, url, title, published (ISO 8601, or the site's raw string if
unparseable), author, topic, keywords, description, site_name,
content (full body text, paragraphs joined by \n\n), content_chars,
fetched_at
```

## Crawl politeness — the identity, robots.txt, and conditional fetches

This crawls ~70 newsrooms nightly for a project that publishes its
methodology, so since 2026-08-26 it does so under its own name:

```
NaiasnoBot/1.0 (+https://electionsbg.com/about; public-interest media monitoring)
```

It replaced a spoofed Chrome 124 string plus a fabricated
`Referer: https://www.google.com/`. Impersonating a reader arriving from a
search result is not something this project should do — and measured across
all 47 direct-tier domains, it was not buying anything: **45 answer the honest
identity exactly as they answered the spoofed one.**

⚠️ **Two refuse it.** `svobodnoslovo.eu` and `novavarna.net` 403 an identified
bot and 200 a browser string. That is those sites declining to be crawled by a
bot, and the answer is to respect it, not to put the mask back on. They carry
`bot_policy_<vintage> = bot_refused` in the registry, and the saver **exits 3
with `bot_refused` before fetching anything** — recording the refusal and then
crawling nightly anyway would be worse than not recording it, since the sweep
would hammer a source that said no AND raise a permanent `failing` alert.
`bot_refused` is a standing fact, so it is not counted as a broken source.
**Do not "fix" this by restoring a browser UA for them.**

`Crawl-delay` is honoured too: a host asking for one gets `max(--delay, that)`
between article fetches, reported as `delay` in the summary. Measured before
this: 0.0005 s between requests to a host asking for 10 s.

⚠️ **A validator belongs to a DOCUMENT, not a domain.** The stored `etag`
carries the `validator_url` it came from, and a `feed_url` edit discards it —
sending the old document's ETag invites a 304 about a page we are no longer
asking for. The same hazard bit once already: the validators used to be
module-global, so a sitemapindex's child fetches overwrote the feed's with the
last article page's, and the next run got a 304 on a sitemap that HAD changed
— zero articles, exit 0, recorded a success, across 40 of the 70 registry rows.

**robots.txt `Disallow` is honoured**, not just mined for its `Sitemap:` line.
Measured across the same 47 domains: exactly ONE feed URL is disallowed for a
generic bot (`investor.bg`, already quarantined as structurally stale) and
ZERO article URLs are — so honouring it costs the corpus essentially nothing,
which is the whole argument for doing it. An unreadable robots.txt means
UNKNOWN and unknown means allowed, per the convention robots.txt itself
specifies. A refusal exits 3 as `robots_disallowed` — a policy statement, not
a failure, so a nightly run does not count it as a broken source night after
night, and the URL is never queued for retry.

**Conditional requests.** The lister sends `If-None-Match` / `If-Modified-Since`
from the validators stored in the intake state, so a nightly re-run of an
unchanged feed costs the source a header exchange instead of a document
(`order_confidence: "not_modified"`). ⚠️ **Every 7 days it deliberately fetches
UNCONDITIONALLY** — a server with a buggy validator can answer 304 for ever,
and a conditional-only sweep would then stop collecting that source entirely
while every run still reported success.

Extraction details that were measured, not assumed:

- **windows-1251 is still alive** (moreto.net). Decode follows the
  Content-Type charset, then a `<meta charset>` sniff, then UTF-8, then a
  cp1251 fallback.
- Titles get site-name suffixes stripped (`" - Новини от Dnes.bg"` → clean
  headline) — only when the trailing segment names the site/brand or a
  generic news-word, so legit dash endings survive. ⚠️ That claim was FALSE in
  both directions until the fixtures caught it: the match ran leftmost-first,
  so `Трансферите в Първа лига - лято 2026 г. - Новини СЕГА` lost the
  legitimate `- лято 2026 г.` along with the brand; and the separator class
  omitted the **em-dash**, so every offnews.bg headline kept `— OFFNews`. Both
  are pinned per-page (`expect_title`) and as an invariant (no extracted title
  may end in a separator followed by the domain's brand).
- Body text: `<p>` paragraphs outside junk subtrees (nav/aside/footer/
  ad-classed boxes), preferring an `<article>` wrapper. Legacy sites with
  no `<p>` (moreto.net) get a longest-contiguous-run fallback over free
  text — this measured cleanly past an anti-adblock popup that duplicates
  the lede plus every menu. Ends are trimmed of chrome (share bars,
  calendars, "сподели…" prompts).
- **An article GATE rejects listing/homepage pages** instead of saving
  pseudo-articles: JSON-LD Article node, or `og:type=article`, or ≥2
  extracted paragraphs. Rejections land in the summary's `failed` list as
  `non_article_page`.
- **A body GATE then rejects headline-only records**, because the article
  gate above is satisfied by a JSON-LD node ALONE — so a page with valid
  JSON-LD, a real headline and zero extracted paragraphs used to be stored as
  a complete-looking article. Measured on the first full sweep: 1,284 of
  4,925 records had a body under 400 chars, 600 of them holding nothing but
  their own headline, whole domains at 100% (24chasa.bg, iskra.bg, toest.bg,
  e-vestnik.bg, novavarna.net, narod.bg, svobodnoslovo.eu,
  forbesbulgaria.com). Two reasons, both in `failed[]` and both counted in
  `rejected`: `title_as_body` (the body is the headline, allowing a trailing
  brand tail) and `thin_body` (under `--min-body`, default 400).
  ⚠️ **400 is the same number as `analyze_articles.py`'s `MIN_CONTENT_CHARS`
  and they are two copies with no gate keeping them equal** — a record under
  the floor is one the analysis layer flags `suspect_too_short` and the LLM
  judges `too_short`, so the two must move together or the saver starts
  storing records that cost a judgement call and can only come back "not an
  article".
- Bulgarian dates ("22 август 2026") normalize to ISO; so do RFC-822 and
  ISO variants. ⚠️ **A timestamp with NO offset is read as Europe/Sofia, not
  UTC** — Bulgarian newsrooms publish in local time (+02:00/+03:00), and
  stamping those UTC shifted 4,354 of 4,925 stored records by 2-3 hours and
  filed anything published after 21:00 local under the previous day. A
  date-only value ("2026-08-24", a sitemap `<lastmod>`) is anchored at NOON so
  its day survives the conversion; a written-out midnight is left alone. Each
  date source is normalised in turn and the first that survives wins, so a
  future JSON-LD date does not also discard a sane `article:published_time`.
- **A publish date more than a day in the future is REFUSED**, not stored — it
  would sort the article to the top of every "latest" view for as long as it
  stayed in the future (measured: 5 records, capital.bg by nearly two months).
- **Identity is the CANONICAL url**, not the raw one: scheme, host case,
  `www.`, port, trailing slash, fragment and tracking parameters are
  normalised away before anything is compared — by `existing_urls`, the
  rejection ledger, the HTML-cache key and the filename hash alike. The stored
  `url` field stays the real fetchable one. Measured: 19 canonical keys held
  more than one stored record, all same-title (haskovo.net `#comments`,
  capital.bg `?ref=`, focus-news.net trailing-slash). A non-tracking query is
  KEPT — moreto.net addresses every article as `novini.php?n=NNNN`, so
  dropping the query would collapse the whole site into one key.
  `--reextract` reports pre-existing duplicates as `duplicates_found` and
  collapses them only with `--dedupe`, keeping the fullest body and removing
  the loser's analysis sidecar with it.
- **The filename's day bucket is the Sofia day; `published` stays UTC.** One
  is a calendar day, the other an instant. A UTC-derived bucket filed
  everything published 00:00-02:59 local under the previous day (143 of 4,361
  records). Re-filing an existing corpus is a `--reextract` pass, which
  already moves the analysis sidecar with the rename.

## Step 1 — one site

```bash
python3 news/scripts/save_articles.py <domain> <N> [--min-body=N] [--retry-rejected]
```

⚠️ **Budget generously: N=100 measured 3–6 minutes per site** (sequential
fetches, 0.4s delay between pages — politeness, not slowness), and the
lister stage alone can take up to 300s on multi-chunk ambiguous sitemaps
(measured: bird.bg and economic.bg timed out at 180s and completed fine
once the lister timeout was raised to 300s). Give the call a 10-minute
timeout, not the default.

Stdout is ONE JSON summary: `saved`, `rejected`, `skipped_rejected`,
`min_body`, `already_present`, `dir_exists`, `rejected_ledger`, `failed[]`
(with per-article reasons), `list_method`, `order_confidence`, plus the
lister's `warning` when stale. Note `rejected` is a strict SUBSET of
`failed` — a body-gate rejection is counted in both — so the outcome counts
do not sum to `listed`. Exit 0 = at least something saved or nothing new was
needed; 2/3/4 = the list-stage error, propagated verbatim from
fetch_latest_articles.py (see that skill for `needs_browser`,
`blocked_captcha` etc.); 4 also when every article failed individually.

⚠️ **Body-gate rejections push exit 4 from rare to ordinary.** "Nothing
saved and something failed" is now the normal outcome for a domain whose
extractor is broken — a fully-rejected `--retry-rejected` run exits 4 where
the identical nightly run exits 0, because the nightly one skips the ledger
and saves nothing without failing. Benign in the sweep, which discards the
code and forces `exit 0`, but do not read a 4 as a crash.

**Two flags and a ledger, all new with the body gate:**

- `--min-body=N` lowers (or with `0` disables) the length floor for a source
  that genuinely publishes briefs. The title-echo slack scales with it, so a
  lowered floor does not then lose the briefs to the echo rule instead.
- Rejected URLs are remembered in `news/data/_rejected/<domain>.jsonl`, so a
  nightly run does not re-fetch the same dead page for ever. The ledger is
  append-only, deduped per URL, and entries **expire after 30 days** — the
  sweep passes no flags, so without that TTL it could never recover from an
  over-firing gate on its own.
- `--retry-rejected` ignores the ledger for one run. **This is the tool to
  reach for immediately after an extractor fix**, rather than waiting out the
  TTL or deleting the folder.

`skipped_rejected` is the number to watch in a sweep log: it is what tells
"this source published nothing new" apart from "the extractor broke and every
article here is now ledgered as dead".

**Incremental by design:** folders are keyed by the `url` field inside the
files — re-running tops up with only new articles and never refetches or
rewrites what's already on disk.

## Step 1b — after an extractor fix, RE-EXTRACT rather than re-fetch

```bash
python3 news/scripts/save_articles.py <domain> --reextract               # cache only, no network
python3 news/scripts/save_articles.py <domain> --reextract --allow-fetch # fill the cache first
python3 news/scripts/save_articles.py <domain> --reextract --prune-cache # drop orphaned cache entries
python3 news/scripts/save_articles.py <domain> --reextract --dedupe      # collapse duplicate spellings
```

⚠️ **"Incremental by design" is also why an extractor fix used to be
unreachable.** Dedupe is by stored URL, so a stored article was never
re-fetched OR re-extracted: every improvement to `BodyExtractor` reached only
articles saved after it, and Step 2's remedy below (`rm -rf` the folder and
re-run) re-fetches from the network — which for a structurally stale source
destroys articles that can never be listed again. Measured on two stored URLs:
e-vestnik.bg held 87 chars against 5,545 from the same page under the fixed
extractor; novavarna.net 73 against 936.

Every fetched page is now cached gzipped under `news/data/_html/<domain>/`,
keyed by a hash of the URL and written **before** the gates — so a rejected
page is cached too, which is what lets `--reextract` promote it later.
~15 KB per page measured (≈75 MB for a 5,000-article corpus). `--no-cache`
opts a run out.

`--reextract` rebuilds every stored record from that cache with no network,
and makes a second pass over the rejection ledger promoting any page that now
yields a real body. Measured on e-vestnik.bg: **100 records at a median of 78
chars → 96 records at a median of 5,185, none under the floor**, with 4
demoted (photo-gallery stubs that genuinely carry no body). Re-running is a
no-op.

Three guards, all deliberate, and all three were live defects first:

- **It refuses to replace a good body with a worse one** (`shrunk_refused`)
  unless `--allow-shrink`. A re-extraction runs the CURRENT extractor, and a
  regression in it would otherwise quietly overwrite a corpus that was fine.
- **Under `--allow-fetch` it refuses a page that is no longer the same
  article** (`identity_refused`). A URL can be recycled, redirected, or answer
  200 with an error page, and a character count alone cannot tell "the
  extractor improved" from "this is a different article" — measured, a
  „Страницата не е намерена" page replaced a good record because it happened
  to be longer. The check is on the headline, and it forgives a brand-tail
  change.
- ⚠️ **It re-judges each record against the floor THAT RECORD was saved
  under**, which every record now carries as `gate_min_body`. Both halves are
  documented workflows — save a briefs source at `--min-body=100`, then
  re-extract after an extractor fix — and re-judging against the default 400
  deleted the whole corpus at exit 0. Passing `--min-body` explicitly on the
  re-extraction overrides the stored floor for every record, which is how you
  deliberately re-tighten a domain.

**A record that no longer clears the gate is DEMOTED** — ledgered, then
deleted, in that order, and kept if the ledger write fails. Otherwise "what is
in the corpus" would depend on when each article happened to be fetched rather
than on the current rules. Demotion also removes the record's analysis sidecar
under `news/data/analysis/articles/<domain>/`, and a rename moves it, since
that tree is keyed by the corpus filename.

`--allow-fetch` fills the cache for records that predate it, at the same
polite delay as a normal run. That is the one-off pass for the existing
corpus; afterwards `--reextract` alone is free and offline.

**Exit codes:** `0` whenever the pass completed — including an all-unchanged
re-run — and `4` only when it could do nothing at all and something failed.
Demotions, prunes and refusals all count as work, so an identical re-run does
not change the code.

**Cache lifecycle:** nothing prunes it automatically, on purpose — a rejected
page's HTML is exactly what a future extractor fix needs, so age is the wrong
axis. `--prune-cache` drops entries whose URL is in neither the corpus nor the
ledger (orphans from a `rm -rf` of a domain folder). Budget ~15 KB per page.

## Step 1c — before changing the extractor, run the fixtures

```bash
python3 news/scripts/test_save_articles.py
```

`BodyExtractor` is ~150 lines of heuristics and every rule in it was learned
from one specific page — windows-1251 on moreto.net, the iubenda cookie banner
in glasove.com's rendered DOM, the `with-sidebar` class that names the MAIN
column and once silently zeroed every article on that domain. None of it was
pinned, so the only way to find out whether a change broke something was a
4,700-page sweep that reports a number moved and cannot say which edge did it.

18 real pages are now frozen under `news/scripts/tests/fixtures/` (see the
README there for provenance), one per class. Each expectation is a **two-sided
band on characters AND paragraphs, plus the gate verdict and the extracted
title** — never an exact character count, which breaks on any cosmetic change
to the page and teaches people to re-baseline without reading. Paragraph count
is the sensitive axis: it is what catches a tightened `LINK_SOUP_RATIO` or a
`trim_junk` that started dropping middle paragraphs, both of which shrink a
body by less than a character band can safely allow.

21 mutants of the extractor, the gate and the title rule have been tried and
all 21 are caught — including four real historical bugs (the `sidebar`
substring, the missing cookie-banner classes, and both title-stripping
defects). That is not saturation; it is the set that has been tried.

⚠️ **Edit `MANIFEST_SEED` in `capture_fixtures.py`, never
`expectations.json`** — the manifest is GENERATED and the next capture run
overwrites an edit made there. A test asserts the two agree.

Three fixtures are marked `known_gap` and pin behaviour we consider WRONG — a
terms-of-use page, a donation page and a section listing are each stored as a
long "article", because the article gate passes on paragraph count alone. The
obvious discriminator (no Article JSON-LD **and** no publish date) is NOT safe:
svobodnoslovo.eu carries no dates anywhere and its articles are real, so that
rule would delete a whole domain. Whoever narrows the gate should make those
three flip and update the seed deliberately.

Add a class with `capture_fixtures.py` — it prefers `news/data/_browser/` and
the HTML cache over the network, so a `browser_render_scrape` domain (which a
plain HTTP client cannot fetch at all) can still be frozen. `--refresh`
re-captures from the SAME source tier for that reason; `--refresh-network`
forces the network and is unsafe for those domains.

## Step 2 — CHECK order_confidence before trusting the vintage

This is the step that separates a useful archive from a beautifully
formatted pile of old news. If `order_confidence` is not `date_sorted`,
the sitemap/feed carried no dates and the "latest N" is file-order, which
can mean the OLDEST articles (measured: fakti.bg's plain `sitemap.xml` is
an undated sitemapindex whose leading chunks hold 2011–2024 archive URLs —
a first run "saved 100" that were all from 2021).

**The fix that worked, in order:**

1. `curl -s https://<domain>/robots.txt` and read every `Sitemap:` line —
   a `sitemapNews.xml`/`sitemap-news` Google-News sitemap (dated, titled,
   articles-only) beats a generic sitemap for this job. fakti.bg declared
   `sitemapNews.xml` (373 same-day articles) all along.
2. If found, FIX THE REGISTRY ROW (feed_method → `sitemap_news`,
   feed_url → the news sitemap, a note saying why) so the next run doesn't
   repeat the detour — same policy fetch-news-articles states for better
   sitemap URLs.
3. `rm -rf news/data/<domain>` if it holds wrong-vintage articles —
   incremental skip would otherwise keep them forever — and re-run.
   ⚠️ **Since the quarantine landed, that is `rm -rf` on BOTH folders**:
   `existing_urls` reads the corpus and `news/data/_quarantine/<domain>/`
   together, so clearing one leaves the other still suppressing the re-fetch.

**Since 2026-08-26 a stale source is QUARANTINED, not stored beside fresh
content.** The lister had detected this all along and the saver stored the
articles anyway, where they were indistinguishable from current reporting and
entered the analysis queue at the same priority. Articles from a stale source
now land in `news/data/_quarantine/<domain>/`, and every run reports
`quarantined`, `quarantine_reason`, `newest_stored` and
`newest_stored_age_days`.

Two inputs decide it, deliberately: the RUNTIME `stale_source_suspected`
signal catches a source that goes stale tomorrow, and a curated
`quarantine_<vintage>` column in the registry settles the cases the runtime
signal gets wrong in either direction — `dnes.bg`'s staleness is TRANSIENT, so
a runtime-only rule would shuttle its articles between two folders run to run.
Values: `stale_source` (always quarantine), `never` (never), empty (follow the
runtime signal). `--no-quarantine` overrides for one run.

`existing_urls` reads BOTH folders, so a domain that moves between them does
not re-fetch what it already holds. Relocating an EXISTING corpus is a
separate, registry-driven, dry-by-default pass that needs no network:

```bash
python3 news/scripts/save_articles.py <domain> --apply-quarantine          # report
python3 news/scripts/save_articles.py <domain> --apply-quarantine --apply  # move
```

Run 2026-08-26: 592 records moved across six domains (bnews.bg 100, iskra.bg
100, investor.bg 100, dnes.bg 98, bntnews.bg 98, bgonair.bg 96). A relocation
DELETES the record's analysis sidecar rather than moving it — `corpus_domains()`
skips `_`-prefixed directories, so the analysis layer cannot reach a
quarantined article at all, and the sidecar is an analysis of something no
longer in the analysable corpus.

⚠️ **The mode acts on the CURATED verdict only.** It reads no feed, so it
cannot see the runtime signal `main()` also routes on — acting on a blank
verdict would drag records back OUT of quarantine on a domain the lister had
flagged. An uncurated domain is reported and left alone.

⚠️ **`--reextract` reads BOTH folders**, and must: a quarantined article is
precisely the one a structurally stale source can never list again, which is
the population that mode exists for. A record is rewritten into its own
folder, so a re-extraction never promotes an article out of quarantine, and
`--prune-cache` keeps quarantined articles' cached HTML.

Do NOT paper over `stale_source_suspected` the same way: some sources are
STRUCTURALLY stale — the sitemap generator carries years-old dates on an
actively publishing site, consistently, and no feed swap fixes it
(first-full-sweep measurements, all saved-old-and-flagged: bnews.bg stuck
at 2020, iskra.bg at 2019, investor.bg at 2023, bgonair.bg at 2025-04,
bntnews.bg at 2025-12→2026-06, plus bivol.bg from fetch-news-articles'
list). dnes.bg is the opposite — TRANSIENT: it served fresh 2026-08-22
headlines early in the day, then only 2018 URLs for hours afterwards; its
folder holds flagged 2018 articles until a later run lists fresh ones.
Report which class, same as fetch-news-articles-all teaches.

Two more dead-end classes measured in that sweep, both correctly ending
in `saved: 0` rather than garbage files:

- **Client-rendered pages behind a fine sitemap** (novini.bg): a Next.js
  app whose article URLs return an empty `NEXT_HTTP_ERROR_FALLBACK` shell
  to a plain HTTP client — the sitemap lists dated articles perfectly,
  the pages yield nothing. Browser tier or nothing.
- **Broken sitemap infrastructure** (telegraph.bg: every sitemap-index
  child returns HTTP 500 and there is no RSS; bivol.bg: the Jetpack
  sitemap tree exceeds even a 300s lister descent).

## Step 3 — the full sweep (direct tier)

```bash
bash news/scripts/save_all_direct.sh 100 news/data/_summaries_<YYYYMMDD>.jsonl
```

Every direct-method domain (rss/sitemap/robots_sitemap/sitemap_news/
homepage_link — ~47 of 70), 6 domains in parallel (6 requests to 6
different hosts, one per host, sequential within each). One summary JSON
line per domain lands in the output file.

⚠️ **Cost before you launch: at N=100 this is ~47 sites × 3–6 min ÷ 6
parallel ≈ 30–50 minutes and ~4,700 page fetches.** Say the cost out loud
before running it; for a spot-check, a handful of domains at N=5 answers
"does this work" in two minutes. The same anti-hammering rule from
fetch-news-articles-all applies: do not loop the sweep back-to-back.

## Step 3b — read the sweep's own verdict

`save_all_direct.sh` appends one `--intake-report` object as the LAST line of
its output (`tail -1`). Run it any time on its own — it reads only the
per-domain state files and the stored corpus, no network:

```bash
python3 news/scripts/save_articles.py --intake-report [--stale-after=N]
```

Every run now persists per-domain state to `news/data/_state/<domain>.json`
(one file per domain, because the sweep runs six at a time through `xargs` and
a single shared file would have six concurrent writers): last success, last
error, `consecutive_failures`, `newest_stored`, and a **retry queue**.

⚠️ **Before this, each run was a fresh "give me the newest N" with no memory** —
a domain that timed out was simply absent from that night's data and nothing
ever noticed or went back for it. 14 of 55 domains failed the first full
sweep, 8 by timeout, and every one of those articles was lost silently.

Transient per-article failures (HTTP errors, timeouts) are queued and retried
FIRST on the next run, deduped against the fresh listing so a URL that
reappeared in the feed is not fetched twice. A URL that burns
`MAX_RETRY_ATTEMPTS` (3) is dropped, NAMED in `retry_exhausted`, and then
stays exhausted for 30 days — **both halves are needed**: the cap alone only
empties the queue, so a 404 that stays in the sitemap is re-queued by the next
run's failures and cycles 1 → 2 → exhausted → 1 for ever, re-naming the same
URLs every third night. Gate DECISIONS (`thin_body`, `title_as_body`,
`non_article_page`) are never queued: they have the rejection ledger and its
own TTL.

⚠️ **`--prefetched` and `--urls-file` cannot drain the queue** — their article
list comes from a browser capture or a file, not from the feed — so those runs
CARRY IT FORWARD untouched rather than rewriting it from their own failures.
That distinction matters for the 17 browser-tier domains in Step 5, which are
served entirely by those two modes; without it a prefetched run silently
discarded the whole queue.

Keying is CANONICAL throughout. Keying the attempt counter on the raw URL
while the listing dedupe used the canonical one let a spelling change reset
`attempts` to 1 for ever, so the cap never fired.

**A run that lists articles and stores none of them is not a success** — it
increments `consecutive_failures` and records `nothing_stored`. Recording every
completed run as a success made the counter unable to notice a source that had
stopped working. A run with nothing NEW is still a success: a quiet source is
not a broken one.

`alerts` is what a human reads:

| alert | means |
| --- | --- |
| `failing` | 3+ consecutive failed runs |
| `going_stale` | newest stored article older than the threshold **and not quarantined** — a quarantined source is old on purpose |
| `retry_backlog` | 10+ URLs queued and not draining |
| `never_ran` | in the registry, but no run has ever completed for it |

The report enumerates the REGISTRY as well as the state files. Enumerating
state files alone made a domain that has never completed a run invisible —
which is the original defect's exact shape, since the sweep silently dropped
14 of 55 domains and nothing noticed.

## Step 4 — report honestly, per domain

The first full sweep (2026-08-22, N=100) measured the real spread: of 47
direct-tier domains, 35 landed fresh-bulk-2026 folders, 5 saved
structurally-stale old articles (flagged — see Step 2's list), 4 saved
undated content (`feed_order_unconfirmed` — burgas24.bg, plovdiv24.bg,
svobodnoslovo.eu, varna24.bg carry no dates anywhere), and 3 saved nothing
(novini.bg, telegraph.bg, bivol.bg — the dead-end classes above). A
handful of `date_sorted` folders legitimately span wide ranges with a few
ancient evergreen strays (e-vestnik.bg: 89/100 from 2026, oldest 2007) —
check the year DISTRIBUTION, not just min/max, before calling one wrong.
Per domain state: saved / already_present / failed-with-reasons, and flag
every non-`date_sorted` order_confidence explicitly. Known gap shapes to
expect:

- `non_article_page` on every URL (plovdiv24.bg): the recorded sitemap
  lists only section pages. Needs a better feed_url (Step 2) or the
  browser tier — not a bug in the saver.
- One-off `HTTP Error 404`: sitemap entries for since-deleted articles;
  ignore.
- `blocked_captcha` and `portal_not_newsroom` (~5 of 70) stay unreachable
  — no CAPTCHA solving, ever.

## Step 5 — the browser tier, HEADLESS

```bash
node news/scripts/harvest_browser.mjs <domain> [--n=100] [--timeout=600] [--route]
bash news/scripts/save_all_browser.sh 100 news/data/_summaries_browser_<YYYYMMDD>.jsonl
```

⚠️ **This tier used to be a Claude session driving a Browser tool by hand, so
a cron job skipped all 18 domains** — four of them in the top twenty (dir.bg
#2, blitz.bg #3, offnews.bg #16, dnevnik.bg #18), plus bta.bg, the national
agency, and capital.bg. `harvest_browser.mjs` does the same work with
Playwright, which the repo already depends on.

Three shapes, chosen from the registry's own `feed_method`:

| shape | what the browser is for | hand-off |
| --- | --- | --- |
| `browser_then_rss` / `browser_then_sitemap` | a real feed exists; the browser only clears the JS challenge for the ORIGIN, then fetches the feed from the page's own JS context | `save_articles.py <domain> N --stdin-list=rss` (or `sitemap`) — the SAME tested parser the direct tier uses |
| `browser_render_scrape`, articles plain-HTTP fetchable | harvest article links from the rendered homepage | `--urls-file=` |
| `browser_render_scrape`, articles blocked too | harvest links, then fetch each page's rendered HTML | `--prefetched=` |

`--route` probes the first article and picks between the last two itself.

⚠️ **It never clicks anything.** Cloudflare's ordinary JS challenge is cleared
by a genuine browser by design and waiting it out is not evasion; an
INTERACTIVE checkbox is a different thing, and the script stops with
`blocked_captcha` rather than solving it. That line is the whole reason this
tier is allowed to be automated at all.

⚠️ **The sweep is SEQUENTIAL, not parallel.** Each domain runs a real
Chromium and the challenge is waited out — measured ~12s for blitz.bg, ~5 min
for dnevnik.bg, ~10 min for capital.bg. Six browsers at once compete for the
same CPU and make every one of them slower. Budget an hour. A domain whose
challenge does not clear inside `--timeout` reports exactly that and names the
fix, rather than reporting the source as empty.

⚠️ **WHERE TO NAVIGATE is the thing this gets wrong.** Three bugs, each of
which silently emptied a whole outlet while reporting success:

- **`browser_then_*` must render the SITE, not the feed.** `feed_url` there is
  an XML document, and Chrome renders XML with zero `<a href>` — so the "the
  page has links" clear-condition can never be met. All five domains burned
  their full timeout and reported *"the JS challenge did not clear"* against a
  feed that has no challenge. It must be the feed's ORIGIN, not
  `https://<domain>/`: capital.bg and marica.bg serve from `www.`, and a
  bare→www `fetch()` from the page context is cross-origin.
- **An outlet's own SUBDOMAINS are the outlet.** dir.bg's homepage carries 378
  links to `dnes.dir.bg`, 274 to `impressio.dir.bg`, 242 to
  `business.dir.bg`, 223 to `corner.dir.bg`. Rejecting them left the **#2
  outlet with 2 links** — a topic index and a film page.
- **A bare → www redirect defeated the same-origin filter.** bta.bg serves
  from www.bta.bg, so every harvested link failed `startsWith(origin)`.
- **For `browser_render_scrape` the entry IS the registry's `feed_url`**, not
  the bare origin: bta.bg serves its Bulgarian edition at `/bg`.

`settle()` reports "the challenge cleared but the page rendered nothing"
separately from "the challenge did not clear", because conflating them is what
sent the first bug above to the wrong diagnosis for a whole session — the
conclusion written here was "blitz.bg and offnews.bg need a longer timeout",
and it was false.

And one temptation to resist: **do not widen the junk-segment filter.**
Several outlets put real articles under `/novini/` (glasove.com) and `/video/`
(a video report is still a report), so adding those drops the very content
this tier exists to collect. `harvest_browser.test.mjs` pins all of it,
including a source-level assertion that the script contains no `.click(`,
`.type(`, `mouse.` or `keyboard.` call at all — the one property this tier's
licence to be automated rests on.

Measured 2026-08-26: 20/20 links for bta.bg, news.bg, epicenter.bg,
flagman.bg, haskovo.net, faktor.bg, lupa.bg, glasove.com, money.bg, bgnes.bg,
bgnes.com and dir.bg; blitz.bg's feed pulled in seconds (193 KB) where it had
burned 600s; kmeta.bg 5 articles saved through `--stdin-list`; money.bg 14
saved / 0 rejected / 0 failed through `--urls-file`; and a whole-tier sweep of
all 18 domains from a repo path containing a space, on bash 3.2.

### The hand-driven notes this replaced

The recipe below is what the script now does. It is kept because the measured
observations in it — which domains clear in seconds and which in minutes, the
cookie-banner and `with-sidebar` traps, which outlet serves its English
edition by default — are still the facts, and because a human still has to
fall back to them when a site changes shape.



For `browser_render_scrape` / `browser_then_*` domains, run the Browser
Use skill (node REPL) and apply ONE pipeline per domain with two routing
points. All numbers below are the 2026-08-22 first run, measured.

**Harvest (every domain):** new tab → `goto(https://<domain>/)` →
domcontentloaded → wait ~9–10s → check the title:

- "Just a moment…" — Cloudflare's automatic JS challenge. blitz.bg cleared
  in ~12s; dnevnik.bg took ~5 MINUTES of soaking; capital.bg ~10. Leave
  the tab open and re-check later — do NOT click anything. If an
  interactive checkbox appears, STOP: that is `blocked_captcha` territory.
- dir.bg: `goto` failed with an internal webview error on every one of 3
  attempts (bare and www) — an environment failure, not a site class.

Then ONE read-only `evaluate` harvesting `a[href]` anchors (the a11y
snapshot carries no hrefs), filtered in Node: same-origin, title ≥ 30
chars, nav-word titles out, first path segment not in the junk set
(vremeto/page/horoskop/tv/video/tag/category/search/…), dedupe, cap 100 →
write `news/data/_browser/<domain>.urls`. Eyeball the sample: weather
widgets and section chrome pass length filters (blitz's top 3 were
`/vremeto/` links until the path filter; flagman's were /archives//info/
chrome). Homepages expose 30–100 links — that IS the ceiling for this
tier, not a failure to reach N.

**Route (one curl):** plain-HTTP GET on the first article URL:

- **200 → fast path**: `save_articles.py <domain> 100
  --urls-file=news/data/_browser/<domain>.urls`. Worked for 11 of 16
  reached domains (news.bg, marica.bg, capital.bg, epicenter.bg, flagman.bg,
  bta.bg, haskovo.net, money.bg, faktor.bg, kmeta.bg, bgnes.bg).
- **403 or a JS shell → browser-fetch path**: in the SAME cleared tab,
  batch (~25–35 per REPL call, the 120s kernel cap is the budget) `goto`
  each URL → domcontentloaded → read-only `evaluate(() =>
  document.documentElement.outerHTML)` → append `{"url", "html"}` lines to
  `news/data/_browser/<domain>.jsonl`, then `save_articles.py <domain> 100
  --prefetched=<that file>`. Needed for blitz.bg (96/96), dnevnik.bg
  (87/87), offnews.bg (88/88), glasove.com (72/72 — plain HTTP serves an
  empty JS shell ~half the time, rendered DOM always has the article).
- **Hybrid (capital.bg)**: fast path saved 34, then Cloudflare rate-blocked
  the plain client (49× 403). Extract the failed URLs from the summary,
  browser-fetch just those, re-run `--prefetched` — incremental skip keeps
  the 34. Final: 81/83.

Measured traps for the rendered DOM (both fixed in the extractor):

- **Cookie-consent banners ride along** — iubenda's vendor list swamped
  100+ paragraphs per article on glasove.com (and dnevnik/offnews). The
  junk filter carries iubenda/cmp/consent classes now; if a corpus smells
  of "Бисквитките…", re-run `--prefetched` after extending it.
- **`with-sidebar` is a LAYOUT class naming the MAIN column** — a bare
  `sidebar` substring in the junk regex zeroed every glasove article.
  Sidebar matching is token-startswith only; keep it that way.

Other measured facts: bgnes.com serves its ENGLISH edition by default —
the Bulgarian one is a separate domain, **bgnes.bg** (harvest there);
offnews.bg and glasove.com article pages carry NO machine dates (folders
are honestly undated); bta.bg's corrupted-looking summary line was two
background savers appending to ONE summaries file concurrently — one
writer per summaries file, always.

## Verify

```bash
ls news/data/<domain> | wc -l          # ≈ N (minus failures)
python3 - <<'PY'
import json, glob
recs = [json.load(open(f)) for f in glob.glob('news/data/<domain>/*.json')]
dates = sorted(str(r['published'])[:10] for r in recs if r['published'])
print(len(recs), 'files |', dates[0] if dates else '?', '->', dates[-1] if dates else '?')
print('missing fields:', [k for k in ('title','published','content') if not all(r.get(k) for r in recs)])
PY
```

The date RANGE is the check that matters — a folder full of complete
records from 2021 (fakti.bg's first run) passes every field check and is
still wrong (Step 2).

## What this skill does NOT do

- Does not solve CAPTCHAs or bypass active bot-detection.
- Does not dedupe across outlets — the same agency story on two sites is
  two files, keyed by their own URLs. Correct for an archive; don't
  "clean" it.
- Does not commit anything. `news/` is a plain data folder (no loader, no
  build, no bucket sync); thousands of article JSONs are a local corpus —
  ask before putting that in git.

## File map

| path | what |
| --- | --- |
| `news/scripts/save_articles.py` | the downloader — list via fetch_latest_articles.py, `--urls-file=` (browser-harvested links, plain-HTTP articles) or `--prefetched=` (browser-fetched HTML, no network), extract, gate, persist (this skill). `DATA_BG_ROOT` overrides the repo root. |
| `news/scripts/test_save_articles.py` | regression suite for the saver — body gate, rejection ledger, HTML cache, `--reextract` and its three guards, charset decoding, CLI contract, and extraction against the frozen fixtures. Run it after touching the script. |
| `news/scripts/capture_fixtures.py` | freezes one real page per known failure class into `tests/fixtures/*.html.gz` + `expectations.json`. `--list` shows what is frozen, `--refresh` re-fetches. |
| `news/scripts/harvest_browser.mjs` | the browser tier, headless: clears the JS challenge (never clicks), harvests links or pulls the feed from the page's JS context |
| `news/scripts/harvest_browser.test.mjs` | its decision logic — registry reader, robots parser, same-site rule, link filter, and the never-click guard. Runs under vitest (`npm run news:test`) |
| `news/scripts/save_all_browser.sh` | the browser-tier sweep: harvest → save → intake report. SEQUENTIAL; budget an hour |
| `news/scripts/tests/fixtures/` | 18 gzipped real pages (1.0 MB, COMMITTED) + `expectations.json` (GENERATED — edit the seed) + a README on provenance. The only thing standing between an extractor change and a 4,700-page sweep. |
| `news/data/_rejected/<domain>.jsonl` | body-gate rejection ledger: url, reason, chars, title, timestamp. Untracked; entries expire after 30 days. |
| `news/data/_state/<domain>.json` | intake state: last success/error, consecutive failures, newest stored day, retry queue. One file per domain — the sweep has six concurrent writers. |
| `news/scripts/save_all_direct.sh` | parallel batch over the direct tier (this skill) |
| `news/data/<domain>/*.json` | the stored articles, incremental by CANONICAL url |
| `news/data/_quarantine/<domain>/*.json` | articles from a structurally stale source — same shape, kept out of the corpus so they cannot read as current reporting |
| `news/data/_browser/*` | browser-tier scratch: `<domain>.urls` (harvested links), `<domain>.jsonl` (prefetched rendered HTML) — reusable for re-extraction, untracked |
| `news/data/_html/<domain>/*.json.gz` | the page-HTML cache `--reextract` reads: gzipped `{url, html, cached_at}`, keyed by URL hash, written before the gates. Untracked, ~15 KB/page. |
| `news/scripts/fetch_latest_articles.py` | the lister it shells out to — see fetch-news-articles |
