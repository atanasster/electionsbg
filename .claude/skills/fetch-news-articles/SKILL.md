---
name: fetch-news-articles
description: Fetch the latest N articles (default 5) from ONE named news website — title, URL, and publish date where available. Works for any of the 69 Bulgarian outlets in news/data/bg_news_sites.csv (uses its recorded feed method) and, via a lightweight inline probe, for other sites too. Use when the user names a specific outlet and asks for its latest / recent articles, headlines, or news — e.g. "get me the latest 5 from Дневник", "what's on mediapool.bg right now", "pull the top 3 headlines from blitz.bg".
---

# fetch-news-articles

Fetches the latest N articles (title, URL, published date) from one news
site, using `news/scripts/fetch_latest_articles.py` — a tested Python
script that reads `news/data/bg_news_sites.csv`, dispatches by the site's
recorded `feed_method_*`, and returns clean JSON. Read that CSV's header
once to get the current `feed_method_*`/`feed_url_*` column names (they're
timestamped and renamed on refresh — see the update-news-sites skill).

## Step 1 — resolve the domain

Strip `https://`, `www.`, and any trailing path/query the user gave you
down to a bare domain (`dnevnik.bg`, not `https://www.dnevnik.bg/`). If the
user named the outlet in Bulgarian or by brand ("Дневник", "Блиц"), match it
against the `outlet` column in the CSV, not just `domain`.

## Step 2 — run the script

```bash
python3 news/scripts/fetch_latest_articles.py <domain> <N>
```

⚠️ **Use a GENEROUS timeout — 60–90s, not the default 2 minutes' worth of
patience but not a tight one either.** Most sites answer in 1–8s, but a
site with an ambiguous multi-chunk sitemap and no dates to disambiguate
(measured: chernomore.bg) can legitimately take 30–60s while the script
tries several candidates in priority order before finding a fresh one. This
is not a hang; it's the script being careful. Do not kill it early.

The script always prints exactly one JSON object and exits 0 (success) or a
nonzero code (see below) — never both success and error.

## Step 3 — branch on the result

**Exit 0 — success.** The JSON has `method`, `count`, `order_confidence`,
and `articles: [{title, url, published}]`.

- `order_confidence: "date_sorted"` — trust the ordering.
- `order_confidence: "feed_order_unconfirmed"` — the source carries no
  per-article dates (a bare sitemap with no `<lastmod>`/`<news:title>`);
  present the articles but say the ordering isn't verified as newest-first.
- `order_confidence: "stale_source_suspected"` + a `warning` field — the
  newest date found is implausibly old (>30 days). **Say so to the user
  explicitly rather than presenting old content as "the latest."** This
  fires for real, measured cases: bivol.bg's whole Jetpack sitemap tree
  carries only 2010–2015 dates despite being actively published; iskra.bg
  similarly stuck at 2019.
- A `null` title in an item (bare sitemaps with no `<news:title>` usually
  get backfilled from the article page's own `<title>`/`og:title`, but a
  slow or blocked backfill can still leave one blank) — show the URL, note
  the title wasn't recoverable.

**Exit 2 — not in the registry, quick probe also failed.** The script tried
a lightweight ad-hoc discovery (robots.txt, `/feed`, `/sitemap.xml`, a
couple more) and found nothing parseable. Don't retry it in a loop — either
the site needs a real browser (try Step 4's `browser_then_*` recipe
speculatively) or report that this outlet isn't reachable this way.

**Exit 3 — a known, deliberate stop.** The `error` field says which:

| `error` | what it means | what to do |
| --- | --- | --- |
| `needs_browser` | no machine feed exists at all (confirmed at discovery time) | go to Step 4a — DOM-scrape via the Browser tool |
| `needs_browser_then_fetch` | a real feed/sitemap exists but a bare HTTP client is blocked (Cloudflare JS challenge or similar) | go to Step 4b — clear it with the Browser tool, then re-run the SAME parser via `--stdin` |
| `blocked_captcha` | an *interactive* CAPTCHA (Cloudflare Turnstile checkbox) stands in the way | **stop. Do not attempt it** — solving bot-detection challenges is off-limits regardless of how trivial the click looks. Tell the user this outlet isn't automatable right now. |
| `portal_not_newsroom` | e.g. abv.bg redirects to a webmail login page | tell the user this isn't actually a newsroom |

