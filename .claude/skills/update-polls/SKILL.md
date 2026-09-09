---
name: update-polls
description: Refresh the polling corpus from each agency's own publication (Trend, Alpha Research, Market Links, Sova Harris, Мяра, Global Metrics, Gallup, press-only agencies) — capture, extract, review the evidence, and accept into data/polls/. Use when the user asks to update polls, add polls for a new election cycle, refresh poll accuracy, regenerate polling analysis, or process a polls_* watcher flip.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Polls skill

Walks through the full refresh cycle for `data/polls/*.json`. Plan:
`docs/plans/polls-agency-watchers-v1.md`.

⚠️ **The corpus's primary source is each agency's OWN publication, never
Wikipedia** (decision 1). `scrape_polls.ts` — which used to scrape BG
Wikipedia and merge the result straight into `polls.json` — is retired;
Wikipedia's polling tables have measured defects (renormalized values,
dropped small parties, outright mislabels, publication-vs-fieldwork date
drift) that made them unsafe to trust unread. It survives only as
`polls:crosscheck`, a read-only report (§6.5, Step 3 below).

| File | What it is | Updated by |
|---|---|---|
| `data/polls/agencies.json` | Polling agency directory | hand-maintained (`scripts/polls/lib/agencies.ts`) |
| `data/polls/polls.json` | Per-poll metadata (agency, fieldwork dates, source, `locked`, `provenance`) | `polls:accept` / `polls:restamp` |
| `data/polls/polls_details.json` | Per-poll, per-party support % | `polls:accept` |
| `data/polls/accuracy.json` | Computed errors, MAE, party bias, bloc lean | `polls:analyze` |
| `data/polls/analysis.json` | AI-written narrative (headlines + story per election + agency takes) | hand-written by Claude (preferred) OR `polls:gen-analysis` (calls the Anthropic API directly, non-interactively) |
| `data/polls/_inbox/*.json` | Auto-extracted drafts awaiting operator review | `polls:extract`; consumed (and deleted) by `polls:accept` |
| `raw_data/polls/<agency>/<pubId>/` | Captured HTML/PDF/images + `SOURCE.json` | `polls:fetch` |

The scripts live in `scripts/polls/`. The frontend reads `data/polls/*.json`
via `dataUrl("/polls/…")` (bucket-served — see "The upload" below) at `/polls`
and via the `PollsTile` / `AccuracyTrendsTile` on the dashboard.

Presidential polls (decision 10) are a separate, not-yet-shipped file family
(`data/polls/presidential/*.json`). `accept` (from the draft's own `race`
field), `restamp` and `crosscheck` (both via `--race`) explicitly refuse a
presidential run rather than guessing at a schema that hasn't landed;
`fetch`/`extract`/`analyze` have no race concept at all today — they simply
operate on the one parliamentary corpus unconditionally. Tier 4 of the plan
covers the presidential build-out.

## When to run this

- **A `polls_*` watcher flipped** — the daily report names the agency(ies)
  with a new electoral publication. This is the normal case; run Steps 0–5
  below.
- **A new election just happened** — same steps; the new poll(s) captured in
  the run before the vote get `--election <iso>` at accept time, and Step 4
  writes the narrative for the new election.
- **A parliamentary vote just became `scheduled`** (or a previously-estimated
  date moved) — run `polls:restamp` (Step 1.5 below) so every null-dated poll
  between the last election and the new one gets stamped and scored.
- **A new polling agency surfaces** — a `polls_press` flip naming an agency
  not in `scripts/polls/lib/agencies.ts`, or an `unknown agencies skipped`
  warning from `polls:crosscheck` (the only script that scans free-text
  agency names against the registry; `polls:extract`'s own
  `unknown or unbuilt --agency` error only fires on an explicit `--agency`
  value). Add it there (id, alias
  spellings, `reach: "site" | "press"`) before re-running.

## Step 0 — See what's new

```bash
cat state/watch/polls_trend.json state/watch/polls_alpha_research.json \
    state/watch/polls_market_links.json state/watch/polls_sova_harris.json \
    state/watch/polls_myara.json state/watch/polls_global_metrics.json \
    state/watch/polls_gallup.json state/watch/polls_press.json 2>/dev/null
cat state/ingest/update-polls.json 2>/dev/null
```

