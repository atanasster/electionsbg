# Phase 2 — ingestion and the browser tier (2026-09-20)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` Phase 2. Measured on
the hourly scheduled runs of 2026-09-19T22:00 → 2026-09-20T05:00 local. Raw
data: `news/data/_perf/*.jsonl` (gitignored, archive-excluded).

## 2.0 Re-confirmation

One scheduler (`com.naiasno.news-hourly`), no crontab, staleness alarm clear.
Backlog at the start of Phase 2: 8,603 stored / 2,891 analysed.

## 2.1 What the live runs showed

Seven scheduled runs; §2.1 asks for one. Acquisition is healthy apart from
the tier below — the 02:00, 04:00 and 05:00 runs each saved 96–99 of 100
queued articles and published.

## 2.2 The browser tier

**The defect was real and is now closed.** The challenge was cleared and the
links harvested, then the article *pages* were fetched by a plain HTTP
client: `browser_then_rss` / `browser_then_sitemap` had no page-level browser
step at all, and neither did the direct tier. Reproduced exactly on blitz.bg
— `listed 20, saved 0, 20 × HTTP 403`.

Added (`896e0081a7`): `harvest_browser.mjs --prefetch-urls` fetches named URLs
in the cleared browser for **any** tier; `escalate_browser.sh` re-runs a save
result's failed URLs through it, bounded per page (45 s), per domain (5 URLs),
per sweep (1,200 s) and by the caller's remaining budget.

**The four outlets §3.2 names turn out to be four different problems, and
only two of them were the fetch path.** Measured on the 05:00 run:

| outlet | listed | saved | what is actually wrong |
| --- | ---: | ---: | --- |
| **capital.bg** | 20 | 0 → **1 via escalation** | ✅ the fetch path. Recoverable |
| **blitz.bg** | 20 | 0 | ❌ per-article block, survives a real browser |
| **dnevnik.bg** | 20 | 0 | ❌ same |
| **24chasa.bg** | 20 | 0 | not a fetch problem at all — **1** per-article failure; the other 19 are already stored or in the rejection ledger |

⚠️ **The escalation does not recover blitz.bg or dnevnik.bg, and the plan said
it would.** Their article pages are challenged for this client *in a real
browser*, headless **and** headed (`NEWS_BROWSER_HEADED=1`), with the origin's
challenge already cleared and its cookies reused:

| attempt | blitz.bg | dnevnik.bg |
| --- | --- | --- |
| plain HTTP (the old path) | 20 × 403 | 20 × 403 |
| browser, headless | 3 of 3 stayed on the interstitial | 3 of 3 |
| browser, headed | 1 of 1 stayed on the interstitial (120 s) | not run |

So plan §3.2's *"this is a fetch-path bug… it recovers four of the most
important outlets"* holds for the fetch path, which was indeed missing, and
for capital.bg. For these two the block is per-article and survives a real
browser; the remaining options are residential/mobile egress or an agreement
with the outlet — not a code change.

**Three further defects found while fixing the first, each of which made the
previous one's evidence untrustworthy:**

- **The challenge detector knew only the English interstitial.** Cloudflare
  serves a bg-BG client „Един момент…", so the harvester called a challenge
  page *clear* and stored it — all 20 escalated blitz.bg pages were the
  interstitial, which the extractor then refused as `non_article_page`. A
  wrong capture reported as a content problem. Now a pure, exported, tested
  function.
- **`grep -c` prints 0 *and* exits 1**, so `|| echo 0` made the count
  `"0\n0"`: the early exit never fired and two lines of invalid JSON went
  into the sweep for every clean domain — 18 of 34 rows in the 03:00 browser
  sweep.
- ⚠️ **A gate decision was being escalated as if it were a fetch failure**
  (`7f2b8a0421`). `escalate_browser.sh` read the save result's `failed` list
  verbatim, so a page refused on its **content** was re-fetched in a real
  browser — which cannot change that answer — and the domain was then cooled
  down for six hours labelled "saved from the browser", which reads as an
  outlet block. Measured on the 05:00 sweep: **all 5 escalated dnes.bg URLs
  were recipes and horoscopes** the article gate rejects by design
  (`/a/528-gladen-gid/`, `/a/7-mish-mash/`), and **plovdiv24.bg's were its
  own section pages** — the homepage, „Новини", „Спортни новини".
  `merge_retry_queue` has always known the distinction; the escalator did
  not. The rule now lives once, in `failure_rules.py`, and `_reject`'s
  structured reason rides along instead of being re-derived from the prefix
  of a human-readable sentence.