**Exit 4 — fetch_failed.** A real HTTP/XML error (a source-side bug, a
transient block, a timeout). Safe to retry once; if it fails twice, report
the `detail` verbatim rather than guessing.

## Step 4a — `needs_browser`: DOM-scrape via the Browser tool

No feed exists (confirmed at discovery — money.bg, news.bg, bgnes.com,
epicenter.bg, haskovo.net, dnevnik.bg, glasove.com, flagman.bg, lupa.bg,
faktor.bg, bta.bg, dir.bg all fall here). Navigate to the homepage, then run
a generic extraction — filter out nav/rubric junk, dedupe, cap at N:

```js
const NAV_WORDS = /^(вход|регистрация|абонамент|контакт|за нас|реклама|начало|още|всички|архив|условия|поверителност|search|home|next|previous)$/i;
const seen = new Set();
[...document.querySelectorAll('a[href]')]
  .map(a => ({title: a.innerText.trim().replace(/\s+/g, ' '), url: a.href}))
  .filter(x => x.title.length >= 20 && x.url.startsWith(location.origin) && !NAV_WORDS.test(x.title))
  .filter(x => { if (seen.has(x.url)) return false; seen.add(x.url); return true; })
  .slice(0, N)
```

⚠️ **This is a starting point, not a guarantee — sanity-check the results
yourself before presenting them.** Measured on glasove.com: the top 3 hits
were recurring COLUMN NAMES ("Историята на 1 снимка", "Светът според
Музата" — regular rubrics, not dated news), and only entries 4–5 were real
headlines. If a title reads like a section/column name rather than a
sentence about an event, drop it and take the next candidate. bta.bg is
further JS-rendered — `get_page_text` after navigation shows headlines with
timestamps directly in the readable text even where DOM `<a>` scraping is
noisy; prefer that when the link-based extraction looks unreliable.

## Step 4b — `needs_browser_then_fetch`: clear the block, then reuse the parser

The error JSON carries `feed_url` and `stdin_mode` (`"rss"` or `"sitemap"`).
Measured on blitz.bg, kmeta.bg, capital.bg, marica.bg, offnews.bg — a bare
HTTP client 403s, but a real browser passes automatically within ~5–8s (no
CAPTCHA — Cloudflare's ordinary JS challenge, which a genuine browser
clears by design; this is not evasion). Recipe:

```
1. navigate to https://<domain>/           (the homepage, NOT the feed_url directly)
2. wait ~5-8s
3. if a "Just a moment..." title / interactive checkbox is STILL showing after ~10s,
   STOP — that's blocked_captcha territory, not this path. Do not click it.
4. javascript_tool: fetch(feed_url).then(r => r.text())   — grab the raw XML text
5. Write that text to a scratch file, then:
     cat <file> | python3 news/scripts/fetch_latest_articles.py --stdin=<stdin_mode> <domain> <N>
```

`--stdin` reuses the exact same tested parser, sorter, deduper, and
staleness check as the direct path — no need to hand-parse the XML.

⚠️ **A site's declared sitemap file isn't necessarily the article list.**
Measured on capital.bg: `capital_all0.xml` (the CSV's original recorded
URL) is a `urlset` whose `<loc>` entries point at *other* sitemap files
(`capital_news0.xml`, `capital_stories0.xml.gz`, …) — a nonstandard reuse
of `<urlset>` where a `<sitemapindex>` belongs. If the fetched XML's `<url>`
entries don't look like article pages, look for a sibling ending in
`news0.xml`/similar in the same response before concluding the site has no
usable sitemap. If you find a better URL, that's worth fixing in the CSV
(see update-news-sites) so the next run doesn't repeat the detour.

## Presenting results

A numbered list: title, then URL, then date if available. Lead with any
caveat from Step 3 (stale, order unconfirmed, title missing) — don't bury
it after the list.

## What this skill does NOT do

- Does not solve CAPTCHAs or otherwise defeat active bot-detection.
- Does not fetch full article body text — title + URL + date only. (The
  page is one `fetch`/navigate away if the user then asks to read one.)
- Does not cache results or write anything to `news/data/` — this is a
  read-only, one-off lookup. For a full-registry sweep, use
  fetch-news-articles-all instead.
