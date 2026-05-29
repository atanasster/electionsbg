---
name: parliament-scrape
description: Scrape MP photos, biographies, and seat data from parliament.bg. Use when the user asks to update parliament data, refresh MP profiles, add a newly seated parliament (e.g. 52nd NS after the April 2026 election), regenerate seat allocations, or fix missing photos/bios on candidate pages. Also use to re-run the scraper after a fresh git clone if `public/parliament/index.json` is missing.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Parliament.bg scraper skill

Pulls MP data (photos, bios, region, party, term history) from `parliament.bg`'s public `/api/v1` endpoints and stores it under `public/parliament/`. The frontend integrates this with the existing CIK candidate data via case-insensitive name matching.

## When to use which command

The scraper at `scripts/parliament/scrape_mps.ts` has three operational modes. Pick based on intent:

| Intent | Command | Time | Network calls |
|---|---|---|---|
| **First-time scrape** (e.g. after fresh clone, no `index.json`) | `npx tsx scripts/parliament/scrape_mps.ts --all` | ~10 min | ~5200 |
| **New parliament was seated** (e.g. 52nd NS sworn in after April 2026 election) | `npx tsx scripts/parliament/scrape_mps.ts --all --refresh-current` | ~2 min | ~240 + new IDs |
| **Just want current 240 MPs as a per-election bundle** | `npx tsx scripts/parliament/scrape_mps.ts --profiles --photos` | ~3 min | ~240 + 240 photos |

**Default to `--all --refresh-current` when in doubt** — it is idempotent, keeps cached files, and produces correct output whether or not a new NS has been seated.

## Inputs and outputs

**Inputs** — none on disk. The scraper reads only from parliament.bg via HTTPS.

**Outputs** under `public/parliament/`:
- `index.json` (~930 KB) — flat lookup table: every MP's `id`, `normalizedName`, `photoUrl`, `currentRegion`, `currentPartyGroup`, `nsFolders[]`, `isCurrent`. Loaded once by the frontend.
- `profiles/{id}.json` × ~4000 (~5 MB total raw, ~1 MB gzipped) — trimmed bio per MP, lazily fetched on candidate pages.

**Both outputs are committed to git** so new contributors can skip the scrape. They are NOT under `/public/2*/` (that path is gitignored), so they survive `npm run prod`.

## Step-by-step: handling a new parliament being seated

When parliament.bg's `coll-list-ns/bg` starts returning a NEW current NS (e.g. 52nd Народно събрание convenes after the 2026-04-19 election), follow this sequence:

1. **Verify the new NS is actually current** — the data only changes when MPs are sworn in, not on election day:
   ```bash
   curl -s -A "Mozilla/5.0" -H "X-Requested-With: XMLHttpRequest" \
     https://www.parliament.bg/api/v1/coll-list-ns/bg | \
     python3 -c "import json,sys; d=json.load(sys.stdin); print(d['A_ns_CL_value'], d['A_ns_C_active_count'])"
   ```
   You should see `52-о Народно събрание 240` (or similar). If you still see the previous NS, parliament.bg hasn't been updated yet — try again later.

2. **Run the incremental update**:
   ```bash
   npx tsx scripts/parliament/scrape_mps.ts --all --refresh-current
   ```
   This re-fetches the 240 sitting MPs (their `oldnsList` grows when their previous NS becomes "past"), pulls any new IDs assigned by parliament.bg, and rebuilds the deduped index.

3. **Verify the change**:
   ```bash
   python3 -c "
   import json
   d = json.load(open('public/parliament/index.json'))
   print('current NS:', d['currentNs'])
   print('total deduped MPs:', d['total'])
   "
   ```

4. **Spot-check the preview** at `/?elections=<latest>` (e.g. `2026_04_19`) — the Top Candidates strip should show photos, and clicking a top candidate should show the MP profile header card with the new NS in the "Terms" line.

5. **Re-decorate local-election bundles** (so any newly-seated MPs whose
   `photoUrl` just appeared in the index also show their portrait on the
   local-election mayor / council rows they ran on):
   ```bash
   npx tsx scripts/parsers_local/decorate_local_mp_links.ts
   ```
   This walks every `data/<cycle>/municipalities/<obshtinaCode>.json`
   shard for all 9 local-election cycles, re-matching candidate names
   against the refreshed parliament index. ~10 s, idempotent. Skip only
   when this run added zero new MPs (`--refresh-current` on an already-up-
   to-date NS) and you're certain no `photoUrl` changed. When in doubt,
   re-run — it's a no-op when nothing changed and prevents stale `mpId`
   stamps after parliament.bg renumbers an MP.