Each `state/watch/polls_*.json` is one of the eight `polls_*` sources
(decision 2 — one watcher per agency, plus `polls_press` for every
site-less agency). `meta.items` lists what is NEW since the last run for
the six single-arm site watchers; Gallup's two-armed watcher splits that
into `meta.site.items`/`meta.press.items`; `polls_press` itself keys by
agency instead, `meta.agencies.<agencyId>.items` (one Google News query per
site-less agency). This is the exact backlog `polls:fetch` below picks up
automatically, so this step is for YOU to know what to expect, not
something the CLI needs told to it.

`state/ingest/update-polls.json`'s `lastSuccessfulIngest` is what the
orchestrator (`process-watch-report`) compares each source's
`lastChanged` against to decide whether to queue this skill at all.

## Step 1 — Fetch, extract, review, accept

```bash
npm run polls:fetch                    # every pending item across all 7 fetchable agencies
npm run polls:extract                  # text acquisition + extraction + the evidence gate — TR/AR only, see below
```

`polls:fetch` downloads the page HTML, every PDF attachment, and (for
Trend/Alpha Research/Sova Harris — decision 18) each agency's own
chart/passport IMAGES, into `raw_data/polls/<agency>/<pubId>/` with a
`SOURCE.json`. Safe to re-run: it skips a `pubId` whose `SOURCE.json`
already exists unless `--force`. Narrow to one agency/publication with
`--agency TR [--pub <id>]`; capture a press article or a Wayback snapshot
of an agency's own page with `--url <articleUrl> --agency <ID>` /
`--archive <waybackUrl> --agency <ID>`.

