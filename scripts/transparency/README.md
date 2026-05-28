# Municipal Transparency Index (TI-BG LISI) ingest

**Status:** scaffolding committed; actual scrape pending source verification.

Adds the Transparency International Bulgaria *Local Integrity System Index* — an annual 9-pillar score for all 265 Bulgarian municipalities — as a one-row tile on the My-Area dashboard. Source: `transparency-bg.org`.

## Planned outputs

- `data/municipal_transparency/index.json` — top-level metadata, pillar labels, year, national average, and a `scoresByObshtina` map:
  ```jsonc
  {
    "year": 2024,
    "nationalAverage": 3.27,
    "scoresByObshtina": {
      "SOF00": {
        "composite": 6.42,
        "pillars": {
          "procurement_transparency": 7.10,
          "budget_transparency": 6.80,
          // …seven more
        },
        "nationalRank": 1
      }
      // …264 more
    }
  }
  ```

The shape is locked in by the SPA hook (`src/data/transparency/useMunicipalTransparency.tsx`) and the tile (`src/screens/myarea/MyAreaTransparencyTile.tsx`). The scrape's only job is to populate `scoresByObshtina` with real values.

## Source verification needed before scraping

1. Confirm the latest publication URL (2024 release was referenced via a BTA report at score 3.27/10 national average).
2. Inspect the data format — TI-BG publishes a PDF report; check whether a supplementary CSV/XLSX is offered alongside.
3. Note the licence terms — confirm we may re-publish derivatives on electionsbg.com (most likely OK with attribution but verify).

## Scrape design (once verified)

`scripts/transparency/scrape_lisi.ts`:

1. Fetch the annual report PDF (or CSV) from transparency-bg.org.
2. Extract the 265-row table — composite score + nine pillar scores per município.
3. Map TI-BG município names to our `obshtina` codes via a name-normalize join against `data/municipalities.json` (same pattern as кметство name-matching).
4. Compute national rank (1 = highest composite).
5. Write `data/municipal_transparency/index.json`.

## Watcher wiring

- New watch source: `state/watch/ti_bg_lisi.json` — annual fingerprint of the publications listing page on transparency-bg.org.
- New skill: `update-municipal-transparency`.
- Mapping row in `.claude/skills/process-watch-report/SKILL.md`:
  ```
  | ti_bg_lisi | update-municipal-transparency |
  ```
- New ingest state: `state/ingest/update-municipal-transparency.json`.

## UI integration

Already shipped:

- `useMunicipalTransparency(obshtina)` — reads the JSON, returns the score record or `undefined` while data is missing or for municipalities not in the index.
- `MyAreaTransparencyTile` — mounts on the My-Area dashboard, renders **nothing** while no data is present. As soon as the scrape populates `scoresByObshtina`, the tile lights up for every município that has an entry.

So the cutover is silent: ship the scrape, the dashboard tile appears the next deploy.
