# Interreg parse fixtures

**These are PROJECTIONS of `raw_data/interreg/keep/<id>.json`, not byte captures.**
Each was produced by keeping only the fields `parse.ts` reads, so a fixture is
2–6 KB instead of 14–37 KB. What is trimmed:

- `programme` keeps `{id, title, period:{title}}`; the raw object carries
  `period.id`, `type`, `projects_in_keep` and more.
- `partner.country` / `country_department` keep `{title}` only — the raw `id` is
  dropped. That `id` is keep.eu's own internal key rather than an ISO code, and
  it is the fact the verbatim-country decision turns on, so it is worth knowing
  it existed.
- `partner.translations` keeps `en.name_translated` only; some rows have a `bg`.
- **`translations.en.description` is TRUNCATED to 160 characters** (raw lengths
  run to ~5,000). Do not assert `summaryEn` against a fixture as if it were the
  source value — you would be pinning a prefix.

Nothing `parse.ts` reads is altered in value; only absent or shortened.

| fixture | why it is here |
|---|---|
| `33607.json` | BSB00963 ALL4NATURE — plan §3.1 row 1; 2021-2027; five countries |
| `32348.json` | BGTR0200037 — §3.1 row 2; Малко Търново is a partner, Средец leads |
| `32344.json` | BGTR0200044 — §3.1 row 3 |
| `32324.json` | BGTR0200100 — §3.1 row 4; the museum is the LEAD |
| `17853.json` | 2014-2020 ROBG — the older template: no `project_id`, no EIK, no PIC, no partner co-financing |
| `25693.json` | 2014-2020 GR-BG — carries the two `published_zero` rows §3.1 names by hand |

Regenerate from the crawl cache rather than editing by hand.
