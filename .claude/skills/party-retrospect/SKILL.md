---
name: party-retrospect
description: Generate the AI campaign retrospect for one or more parties in one election. Bundles the party's voting, regional, polling, risk-neighborhood, candidate-preference, head-to-head, and (if available) financing data into a single input, then writes a markdown analysis to public/{election}/parties/assessment/{partyNum}.json. Use when the user asks to generate, refresh, or write a campaign retrospect / strategic analysis / next-election advice for a party. Also use after a new election when adding retrospects for the latest cycle.
allowed-tools:
  - Read
  - Bash
  - Write
---

# Party Retrospect skill

Generates the per-party "Campaign retrospect" markdown shown on `/party/{nickName}` dashboards. The output is a static JSON file (cached per party per election), so the site has zero LLM cost at runtime.

## Pipeline overview

```
scripts/parties/bundle_party_data.ts   → builds a structured input bundle from public/*.json
                                         (deterministic — vote counts, deltas, polling errors, etc.)
            ↓
Claude reads the bundle               → writes BG + EN markdown bodies (THIS skill, preferred path)
   OR
scripts/parties/generate_retrospect.ts → calls Gemini with the bundle (fallback)
            ↓
public/{election}/parties/assessment/{partyNum}.json  → consumed by PartyAssessmentTile
```

**Output file shape** (consumed by `src/screens/dashboard/PartyAssessmentTile.tsx`):

```json
{
  "generatedAt": "<ISO timestamp from new Date().toISOString()>",
  "model": "Claude Opus 4.7 (1M context)",
  "partyNum": 18,
  "nickName": "ГЕРБ-СДС",
  "bg": "## Резултат на изборите\n\n...markdown...",
  "en": "## Headline result\n\n...markdown..."
}
```

## When to run this

- **A new election just landed and you want retrospects for the leading parties** — generate for every party at ≥4% (or ≥2% if you want minor parties too).
- **A specific party's retrospect needs refresh** — e.g. polling data was updated, or financing data became available after the initial generation.
- **You added a new party-relevant data source** (e.g. preferences, recount) and want assessments to incorporate it — re-bundle (the script picks up new sources automatically) and re-write.

## Step 1 — Decide scope

Look at `src/data/json/elections.json` and the most recent election folder. Then check what assessments already exist:

```bash
ls public/2024_10_27/parties/assessment/ 2>/dev/null
```

For new generations, the user usually wants the parties at ≥4% (those that won seats). Confirm against the actual `cik_parties.json` + `national_summary.json` for the election folder.

## Step 2 — Bundle the input data

For one party:

```bash
npm run party:bundle -- --election 2024_10_27 --party 18 --out /tmp/party-18-bundle.json
```

The bundle (schemaVersion 2) includes:

**Identity & national context**
- `party` — number, nickName, color, name in BG + EN
- `nationalContext` — votes, % nationally, position, vs prior election
- `paperMachine` — paper vs machine split for this party
- `contextSnapshot` — national turnout %, prior turnout, anomaly counts (recount/SUEMG/problem sections)

**Geographic distribution**
- `regions[]` — per-region results (with deltas vs prior, machine pct, position, share of party total)
- `topGainerRegions` / `topLoserRegions` — top 5 by Δpp
- `topMunicipalities` / `topSettlements` — top 25 each by absolute votes
- `geography.strongholds` — top-5-regions and top-10/25-municipalities share of the party's national vote (concentration metric)
- `geography.urbanRural` — separate aggregates for Sofia City (S23+S24+S25), other big cities (Plovdiv-city, Varna, Burgas), and abroad (oblast 32). Each has `sharePct` (party's % within that group), `pctOfPartyTotal` (group's contribution to party national), `overIndex` (sharePct / national partyPct — >1 means over-indexes), and prior-comparison fields when available.
- `geography.ethnicMixedCluster` — same shape, aggregate over Kardzhali/Razgrad/Targovishte/Silistra/Shumen/Blagoevgrad/Haskovo/Smolyan. Useful for DPS-family analysis but use carefully for other parties (low absolute number is itself a story).

