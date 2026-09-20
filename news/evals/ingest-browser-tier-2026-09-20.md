# Phase 2 — ingestion and the browser tier (2026-09-20, interim)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` Phase 2. Steps 2.0–2.3
are done; **2.3's 24-hour coverage measurement is accumulating** through the
hourly scheduler and 2.4's final numbers need a full day of it.

## 2.0 Re-confirmation

One scheduler (`com.naiasno.news-hourly`, 5 runs, last exit 0), no crontab, and
the staleness alarm clear (`ok: true`, manifest 718 s old) after the 02:00 run
published. Backlog at the start of Phase 2: 8,603 stored / 2,891 analysed.

## 2.1 What the live runs showed

The 22:00–03:00 scheduled runs are the test batch (§2.1 asks for one sweep with
the perf log on; five ran). Acquisition is healthy apart from the tier below:
the 02:00 and 03:00 runs each saved 96–99 of 100 queued articles and published.

## 2.2 The browser tier — the fix, and what it did NOT fix

**The defect was real and is now closed.** The challenge was cleared and the
links harvested, then the article *pages* were fetched by a plain HTTP client:
`browser_then_rss` / `browser_then_sitemap` had no page-level browser step at
all, and neither did the direct tier. Reproduced exactly on blitz.bg —
`listed 20, saved 0, 20 × HTTP 403`.

Added (`896e0081a7`): `harvest_browser.mjs --prefetch-urls` fetches named URLs
in the cleared browser for **any** tier; `escalate_browser.sh` re-runs a save
result's failed URLs through it, bounded per page (45 s), per domain (5 URLs),
per sweep (1,200 s) and by the caller's remaining budget; both sweeps call it.

⚠️ **It does not recover blitz.bg or dnevnik.bg, and the plan said it would.**
Measured 2026-09-20: their article pages are challenged for this client *in a
real browser*, headless **and** headed (`NEWS_BROWSER_HEADED=1`), with the
origin's challenge already cleared and its cookies reused:

| attempt | blitz.bg | dnevnik.bg |
| --- | --- | --- |
| plain HTTP (today's path) | 20 × 403 | 20 × 403 |
| browser, headless | 3 of 3 stayed on the interstitial | 3 of 3 |
| browser, headed | 1 of 1 stayed on the interstitial (120 s) | not run |

So plan §3.2's *"this is a fetch-path bug… it recovers four of the most
important outlets"* holds only for the **fetch path**, which was indeed
missing. For these two the block is per-article and survives a real browser;
the remaining options are residential/mobile egress or an agreement with the
outlet — not a code change. The caps and the 6-hour cooldown ledger exist so a
permanently refusing outlet costs a bounded slice of each run.

**A second defect found while fixing the first:** `settle()` knew only the
English interstitial. Cloudflare serves a bg-BG client „Един момент…", so the
harvester called a challenge page *clear* and stored it — all 20 escalated
blitz.bg pages were the interstitial, which the extractor then refused as
`non_article_page`. A wrong capture reported as a content problem. The
detector is now a pure, exported, tested function.

**Still open for 2.2:** capital.bg and 24chasa.bg have not been re-measured
since the escalation shipped (capital.bg stored articles on one run and failed
15 of 21 on the next; 24chasa.bg is the direct-tier case the escalation was
extended for). The 04:00+ runs exercise both.

## 2.3 Feed-window coverage — instrumented, collecting

`window_overlap` per domain per sweep (`e2ac917d6d`): **False** means every
listed item was new, i.e. the window did not overlap the previous sweep and
articles fell through the gap with no error; **None** means nothing was
listed. The per-domain rate of False is what sets the longest safe sweep
interval — the number Phase 4's cadence depends on.

⚠️ The first cut measured the wrong population (the retry queue is prepended
to the listing, so a queued URL already on disk faked an overlap). Fixed and
pinned by test before any data was collected under it.

**Not yet recorded, and 2.4 needs them:** per-sweep bytes and seconds, an
event on the six early-exit paths, and a 304 "unchanged" listing (currently
`None`, arguably an overlap).

## Corrections to the Phase 0 report

`consecutive_failures` counting "nothing new" as a failure is **narrower than
I stated**: `save_articles.py` already treats `len(articles) ==
already_present` as productive. bgdnes.bg still incremented, so something in
that equality (canonicalisation, or the retry queue in `articles`) misfires
for some domains — a real but smaller defect than the Phase 0 report implies.

## Acceptance (plan Phase 2)

| criterion | status |
| --- | --- |
| 2.0 host/scheduler re-confirmed | ✅ |
| 2.1 test batch measured with the perf log on | ✅ five scheduled runs |
| 2.2 blitz.bg, dnevnik.bg, capital.bg, 24chasa.bg each store ≥10 | ❌ **not met, and not reachable by code** for blitz.bg / dnevnik.bg (evidence above); capital.bg and 24chasa.bg pending re-measurement |
| 2.3 feed-window overlap per domain per sweep | ✅ instrumented; ⏳ 24 h of data accumulating |
| 2.4 report | ⏳ this file is the interim; the day's figures follow |
