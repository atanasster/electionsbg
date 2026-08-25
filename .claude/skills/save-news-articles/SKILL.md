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

Extraction details that were measured, not assumed:

- **windows-1251 is still alive** (moreto.net). Decode follows the
  Content-Type charset, then a `<meta charset>` sniff, then UTF-8, then a
  cp1251 fallback.
- Titles get site-name suffixes stripped (`" - Новини от Dnes.bg"` → clean
  headline) — only when the trailing segment names the site/brand or a
  generic news-word, so legit dash endings survive.
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
  ISO variants.

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
homepage_link — ~47 of 69), 6 domains in parallel (6 requests to 6
different hosts, one per host, sequential within each). One summary JSON
line per domain lands in the output file.

⚠️ **Cost before you launch: at N=100 this is ~47 sites × 3–6 min ÷ 6
parallel ≈ 30–50 minutes and ~4,700 page fetches.** Say the cost out loud
before running it; for a spot-check, a handful of domains at N=5 answers
"does this work" in two minutes. The same anti-hammering rule from
fetch-news-articles-all applies: do not loop the sweep back-to-back.

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
- `blocked_captcha` and `portal_not_newsroom` (~5 of 69) stay unreachable
  — no CAPTCHA solving, ever.

## Step 5 — the browser tier (17 domains), now wired

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
| `news/scripts/test_save_articles.py` | regression suite for the saver — body gate, ledger, CLI contract, extraction fixtures. Run it after touching the script. |
| `news/data/_rejected/<domain>.jsonl` | body-gate rejection ledger: url, reason, chars, title, timestamp. Untracked; entries expire after 30 days. |
| `news/scripts/save_all_direct.sh` | parallel batch over the direct tier (this skill) |
| `news/data/<domain>/*.json` | the stored articles, incremental by URL |
| `news/data/_browser/*` | browser-tier scratch: `<domain>.urls` (harvested links), `<domain>.jsonl` (prefetched rendered HTML) — reusable for re-extraction, untracked |
| `news/scripts/fetch_latest_articles.py` | the lister it shells out to — see fetch-news-articles |