**Risk / Roma neighborhoods** (`problemSections`, null for elections before 2009_07_05)
- `totalRiskSections`, `totalRiskVotes` — election-wide context
- `partyVotesInRiskSections`, `partyShareOfRiskVotes` — what fraction of risk-section votes this party captured
- `overIndex` — `partyShareOfRiskVotes / partyPct nationally`. >1 means over-indexes in risk neighborhoods, <1 means under-indexes. The headline number for this section.
- `priorPartyShareOfRiskVotes`, `deltaShareOfRiskPP` — comparison to prior election (matched by nickName/commonName, so coalition continuity works)
- `topNeighborhoods[]` — top 5 by party votes, with `name_bg`, `city_bg`, `partyShareInNeighborhood`

**Section-level anomaly attribution** (`sectionAnomalies`)
- `suemgTopChangeForParty` / `suemgBottomChangeForParty` — count of sections where this party was the biggest gainer/loser when SUEMG (machine flash memory) corrections were applied. High count is a flag for procedural anomalies, not necessarily intent.
- `recountTopChangeForParty` / `recountBottomChangeForParty` — same for recount-flagged sections (only for elections with `hasRecount`)
- `concentratedSectionsForParty` — count of sections where this party held ≥95% of the vote. For parties like ДПС this is expected/structural; for others it's an anomaly.
- Also includes total-flagged context (`suemgFlaggedSectionsTotal`, `recountFlaggedSectionsTotal`) so you can frame the count as a share.

**Candidate preferences** (`preferences`, null when `hasPreferences: false` — elections before 2021_07_11)
- `totalPrefVotes`, `prefRate` (% of party voters who cast a preference)
- `topCandidatesNational[]` — top 10 by votes, with `name`, `oblast`, `oblastName_bg`, `pctOfPartyPrefsNational`
- `topCandidatesByRegion[]` — strongest candidate in each oblast, with `candidateName`, `leaderName` (the pref=101 default leader), `beatBallotOrder` flag
- `ballotOrderUpsets`, `ballotOrderUpsetRegions` — count and list of regions where a non-list-leader pref outpolled the official #1. Strong "local notable beats central party" signal.
- `top1ShareOfPartyPrefs` — concentration. >15% means a single candidate dominates; <8% means a broad bench.

**Head-to-head with closest national rival** (`competitive`)
- `rivalNickName` — auto-picked: party closest in national vote total
- `regionsWon` / `regionsLost` — count vs rival
- `topMargins` / `bottomMargins` — top 5 regions where party leads / trails, with absolute and percentage-point lead

**Polling** (when polling data exists for this election)
- `polling.finalPollErrors` — per-agency final poll vs actual, error in pp
- `polling.agencyHistoricalBias` — recomputed from elections ≤ current to avoid leaking future cycles into older retrospects

**Financing** (`financing`, only when `hasFinancials: true`)

Read the bundle:

```bash
cat /tmp/party-18-bundle.json | head -200
```

## Step 3 — Write the markdown (THE VALUABLE STEP)

**Strongly preferred: Claude writes the bodies directly** rather than calling the Gemini script. Per the polls workflow, hand-written narratives by Claude Opus produce materially better strategic analysis than Gemini-2.5-flash.

### 3a. Output structure (every section, both languages)

Use these EXACT section headings (translate to BG for the bg body):

