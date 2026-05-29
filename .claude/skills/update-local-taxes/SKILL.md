---
name: update-local-taxes
description: Refresh the per-município local-tax rates (data/local_taxes/index.json) — five ИПИ indicators across all 265 общини (property tax on legal entities, property-transfer tax, vehicle tax 74-110 kW, retail patent tax ≤100 m², taxi patent tax) plus optional per-município naredba blocks (residential ТБО + basis flag, property tax for individuals where the TAX naredba is reachable, tourist tax, dog tax) for the oblast capitals. Use when the daily watch report flags `ipi_local_taxes` or `municipal_naredba` as changed, when the user asks to refresh local taxes / местни данъци / municipal-tax rates, after a new fiscal year of naredbi (typically December-January), or after a fresh git clone if data/local_taxes/index.json is missing or has an empty `scoresByObshtina`.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update local taxes skill

Refreshes `data/local_taxes/index.json` — Bulgaria's per-município local-tax rates. Powers the My-Area "Местни данъци" tile.

The file has two tiers that merge into one structure:

| Tier | Source | Coverage | Cadence | Cost |
|---|---|---|---|---|
| **A — ИПИ aggregator** | [265obshtini.bg](https://www.265obshtini.bg/) | All 265 общини × 5 tax indicators | Annual (Q3 publication) | Fully automated |
| **B — Per-município naredba** | each município's FEES + TAX naredbi | Currently 9 wired: ТБО basis flag (9/9) · property tax for individuals (**9/9** — Sofia 1.875‰, Plovdiv 1.8‰, Varna 2.0‰, Burgas 1.75‰ (pinned — anaphoric phrasing), Razgrad 3‰, Samokov 2.5‰, Мъглиж 3.5‰, Балчик 2.5‰, Петрич 3‰) · tourist tax 8/9 (extractor walks every "1 звезда" anchor + 200-char rate-lookahead window, prefers EUR-native over BGN-converted, falls back to range form "от X до Y евро за нощ" and the legacy single-rate phrasing; Varna's tariff sits in an external Приложение № 2 not in the fetched JSON) · dog tax 2/9 (extractor walks every "куче" anchor + 200-char window for rate + година; catches inline forms — Sofia + Varna 24 BGN ≈ 12.27 EUR/година — but misses tabular dual-currency rows in Plovdiv/Razgrad/Maglizh/Balchik/Petrich/Burgas, which need column-aware extraction). Other oblast capitals land as parsers are added; the `scripts/probe_obshtini_all.ts` survey enumerates obshtini.bg coverage for the remaining 257 municípios. | Annual (Dec→Jan adoption) | Per-município parser via `createObshtiniBgNaredbaParser` factory when both naredbi are on the obshtini.bg platform; bespoke for direct PDFs / DOCX / legacy .doc (Burgas — `lib/fetch_doc.ts` shells out to macOS `textutil`; Linux operators swap in `antiword`) |

Tier B fills in the resident-side taxes ИПИ doesn't cover — most importantly the residential garbage-fee basis (промил / users / area / volume), which is the comparability metadata that lets the tile honestly show ТБО across municipalities.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher describes `ИПИ — Местни данъци (265 общини)` with a year tick or row-count change | Step A1 |
| Daily watcher describes `Общински наредби за местни данъци` with a `N município(s) re-uploaded` line | Step B1 — pass the named municípios via `--naredba <code>,<code>` |
| User asks "refresh local taxes", "update местни данъци", "ИПИ tax rates" | Step A1 (+ Step B1 if oblast-capital naredbi changed) |
| Fresh clone with empty `scoresByObshtina` | Step A1 (Tier B is incremental — naredba blocks land as parsers run) |
| New fiscal year (December rollover) | Step A1 once ИПИ publishes (typically August/September of T+1); Step B1 once each município adopts its new naredba (late Dec → late Jan) |

## Step A1 — refresh ИПИ tier (5 CSVs, all 265 общини)

```bash
npx tsx scripts/local_taxes/build_index.ts
```

Expected output:

```
fetching property_tax_legal (id=615)…
  property_tax_legal: 265/265 municípios mapped · latest year 2025 · avg 2.539
fetching transfer_tax (id=616)…
  transfer_tax: 265/265 municípios mapped · latest year 2025 · avg 2.758
fetching vehicle_tax_74_110kw (id=617)…
  vehicle_tax_74_110kw: 265/265 municípios mapped · latest year 2025 · avg 1.498
fetching patent_tax_retail (id=618)…
  patent_tax_retail: 265/265 municípios mapped · latest year 2025 · avg 8.332
fetching patent_tax_taxi (id=360)…
  patent_tax_taxi: 265/265 municípios mapped · latest year 2023 · avg 302.015

wrote data/local_taxes/index.json · ipi: 265 municípios · naredba: 0 (preserved) · total unmatched cell-rows: 0
```

The build is idempotent and merges with any existing `naredba` blocks Tier B parsers wrote — re-running Tier A never wipes Tier B output.

If `unmatched > 0` appears in the output, the script will print the unique município names that didn't resolve. Add the missing alias in `scripts/local_taxes/lib/match_obshtina.ts` — most are case-only mismatches between ИПИ's title-cased spelling and the canonical first-word-only-capitalised Bulgarian convention.

## Step B1 — refresh per-município naredba tier (Tier B)

