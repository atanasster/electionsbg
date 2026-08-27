---
name: update-transparency-lisi
description: Refresh the Transparency International Bulgaria Local Integrity System Index (LISI) annual composite scores (data/municipal_transparency/index.json) for Bulgaria's 27 oblast-center municipalities. Use when the daily watch report flags `ti_bg_lisi` as changed (a new year landed on lisi.transparency.bg), when the user asks to refresh LISI / municipal transparency / TI-BG scores, or after a fresh git clone if data/municipal_transparency/index.json has an empty `scoresByObshtina`.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update TI-BG LISI skill

Refreshes `data/municipal_transparency/index.json` — the annual Local Integrity System Index composite scores for Bulgaria's 27 oblast-center municipalities, published by Асоциация "Прозрачност без граници" (Transparency International Bulgaria). Powers the My-Area "Прозрачност на местното управление" tile.

Source contract:

| Field | Source | Granularity | Cadence |
|---|---|---|---|
| `composite`, `nationalRank` | [lisi.transparency.bg](https://lisi.transparency.bg/) interactive dashboard | per municipality (27 oblast centers, 0–5 scale) | annual |
| `nationalAverage` | LISI dashboard headline number | national | annual |

**Manual paste required.** The LISI dashboard is a heavy Vue SPA whose state can't be programmatically extracted without a Playwright session (and even then the chart data is rendered client-side from a payload the page assembles, not a stable JSON endpoint). The 27 composite scores are hand-pasted into the `LISI_2024`-style array in `scripts/transparency/build_lisi.ts`, then a small build script rewrites the output file.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher describes `Прозрачност без граници — LISI` with `LISI {Y} appears to have landed (was {Y-1})` | Steps 1–3 |
| User asks to "refresh LISI" / "update transparency scores" / "TI-BG new year" | Steps 1–3 |
| Fresh clone with empty `scoresByObshtina` | Steps 1–3 (re-do the existing year if no newer one is published) |

LISI publishes annually with no fixed calendar week. Routine watcher flips between years are intra-year dashboard adjustments — open the source page to check the headline year before doing manual work.

## Step 1 — Capture the new year's scores

Open [lisi.transparency.bg](https://lisi.transparency.bg/) in a browser. The dashboard shows the 27 municipalities ranked by composite score for the latest year. Capture:

1. The headline year (e.g. "2024" or "2025").
2. The national average for that year (shown prominently on the page).
3. The 27 (município name, composite) pairs in rank order, top to bottom.

Cross-check: the leader is typically Бургас or Русе; the bottom is typically Силистра or Кърджали. 2024 figures: Бургас 3.71 (national avg 3.27).

Recommended capture flow if the page is hard to read:

```bash
# Use WebFetch to ask a summarising model for the ranked list.
# Verify each row by eye against the dashboard before pasting.
```

## Step 2 — Edit the script's LISI_<year> array

Open `scripts/transparency/build_lisi.ts`. Update:

```ts
// Add a new array for the new year, or replace LISI_2024:
const LISI_2025: Array<{ name: string; composite: number }> = [
  { name: "Бургас", composite: 3.78 },     // example values
  { name: "Русе",   composite: 3.71 },
  // ...all 27 entries, BG names
];

const NATIONAL_AVERAGE_2025 = 3.31;
const YEAR = 2025;
```

Critical naming conventions:
- Use the BG name exactly as it appears in `data/municipalities.json` (e.g. `Велико Търново`, not `В.Търново`).
- Sofia is the only special case: enter the name as `София` — the script maps it to the synthetic `SOF00` obshtina code.
- For municipalities with multi-município name collisions (rare among oblast capitals), the script tie-breaks to the lowest-numbered code, which is the canonical oblast capital.

## Step 3 — Build, verify, commit

```bash
npx tsx scripts/transparency/build_lisi.ts
```

Expected output:

```
Wrote .../data/municipal_transparency/index.json — 27/27 municípios mapped, 0 unmatched
```

If unmatched > 0, the name → obshtina-code match broke. The "unmatched" list will print the BG names that didn't resolve — fix the script's `LISI_<year>` array entry to use the canonical municipalities.json name.

Cross-check the output against the iisda mayor-contacts file's email domains:

```bash
python3 -c "
import json
c = json.load(open('data/officials/municipal_contacts/index.json'))
t = json.load(open('data/municipal_transparency/index.json'))
for code in sorted(t['scoresByObshtina'].keys()):
    print(f'  {code}: composite={t[\"scoresByObshtina\"][code][\"composite\"]} · email={c[\"contactsByObshtina\"].get(code, {}).get(\"email\",\"?\")}')
"
```

Every LISI obshtina code should appear in the contacts file (it's a known oblast capital). The email domain should match the município name (e.g. BGS04 → `@burgas.bg`).

Commit:

```bash
git add scripts/transparency/build_lisi.ts data/municipal_transparency/index.json
git commit -m "transparency: ship LISI <year> (national avg <value>)"
```

## Step 4 — Stamp success

```bash
npx tsx scripts/stamp-ingest.ts update-transparency-lisi \
  --summary "LISI <year> shipped · 27/27 mapped · national avg <value>"
```

Append to the public data-changes log only when the year actually changed:

```bash
if [ -n "$(git diff --stat data/municipal_transparency/)" ]; then
  npx tsx scripts/append-data-change.ts update-transparency-lisi \
    --summary "LISI <year> shipped · 27/27 mapped · national avg <value>" \
    --source "Прозрачност без граници — LISI"
fi
```

## Known limitations

- **27 oblast centers only** — the other 238 BG municipalities are out of scope of TI-BG's index. The hook returns `undefined` for non-listed municípios and the tile auto-hides elsewhere. This is correct, not a bug.
- **Per-pillar sub-scores aren't ingested.** The dashboard exposes nine institutional pillar sub-scores per município (procurement, budget, council oversight, conflict of interest, citizen participation, audit, asset declarations, public data, integrity response) but they're surfaced only through the interactive UI. Pillars `{}` are kept empty in the output until a follow-up Playwright-based scrape extracts them.
- **Manual paste, not automated.** The cost of the Playwright route is much higher than the cost of typing 27 numbers once a year; this stays manual on purpose.

## What this skill does NOT do

- **Does not refresh any other TI-BG dataset.** The Corruption Perceptions Index (CPI) — Bulgaria's annual score — is a separate `update-macro` step (`transparency_cpi` watcher).
- **Does not produce per-pillar breakdowns.** See "Known limitations."

## File map

| Path | Purpose |
|---|---|
| `scripts/transparency/build_lisi.ts` | CLI entry — read hand-curated `LISI_<year>` array, map to obshtina codes, write |
| `data/municipal_transparency/index.json` | output — `scoresByObshtina` + `nationalAverage` |
| `scripts/watch/sources/ti_bg_lisi.ts` | watcher — fingerprints lisi.transparency.bg page + max-year mention |
| `src/data/transparency/useMunicipalTransparency.tsx` | React Query hook |
| `src/screens/myarea/MyAreaTransparencyTile.tsx` | "Прозрачност на местното управление" tile (0–5 scale, color-ramped) |