```markdown
## Headline result

2-3 sentences. Lead with votes, %, position. Always include change vs prior election. If turnout shifted notably (`contextSnapshot.deltaTurnoutPP`), frame the result against it.

## What worked

- 3-5 bullets, each grounded in a specific number from the bundle.

## What didn't work

- 3-5 bullets, each grounded in a specific number.

## Geographic strategy

A short paragraph naming 2-4 specific regions/municipalities, recommending defend / attack / abandon stances based on swings. Weave in stronghold concentration (`geography.strongholds`) and urban/rural skew (`geography.urbanRural`) when they sharpen the story — e.g. "62% of votes come from 5 regions; Sofia City over-indexes 1.4× while ethnic-mixed cluster is under-indexed at 0.3×".

## Risk neighborhoods

(Skip if `problemSections` is null.) 2-3 sentences. Lead with `partyShareOfRiskVotes` and `overIndex` — the over-index ratio is the story. Name the top 1-2 neighborhoods by party votes. If `deltaShareOfRiskPP` exists, include the trend. Be careful: this is a sensitive topic. Stick to vote counts; do NOT speculate about vote-buying or voter ethnicity.

## Candidates and preferences

(Skip if `preferences` is null.) 2-4 sentences. Lead with `prefRate` (engagement) and the top national candidate by name. If `ballotOrderUpsets > 0`, name 1-2 regions where a non-leader pref won — that's a strong "local figures matter more than central list" signal. If `top1ShareOfPartyPrefs > 15`, frame the party as one-personality-driven; if < 8, frame as having a broad bench. Use actual candidate names from `topCandidatesNational[]` and `topCandidatesByRegion[]` — these are sourced from official candidate filings, not invented.

## Competitive geography

(Skip if `competitive` is null or the rival is essentially the same party.) 2-3 sentences naming the head-to-head rival, the regions-won/lost split, and 1-2 regions where margins are tightest in either direction. Useful for "where to fight next time" framing.

## Polling intelligence

(Skip if polling data is null.) 1-2 sentences naming agencies that were closest or biggest miss for this party. Use agencyId abbreviations as-is — they're well-known (ML, GIB, AR, AFIS, etc.).

## Recommendations for next campaign

- 3-5 prioritized action items SPECIFIC to this party's data, not generic advice. Tie at least one recommendation to a number that surprised you most in the bundle.
```

### 3b. Writing principles

1. **Every claim must be grounded in a number from the bundle.** Don't write "voters disappointed by leadership" — you have no data for that. Do write "lost 11pp in Razgrad despite gaining +1.68pp nationally — investigate local organization."
2. **Quote percentages exactly** — 26.39%, not "around 26%". The audience is data nerds.
3. **Match place names to body language.** In the BG body use `name_bg` for every region/municipality/neighborhood (Варна, Столипиново, Пловдив). In the EN body use `name_en` (Varna, Stolipinovo, Plovdiv). Mixed scripts in the same body — e.g. "in Хасково" inside an English paragraph — read as a translation oversight. The bundle exposes both forms for regions (`name_en` / `name_bg`), neighborhoods (`name_en` / `name_bg`), and neighborhood cities (`city_en` / `city_bg`); always pick the right one. **Personal candidate names stay in Cyrillic in both languages** — they're proper names sourced from official filings (Бойко Борисов, Стефан Апостолов), not place names. Party nicknames (ГЕРБ-СДС, ПП-ДБ) also stay in Cyrillic in both languages.
4. **Hedge causation.** The data is deterministic vote counts, not causal explanations. Phrases like "the data suggests", "тенденцията показва" are honest; "voters punished the party" is overreach.
5. **Bulgarian must read like native journalism.** Don't translate idioms literally. "machine adoption surged" → "машинното гласуване се ускори", not "машинното осиновяване скочи".
6. **No top-level # title.** The tile already has a header. Start with `## Headline result`.
7. **Length budget: ~450-650 words per language.** A pithy retrospect beats a verbose one. The new sections add length only when they have something to say — skip them when the bundle field is null or the data is unremarkable.
8. **Candidate names ARE allowed** — but only those present in `preferences.topCandidatesNational[]` or `preferences.topCandidatesByRegion[]`. Never invent. If `preferences` is null, keep the narrative party-level.
9. **Risk-neighborhood section is sensitive** — describe vote counts and shares, never voters. "ГЕРБ-СДС took 31% of risk-section votes (over-index 1.2×)" is fine. "ГЕРБ-СДС bought Roma votes" is not, even by implication.
10. **Empty sections are fine.** If polling data is null, skip that section entirely. Don't write "no polling data available" filler.
11. **Anomaly counts need framing context** — `suemgTopChangeForParty: 12` reads as huge, but if `suemgFlaggedSectionsTotal: 158`, that's 7.6%. Always express anomaly attribution as a share of the flagged total, or omit if the count is single digits.
12. **The over-index ratio is the killer single number** for both `problemSections` and `geography.urbanRural`/`ethnicMixedCluster`. Lead with it when present.

### 3c. Write the file

Use the `Write` tool to write `public/{election}/parties/assessment/{partyNum}.json` with this exact shape:

```json
{
  "generatedAt": "<ISO 8601 timestamp — use new Date().toISOString() at write time, not a hardcoded value>",
  "model": "Claude Opus 4.7 (1M context)",
  "partyNum": 18,
  "nickName": "ГЕРБ-СДС",
  "bg": "## Резултат на изборите\n\n...",
  "en": "## Headline result\n\n..."
}
```