6. **Commit**:
   ```bash
   git add public/parliament/ data/
   git commit -m "Update parliament data for 52nd NS"
   ```
   The diff will mostly be in `index.json` plus 240-ish profile files (the
   sitting MPs' updated `oldnsList`), and the `mpId` stamps the decorator
   wrote across local-election bundles.

## Data-integrity contract

The scraper is designed to **fail loud rather than overwrite `data/parliament/index.json` with a near-empty roster** when parliament.bg's API mass-fails.

Fail-loud surfaces (the script throws before any write):

| Surface | Trigger |
|---|---|
| HTTP non-2xx on `coll-list-ns/bg` or `mp-profile/<lang>/<id>` after 3 retries | `fetch failed for <url>: <status>` |
| Deduped MP count < 200 after the full walk | `safety check: deduped MP count N < 200 (kept R raw, …)`. Catches "parliament.bg returned a different shape and we'd write an empty roster". |

Intentional non-fatal skips (documented as normal):

| Surface | Behaviour | Why not a hard fail |
|---|---|---|
| MP id returns `[]` from `mp-profile/bg/<id>` | Counted as `empty`, walk continues | parliament.bg has ~1170 gaps in its id sequence — these are real holes, not failures |
| MP id throws during fetch (network/transient) | Counted as `failed`, walk continues | Occasional 5xx; the retry loop already handles 3 attempts |
| Photo download fails for one MP | `photoUrl` cleared on that MP's index entry | Doesn't invalidate the rest of the roster; the SPA falls back to initials |
| English-name backfill (`mp-profile/en/<id>`) fails | Falls back to transliterating the BG name | Older records often have no EN profile; transliteration is acceptable |

Summary line after every run prints `kept R raw → D deduped, E empty ids, F failures` so you can see at a glance whether the run is healthy. A normal `--all --refresh-current` produces D ≈ 2100+ deduped, E ≈ 1170, F ≈ 0.

## Common pitfalls

### Cloudflare blocks results.cik.bg
The scraper uses `parliament.bg`, NOT `results.cik.bg`. Don't try to extend it to scrape CIK URLs without a headless browser (Playwright) — Cloudflare returns a 403 challenge to plain `curl`/`fetch` requests. CIK is needed only for *original election-day winners* (which we explicitly do not pull here — see "What this skill does NOT do" below).

### Why some MPs have multiple records
Parliament.bg creates a **separate MP record per NS** for the same person. Borisov has 7 records (one per term he served). The scraper dedupes by normalized name in the index — keeping the entry with `isCurrent === true` if any, otherwise the one with the most `nsFolders`. Profile files keep all variants on disk under their respective IDs (we never delete cached profiles).

### Married names and orthographic variants
Name matching is case-insensitive whitespace-normalized but exact otherwise. `НЕБИЕ ИСМЕТ КАБАК` (CIK candidate listing) and `НЕБИЕ ИСМЕТ ЦЪРЕНСКА` (parliament.bg, after marriage) will not match. There is no fix in the scraper for this — it is an irreducible 1-2 MPs per parliament.

### Profile bloat
parliament.bg returns ~30 KB profiles by default with massive `importActList`/`controlList`/`mshipList` arrays we don't use. The scraper trims to ~1.5 KB per profile. **If you ever change the scraper to keep more fields**, update `PROFILE_KEEP` in `scripts/parliament/scrape_mps.ts` AND clear `public/parliament/profiles/` so cached files are re-fetched fresh.

### Empty IDs
Out of 5200 walked, ~1170 IDs return `[]` — these are gaps in parliament.bg's id sequence. The scraper handles them silently. Do not interpret a high empty count as a failure.

## What this skill does NOT do

- **Does not scrape CIK** (`results.cik.bg`). That requires a headless browser to bypass Cloudflare, and would only matter if you need *original election-day winners* (i.e. the seat allocation as published the day after the vote, before any list-substitutions). Parliament.bg gives the *currently active* member roster, which is what the dashboard's photo integration uses.
- **Does not download photos to disk.** The frontend hotlinks `https://www.parliament.bg/images/Assembly/{id}.png` directly. There is a `--photos` option on the legacy current-only mode, but `--all` does not download photos because we ship 4000+ MPs and committing 40+ MB of photos would be wasteful. If you need photos offline, fork the script.
- **Does not produce per-region seat allocation.** The 51st-NS-only mode (`--profiles`) writes a `seats_by_region.json` to its `--out` directory. The historical `--all` mode does not — building per-region per-NS seat data would require either CIK scraping or reconstructing it from `oldnsList` + region-at-the-time, which parliament.bg does not store.

## File map

| Path | Purpose |
|---|---|
| `scripts/parliament/scrape_mps.ts` | The scraper. CLI entry. |
| `public/parliament/index.json` | Lookup table — committed to git. |
| `public/parliament/profiles/{id}.json` | Per-MP bio — committed to git. |
| `src/data/parliament/useMps.tsx` | React Query hook for the index. |
| `src/data/parliament/useMpProfile.tsx` | React Query hook for one profile (lazy). |
| `src/screens/components/candidates/MpProfileHeader.tsx` | Photo + bio card on the candidate page. |
| `src/screens/dashboard/TopCandidatesStrip.tsx` | Avatar with photo on the dashboard tile. |

## Frontend integration cheat-sheet

If you change the scraper's output schema, update these in lockstep:
- `IndexEntry` type in `scripts/parliament/scrape_mps.ts`
- `MpIndexEntry` type in `src/data/parliament/useMps.tsx`
- `RawProfile` and `MpProfile` types in `src/data/parliament/useMpProfile.tsx`
- `PROFILE_KEEP` set in `scripts/parliament/scrape_mps.ts` if adding a new field from the API

The match key is `normalizedName = name.toUpperCase().replace(/\s+/g, " ").trim()`. CIK candidate names are title-cased, parliament.bg names are uppercase, so normalization is required — do not rely on case-sensitive equality.
