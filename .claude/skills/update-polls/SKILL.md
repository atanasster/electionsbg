---
name: update-polls
description: Refresh the polling-accuracy data — scrape new polls from BG Wikipedia, recompute accuracy metrics, and write a hand-crafted narrative for the new election. Use when the user asks to update polls, add polls for a new election cycle, refresh poll accuracy, regenerate polling analysis, or import the latest pre-election surveys.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Polls skill

Walks through the full refresh cycle for `public/polls/*.json`. The pipeline has four files and three scripts:

| File | What it is | Updated by |
|---|---|---|
| `public/polls/agencies.json` | Polling agency directory | `scrape_polls.ts` |
| `public/polls/polls.json` | Per-poll metadata (agency, fieldwork dates, source) | `scrape_polls.ts` |
| `public/polls/polls_details.json` | Per-poll, per-party support % | `scrape_polls.ts` |
| `public/polls/accuracy.json` | Computed errors, MAE, party bias, bloc lean | `analyze_accuracy.ts` |
| `public/polls/analysis.json` | AI-written narrative (headlines + story per election + agency takes) | hand-written by Claude (preferred) OR `generate_analysis.ts` (Gemini fallback) |

The scripts live in `scripts/polls/`. The frontend reads the JSONs at `/polls` and via the `PollsTile` / `AccuracyTrendsTile` on the dashboard.

## When to run this

- **A new election just happened** — scrape the new pre-election polls and write the narrative for that cycle.
- **An inter-election polling cycle has accumulated new polls** (e.g., 6+ months of fresh polls between elections) — refresh polls.json so trends stay current.
- **A new polling agency surfaces in the wild** — surfaces as an "unknown agency skipped" warning in scrape output; needs to be added to the alias map.
- **The accuracy formula or bloc definitions changed** — `analyze_accuracy.ts` only.

## Step 1 — Decide what changed

Before running anything, figure out which steps are needed:

1. **Is there a new election?** Check `public/` for a `YYYY_MM_DD/` folder that doesn't appear in `accuracy.elections[]`:
   ```bash
   ls public/ | grep -E '^\d{4}_\d{2}_\d{2}$'
   node -e "console.log(JSON.parse(require('fs').readFileSync('public/polls/accuracy.json')).elections.map(e=>e.electionDate))"
   ```
   If yes, you'll need to add a `Cycle` entry to `scripts/polls/scrape_polls.ts` (see Step 2).

2. **Should the existing cycle be re-scraped?** If it's been weeks since the last scrape and new polls likely appeared, re-run scrape — `polls.json` dedupes by poll id so it's safe.

3. **Did party labels change?** Mergers, splits, or a new party joining the ballot may need new aliases in `analyze_accuracy.ts` `POLL_TO_ACTUAL`. Often you'll hit this only when the analyzer reports tons of `?` errors.

## Step 2 — Scrape new polls

The scraper reads BG Wikipedia's "Парламентарни избори в България (YYYY)" pages — that's where every Bulgarian agency's published polls get aggregated, license-clean, well-structured. Per-agency website scraping is 3-4× the work for ~5% more coverage.

### 2a. Add a new election cycle (only if new election)

Open `scripts/polls/scrape_polls.ts` and find the `CYCLES` array near the top:

```ts
const CYCLES: Cycle[] = [
  {
    url: "https://bg.wikipedia.org/wiki/Парламентарни_избори_в_България_(2026)",
    electionDate: "2026-04-19",
  },
];
```

Add a new entry. **First verify the page exists** with a quick `WebFetch` before running the scrape — Wikipedia's URL convention is consistent but not guaranteed:

```
https://bg.wikipedia.org/wiki/Парламентарни_избори_в_България_(YYYY)
```

For inter-election polling buckets (no upcoming election yet), set `electionDate: null` and leave the URL as the most recent cycle's page (BG Wiki keeps adding inter-election polls there until the next election is scheduled).

### 2b. Run the scrape

```bash
npm run polls:scrape
```

First-time-ever run (no existing data, importing from izboriai seed):
```bash
npm run polls:scrape -- --seed-izboriai
```

Expected output:
```
→ https://bg.wikipedia.org/wiki/...
  ✓ NN polls, NNN party rows, agencies: ML, MY, ...
✓ wrote NN polls / NNN details / N agencies → public/polls
```

### 2c. Handle "unknown agencies skipped" warnings

