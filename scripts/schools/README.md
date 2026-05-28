# Per-school НВО + ДЗИ scores ingest

**Status:** scaffolding committed; actual scrape pending.

Adds school-level matura performance to the My-Area dashboard. МОН already feeds município-level aggregates into `data/indicators.json` via the `update-indicators` skill; this phase extends that to per-school records so users can see *which* schools in their município perform well or poorly.

## Source

МОН publishes per-school НВО (7th grade) and ДЗИ (12th grade) average scores via data.egov.bg. Two datasets per year:
- НВО (7th grade entrance exam) — one row per school per subject
- ДЗИ (matura) — one row per school per subject

Coverage varies by year — earlier years may publish município-level only; recent years (2022+) include per-school.

## Planned outputs

```jsonc
// data/schools/index.json
{
  "latestYear": 2024,
  "schoolsByObshtina": {
    "SOF00": [
      {
        "id": "1234",                // МОН school identifier
        "name": "Първа английска гимназия",
        "type": "secondary",         // primary | secondary | mixed
        "address": "София, бул. ...",
        "loc": "23.32,42.69",        // optional, lon,lat
        "scoresByYear": {
          "2024": { "nvo_bel": 4.92, "nvo_math": 4.71, "dzi_bel": 5.31, "dzi_math": 4.85 }
        }
      }
      // …more schools
    ]
  }
}
```

## Scrape design

`scripts/schools/scrape_mon.ts`:
1. Identify the latest data.egov.bg dataset IDs for НВО + ДЗИ (annual).
2. Fetch all rows; group by school id.
3. Join school metadata (name, address, município) from the МОН school registry (`Регистър на училищата`).
4. Map МОН municipality field to our `obshtina` code via name-normalize.
5. Compute per-school avg per subject per year.
6. Write `data/schools/index.json`.

## Watcher wiring

- New watch source: `state/watch/mon_school_scores.json` — annual.
- New skill: `update-schools` (or `--schools` mode in update-indicators).
- Mapping in `process-watch-report/SKILL.md`: `mon_school_scores → update-schools`.

## UI integration

Shipped:
- `useSchools(obshtina)` — returns the school list for a município.
- `MyAreaSchoolsTile` — top-3 and bottom-3 schools by composite score (avg of all available subjects). Renders nothing when the list is empty.

Silent cutover when the scrape lands.