⚠️ **`polls:extract` only has a built extractor for TR and AR today**
(`scripts/polls/extract.ts`'s own header names the gap: ML/GM's
aligned-row rule, MY, SH's OCR+table rule, and GIB are not yet built). A
bare `polls:extract` silently iterates just those two — a captured ML, SH,
MY, GM, or GIB publication sits in `raw_data/` with **no path to a draft
and no warning printed**. Running `polls:extract -- --agency SH` (or any
other unbuilt agency) errors immediately (`unknown or unbuilt --agency`)
rather than attempting anything. For TR/AR, it runs text acquisition
(plain text first, then **tesseract** OCR on the captured images when the
text yield is short — decision 18; the Gemini-Vision half of that fallback
is planned but not yet implemented, so a chart-only post below the
`< 3 shares` threshold is refused rather than OCR'd by Vision), then that
agency's deterministic sentence-rule extractor, then the evidence gate
(every share/passport value needs a verbatim quote that both occurs in the
text AND states that value). It writes one pretty-printed draft per
publication to `data/polls/_inbox/<pollId>.json` — `<agency>-pub-<pubId>.json` when no
fieldwork end date resolved (a PROVISIONAL id; superseded automatically once
a later re-extraction resolves a real one).

**Print the evidence table and review each draft before accepting.** For
every file under `data/polls/_inbox/`:

```bash
node -e "
const fs = require('fs');
for (const f of fs.readdirSync('data/polls/_inbox')) {
  const d = JSON.parse(fs.readFileSync('data/polls/_inbox/'+f, 'utf8'));
  console.log(f, '|', d.race, '|', d.poll.agencyId, '|', d.poll.fieldwork, '| n='+d.poll.respondents,
    '| genre='+d.genre, '| residual='+JSON.stringify(d.residual),
    '| shares:', d.details.map(x => x.nickName_bg+'='+x.support).join(' '),
    '| refused:', d.refused.map(r => r.field).join(','));
}
"
```

Columns to look at: **race** (parliamentary only today — see the file
header), **agency**, **fieldwork**, **n** (sample size), **genre**
(`raw_attitudes`/`forecast`/`both_published`/`unclear` — decision 8),
**residual** (undecided/wontVote, redistributed by the analyzer),
**shares with quotes** (open the draft file itself to read
`evidence`/`provenance.quotes` beside each value), and **refused fields**
(what the gate couldn't verify — a chart-only post whose OCR yield was
short, a passport field with no matching quote). `methodology` is
**never** resolved by the extractor (decision 5 — an English translation
of an agency's own methodology text can't be quote-verified against a
Bulgarian source) — **edit the draft file by hand** to fill in
`poll.methodology.bg`/`.en` before accepting; this is also the moment to
fix anything else a human reading the source page caught that the
extractor didn't.

Then, for each draft the operator confirms:

```bash
npm run polls:accept -- <pollId>
npm run polls:accept -- <pollId> --genre forecast              # override the extractor's genre call
npm run polls:accept -- <pollId> --election 2026-11-08          # this poll IS scorable against a known date
npm run polls:accept -- <pollId> --locked-by agency_pdf         # override the default agency_website tier
npm run polls:accept -- <pollId> --replace                      # supersede an already-locked/genre-protected poll
```

`polls:accept` refuses: a zero-share draft (pass `--allow-empty` if that's
correct — e.g. a chart-only post with no OCR fallback built yet),
a provisional (`-pub-<id>`) id, and an existing poll already protected by
`locked` OR the legacy `genre` marker unless `--replace` (which records the
superseded values under `locked.supersedes` rather than discarding them).
On success it deletes the inbox file and, if the accepted poll now has an
`electionDate`, reminds you to run `polls:analyze`.

## Step 1.5 — Restamp (only when a vote becomes scheduled)

```bash
npm run polls:restamp -- --race parliamentary --to <iso>
```

Stamps every still-null-dated parliamentary poll whose fieldwork falls
after the most recently HELD parliamentary election and before `<iso>`,
then **always** runs `polls:analyze` — this is the one command that exists
so nobody has to remember that follow-up step. Not part of the routine
per-publication flow above; run it only when a new vote's date is
announced (or an estimated date moves).

## Step 2 — Third-party verification (press-arm flips only)

A `polls_press` flip (or Gallup's press arm) names an article about an
agency with **no site of its own** (Медиана, АФИС, ЦАМ, and — per §2.1 —
Екзакта/Барометър България/ИМП/Online Solutions when they surface). Google
News RSS only finds the article; it does not capture it, and its `<link>`
is a `consent.google.com`-walled redirect token that cannot be fetched
server-side.

1. Resolve the real article URL on the outlet by hand (WebFetch or a browser).
2. `npm run polls:fetch -- --agency <ID> --url <resolvedArticleUrl>`, then
   `polls:extract` as in Step 1.
3. Lock as `third_party_consensus` (`polls:accept -- <pollId> --locked-by
   third_party_consensus`) **only** when a second, independent outlet's
   capture agrees with the first on every figure — the corpus's existing
   rule, now with the press watcher finding the citations instead of a
   human googling them.

## Step 3 — Cross-check (report only)

```bash
npm run polls:crosscheck
```

Reads the current BG Wikipedia parliamentary polling page and diffs it
against `data/polls/polls.json`, printing **missing here** (on Wikipedia,
not in the corpus — each with a citation URL; capture it with
`polls:fetch --url` if it looks like a real publication we missed),
**missing there** (in the corpus, not on Wikipedia — informational; a
recent inter-election poll Wikipedia hasn't caught up with yet is normal),
**disagreements** (>0.5pp on a shared label, or a differing sample size —
this is where Wikipedia's renormalization defect shows up, and the corpus's
own agency-sourced number is the one to trust), and **extra labels** (a
small party Wikipedia lists that the corpus poll doesn't carry —
informational). Exits 0 for any set of FINDINGS on a normal run — missing
or disagreeing rows are the point, never a failure — but still throws on a
genuine fetch/parse error (the page restructured, a network failure) and
exits 1 on an unsupported `--race`. A run where crosscheck was the ONLY
thing that changed (`wiki_polls` flipped, nothing else) still does Steps 0
and 5 — that is what stops it re-queuing every day.

## Step 4 — Write the narrative (only for a NEW election)

Skip this step entirely unless a poll accepted in this run was the FIRST
one carrying a genuinely new `electionDate` (or a `cik_presidential` flip
once Tier 4 ships, T4.7). `agencyTakes` stays one-per-`agencyProfiles`
entry from `accuracy.json` — an agency with no scored polls (e.g. GM until
2026's presidential results land) needs no entry at all.

**Strongly preferred: Claude writes the narrative directly** in this
session rather than invoking `polls:gen-analysis` non-interactively —
writing it interactively produces materially better analysis with hedged
language and real story-telling; the non-interactive path (which also
calls a Claude/Opus model, just via a raw API request with no
conversational context) reads more like a numbers recitation and was
explicitly downgraded by the user once already.

### 4a. Read the inputs

```bash
node -e "
const a = require('./data/polls/accuracy.json');
console.log('=== ELECTIONS ===');
a.elections.filter(e => e.agencies.length > 0).forEach(e => {
  console.log('\n'+e.electionDate);
  console.log('  ACTUAL:', e.actualResults.filter(r => r.passedThreshold || r.pct >= 2).map(r => r.key+'='+r.pct).join(' '));
  e.agencies.sort((x,y) => x.mae - y.mae).forEach(ag => {
    const top3 = ag.errors.slice(0, 3).map(er => er.key+(er.error>0?'+':'')+er.error).join(' ');
    console.log('  '+ag.agencyId.padEnd(5)+' MAE='+ag.mae+' '+ag.daysBefore+'d, n='+ag.respondents+' | '+top3);
  });
});
console.log('\n=== AGENCY PROFILES ===');
a.agencyProfiles.forEach(p => {
  console.log('\n'+p.agencyId+' MAE='+p.overallMAE+' elections='+p.electionsCovered.length);
  console.log('  party bias: '+p.partyBias.slice(0,5).map(b=>b.key+(b.meanError>0?'+':'')+b.meanError+' (n='+b.samples+')').join(', '));
  console.log('  bloc lean: '+Object.entries(p.blocLean).filter(([,v])=>v.samples>0).map(([k,v])=>k+(v.meanError>0?'+':'')+v.meanError).join(', '));
});
"
```

Read the existing `data/polls/analysis.json` for tone and structure — match it.

### 4b. Output schema

`analysis.json` has this exact shape:

```jsonc
{
  "generatedAt": "<ISO timestamp>",
  "model": "Claude Opus 4.7 (1M context)",      // whatever Claude model is writing
  "inputAccuracyGeneratedAt": "<value from accuracy.json>",
  "agencyTakes": [
    {
      "agencyId": "GIB",                         // matches agencyProfiles[].agencyId
      "summary": { "en": "2-3 sentences", "bg": "Same in BG" },
      "lean": { "en": "1 sentence", "bg": "Same" },
      "warning": { "en": "1 sentence caveat (or empty string)", "bg": "Same" }
    }
    // ... one per agency in agencyProfiles, same order (sorted by overallMAE asc)
  ],
  "byElection": {
    "2026-04-19": {                              // ISO date matching accuracy.elections[].electionDate
      "headlines": {
        "en": ["3-5 sentence-length bullets, all about THIS election"],
        "bg": ["Same number of bullets in BG"]
      },
      "story": {
        "en": "2-4 sentence summary",
        "bg": "Same in BG"
      }
    }
    // ... one entry per election in accuracy.elections that has agencies.length > 0
  }
}
```

### 4c. Writing principles

**For agency takes (cross-election):**

1. **Lead with MAE and election count** so a reader knows the confidence level immediately.
2. **Lean section** = which parties or blocs they systematically over- or under-poll. Quote the signed mean error and sample size.
3. **Warning** = sample size, fieldwork-distance issues, methodology drift, or "this profile is provisional" for n < 3 elections. Empty string is OK.
4. **Don't pretend agencies with n=1 have a profile.** Use "provisional", "n=1 election", "cannot distinguish house effect from cycle-specific error yet".
5. **Bulgarian translations** should read like native journalism, not literal translation. "Pro-establishment signature" → "проистаблишмънт почерк" (not "подпис").

**For per-election headlines + story:**

1. **Headlines should be SPECIFIC to that election** — name the parties, quote the actual percentages, identify the closest/worst agency. Never recycle headlines across elections.
2. **The "story" is the why behind the numbers.** What happened in this election that made polling easy or hard? Late-breaking party? Voter shift the polls couldn't catch? Sampling problem with a specific demographic?
3. **Connect to broader patterns** when honest: "the same blind spot showed up in 2021-07 with ИТН and 2026 with ПрБ" is a real cross-election pattern. "Установените партии се представиха според очакванията" is filler.
4. **Quote numbers exactly.** Don't round 24.71% to 25%. The page is for nerds; precision matters.
5. **Hedge new parties** — when n=1 election and the agency missed the rising party by 10+pp, that's a cycle artifact, not a house effect. Say so.
6. **For thin coverage (1-2 agencies, single cycles)**, write less. A 2017 entry with only TR and AFIS represented should be 2-3 headlines max, with explicit "limited data" note.

**Length budget:**

- Per election: 4-5 headlines × ~30 words EN; story ~60 words EN; same in BG → ~420 words total per election
- Per agency take: ~80 words EN total (summary + lean + warning); same in BG → ~160 words total per agency

### 4d. Write `analysis.json`

Use the `Write` tool to overwrite `data/polls/analysis.json`. **Always set
`model` to your actual Claude model name** — the frontend displays this as
"Editorial · <model>" in the headlines tile footer. Keep existing entries
when only a new election needs writing — read the file first, append the
new election's entry to `byElection[]`, regenerate `agencyTakes` only if an
agency's stats meaningfully shifted.

### 4e. Non-interactive fallback (only if explicitly asked)

Calls the Anthropic API directly (needs `ANTHROPIC_API_KEY` in `.env.local`)
rather than writing the file through this session:

```bash
npm run polls:gen-analysis                        # all elections (~12 calls, ~2 min)
npm run polls:gen-analysis -- --only YYYY-MM-DD    # one election (1 call)
```

## Step 5 — Recompute accuracy, stamp, publish

```bash
npm run polls:analyze
```

(Restamp already ran this in Step 1.5 if that step applied — running it
again here is harmless and idempotent.)

Then:

```bash
node -e "JSON.parse(require('fs').readFileSync('data/polls/analysis.json'))" && echo "analysis.json valid"
npx tsx scripts/stamp-ingest.ts update-polls --summary "<BG one-liner — race · agency · what happened>"
if [ -n "$(git diff --stat data/polls/)" ]; then
  npx tsx scripts/append-data-change.ts update-polls \
    --summary "<same one-line recap>" \
    --source "<agency name(s)>"
fi
```

`update-polls`'s `/polls` link already exists in `linksForSkill`
(`scripts/lib/data-changes.ts`), so no separate wiring is needed there.
Note `polls` as a touched bucket subtree for `/upload-watch-changes`'s
manifest — `data/polls/_inbox/` is excluded from every sync path
(`isExcluded`/`CHILD_EXCLUDES`/the `-x` regex in `bucket:sync*`) so an
unaccepted draft never reaches the bucket, only the accepted corpus files
do.

## Troubleshooting (the §2 landscape, in operator form)

| Symptom | What it means | What to do |
|---|---|---|
| TR (Trend) `polls:fetch` finds nothing new for a long time | TR's RSS feed is frozen at 2018 — the lister must use `wp-json/wp/v2/project`, never the feed. If this happens, it's a code regression in `scripts/polls/agencies/trend.ts`, not an agency outage. | Check the lister's endpoint, not the RSS. |
| AR (Alpha Research) extraction yields odd tokens or spam-looking text | The site injects casino/gambling spam LINKS on its blog *listing* page (`/blog/?page=N`), not inside article bodies — `isOwnPostLink()` in `scripts/polls/agencies/alpha_research.ts` filters them out before any article is ever fetched. `stripUrls()` in `text_acquisition.ts` is a generic bare-URL stripper applied to every agency, not an AR-specific spam-token list. | If a real quote in an extracted ARTICLE looks corrupted, check `stripUrls()`; if spam links are reaching the lister's output at all, check `isOwnPostLink()`. |
| SH (Sova Harris) has no extractor yet | `polls:extract` has no built extractor for SH (only TR/AR today) — `-- --agency SH` errors immediately rather than producing a draft. Sova Harris publishes ONLY as bulletin page JPGs (no text, no PDF), so its extractor needs the OCR+table rule §6.2 describes, not yet built. | Not actionable today beyond capturing with `polls:fetch` — the images land under `raw_data/polls/sova_harris/<pubId>/` and wait until the extractor ships. |
| ML (Market Links) PDF attachments fail with HTTP 403 | A WAF block on `/storage/` PDFs, confirmed live across curl/Node with every header variation tried (see the dated comment in `scripts/polls/fetch.ts`) — not a link-discovery problem. The page HTML still captures; only the PDF attachment fails. | No known workaround short of an operator manually retrieving the PDF; `polls:extract` has no ML extractor yet regardless (aligned-row rule, not yet built). |
| GIB (Gallup) site arm errors | gallup-international.bg has a broken TLS cert (confirmed 2026-09-05) — the press arm (Google News RSS) still works independently. | Capture via `--archive <waybackUrl>` instead of `--url` until the cert is fixed; `meta.armErrors` on the watcher state records which arm failed. |
| A press-arm item's link 404s or redirects to a Google consent page | Google News RSS `<link>` is a `consent.google.com`-walled redirect token, never fetchable server-side by design. | Resolve the real article URL on the outlet by hand (Step 2), then `--url` that. |
| A draft's filename ends in `.v2.json` (or higher) | The agency re-issued a corrected publication at the same URL; `polls:fetch --force` detected a changed hash and versioned it rather than silently overwriting. | Review it like any other draft — `polls:accept` finds the latest version automatically. |
| `polls:crosscheck` warns `unknown agencies skipped` | A pollster's Wikipedia-table name doesn't fold to any entry in `scripts/polls/lib/agencies.ts` (a genuinely new one, or a spelling variant). | Add an id + alias entry there (and `reach: "site"\|"press"`) if it's real, then re-run. |
| A draft's `refused` array names a field with no quote | The evidence gate found no verbatim text supporting a value (a chart image the tesseract pass couldn't read — the Gemini-Vision fallback for this is planned but not built, decision 18 — or a passport field styled unusually). | Read the raw capture yourself; either fix the extractor's pattern or hand-edit the draft (methodology already requires this) before accepting. |

## Common pitfalls

- **Never run `polls:accept` on a whole batch unattended.** Decision 7's
  whole point is a human reviews the evidence table once per run — an
  `--auto-accept` mode is explicitly future work (Tier 5, ⚑ §11.2), not
  something to fake by scripting repeated `polls:accept` calls.
- **`data/polls/polls.json`/`polls_details.json` stay MINIFIED, single-line
  JSON** — `polls:accept`/`polls:restamp` already write them that way;
  never hand-format them. `_inbox/*.json` is pretty-printed on purpose (for
  humans) and excluded from the bucket sync.
- **Date format**: corpus `fieldwork`/`electionDate` are ISO with hyphens
  (`2026-04-19`); `raw_data/`/folder names use underscores. Never format
  one as the other.
- **The `NA` ("Общ консенсус") placeholder agency and the old `izboriai`
  seed are both already gone**, in separate cleanups predating this pipeline
  — `NA` was dropped from `agencies.json` entirely, and
  `--seed-izboriai` no longer exists (decision 1 deleted it with
  `scrape_polls.ts`). Neither should reappear; the corpus is populated
  exclusively through `fetch`/`extract`/`accept` now.
- **`methodology` is never auto-filled.** Every draft needs it hand-edited
  before `polls:accept` will take it (decision 5) — this is not a bug in
  the extractor.

## Quick command reference

```bash
npm run polls:fetch                                       # Step 1 (capture pending publications)
npm run polls:extract                                     # Step 1 (text/OCR + extractor + evidence gate — TR/AR only)
#    review data/polls/_inbox/*.json by hand               # Step 1
npm run polls:accept -- <pollId>                           # Step 1 (promote a reviewed draft)
npm run polls:restamp -- --race parliamentary --to <iso>   # Step 1.5 (only when a vote is scheduled)
npm run polls:crosscheck                                   # Step 3 (Wikipedia diff, report only)
#    write data/polls/analysis.json by hand                # Step 4 (only for a new election)
npm run polls:analyze                                      # Step 5 (recompute accuracy)
npx tsx scripts/stamp-ingest.ts update-polls --summary "…" # Step 5
```
