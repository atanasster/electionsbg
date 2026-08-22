---
name: update-news-sites
description: Rebuild the ranked register of Bulgarian news websites in news/data/bg_news_sites.csv from three independent sources — Similarweb category ranks (the ordering key), Semrush's country mass-media table (second traffic estimate) and the Tranco top-1M (reproducible, offline) — with sports portals excluded and the broadcasters Similarweb misfiles added back by hand. Use when the user asks to refresh / rebuild / re-rank the Bulgarian news-site list, to add or remove an outlet, to answer "who are the top N news sites in Bulgaria", to build a media-outreach or media-monitoring list, or when the vintage in the CSV's column names is more than a quarter old.
---

# update-news-sites

Produces **`news/data/bg_news_sites.csv`** — every Bulgarian news domain worth knowing,
ranked, with three independent measurements beside each so no single vendor's estimate
is load-bearing.

## What the file is

```
rank, tier, domain, outlet, type, scope,
similarweb_visits_<month><year>, semrush_visits_<month><year>, tranco_rank_<month><year>,
feed_method_<month><year>, feed_url_<month><year>, feed_status_<month><year>,
feed_success_<month><year>, feed_notes_<month><year>
```

⚠️ **The vintage lives in the COLUMN NAMES, and that is deliberate — rename them on every
refresh.** These are traffic estimates that move monthly; a column called `visits` cannot
go stale visibly, and a year-old figure read as current is the whole failure mode of this
kind of list.

⚠️ **The five `feed_*` columns are a SEPARATE dataset from the traffic columns, refreshed
by a SEPARATE procedure — do not drop or silently overwrite them while refreshing traffic
data, and do not treat a traffic-only refresh as having validated them.** They record how
`news/scripts/fetch_latest_articles.py` reaches each site's latest articles (a feed URL, a
sitemap, "needs a real browser first", "blocked by an interactive CAPTCHA", …), and the
[fetch-news-articles](../fetch-news-articles/SKILL.md) and
[fetch-news-articles-all](../fetch-news-articles-all/SKILL.md) skills read them directly —
losing them breaks both silently (every domain looks unregistered). If you refresh the
traffic columns only, carry the five `feed_*` columns forward unchanged by domain (a join
on `domain`, same as the merge that first combined them); only re-probe them when the user
specifically asks to refresh feed/article-access data, using the discovery method documented
in those two skills (curl → curl-with-browser-headers → real browser, in that order, stopping
at any interactive CAPTCHA). `feed_method_*` values in current use: `rss`, `sitemap`,
`robots_sitemap`, `sitemap_news`, `homepage_link` (direct fetch); `browser_render_scrape`,
`browser_then_rss`, `browser_then_sitemap` (need the Browser tool); `blocked_captcha`,
`portal_not_newsroom` (unreachable — logged, not fetchable).

**`tier` is not a decoration — the three tiers are measured on different bases and must
never be sorted into one ranking:**

| tier | meaning |
| --- | --- |
| `mass` (1–50) | ranked by measured traffic; the answer to "top 50 news sites" |
| `long_tail` (51–62) | same basis, smaller — regional press, business titles |
| `editorial` (63–69) | **NOT traffic-ranked.** Investigative/accountability outlets included because a pure traffic list buries them. Row 69 is not "the 69th biggest site" |

## The four sources, and what each can and cannot tell you

**1. Similarweb — the ordering key.** The per-domain page
`https://www.similarweb.com/website/<domain>/` is the workhorse: it gives Total Visits
for the latest month, the country rank, and — the field this whole skill turns on — the
**category rank in "News & Media Publishers (In Bulgaria)"**. Two other endpoints matter:

- `https://www.similarweb.com/top-websites/bulgaria/` → **50 rows free**, the cheap seed.
- `https://www.similarweb.com/website/<domain>/competitors/` → ~10 **rank-adjacent** peers
  WITH their category ranks. This is the discovery mechanism; guessing domains from memory
  will not find them all (`bnrnews.bg`, `bgdnes.bg`, `svobodnoslovo.eu`, `novavarna.net`
  and `topsport.bg` were all found this way and none was on the guess list).
