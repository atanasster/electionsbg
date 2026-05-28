# Air quality ingest

**Status:** scaffolding committed; actual scrape pending.

Sources: EEA (European Environment Agency) Discomap API + ИАОС real-time feed. ~30 stations countrywide (heaviest in Sofia, Plovdiv, Varna, Burgas, Pleven, Ruse, Stara Zagora, Pernik).

## Planned output

```jsonc
// data/air/index.json
{
  "snapshotAsOf": "2026-05-28T08:00:00Z",
  "stations": [
    {
      "id": "BG0048A",
      "name": "София — Хиподрума",
      "obshtina": "SOF00",
      "loc": "23.30,42.69",
      "latestReadings": { "pm10": 32, "pm25": 18, "no2": 21 },
      "history7d": { "pm10": [30, 31, ...], ... }
    }
  ]
}
```

## Watcher wiring

- Daily watch source: `state/watch/air_quality.json`.
- Skill: `update-air-quality`.

## UI

`MyAreaAirTile` mounts only when at least one station is inside the município bounds (or within 5 km of its centroid). Shows the worst-pollutant current reading + EU limit + 7-day mini-sparkline.
