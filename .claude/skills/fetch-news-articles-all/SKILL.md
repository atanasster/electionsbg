---
name: fetch-news-articles-all
description: Fetch the latest N articles (default 5) from EVERY site in news/data/bg_news_sites.csv — a full-registry sweep, not one site. Runs the direct-fetch tier (feeds/sitemaps) in parallel, then walks the browser-only tiers sequentially, and writes one combined CSV/JSON of every article found plus a skip list with reasons. Use when the user asks for "the latest news from all sites", a full news roundup across outlets, or building a combined feed/digest across the whole registry. For a single named outlet, use fetch-news-articles instead — this skill is much more expensive and slower.
---

# fetch-news-articles-all

Sweeps every domain in `news/data/bg_news_sites.csv` (currently 69) for its
latest N articles and writes one combined result. This is a full-registry
batch job, not a quick lookup — budget several minutes, and read
[fetch-news-articles](../fetch-news-articles/SKILL.md) first for the
per-method mechanics this skill dispatches to.

## The four tiers, and why they're handled differently

```
python3 -c "
import csv
from collections import Counter
c = Counter()
for r in csv.DictReader(open('news/data/bg_news_sites.csv', newline='', encoding='utf-8')):
    c[r[[h for h in r if h.startswith('feed_method_')][0]]] += 1
for k, v in sorted(c.items(), key=lambda x: -x[1]): print(v, k)
"
```

| tier | methods | count | how |
| --- | --- | --- | --- |
| direct | `rss`, `sitemap`, `robots_sitemap`, `sitemap_news`, `homepage_link` | ~47 | parallel, scripted |
| browser-scrape | `browser_render_scrape` | ~12 | sequential, one Browser tab |
| browser-then-fetch | `browser_then_rss`, `browser_then_sitemap` | ~5 | sequential, one Browser tab |
| unreachable | `blocked_captcha`, `portal_not_newsroom` | ~5 | skipped, logged with reason |

(Counts drift as the registry is refreshed — the query above gives the
current split; don't hardcode the numbers.)

## Step 1 — the direct tier, in parallel

```bash
bash news/scripts/fetch_all_direct.sh <N> <output.jsonl>
```

This is a tested helper — measured at **47/47 succeeding in ~90s** with
10-way parallelism on a clean run. It writes one JSON line per domain
(the exact same shape `fetch_latest_articles.py` prints standalone) to the
given file, `xargs -P 10`, `timeout 90` per domain so one slow site can't
stall the batch.

⚠️ **A successful run does not mean every result is trustworthy — check
`order_confidence` on every line, every time.** Two distinct reasons a
result can be stale, and they need different responses:

- **Structurally broken source** (bivol.bg, iskra.bg): the site's sitemap
  generator itself has been carrying wrong dates for years. Consistent
  across runs. Report it as unreliable and move on.
- **Transient degradation under repeated automated access** (measured live
  on dnes.bg during this skill's own testing: one run returned correct
  2026-08-22 headlines, a later run — after several prior fetches in the
  same session — returned 2018-era content from a completely different
  URL pattern, then a subsequent run was fresh again). This reads exactly
  like anti-scraping throttling that serves stale/cached content instead
  of an outright block. **Do not treat one `stale_source_suspected` hit on
  an otherwise-reliable site as proof it's broken** — note it in the
  output, and if the user cares, offer to retry that one domain after a
  pause rather than re-running the whole sweep immediately.

⚠️ **Do not run this skill back-to-back in quick succession.** Repeated
full-registry sweeps in a short window are exactly the access pattern that
seems to trigger the degradation above, and burns the goodwill of ~50
independent sites for a single user's request. If the user wants it
refreshed, a few minutes' gap is reasonable; looping it is not.

## Step 2 — the browser-scrape tier, sequentially

For each domain with `feed_method = browser_render_scrape`, follow
fetch-news-articles Step 4a: navigate, run the generic extraction snippet,
sanity-check the results (drop anything that reads like a rubric/section
name rather than a headline), cap at N. One Browser tab, so this is
inherently sequential — budget ~15–25s per site.

## Step 3 — the browser-then-fetch tier, sequentially

For each domain with `feed_method` in `browser_then_rss` /
`browser_then_sitemap`, follow fetch-news-articles Step 4b: navigate, wait
for the Cloudflare check to clear, `fetch()` the known `feed_url_*` from
page context, pipe the text through `--stdin=<rss|sitemap>`. If a
CAPTCHA checkbox appears instead of an automatic pass, stop on that domain
and log it as blocked — do not solve it.

## Step 4 — unreachable tier: log and skip

`blocked_captcha` and `portal_not_newsroom` domains contribute nothing.
List them in the summary with their `feed_notes_*` reason so the gap is
visible rather than silently absent from the output.

## Step 5 — combine and write

Merge every tier's articles into one file, one row per article:

```
domain, tier, outlet, title, url, published, order_confidence, warning
```

```bash
python3 -c "
import csv, json, sys
rows = []
for line in open('<direct_output.jsonl>'):
    d = json.loads(line)
    if 'error' in d:
        continue
    for a in d.get('articles', []):
        rows.append([d['domain'], d['method'], a.get('title',''), a.get('url',''),
                     a.get('published',''), d.get('order_confidence',''), d.get('warning','')])
# extend `rows` with the browser-tier results gathered in Steps 2-3
w = csv.writer(sys.stdout)
w.writerow(['domain','method','title','url','published','order_confidence','warning'])
w.writerows(rows)
" > news/data/latest_articles_<YYYYMMDD>.csv
```

Don't commit this file automatically — it's a point-in-time snapshot, not
registry data; ask first, same as any other write in this repo.

## Step 6 — report a summary, not just the file

State plainly: how many domains attempted, how many succeeded, how many
were flagged stale (and which class — structural vs transient, per Step
1's distinction), how many needed the browser, how many were skipped and
why. A silent partial result (say, 61 of 69) reads as complete unless the
gap is named.

## What this skill does NOT do

- Does not retry a domain automatically on failure — one pass, reported
  honestly, is the contract. Retrying is the user's call.
- Does not solve CAPTCHAs.
- Does not fetch full article bodies, only title/url/published.
- Does not run unattended/on a schedule — this is a one-shot sweep invoked
  when asked, not a cron job. (If the user wants recurring collection,
  that's a different, not-yet-built capability — say so rather than
  approximating it with a loop.)