```bash
# All wired munícipios (default)
npx tsx scripts/local_taxes/run_naredba.ts

# Subset — pass obshtina codes either comma-separated or as individual args
npx tsx scripts/local_taxes/run_naredba.ts SOF00,PDV01

# Bypass the raw_data/local_taxes/naredba/ cache (re-fetch upstream PDF)
npx tsx scripts/local_taxes/run_naredba.ts --force SOF00
```

The watcher's describe-line names exactly which munícipios' source URLs flipped (`N naredba(s) re-uploaded: SOF00, PDV01`) — run the dispatcher with that subset.

What ships per município:
- **ТБО basis flag** (промил / users / area / volume) — required; without it cross-município ТБО comparisons are noise.
- **ТБО rate** — surfaced when the naredba carries it inline; many municípios (Sofia in particular) defer the per-year rate to a separate annual council decision, in which case the `rate` field stays absent and a Bulgarian note explains why.
- **Tourist tax** — value + unit ("BGN/нощувка"), when the source document is the TAX naredba (туристически данък lives there, not in the FEES naredba).
- **Dog tax** — value + unit ("BGN/година"), same caveat.

Adding a new município:
1. Write `scripts/local_taxes/parsers/<obshtina>.ts` exporting a `NaredbaParser` (see `parsers/sof.ts` as the template — fetches a PDF via `fetchNaredbaPdf`, extracts text, calls `buildNaredbaBlock`).
2. Push it onto `NAREDBA_PARSERS` in `scripts/local_taxes/parsers/index.ts`.
3. Re-run the dispatcher with just that código to verify the basis flag landed correctly.

The dispatcher merges into `data/local_taxes/index.json` preserving the Tier A `ipi` blocks, and writes a per-município watermark at `state/ingest/local_taxes_<obshtina>.json` so future runs can short-circuit when the source PDF hasn't changed (sourceHash matches).

OCR fallback (Gemini Vision) is not wired yet — the current parsers assume the upstream PDF carries a real text layer. When we hit a município with image-only naredbi (Сливен-style protocols), we'll add a `--ocr` flag mirroring the council-minutes pattern.

## Step 2 — verify

```bash
jq '.latestYear, .indicators | length, (.scoresByObshtina | length)' data/local_taxes/index.json
# 2025 (or newer)
# 5
# 265
```

Spot-check a known município (Sofia uses SOF00 synthetic code):

```bash
jq '.scoresByObshtina.SOF00.ipi' data/local_taxes/index.json
```

## Step 3 — commit + stamp

```bash
git add scripts/local_taxes/ data/local_taxes/ scripts/watch/sources/{ipi_local_taxes.ts,index.ts}
git commit -m "local-taxes: refresh ИПИ tier (5 indicators · 265 municípios · latest YYYY)"

npx tsx scripts/stamp-ingest.ts update-local-taxes \
  --summary "ИПИ tier: 265/265 municípios · 5 indicators · latest YYYY · avg Y.YY%"
```

Append to the public data-changes log only when on-disk data actually moved:

```bash
if [ -n "$(git diff --stat data/local_taxes/)" ]; then
  npx tsx scripts/append-data-change.ts update-local-taxes \
    --summary "ИПИ tier: 265/265 municípios · 5 indicators · latest YYYY" \
    --source "ИПИ — Местни данъци (265 общини)"
fi
```

## Known limitations

- **Residential ТБО not in ИПИ.** The most-asked-about tax (garbage fee on private homes) varies by basis (промил / брой ползватели / РЗП / количество) and isn't part of the ИПИ aggregator. Tier B parsers will surface it per município once Tier B ships.
- **No intra-município zoning.** Property tax and ТБО can vary by zone within a município under ЗМДТ Art. 15, but each município defines its own zones in prose; no national EKATTE→zone map exists. Tier B captures only the município-level rate (or the city-centre / "zone 1" rate if multiple zones exist).
- **Vehicle tax band is 74-110 kW only.** ИПИ tracks one slice of the ЗМДТ tariff grid as the representative comparison point. Other engine-power bands are out of scope.
- **Taxi patent tax tracked only through 2023.** ИПИ paused this indicator after the 2024 amendments to ЗМДТ Art. 61з. We surface the 2023 value as the latest available and don't try to back-fill 2024-2025.
- **Манual paste not required.** Unlike LISI, the ИПИ CSV endpoint is a stable HTTP download. Tier A runs unattended.

## What this skill does NOT do

- **Does not touch state/municipal_budgets/.** Local-tax rates are an input to the budget, not a slice of it.
- **Does not build per-município sidecars.** The file is one ~30-40 KB blob; per-município shards aren't needed at this size.
- **Does not enrich with collection-rate data.** ИПИ also publishes "collected % of assessed" indicators (separate ids 619-620); deferred — the tile design doesn't yet have a place for them.

## File map

| Path | Purpose |
|---|---|
| `scripts/local_taxes/ipi.ts` | Indicator catalogue (5 ids, labels, units, direction) |
| `scripts/local_taxes/build_index.ts` | Tier A build script — re-fetches 5 CSVs, normalises names, ranks, writes |
| `scripts/local_taxes/lib/match_obshtina.ts` | Município-name → obshtina-code resolver (manual aliases + oblast disambiguation) |
| `data/local_taxes/index.json` | Output file — `scoresByObshtina` keyed by obshtina code |
| `scripts/watch/sources/ipi_local_taxes.ts` | Watcher — fingerprints all 5 CSVs jointly + tracks the max year seen |
| `src/data/local_taxes/useLocalTaxes.tsx` | React Query hook |
| `src/screens/myarea/MyAreaLocalTaxesTile.tsx` | "Местни данъци" tile |