**dnes.bg is therefore not a failing outlet** — it holds 198 stored articles,
its window overlaps, and its only "failures" were the gate doing its job.

**Open, and not a fetch problem: plovdiv24.bg's listing emits section pages.**
Its escalated URLs were the site's own index pages, so the extractor was
right to refuse them. That is a lister defect, not a block, and it is the
reason the domain holds nothing. Not fixed here.

## 2.3 Feed-window coverage

`window_overlap` per domain per sweep (`e2ac917d6d`, `fb89e0f6b4`): **False**
means every listed item was new, i.e. the window did not overlap the previous
sweep and articles fell through with no error; **None** means nothing was
listed; **True** includes a 304, which is the strongest evidence of coverage
there is and arrives looking like the opposite (no body, so it reads as
`listed == 0`).

Over 120 recorded sweeps: **92 True, 14 False, 14 None**, 1 error.

⚠️ **Read a bare False rate and you will reach the wrong conclusion.** Three
different things produce it, and only the first is a cadence problem:

1. the feed window genuinely moved past us;
2. a domain we can never store — `already_present` is 0 for ever, so blitz.bg
   and 24chasa.bg read False every hour;
3. a cold corpus on its first sweep.

Of the first 12 False readings, **8 were (2) or (3)**. A rate computed blind
would argue for sweeping *more often*, which is precisely the wrong response
to a 403. The event therefore carries `held` (what we held going in), and the
rate must be taken over sweeps with `held > 0` and `listed > 0`.

On that basis — **13 True / 2 False of 15 interpretable sweeps**, i.e. the
hourly cadence overlaps ~87% of the time. ⚠️ Small sample: `held` landed
mid-day, so this is hours rather than the full 24. The figure to re-derive
before Phase 4 sets a cadence is that ratio, not the headline.

**Per-sweep cost**, now recorded (`seconds`, `article_bytes` counted on the
wire, before gunzip — the two differ ~4×):

| | n | median | max |
| --- | ---: | ---: | ---: |
| sweeps that fetched an article | 15 | 5.7 s | 32.3 s |
| sweeps that fetched nothing (window overlapped) | 47 | 0.7 s | 12.2 s |

Total 14.6 MB of article pages. The largest single sweep is trafficnews.bg —
32.3 s, 7.71 MB over 20 responses, 18 saved. **Most sweeps cost almost
nothing**, which is the real argument about cadence: an hourly sweep of a
quiet outlet is a conditional request and a few hundred milliseconds.

⚠️ **A failed sweep used to emit no event at all**, so any per-domain rate
computed from this log omitted exactly the domains being measured — a total
failure read as a small sample. Every ending this file controls now emits;
an unhandled exception and the runner's SIGTERM still do not, and a consumer
counting sweeps must expect that.

## Corrections to the Phase 0 report

`consecutive_failures` counting "nothing new" as a failure is **narrower than
stated there**: `save_articles.py` already treats `len(articles) ==
already_present` as productive. bgdnes.bg still incremented, so something in
that equality misfires for some domains — real, but smaller than the Phase 0
report implies.

## Acceptance (plan Phase 2)

| criterion | status |
| --- | --- |
| 2.0 host/scheduler re-confirmed | ✅ |
| 2.1 test batch measured with the perf log on | ✅ seven scheduled runs |
| 2.2 blitz.bg, dnevnik.bg, capital.bg, 24chasa.bg each store ≥10 | ❌ **not met, and not reachable by code** for blitz.bg / dnevnik.bg (evidence above). capital.bg is recoverable — 1 article via escalation on its first run with the tier live, so the criterion is a question of budget, not of possibility. 24chasa.bg is not a fetch problem: 1 failure in 20 |
| 2.3 feed-window overlap per domain per sweep | ✅ recorded, with `held` so the rate is interpretable; ~87% on 15 interpretable sweeps |
| 2.4 report | ✅ this file |

**Recommendation for Phase 4's cadence:** do not raise the sweep frequency on
the strength of the False rate. The two outlets driving it are blocked, not
missed, and the interpretable rate is ~87% at one hour with most sweeps
costing under a second.
