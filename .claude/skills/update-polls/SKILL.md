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

Presidential polls use the separate data/polls/presidential/ family:
polls.json (surveys and question metadata), polls_details.json (candidate
answers), runoffs.json (paired answers), candidates.json (identity projection),
accuracy.json (round comparisons and diagnostics), and coverage.json (dated
archive coverage). They appear on /presidential/:cycle and
/polls/:agencyId/presidential. The agency overview links to its separate history.

Acceptance dispatches from the draft's race. Extraction can emit both races
from one publication. Presidential restamping, rekeying and accuracy are
implemented; crosscheck remains parliamentary only. See
[the presidential accuracy policy](../../../docs/polls/presidential-accuracy.md)
and [historical source review](../../../docs/polls/historical-backfill-review.md).

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

Watch state describes the last discovery check. Its new-item list is not the
processing queue. The durable ledger in state/polls/<AGENCY>.json retains
capture versions, extraction/refusal states, review and accepted hashes.
An unchanged watcher run cannot retire pending publications.

Inspect the backlog before declaring ingestion complete:

```bash
node --import tsx scripts/polls/backlog.ts
```

For historical inventory, walk the requested archive interval, optionally
capturing its electoral publications:

```bash
node --import tsx scripts/polls/inventory.ts --after 2016-01-01 --before 2016-12-31 --capture
node --import tsx scripts/polls/inventory.ts --after 2021-01-01 --before 2021-12-31 --agency ML --capture
```

Inventory records retain listing/capture failures. Reconcile them against
accepted surveys and record exclusions or missing metadata; a discovered
publication is not automatically an accepted poll.

A reviewed exclusion must reach the LEDGER, or the backlog reports the item as
pending for ever and re-running extraction cannot finish it:

```bash
npm run polls:exclude -- --agency AR --pub 912 --race presidential --reason "Round-two exit poll"
npm run polls:exclude -- --from-reconciliation   # after editing historical-reconciliation.json
node --import tsx scripts/polls/backlog.ts > state/polls/backlog.json
```

An exclusion binds to the current source hash AND one race: a changed source
reopens review, and a presidential exclusion leaves a joint publication's
parliamentary draft pending. The reconciliation's `excluded` status resolves
both races (not a survey at all); `other_race`/`other_question` resolve only
the presidential one. An accepted race is refused — correct the corpus instead.

`polls:extract` never overwrites an inbox draft or re-opens an accepted race on
an unchanged source version. To deliberately rebuild one publication's drafts,
pass `--agency <ID> --pub <id> --regenerate`; the replaced bytes are archived to
`state/polls/review-history/<sha256>.json` first.

Ledger writes take `state/polls/<AGENCY>.json.lock`, a symlink naming its
owner. A lock left by a killed process is recovered automatically on this host;
a DIRECTORY lock was written by the pre-ownership code and must be removed by
hand once no polls writer is running. state/ingest/update-polls.json
records a completed ingestion run, not merely a successful watch.

## Step 1 — Fetch, extract, review, accept

```bash
npm run polls:fetch                    # every pending item across all 7 fetchable agencies
npm run polls:extract                  # text/OCR + agency extraction + evidence gate
```

`polls:fetch` downloads the page HTML, every PDF attachment, and (for
Trend/Alpha Research/Sova Harris — decision 18) each agency's own
chart/passport IMAGES, into `raw_data/polls/<agency>/<pubId>/` with a
`SOURCE.json`. Safe to re-run: it skips a `pubId` whose `SOURCE.json`
already exists unless `--force`. Narrow to one agency/publication with
`--agency TR [--pub <id>]`; capture a press article or a Wayback snapshot
of an agency's own page with `--url <articleUrl> --agency <ID>` /
`--archive <waybackUrl> --agency <ID>`.

Built extractors cover TR, AR, GM, ML, SH, MY and GIB. They use captured
article text, document tables and OCR where available. Structured and
aligned-table fallbacks are conservative: missing dates, bases, methods or
unreadable chart values remain refused. A successful extractor dispatch does
not mean that the source can be accepted without review.

One publication may emit separate parliamentary and presidential drafts.
Presidential questions retain their own measure, base, round, scenario,
answer scale, residuals and evidence. Party-backed hypothetical choices,
named-person support potential, vote intention, runoffs and participation
must never be merged into one candidate ranking. Participation uses
question.observations, with no invented candidate identity.

Drafts are written under data/polls/_inbox/. A provisional publication-based
ID must be resolved from supported fieldwork metadata before acceptance.
A refusal remains visible in the ledger/backlog on subsequent unchanged runs.

**Print the evidence table and review each draft before accepting.** For
every file under `data/polls/_inbox/`:

```bash
node -e "
const fs = require('fs');
for (const f of fs.readdirSync('data/polls/_inbox')) {
  const d = JSON.parse(fs.readFileSync('data/polls/_inbox/'+f, 'utf8'));
  console.log(f, '|', d.race, '|', d.poll.agencyId, '|', d.poll.fieldwork, '| n='+d.poll.respondents,
    '| genre='+d.genre, '| residual='+JSON.stringify(d.residual),
    '| shares:', d.details.map(x => (x.candidateName_bg || x.nickName_bg)+'='+x.support).join(' '),
    '| refused:', d.refused.map(r => r.field).join(','));
}
"
```