- ❌ `https://www.similarweb.com/top-websites/bulgaria/news-and-media/` returns **only 5
  rows** to an unauthenticated fetch. Do not plan the run around it.

**2. Semrush — second traffic estimate, one page only.** Use
`https://www.semrush.com/trending-websites/bg/mass-media` (20 rows, monthly visits). The
category slug is `mass-media`; `news-and-media`, `news-and-media-publishers` and any
nested variant all **404**. Per-domain `/website/<d>/overview/` pages **404 after a handful
of requests** — they rate-limit hard, so budget ~2 lookups, not 30. That table mixes in
google/youtube/facebook/weather; skip those rows.

**3. Tranco — the only reproducible source.** Domain-popularity rank aggregated from
DNS/crawl data. Bash, no vendor page:

```bash
cd <scratchpad>
curl -sL --max-time 180 -o tranco.zip https://tranco-list.eu/top-1m.csv.zip
unzip -o -q tranco.zip
tr -d '\r' < top-1m.csv > tranco.csv          # the file is CRLF — grep/awk fail silently without this
grep '\.bg$' tranco.csv | head -200           # top Bulgarian domains, "rank,domain"
for d in actualno.com segabg.com focus-news.net; do                 # non-.bg BG outlets
  printf "%-22s %s\n" "$d" "$(grep -m1 ",$d$" tranco.csv | cut -d, -f1 || echo '—')"; done
```

⚠️ **Tranco is NOT traffic and must never be the sort key.** telegraph.bg is 3.1M visits at
Tranco 279,092; novinite.com is Tranco 42,390 on a fraction of that traffic. Use it to
confirm a domain is real and widely referenced, and to surface outlets the vendor pages
missed (`focus.bg`, `stolica.bg`, `vestitel.bg`, `bulnews.bg`, `dunavmost.com` came from here).

**4. Gemius — the currency, and it is not public.** Gemius is what Bulgarian advertisers
actually accept, and its results need a licence plus gemiusExplorer;
`audience.gemius.com/en/research-results/bulgaria/` serves only licensed .gem files and
`rankings.gemius.com` does not resolve. ⚠️ **Never cite a publisher's own Gemius headline
as a ranking** — PIK, Blitz, 24 Chasa and Actualno have each announced a Gemius "#1" on a
different cut (reach %, impressions, portal-level rollup). Say "no public ranking exists".

Context only, no numbers to harvest: the Reuters Institute DNR country page
(`reutersinstitute.politics.ox.ac.uk/digital-news-report/<year>/bulgaria`) — brand reach
and trust, charts not machine-readable.

## Run

**Step 1 — seed.** Read the previous `news/data/bg_news_sites.csv` (every row is a
candidate), then fetch the Similarweb country top-50 and the Semrush mass-media table.

**Step 2 — Tranco.** Recipe above. Diff the `.bg` head against the previous CSV; anything
new and news-shaped joins the candidate set.

**Step 3 — resolve.** WebFetch each candidate's Similarweb page **in parallel batches of
12–18**, one prompt: *"Report only: total visits for the latest month, rank in Bulgaria,
and category rank (name the category)."* Record the category rank as the ordering key.

**Step 4 — snowball.** For every domain that lands in category ranks ~20–50, fetch its
`/competitors/` page and harvest unfamiliar domains, then loop back to step 3. Stop when a
round yields nothing new. ⚠️ **Expect ~8 of the top-50 category slots to stay
unidentified** — that is the normal end state, not a failed run. State the count; never pad
the list to hide it.

