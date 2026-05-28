# Crime statistics ingest (МВР RDVR-grain)

**Status:** scaffolding committed; actual scrape pending.

Monthly per-ОДМВР crime tallies (~28 RDVR units, roughly mapping to oblasti). Published by МВР as monthly PDFs on mvr.bg.

## Pipeline

1. Fetch the latest monthly PDF from mvr.bg news/statistics.
2. OCR + table extraction (Gemini Vision, same pattern as Varna capital-programmes ingest per the `project_budget_execution_source` memory).
3. Map МВР RDVR name → our oblast code.
4. Write `data/crime/index.json` with `monthlyByOblast[oblast][month][category] = count`.

## Caveat — surfaced in the tile

Grain is oblast, not município. The tile makes this explicit: "Данните са на ниво ОДМВР (~ област), не за конкретна община."

## Watcher wiring

- Monthly watch source: `state/watch/mvr_crime.json`.
- Skill: `update-crime-stats`.

## UI

`MyAreaCrimeTile` renders a 12-month trend mini-chart per category, with the oblast-grain disclosure pinned at the bottom.
