---
name: party-retrospect
description: Generate the AI campaign retrospect for one or more parties in one election. Bundles the party's voting, regional, polling, and (if available) financing data into a single input, then writes a markdown analysis to public/{election}/parties/assessment/{partyNum}.json. Use when the user asks to generate, refresh, or write a campaign retrospect / strategic analysis / next-election advice for a party. Also use after a new election when adding retrospects for the latest cycle.
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
  "generatedAt": "<ISO timestamp>",
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

Look at `public/elections.json` and the most recent election folder. Then check what assessments already exist:

```bash
ls public/2024_10_27/parties/assessment/ 2>/dev/null
```

For new generations, the user usually wants the parties at ≥4% (those that won seats). For the 2024-10-27 election those are roughly: 18 (ГЕРБ-СДС), 30 (ПП-ДБ), 28 (Възраждане), 13 (ДПС-НН), etc. — confirm against the actual cik_parties.json + national_summary.json.

## Step 2 — Bundle the input data

For one party:

```bash
npm run party:bundle -- --election 2024_10_27 --party 18 --out /tmp/party-18-bundle.json
```

The bundle includes:

- Party identity (number, nickName, color, name in BG + EN)
- National context (votes, % nationally, position, vs prior election)
- Paper vs machine split
- Per-region results (with deltas vs prior)
- Top-10 gainer regions / top-10 loser regions (sorted by Δpp)
- Top-25 municipalities (with delta vote counts)
- Top-25 settlements
- Campaign financing filing (if available for this election)
- Pre-election polling errors (per agency, for THIS party — only if polling data exists)
- Agency historical bias for this party

Read the bundle:

```bash
cat /tmp/party-18-bundle.json | head -200
```

You'll see something like:

```json
{
  "schemaVersion": 1,
  "election": "2024_10_27",
  "priorElection": "2024_06_09",
  "party": { "number": 18, "nickName": "ГЕРБ-СДС", ... },
  "nationalContext": {
    "partyVotes": 642521, "partyPct": 26.39, "position": 1,
    "deltaPctPoints": 1.68, ...
  },
  "regions": [...],
  "topGainerRegions": [...],
  "topLoserRegions": [...],
  ...
}
```

## Step 3 — Write the markdown (THE VALUABLE STEP)

**Strongly preferred: Claude writes the bodies directly** rather than calling the Gemini script. Per the polls workflow, hand-written narratives by Claude Opus produce materially better strategic analysis than Gemini-2.5-flash.

### 3a. Output structure (every section, both languages)

Use these EXACT section headings (translate to BG for the bg body):

```markdown
## Headline result

2-3 sentences. Lead with votes, %, position. Always include change vs prior election.

## What worked

- 3-5 bullets, each grounded in a specific number from the bundle.

## What didn't work

- 3-5 bullets, each grounded in a specific number.

## Geographic strategy

A short paragraph naming 2-4 specific regions/municipalities, recommending defend / attack / abandon stances based on swings.

## Polling intelligence

(Skip if polling data is null.) 1-2 sentences naming agencies that were closest or biggest miss for this party. Use agencyId abbreviations as-is — they're well-known (ML, GIB, AR, AFIS, etc.).

## Recommendations for next campaign

- 3-5 prioritized action items SPECIFIC to this party's data, not generic advice.
```

### 3b. Writing principles

1. **Every claim must be grounded in a number from the bundle.** Don't write "voters disappointed by leadership" — you have no data for that. Do write "lost 11pp in Razgrad despite gaining +1.68pp nationally — investigate local organization."
2. **Quote percentages exactly** — 26.39%, not "around 26%". The audience is data nerds.
3. **Use Bulgarian region/municipality names in BG body** — Варна, not Varna. The bundle gives you `name_bg` and `name_en` for every region.
4. **Hedge causation.** The data is deterministic vote counts, not causal explanations. Phrases like "the data suggests", "тенденцията показва" are honest; "voters punished the party" is overreach.
5. **Bulgarian must read like native journalism.** Don't translate idioms literally. "machine adoption surged" → "машинното гласуване се ускори", not "машинното осиновяване скочи".
6. **No top-level # title.** The tile already has a header. Start with `## Headline result`.
7. **Length budget: ~350-500 words per language.** A pithy retrospect beats a verbose one.
8. **No invented candidate names.** Only mention candidates if they're in the bundle (currently the bundle doesn't include preferences — keep narrative party-level).
9. **Empty sections are fine.** If there's no polling data, skip the polling section entirely. Don't write "no polling data available" filler.

### 3c. Write the file

Use the `Write` tool to write `public/{election}/parties/assessment/{partyNum}.json` with this exact shape:

```json
{
  "generatedAt": "2026-04-27T00:00:00Z",
  "model": "Claude Opus 4.7 (1M context)",
  "partyNum": 18,
  "nickName": "ГЕРБ-СДС",
  "bg": "## Резултат на изборите\n\n...",
  "en": "## Headline result\n\n..."
}
```

**Always set `model` to your actual Claude model name** — the frontend displays it as "Editorial · {model}" in the tile footer. If a different Claude wrote a prior version, overwrite the model field.

### 3d. Repeat for each party

For a new election with ~5-7 leading parties, this is ~5-7 hand-written analyses. Do them sequentially in one Claude turn — context compounds: by the third party you'll have a clear sense of the election's overall narrative, which sharpens the per-party takes.

## Step 4 — Gemini fallback (only if explicitly asked)

If the user _explicitly_ says "use Gemini" or "I don't want to write these manually" or there are 20+ parties to generate:

```bash
npm run party:gen-retrospect -- --election 2024_10_27 --party 18
npm run party:gen-retrospect -- --election 2024_10_27 --all-passed   # every party at ≥2%
```

Output quality is noticeably worse — Gemini tends to recite numbers without weaving narrative. Claude's hand-written version is preferred when the user cares about the analysis quality.

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
- **Coalition parties** — for entries like ГЕРБ-СДС that aggregate constituent parties, the bundle uses `commonName` consolidation when matching prior-year votes. The deltaPct is therefore the COALITION's delta, not a single constituent's.
- **Party numbers change between elections** — partyNum 18 in 2024-10-27 is not the same party as partyNum 18 in 2017-03-26. Always pass the partyNum from the SAME election folder you're generating for.

## Quick command reference

```bash
# Bundle one party's data (inspect what the LLM sees)
npm run party:bundle -- --election 2024_10_27 --party 18 --out /tmp/p18.json

# Hand-write retrospect (preferred): read bundle, draft BG+EN markdown, Write JSON file
# (no command — you do it via Read + Write tools)

# Gemini fallback (single party)
npm run party:gen-retrospect -- --election 2024_10_27 --party 18

# Gemini fallback (every party at ≥2%)
npm run party:gen-retrospect -- --election 2024_10_27 --all-passed
```