If you see:
```
! unknown agencies skipped: Foo Research | Bar Institute
```

A new agency has appeared. Add to `AGENCY_ALIASES` in `scripts/polls/scrape_polls.ts`:

```ts
{
  id: "FR",                                    // 2-3 letter id, must be unique
  aliases: ["foo research", "фоо рисърч"],     // lowercase substrings to match
  agency: {
    id: "FR",
    website: "https://fooresearch.example/",   // or null
    name_bg: "Фоо Рисърч",
    name_en: "Foo Research",
    abbr_bg: "ФР",
    abbr_en: "FR",
  },
},
```

Then re-run the scrape. The scraper merges by `pollId = ${agencyId}-${endDate}`, so reruns are idempotent.

### 2d. Sanity-check the scraped output

```bash
node -e "
const polls = require('./public/polls/polls.json');
const details = require('./public/polls/polls_details.json');
console.log('Total polls:', polls.length);
console.log('Newest 5:');
polls.slice(0, 5).forEach(p => {
  const d = details.filter(x => x.pollId === p.id).slice(0, 4).map(x => x.nickName_bg+'='+x.support).join(', ');
  console.log('  '+p.id+' | '+p.fieldwork+' | n='+p.respondents+' | '+d);
});
"
```

Watch for:
- **Wonky decimals** like `29.49`, `20.764` — the cell contains `<b>29</b><br><small>49</small>` (pct + seats). The parser strips `<small>` before reading; if you see this, `parsePct()` regressed.
- **"Mar 2024"-style fieldwork** — vague single-month dates fall back to mid-month. Acceptable for old izboriai-seed data but new polls should always have specific date ranges.
- **Sample sizes of `null`** — Wikipedia row didn't have a sample column, or the column was at an unexpected index. Check the source page manually.

## Step 3 — Recompute accuracy

```bash
npm run polls:analyze
```

Expected output:
```
→ analyzing N elections, NN polls, N agencies
✓ wrote .../public/polls/accuracy.json

Agency leaderboard (overall MAE across all pre-election last-polls):
  GIB   MAE=1.67  RMSE=3.12  elections=7  polls=7
  ...

Most recent election (YYYY-MM-DD) — agency last-poll MAE:
  ML    MAE=1.96  5d before  worst=ПрБ (-6.59)
  ...
```

### 3a. Watch for unmatched parties

If many new errors look like party-name mismatches, open `analyze_accuracy.ts` `POLL_TO_ACTUAL` and add aliases:

```ts
const POLL_TO_ACTUAL: Record<string, string> = {
  "Прогресивна България": "ПрБ",
  "БСП за България": "БСП",
  // ... add new entry, e.g.:
  "ПП-ДБ-Зелено движение": "ПП-ДБ",
};
```

Test by checking the agency MAEs — a poll with all parties matched should have errors comparable to other agencies in the same cycle. If one agency shows MAE >> 5pp where others are <2pp, party labels probably aren't matching.

### 3b. Watch for new bloc memberships

For ideological-bloc lean to work, new parties need an entry in the `BLOC_OF` map in `analyze_accuracy.ts`. Default is `"other"`. Pick from:

| Bloc | Examples |
|---|---|
| `right_govt` | GERB(-SDS), traditional centre-right |
| `reformist` | PP-DB, DB, ПрБ, Реформаторски блок |
| `nationalist` | Възраждане, Атака, ОП, Сияние, МЕЧ, Величие |
| `left` | БСП, БСП-ОЛ |
| `minority` | ДПС / ДПС-НН / АПС |
| `populist` | ИТН, Воля, Български възход, ИСМВ |

When in doubt, leave it as `"other"` rather than mis-classify — the user prefers honest gaps to wrong categories.

## Step 4 — Write the narrative (THIS IS THE VALUABLE STEP)

**Strongly preferred: Claude writes the narrative directly** rather than calling the Gemini script. Claude Opus produces materially better analysis with hedged language and specific story-telling. Gemini-2.5-flash output looked like an LLM doing a numbers recitation and the user explicitly downgraded it.

### 4a. Read the inputs

