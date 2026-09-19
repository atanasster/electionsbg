# Phase 0 — scheduler, staleness alarm, failure baseline (2026-09-19)

Plan: `docs/plans/news-jev-realtime-cloud-worker-v1.md` Phase 0. Everything
below was measured on 2026-09-19 on the host named in 0.1.

## 0.1 Host and exclusivity

| question | answer | evidence |
| --- | --- | --- |
| Where is the job meant to run? | Documented target is a Mac mini at `/opt/naiasno/news` (`news/STANDALONE_SETUP.md`). **It does not exist from here**: `ssh macmini` does not resolve, no `~/.ssh/config` entry, no `/opt/naiasno`. | `ssh`, `ls` |
| Where did every recorded run happen? | **This machine** — a MacBook Pro (`Mac16,8`) holding the only configured install (`news/.env.{api,model,upload,pipeline,evals}`, credentials, Playwright browsers). | `sysctl hw.model`, `ls news/.env*` |
| Is any other scheduler live? | **No.** The public manifest had not moved since 2026-09-02T15:28:56Z (412 h) — a live scheduler anywhere would have published. No crontab here; no LaunchAgent for the job before this phase. | `curl …/manifest.json`, `crontab -l`, `ls ~/Library/LaunchAgents` |

**Decision:** install on this MacBook as the interim host. It is a laptop, so
the Phase 5 soak must record sleep/lid/network gaps; the Mac mini remains the
documented target and the Phase 6 decision is still open. Exclusivity is now
enforced in code: `install_launchd.sh` and `install_cron.sh` refuse each other.

## 0.2 Scheduler

Installed with `news/install_launchd.sh` (commit `51bbe62cc8`): LaunchAgent
`com.naiasno.news-hourly`, `StartCalendarInterval` minute 0, log
`news/var/cron.log`. launchd, not cron, because cron does not wake a sleeping
Mac and drops missed runs.

| scheduled run | fired | analyze | publish | cause |
| --- | --- | --- | --- | --- |
| 22:00 `2026-09-19T190005Z-77827` | ✅ 22:00:05 | ❌ skipped `model_unavailable` | refused (home_health not ready) | the probe timed out. Its record names `127.0.0.1:8080` — a reporting bug: on failure `probe()` printed `DEFAULT_URL`, not the URL it tried. Reproduced under the run's env: it fetched OpenRouter's whole `/api/v1/models` catalogue (`curl`: ~0.5 MB, still streaming at 60 s) under a 10 s timeout. Fixed `74fd3ace72` (per-model endpoint, real URL reported) |
| 23:00 `2026-09-19T200007Z-67048` | ✅ 23:00:07 | ❌ crashed after 5 saves (125 s) | refused (pipeline failed) | an unmeasured provider returned `"quality": "ok"`; `AttributeError` escaped `future.result()` — fixed `bd8c1f9344`; provider preference set |
| 00:00 | see **Acceptance** below | | | |

Both defects are exactly the "first unattended run" class the plan warned
about, and neither could have been found by a manual run: the first needed a
slow catalogue at the scheduled minute, the second the routing change of
Phase 1.3. In both cases the publish gate refused the release: no partial or
unanalysed release was published — readers kept the 412 h-old one.

## 0.3 Staleness alarm

`news/scripts/check_staleness.py` as its own LaunchAgent
`com.naiasno.news-staleness` (every 30 min + at load; commit `bc204e2b1d`).
Alarms: `manifest_stale`, `no_recent_run`, `run_failed`, `manifest_unreadable`,
notified (macOS notification, optional `NEWS_ALERT_WEBHOOK_URL`) after a 45 min
wake grace. Verified:

- live: 4 runs by 23:1x, notified `manifest_stale` (412 h) once past the grace;
  `run_failed` is tracked per run id;
- a stopped scheduler, SIMULATED: with `NEWS_STALE_AFTER_S=60` the check
  reports `no_recent_run` alongside `manifest_stale` and `run_failed`. The
  production scheduler was deliberately not stopped, so the plan's literal
  acceptance ("fires when the scheduler is stopped deliberately") is covered
  by this and by the unit tests, not by a live stop;