**Step 5 — classify.**
- ❌ **Exclude sports outright**: sportal.bg, gong.bg, dsport.bg, gol.bg, flashscore.bg,
  btvsport.bg, temasport.com, sportlive.bg, novsport.com — and **topsport.bg, which
  Similarweb files under News & Media Publishers** (it held category #26 in Aug 2026).
- ✅ **Add back what Similarweb misfiles** (see the trap below).
- **One row per outlet for broadcasters** — use the NEWS domain (`btvnovinite.bg`,
  `bntnews.bg`, `bnrnews.bg`, `nova.bg`) and mention the parent in `outlet`; listing
  `btv.bg` beside `btvnovinite.bg` double-counts one newsroom.
- Keep portals and aggregators (abv.bg, dir.bg, novini.bg) but say so in `type` — abv.bg is
  a webmail landing page, and its 18M visits are not news readership.

**Step 6 — write and verify.** This skill's job is the RANKING (rank, tier, domain, outlet,
type, scope, the three traffic columns). It must never destroy the feed-access columns —
**read the current on-disk file's `feed_*` values FIRST, build the new ranking SECOND, join
the two by domain, and only then write.** Never write a fresh file from the ranking alone;
that silently blanks every `feed_*` cell, and nothing about a traffic refresh would catch it
short of the Verify step below.

```bash
python3 - <<'PY'
import csv

OLD = "news/data/bg_news_sites.csv"   # read BEFORE this script overwrites it
old_feed = {}
old_headers = None
with open(OLD, newline="", encoding="utf-8") as f:
    r = csv.DictReader(f)
    old_headers = r.fieldnames
    feed_cols = [h for h in old_headers if h.startswith("feed_")]
    for row in r:
        old_feed[row["domain"]] = {h: row[h] for h in feed_cols}

# `new_rows` is the list of dicts you built in Steps 1-5 — one per domain, keys
# rank/tier/domain/outlet/type/scope/<the three traffic columns this run>.
# Substitute the actual variable/list you built; this is the join+write shape,
# not a standalone script.
for row in new_rows:
    feed = old_feed.get(row["domain"])
    if feed:
        row.update(feed)
    else:
        # a genuinely NEW domain this run found — no prior feed data exists.
        # Use an explicit sentinel, never a blank cell (blank reads as "probed,
        # found nothing" — a false claim; this domain has not been probed at all).
        for h in feed_cols:
            row[h] = "not_yet_probed" if h.startswith("feed_method") else ""

with open(OLD, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(new_rows[0].keys()))
    w.writeheader()
    w.writerows(new_rows)
PY
```

A domain this run DROPS from the ranking (no longer news-shaped, merged into another entry,
etc.) drops its `feed_*` data with it — that's correct, not a loss to guard against. The
guard above is only for domains that survive into the new ranking.

Then run the checks below. Do not commit unless asked.

## Traps

- ⚠️ **Category rank is BULGARIAN traffic; Total Visits is GLOBAL.** They disagree whenever
  an outlet has a large foreign audience — iskra.bg shows 922K visits at category #136,
  while haskovo.net shows 1.1M at #52. When the two conflict, **the category rank is the
  better proxy for domestic reach**; flag the row rather than reconciling it.
- ⚠️ **Similarweb misfiles the biggest broadcasters, so a News-category sweep alone silently
  drops the country's largest TV newsroom.** Known misfilings: `nova.bg` → Streaming &
  Online TV, `bntnews.bg` → **Jobs and Employment**, `btv.bg` → Streaming, `bnr.bg` → Music,
  `webcafe.bg` → Social Networks, `edna.bg` → Arts & Entertainment, `bird.bg` → Jobs and
  Employment. Re-check these each run; the misfiling is not stable.
- ⚠️ **The WebFetch summarizer sometimes describes Total Visits as a "three-month total".**
  It is the latest month — the page shows a 3-month chart beside it. The tell is
  cross-source: Similarweb dnes.bg 6.3M vs Semrush 7.73M only reconciles on the monthly
  reading. Do not divide by three.
