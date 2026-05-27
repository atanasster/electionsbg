# EU funds (ИСУН 2020)

Bulgaria's Management & Monitoring Information System for EU funds — public
beneficiary + project register. Source: <https://2020.eufunds.bg/>.

This directory holds the parsed JSON. Raw XLSX exports are cached in
`data/_cache/funds/` (gitignored). The pipeline lives under `scripts/funds/`
and is run by the `/update-funds` skill — see
`.claude/skills/update-funds/SKILL.md` for the operator playbook.

## Layout

```
data/funds/
├── index.json                          # Corpus totals + top-25 beneficiaries (committed)
├── beneficiaries/                      # Beneficiary rows sharded by EIK last digit (committed, 11 files)
├── beneficiaries-by-eik/{EIK}.json     # One small JSON per beneficiary (gitignored, ~46k files)
├── confirmed.json                      # Hand-curated investigative-journalism cases (committed)
├── projects/                           # Contract-level corpus
│   ├── index.json                          # Totals + per-program / per-status rollups (committed)
│   ├── muni-map.json                       # Choropleth-ready denormalised муни rows (committed)
│   ├── multi_location.json                 # Non-EKATTE rows (regional / national / unresolved) (committed)
│   ├── by-contract/{contractNumber}.json   # One file per signed contract (committed, ~80k)
│   ├── by-ekatte/{ekatte}.json             # Per-settlement contract lists (committed)
│   ├── by-ekatte/{ekatte}-summary.json     # Slim tile-ready summary (~3-5 KB)
│   ├── by-muni/{obshtina}.json             # Per-municipality contract lists (committed)
│   ├── by-muni/{obshtina}-summary.json     # Slim tile-ready summary
│   ├── by-program/{code}.json              # Per-programme contract lists (committed)
│   ├── by-program/{code}-summary.json      # Slim programme-page summary
│   └── by-eik/{eik}.json                   # Per-beneficiary contract lists (gitignored)
└── derived/                            # Cross-references built from siblings (no new external data)
    ├── mp_connected.json                   # EU-funds × MP-companies graph (committed)
    ├── per-mp/{mpId}.json                  # Per-MP shard for candidate pages (committed)
    ├── political_links.json                # Slim leaderboard of politically-tied beneficiaries (committed)
    └── political-by-eik/{eik}.json         # Per-EIK detail for /company panels (committed, ~286 files)
```

## Political-economy join layer (`derived/political_links.json`)

Joins beneficiary EIK against:

- `data/parliament/companies-index.json` — sitting / former MPs' declared
  ownership stakes (Сметна палата) + Commerce Registry management roles.
- `data/officials/derived/company_links.json` — non-MP officials with declared
  stakes or TR roles: cabinet, deputy ministers, agency heads, regional
  governors, mayors, deputy mayors, council chairs, councillors, chief
  architects.
- `data/procurement/derived/top_contractors.json` (and per-EIK
  `data/procurement/contractors/{eik}.json` as fallback) — for the public
  procurement award overlap on the same EIK.
- `data/procurement/debarred.json` — currently debarred from public
  procurement (name-matched).

A beneficiary is **flagged** when at least one declared MP or non-MP-official
linkage exists for its EIK. Editorial guardrail: only the **high-confidence**
slice — declarations (filed by the official themselves) and TR roles with
`namesakeCount == 1`. No name-match guessing.

Outputs three artifacts:

| File | Shape | Purpose |
|---|---|---|
| `derived/political_links.json` | `{ totals, top: top-50, flaggedEiks: [...] }` | Tile + `/funds/political` leaderboard. ~50 KB. |
| `derived/political-by-eik/{eik}.json` | One PoliticalEntry | `/company/{eik}` panel. ~1–4 KB each. |
| `derived/political-by-eik/index.json` | `{ flaggedEiks: [...] }` | Manifest so `/company/{eik}` short-circuits without a 404 round-trip. |

Re-runs whenever `funds:ingest` runs — no separate trigger. Standalone
runnable via `npx tsx scripts/funds/political_links.ts` for dev iteration.

## Why `data/` and not `public/`

The frontend fetches all `data/funds/...` through `src/data/dataUrl.ts`. In
dev/preview, `vite.config.ts` mounts `data/` as a second public dir at root.
In production, large/changing JSON is served from a separate GCS bucket
(`bucket:sync`) — `dataUrl` swaps origins without code changes. So the file
paths above are also the URL paths.

## Verify after a re-ingest

```bash
node -e "
const idx = require('./data/funds/index.json');
console.log('totals:', idx.totals);
console.log('top:', idx.topByContracted[0].name);
console.log('crossRef:', idx.crossReference);
"
node -e "
const pol = require('./data/funds/derived/political_links.json');
console.log('flagged:', pol.totals.flaggedEiks, 'companies');
console.log('split:', pol.totals.mpOnly, 'MP-only,', pol.totals.officialOnly,
            'official-only,', pol.totals.both, 'both');
console.log('top:', pol.top[0].name, '€' + Math.round(pol.top[0].contractedEur));
"
```

`withEik` should stay near ~87% — a sharp drop means EIK parsing regressed.
`flaggedEiks` should sit in the low hundreds — a sharp jump means the
confidence filter on the officials side loosened (e.g. low-confidence
namesakes crept back in).