- it runs under macOS's `/usr/bin/python3` 3.9 (launchd's default PATH).

Limit: it cannot alert while the laptop is powered off — an external watchdog
is the only fix, and is out of Phase 0's scope.

## 0.4 Failure baseline — the "before" column for Phase 2

`python3 news/scripts/save_articles.py --intake-report` (now carries each
domain's feed method and last attempt, commit `65f2741232`). Captured before
any scheduled run (18:34Z, i.e. the 2026-09-02 state) and after the second
(20:16Z):

| domain | method | consecutive failures before → after | newest stored | last error (after) |
| --- | --- | ---: | --- | --- |
| blitz.bg | browser_then_rss | 11 → 13 | 2026-08-22 | listed 31, saved 0, 31 per-article failures |
| dnevnik.bg | browser_render_scrape | 11 → 13 | 2026-08-22 | listed 20, saved 0, 20 per-article failures |
| capital.bg | browser_then_sitemap | 4 → 1 | 2026-09-19 | stored articles on the 22:00 run, then listed 21, saved 0, 15 per-article failures |
| 24chasa.bg | robots_sitemap (direct) | 8 → 10 | 2026-09-02 | listed 20, saved 0, 2 per-article failures |
| bntnews.bg | robots_sitemap | 10 → 12 | 2026-06-14 | 2 per-article failures |
| burgas24.bg / plovdiv24.bg / varna24.bg | sitemap | 10 → 12 | none | 1–8 per-article failures |
| focus-news.net | sitemap | 10 → 12 | 2026-08-22 | 1 per-article failure |
| forbesbulgaria.com | rss | 10 → 12 | 2026-08-21 | 1 per-article failure |

Three of the four outlets §3.2 names (blitz.bg, dnevnik.bg, 24chasa.bg) still
fail as described; capital.bg is intermittent — it stored articles on one run
and failed 15 of 21 on the next. Phase 2 step 2.2 starts from that. `analysis_backlog.pending_total`:
5,153 (2026-09-02) → **5,886** after the 23:00 run.

⚠️ **Probable finding for Phase 2 — `consecutive_failures` may count "nothing
new" as a failure.** On the second hourly run, bgdnes.bg (newest stored:
today) went from 0 to 1 with `listed 20, saved 0, rejected 0, 0 per-article
failures` — the shape of "every listed item was already stored an hour ago".
It is the one clean case: the other 0→1 domains show per-article failures or
have never stored anything (haskovo.net, lupa.bg). If confirmed, an hourly
cadence turns every quiet outlet into an alert, so Phase 2's intake work
should separate "no new items" from "items failed" first. Not changed here.

## Acceptance

| criterion | status |
| --- | --- |
| scheduler installed and exclusive; host recorded | ✅ |
| a *scheduled* run fires | ✅ 22:00:05 and 23:00:07 |
| alarm fires on staleness / a stopped scheduler | ✅ (see 0.3) |
| refreshed `_state` counts recorded | ✅ (0.4) |
| `manifest.generated_at` advances within the cadence | ⏳ pending the first run whose analyze stage completes (addendum below) |

## Addendum — scheduled runs after the fixes (2026-09-20)

| run | analyze | publish |
| --- | --- | --- |
| 00:00 `…T210004Z-72772` | ❌ 0 saved of 100 | refused (pipeline failed) |
| 01:00 `…T220002Z-63626` | ❌ 0 saved of 100 | refused (pipeline failed) |

Both died on the same defect — a validator rejection on the article at the
head of the queue aborted the canary, and a rejected article stays at the head
— fixed in `b6e89a68d1` / `7a7c85f724` and verified by two 100-article runs
(0.97 and 0.96 saved), see `analyze-yield-2026-09-19.md`. The publish gate
refused both, correctly: nothing partial was released.

**Four scheduled runs, four distinct first-unattended defects** (probe,
wrong-shaped answer, canary-on-rejection, and the probe-independence of that
bound). Each was invisible to a manual run and each was caught by the
scheduler plus the alarm doing their job. `manifest.generated_at` had not yet
advanced at the time of writing: acceptance stays ⏳ until a scheduled run
completes analyze and publishes.