```bash
node -e "
const a = require('./public/polls/accuracy.json');
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

Read the existing `public/polls/analysis.json` for tone and structure — match it.

### 4b. Output schema

`analysis.json` has this exact shape:

```jsonc
{
  "generatedAt": "<ISO timestamp>",
  "model": "Claude Opus 4.7 (1M context)",      // or whatever Claude model is writing
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
- For 11 elections + 9 agencies, the file is ~6,000 words. Manageable in one Claude Opus turn.

### 4d. Write `analysis.json`

Use the `Write` tool to overwrite `public/polls/analysis.json`. **Always set `model` to your actual Claude model name** (e.g., "Claude Opus 4.7 (1M context)") — the frontend displays this as "Editorial · Claude Opus 4.7 (1M context)" in the headlines tile footer.

Keep the existing entries when only a new election needs writing — read the file first, append the new election's entry to `byElection[]`, regenerate `agencyTakes` if any agency's stats meaningfully shifted (an extra election may have rebalanced the leaderboard).

### 4e. Gemini fallback (only if explicitly asked)

If the user *explicitly* says "use Gemini" or "I don't want to write narratives manually":

```bash
npm run polls:gen-analysis             # all elections (~12 calls, ~2 min)
npm run polls:gen-analysis -- --only YYYY-MM-DD  # one election (1 call)
```

Default model is `gemini-2.5-pro`. Output quality is noticeably worse than Claude Opus — Gemini tends to recite numbers without weaving narrative. Use only when speed is more important than quality.

## Step 5 — Verify

### 5a. Type-check

```bash
npx tsc -b --noEmit 2>&1 | grep -E "polls|byElection|story" | head -10
```

Should return nothing if all UI types match the new `analysis.json` shape.

### 5b. Browser check

Use the preview server (`mcp__Claude_Preview__preview_*` tools or `npm run dev`):

1. Navigate to `/polls?elections=YYYY_MM_DD` for the new election.
2. Confirm the **HEADLINES — DD/MM/YYYY** card shows the new headlines.
3. Confirm the **ELECTION STORY — DD/MM/YYYY** card shows the new story.
4. Confirm **FINAL-POLL ERRORS — DD/MM/YYYY** lists the agencies with correct MAEs.
5. Switch to a different election in the date picker and confirm the narratives update accordingly.
6. Check the homepage (`/?elections=YYYY_MM_DD`):
   - **Polling accuracy trends** chart should include a new bar for this election.
   - **Polls accuracy** tile should show the new election's agency leaderboard with the AI headline preview.
7. Check the BG locale (toggle to `bg`) for any rough translations.

### 5c. Console check

```bash
# in the eval/console of the preview
preview_console_logs --level error
```

A new election with no `byElection` entry will throw — that means the narrative wasn't saved correctly.

## Common pitfalls

- **JSON validation**: BG strings with embedded `«»` or em-dashes are fine, but watch for unescaped quotes in stories. Always run `node -e "JSON.parse(require('fs').readFileSync('public/polls/analysis.json'))"` after writing.
- **Date format**: `byElection` keys are ISO dates with hyphens (`2026-04-19`). Folder paths use underscores (`2026_04_19`). The frontend converts via `selected.replace(/_/g, '-')`.
- **Agency ordering**: `agencyTakes[]` should match the order of `agencyProfiles[]` from accuracy.json (sorted by `overallMAE` ascending). The frontend doesn't re-sort, so an out-of-order array shows agencies in the wrong order.
- **The izboriai seed**: Older polls (pre-2024) were imported once from `/Users/atanasster/izboriai/public/`. Don't re-seed unless polls.json is empty — `--seed-izboriai` is safe to re-run because of pollId deduplication, but it's not necessary on a populated repo.
- **Wikipedia table layout drift**: BG Wiki occasionally restructures the polling table. If `parseTable()` returns null or finds 0 party columns, manually inspect the page HTML for header changes.
- **The `NA` agency**: An "Общ консенсус" placeholder from the izboriai seed (id `NA`). The analyzer filters it out of leaderboards. Don't include it in agencyTakes.

## Quick command reference

```bash
# Full refresh after a new election (commands in order):
npm run polls:scrape                   # 1. fetch new polls
npm run polls:analyze                  # 2. recompute accuracy
# 3. Hand-write analysis.json (use Read+Write, NOT the Gemini script)
# 4. Verify in browser

# Or for a quick "is everything still valid" pass:
npm run polls:scrape && npm run polls:analyze
node -e "JSON.parse(require('fs').readFileSync('public/polls/analysis.json'))" && echo "analysis.json valid"

# To regenerate just the analysis with Gemini (only when explicitly asked):
npm run polls:gen-analysis -- --only YYYY-MM-DD
```