- **"No data" ≠ small.** Similarweb returns nothing for monitor.bg, kanal3.bg, vsekiden.com,
  pravda.bg, weekend.bg, tvevropa.com and argumenti-bg.com — all real outlets. Keep them as
  known-unmeasured in a note rather than deleting them from the world.
- **svobodnaevropa.bg understates RFE/RL Bulgaria**: its own domain is Tranco 483,632 while
  the parent rferl.org is **7,307**, and part of the Bulgarian service's audience is counted
  there. Treat its figure as a floor.
- **Similarweb and Semrush disagree by up to 70% on the same domain and month** (dir.bg
  12.1M vs 20.9M). Publish both columns; never average them into one number.

## Verify

```bash
f=news/data/bg_news_sites.csv
ncol=$(head -1 "$f" | awk -F, '{print NF}')                         # dynamic — survives future column additions
awk -F, -v n="$ncol" 'NF!=n {print "bad column count on line " NR}' "$f"
tail -n +2 "$f" | cut -d, -f2 | sort | uniq -c                      # tier split
tail -n +2 "$f" | cut -d, -f1 | awk 'NR>1 && $1!=p+1 {print "rank gap at " $1} {p=$1}'
tail -n +2 "$f" | cut -d, -f3 | sort | uniq -d                      # duplicate domains
grep -E 'sportal|gong\.bg|dsport|gol\.bg|flashscore|btvsport|topsport' "$f"   # must print nothing
```

⚠️ **Run this BEFORE declaring the refresh done — it is the check that catches Step 6's join
silently failing.**

```bash
python3 -c "
import csv
rows = list(csv.DictReader(open('news/data/bg_news_sites.csv', newline='', encoding='utf-8')))
feed_cols = [h for h in rows[0] if h.startswith('feed_')]
assert feed_cols, 'no feed_* columns at all — the join in Step 6 was skipped or the columns were dropped'
blank = [r['domain'] for r in rows if not any(r[h] for h in feed_cols)]
assert not blank, f'{len(blank)} domains have EVERY feed_* cell empty (join failed for them): {blank[:10]}'
print(f'{len(rows)} rows, {len(feed_cols)} feed_* columns, 0 fully-blank — OK')
"
```

A domain reporting `not_yet_probed` is fine (it is new this run and genuinely has not been
probed); a domain with every `feed_*` cell truly EMPTY means the join lost it — that is the
failure this whole section exists to prevent.

Then eyeball two things no script can check: that every `mass` row is an outlet a
Bulgarian reader would call a news site, and that the broadcaster rows use the news domain.

## Directory sources for candidate discovery

- `https://infospravka.com/novinarski-medii/` — ~60 outlets with domains, the widest single list.
- `https://www.mediascan.gadjokov.com/` — BG online media with Tranco ranks and ethics flags.
  ⚠️ Use it for DOMAIN DISCOVERY only. Its fake-news / hate-speech classifications are a
  third party's editorial judgement; do not fold them into this CSV.

## What this skill does NOT do

- **No Gemius figures** — licensed, and publisher-quoted "#1" claims are not a ranking.
- **No ownership column.** Ownership is not derivable from any source here; it needs the
  Ministry of Culture media register or Търговски регистър, and a wrong owner attached to a
  named outlet is a defamation-shaped error. Leave it out rather than guess.
- **No quality or trust scoring.**
- **Nothing is committed and nothing is published** — `news/` is a plain data folder, not
  part of the site build, with no loader, no bucket sync and no PG table.

## File map

| path | what |
| --- | --- |
| `news/data/bg_news_sites.csv` | the register — traffic ranking (this skill) + feed access method (see below) |
| `news/scripts/fetch_latest_articles.py` | reads this CSV's `feed_method_*`/`feed_url_*`; not owned by this skill — see fetch-news-articles |
| `<scratchpad>/tranco.csv` | working copy of the Tranco top-1M (CRLF stripped), never committed |