Columns to look at: **race**, **question and answer identity**, **agency**, **fieldwork**, **n** (sample size), **genre**
(`raw_attitudes`/`forecast`/`both_published`/`unclear` — decision 8),
**population base**, **residual** (preserved as published for presidential questions),
**publication date separately from fieldwork**,
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

Then, for each source-reviewed draft:

```bash
npm run polls:accept -- <pollId>
npm run polls:accept -- <pollId> --genre forecast              # override the extractor's genre call
npm run polls:accept -- <pollId> --election 2026-11-08          # assign a supported parliamentary election date
npm run polls:accept -- <pollId> --locked-by agency_pdf         # override the default agency_website tier
npm run polls:accept -- <pollId> --replace                      # preserve a full prior snapshot
npm run polls:accept -- <pollId> --cycle 2021_11_14_pvr          # presidential, when supported
```

Acceptance validates runtime values, dates, percentages, unique answers,
question references, survey/agency identities and runoff participants.
An empty candidate corpus needs --allow-empty unless it contains validated
participation observations. That flag does not make missing source evidence
acceptable. A provisional publication ID is refused. --replace preserves
the previous poll, questions, details and runoffs in locked.supersedes.

A cycle assignment does not establish scoring eligibility. Likely-voter and
all-respondent bases stay as published; never rename them “decided voters”
to get a grade. Unknown publication dates and incomplete candidate coverage
remain visible exclusions or partial comparisons. Once accepted, the draft
is removed from the inbox.

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

### Presidential assignment, identities and recomputation

```bash
npm run polls:restamp -- --race presidential --cycle <YYYY_MM_DD_pvr>
npm run polls:presidential:rekey -- --cycle <YYYY_MM_DD_pvr>
npm run polls:analyze -- --race presidential
npm run polls:presidential:coverage
```

Restamping only assigns null-cycle surveys inside that cycle's fieldwork
window and reruns analysis. It does not move old unknowns into a future
election. Rekeying upgrades provisional candidate and runoff keys from
preserved source names, scoped to the official ticket list. Ambiguous
identities stay unresolved. Recompute accuracy after rekeying.

Presidential analysis selects eligible questions separately by round.
It retains partial candidate errors but withholds MAE/RMSE and prediction
verdicts when required coverage is missing. Hypothetical pre-election
runoffs are separate from actual between-round surveys. No vote-share
threshold alone establishes that an election was decided in one round.

Coverage regeneration reads the dated historical reconciliation and saved
watch states. Review/reconcile new publications before regenerating it;
zero accepted surveys does not mean zero published surveys. For the
reviewed September 2026 archive, 2001 remains uncovered and Gallup has a
recorded source outage.

## Step 2 — Third-party verification (press-arm flips only)

A `polls_press` flip (or Gallup's press arm) names an article about an
agency with **no site of its own** (Медиана, АФИС, ЦАМ, and — per §2.1 —
Екзакта/Барометър България/ИМП/Online Solutions when they surface). Google
News RSS only finds the article; it does not capture it, and its `<link>`
is a `consent.google.com`-walled redirect token that cannot be fetched
server-side.

1. Resolve the real article URL on the outlet by hand (WebFetch or a browser).
2. Capture the resolved source with polls:fetch -- --agency <ID> --url <URL>.
   Run polls:extract for a built agency (TR, AR, GM, ML, SH, MY or GIB).
   Press-only agencies still need a source-reviewed draft written from their
   captured evidence; do not invent an extractor result or accept a news
   headline as numerical evidence.
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
npm run polls:analyze -- --race presidential
npm run polls:presidential:coverage
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
| SH extraction refuses chart values | The bulletin OCR/table did not provide sufficient evidence. The extractor exists; chart-only sources still require careful review. | Inspect the captured page images and correct the draft only from the primary chart. |
| ML attachments fail | A failure belongs to that URL and check time. Historical reports and legacy report download endpoints were successfully captured in the September 2026 audit. | Recheck the exact attachment and capture diagnostics; do not assume a permanent /storage/ block. |
| GIB site arm errors | The site failed TLS negotiation in the September 2026 audit; the press arm is independent. | Retain the outage and pending coverage. Use an available archive or independently corroborated press evidence; do not disable TLS verification. |
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
- **Dates**: provenance fieldworkStart/fieldworkEnd and electionDate use
  ISO dates; cycle folders use underscores. The display fieldwork label is
  written by formatFieldwork in src/data/polls/fieldwork.ts. Preserve unknown
  publication dates; do not substitute fieldwork end or a migrated site date.
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
npm run polls:extract                                     # Step 1 (text/OCR + extractor + evidence gate)
#    review data/polls/_inbox/*.json by hand               # Step 1
npm run polls:accept -- <pollId>                           # Step 1 (promote a reviewed draft)
npm run polls:restamp -- --race parliamentary --to <iso>   # Step 1.5 (only when a vote is scheduled)
npm run polls:crosscheck                                   # Step 3 (Wikipedia diff, report only)
#    write data/polls/analysis.json by hand                # Step 4 (only for a new election)
npm run polls:analyze                                      # parliamentary accuracy
npm run polls:analyze -- --race presidential                # question/round comparisons
npm run polls:presidential:coverage                         # dated public coverage
npx tsx scripts/stamp-ingest.ts update-polls --summary "…" # Step 5
```
