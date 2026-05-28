# Services-near-you ingest

**Status:** scaffolding committed; actual scrape pending.

Aggregates the public services a citizen typically needs to know about per município — GPs, specialists, pharmacies, schools, post offices, kметско. Inspired by Suomi.fi's "services by address" pattern.

## Sources

| Category | Source | Notes |
|---|---|---|
| `gp`, `specialist` | NHIF (Национална здравноосигурителна каса) public register | Has lat/lon for most facilities |
| `pharmacy` | IAL (Изпълнителна агенция по лекарствата) pharmacy register | Address only; geocode via postcode |
| `school` | МОН school registry | Shared with Phase 6 — read its catalog when ingesting here |
| `post` | Български пощи branch network | Often a downloadable XLSX/CSV |
| `kmetstvo` | Municipality websites + namrb.org | Only when Phase 2's municipal contacts ingest runs |

## Planned output

```jsonc
// data/services/index.json
{
  "servicesByObshtina": {
    "BGS01": {
      "gp": [{ "name": "д-р Иванов", "address": "...", "phone": "...", "loc": "..." }, ...],
      "pharmacy": [...],
      ...
    }
  }
}
```

## Watcher wiring

- Quarterly: `state/watch/public_services.json`.
- Skill: `update-public-services` with per-source sub-tasks.

## UI

`MyAreaServicesTile` renders a category accordion with the nearest 5 entries per category, distance computed via haversine to the settlement centroid. Empty categories auto-hide.
