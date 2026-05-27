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
├── taxonomy.json                       # Per-programme period + fund-family lookup (committed)
├── themes.json                         # Hand-curated editorial focus-theme definitions (committed)
└── derived/                            # Cross-references built from siblings (no new external data)
    ├── mp_connected.json                   # EU-funds × MP-companies graph (committed)
    ├── per-mp/{mpId}.json                  # Per-MP shard for candidate pages (committed)
    ├── political_links.json                # Slim leaderboard of politically-tied beneficiaries (committed)
    ├── political-by-eik/{eik}.json         # Per-EIK detail for /company panels (committed, ~286 files)
    ├── absorption.json                     # Per-period + per-programme absorption % (committed)
    ├── sankey.json                         # Fund → top-OP Sankey shape for /funds tile (committed)
    ├── integrity.json                      # Concentration / serial-winner / debarred leaderboard (committed)
    ├── integrity-by-program/{code}.json    # Per-programme HHI + top-10 beneficiaries + debarred (committed)
    └── themes/{slug}.json                  # Per-theme focus dashboard (guest houses / roads / etc.) (committed)
```

## Programme taxonomy (`taxonomy.json` + `derived/absorption.json` + `derived/sankey.json`)

Phase-6 derivatives — programme classification by EU programming period and
fund family.

The CCI-code inference in `scripts/funds/taxonomy.ts` maps every ИСУН programme
code (e.g. `2014BG16RFOP002`) to:

- **period** — `2007-13` / `2014-20` / `2021-27` / `RRP` (Recovery Plan)
- **fundType** — `ERDF` / `ESF` / `CF` / `EAFRD` / `EMFF` / `JTF` / `RRP` / `Other`
- **bucket** — viz-friendly label, e.g. "ERDF 2014-20"

No external taxonomy file is maintained — the inference is regex-only over the
CCI prefix and stays current as 2021-27 / NRRP programmes appear.

**Absorption file** rolls projects up by period, fund type, and (period × fund)
bucket, plus a per-programme row with absorption% (paidEur / contractedEur).
Drives the `AbsorptionByPeriodTile` on `/funds`.

**Sankey file** is a precomputed Fund → top-N-programme graph
(`{nodes, links, totalContracted, topN}`). Beneficiary tier is intentionally
omitted — d3-sankey collapses node heights when the leaf-column count
overflows the available height. Drill into beneficiaries via the linked
`/funds/programme/{code}` pages instead.

## Integrity / red-flags layer (`derived/integrity.json` + per-programme shards)

Phase-7 derivative — concentration and risk indicators per programme.

For each operational programme `scripts/funds/integrity.ts` computes:

- **Herfindahl-Hirschman index (HHI)** on contracted EUR. <1500 unconcentrated
  / 1500-2500 moderate / >2500 high — the standard antitrust bands.
- **Top-1 share** and **top-5 share** — quick read on dominance.
- **Top-10 beneficiaries** for the programme drill-down.
- **Debarred-supplier match** — name-normalised join against
  `data/procurement/debarred.json`.

Cross-cutting metrics in the slim index:

- **Serial winners** — beneficiaries appearing in the top-10 of two or more
  programmes, ranked by `log(EUR) × programmeCount`.
- **Debarred overlap** — total EUR of EU-funds contracts going to currently-
  debarred suppliers.

What is **NOT** computed (limitation of the upstream feed): single-bidder
rate per EU-funded contract. The АОП OCDS feed surfaces bid counts only on
tender records, not on the contract-grain rows we ingest. A future ingest
of the tender-grain feed would unlock that metric.

## Focus themes (`themes.json` + `derived/themes/`)

Phase-8 — editorial lenses across the EU-funds corpus.

Each theme in `themes.json` defines a slug, BG+EN label and summary, an icon
name (lucide), an optional list of `titleKeywords` and/or `programCodes`, and
a list of `investigativeCards` (outlet + title + URL). Any contract whose
title contains a keyword (case-insensitive, normalised) OR whose programme
code matches becomes part of that theme.

The build (`scripts/funds/themes.ts`) scans every per-programme shard in a
single pass and writes one shard per theme:
`derived/themes/{slug}.json` carries the totals, top beneficiaries, top
contracts, top municipalities, programme breakdown and investigative-card
sidebar. A slim `derived/themes/index.json` lists the themes for the `/funds`
tile and the `/funds/focus/{slug}` router.

Adding a theme is purely a JSON edit — re-run `npm run funds:ingest-projects`
or `npx tsx scripts/funds/themes.ts` and the new theme appears on `/funds`
and at `/funds/focus/{slug}`. No code change required.


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
