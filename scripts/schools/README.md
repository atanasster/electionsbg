# Per-school НВО + ДЗИ scores ingest

**Status:** SHIPPED. `data/schools/index.json` is live (latest year **2025**:
per-school **ДЗИ matura** averages, `schoolsByObshtina` across **242 общини**,
sourced from МОН via data.egov.bg; **НВО 7th-grade is not yet included** — DZI
only). Built by `scripts/schools/build_index.ts`, which reuses the per-school МОН
CSVs that `update-indicators` already downloads into
`raw_data/indicators/mon/{year}.csv` — so it re-runs **automatically** whenever the
`indicators_mon_dzi` watcher flips (`process-watch-report` invokes
`build_index.ts` as part of the `update-indicators` handling). There is no separate
`update-schools` skill or schools-specific watcher — it piggybacks on
`indicators_mon_dzi`. Consumed by `useSchools()` on the My-Area / Governance quality
strip and the funds + procurement settlement tiles.

Adds school-level matura performance to the My-Area dashboard. МОН already feeds município-level aggregates into `data/indicators.json` via the `update-indicators` skill; this phase extends that to per-school records so users can see _which_ schools in their município perform well or poorly.

## Source

МОН publishes per-school НВО (7th grade) and ДЗИ (12th grade) average scores via data.egov.bg. Two datasets per year:

- НВО (7th grade entrance exam) — one row per school per subject
- ДЗИ (matura) — one row per school per subject

Coverage varies by year — earlier years may publish município-level only; recent years (2022+) include per-school.

## Output

Shipped. The live file also carries top-level `source` / `sourceUrl` / `subjects`
/ `note` meta and `latestYear: 2025`. Sketch of the per-school shape:

```jsonc
// data/schools/index.json
{
  "latestYear": 2024,
  "schoolsByObshtina": {
    "SOF00": [
      {
        "id": "1234", // МОН school identifier
        "name": "Първа английска гимназия",
        "type": "secondary", // primary | secondary | mixed
        "address": "София, бул. ...",
        "loc": "23.32,42.69", // optional, lon,lat
        "scoresByYear": {
          "2024": {
            "nvo_bel": 4.92,
            "nvo_math": 4.71,
            "dzi_bel": 5.31,
            "dzi_math": 4.85,
          },
        },
      },
      // …more schools
    ],
  },
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

## Watcher wiring (original plan — superseded)

Instead of the standalone source + skill below, the build was wired to **piggyback
on `indicators_mon_dzi`**: `process-watch-report` re-runs `build_index.ts` as part
of `update-indicators` whenever that watcher flips (it reuses the same МОН CSVs). So
neither of the following was built:

- New watch source: `state/watch/mon_school_scores.json` — annual.
- New skill: `update-schools` (or `--schools` mode in update-indicators).
- Mapping in `process-watch-report/SKILL.md`: `mon_school_scores → update-schools`.

## UI integration

Shipped:

- `useSchools(obshtina)` — returns the school list for a município.
- `MyAreaSchoolsTile` — top-3 and bottom-3 schools by composite score (avg of all available subjects). Renders nothing when the list is empty.

Silent cutover when the scrape lands.