**Always set `model` to your actual Claude model name** — the frontend displays it as "Editorial · {model}" in the tile footer. If a different Claude wrote a prior version, overwrite the model field.

**Always set `generatedAt` to the current time** — never copy a timestamp from the example or a prior file. A quick way to get the timestamp:

```bash
node -e "console.log(new Date().toISOString())"
```

### 3d. Repeat for each party

For a new election with ~5-7 leading parties, this is ~5-7 hand-written analyses. Do them sequentially in one Claude turn — context compounds: by the third party you'll have a clear sense of the election's overall narrative, which sharpens the per-party takes.

## Step 4 — Gemini fallback (only if explicitly asked)

If the user _explicitly_ says "use Gemini" or "I don't want to write these manually" or there are 20+ parties to generate:

```bash
npm run party:gen-retrospect -- --election 2024_10_27 --party 18
npm run party:gen-retrospect -- --election 2024_10_27 --all-passed   # every party at ≥2%
```

Output quality is noticeably worse — Gemini tends to recite numbers without weaving narrative. Claude's hand-written version is preferred when the user cares about the analysis quality. The Gemini script reads the same bundle, so it benefits from the new fields, but currently the prompt template inside `generate_retrospect.ts` may not exploit the new sections — verify the prompt mentions the new blocks before relying on the fallback for risk-neighborhood / preferences narrative.

## Step 5 — Verify

### 5a. JSON validity

```bash
node -e "JSON.parse(require('fs').readFileSync('public/2024_10_27/parties/assessment/18.json'))" && echo OK
```

### 5b. Browser check

Use the preview server (`mcp__Claude_Preview__preview_*` tools or `npm run dev`):

1. Navigate to `/party/{nickName}?elections=2024_10_27`.
2. Confirm the **CAMPAIGN RETROSPECT** card now shows the markdown bodies (not the "not yet generated" placeholder).
3. Toggle the language to `bg` and confirm the BG body renders.
4. Check headings are properly styled (## becomes h2).

### 5c. Git

The `public/{election}/parties/assessment/*.json` files should be committed — they're the cached AI output, not generated at build time.

## Common pitfalls

- **Wrong output path** — the file MUST live at `public/{election}/parties/assessment/{partyNum}.json`. The frontend fetches that exact path.
- **Stale bundle** — if you re-run the bundler after editing prior files (e.g. corrected polling data), the bundle picks up the new data automatically. No manual cache invalidation needed.
- **Missing prior election** — the very first election in the chronology has no `priorElection`, so deltas will be undefined. Adapt your "vs prior" language accordingly.
- **Coalition parties** — for entries like ГЕРБ-СДС that aggregate constituent parties, the bundle uses `commonName` consolidation when matching prior-year votes (including for `problemSections.deltaShareOfRiskPP`). The deltaPct is therefore the COALITION's delta, not a single constituent's.
- **Party numbers change between elections** — partyNum 18 in 2024-10-27 is not the same party as partyNum 18 in 2017-03-26. Always pass the partyNum from the SAME election folder you're generating for.
- **Risk-section over-index is undefined for tiny parties** — when `partyPct` is near zero, the ratio inflates wildly. If `partyPct < 1`, lead with absolute counts instead.
- **Preferences pre-2021 are null** — the `hasPreferences` flag in elections.json gates this. Don't write a candidates section when the field is null.
- **Anomaly counts can be misleading** — `suemgTopChangeForParty: 12` is a count, not a percentage. Always frame as share-of-flagged when writing.

## Quick command reference

```bash
# Bundle one party's data (inspect what the LLM sees)
npm run party:bundle -- --election 2024_10_27 --party 18 --out /tmp/p18.json

# Hand-write retrospect (preferred): read bundle, draft BG+EN markdown, Write JSON file
# (no command — you do it via Read + Write tools)

# Get a fresh ISO timestamp for generatedAt
node -e "console.log(new Date().toISOString())"

# Gemini fallback (single party)
npm run party:gen-retrospect -- --election 2024_10_27 --party 18

# Gemini fallback (every party at ≥2%)
npm run party:gen-retrospect -- --election 2024_10_27 --all-passed
```
