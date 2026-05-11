---
name: update-financing
description: Refresh the Сметна палата party-financing index — re-scrape the bulnao.government.bg/bg/kontrol-partii/ section for the list of available years of annual financial reports and write data/financing/index.json. Use when the daily watch report flags "Сметна палата party financing" as changed, when the user asks to refresh party-financing data, or to investigate which year of annual reports was added/removed.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Financing skill

Tier-2 ingest for Сметна палата (Court of Audit) party-financing disclosures. Catalogs the per-year annual-report index that the Court publishes at `https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/` and writes a structured JSON to `data/financing/index.json`.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher flags `Сметна палата party financing: index hash <new>` | Re-run the scraper, inspect the diff |
| User asks "what changed in party financing?" | Run the scraper + diff against the prior `data/financing/index.json` |
| Fresh clone (no `data/financing/index.json`) | Cold-start to populate the catalog |

## Step 1 — Scrape

```bash
npx tsx scripts/financing/scrape_index.ts
```

Expected output:

```
→ Годишни финансови отчети (https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/)
  found 15 year(s)
→ Доклади за субсидии (https://www.bulnao.government.bg/bg/kontrol-partii/dokladi-subsidii/)
  found 0 year(s)
✓ wrote data/financing/index.json
```

Each entry under `sections[0].years` is one annual-report cohort with the year (2011…2025) and the deep link to `gfopp.bulnao.government.bg/?year=YYYY` where the actual per-party filings live.

## Step 2 — Verify the diff

```bash
git diff data/financing/index.json
```

If a new year appeared (typical in spring once that fiscal year's reports are filed by the 31 March deadline) you'll see a new entry near the top of `sections[0].years`. If a year disappeared, that's anomalous — investigate before committing.

## Step 3 — Upload

```bash
npx tsx scripts/financing/scrape_index.ts --upload
```

Pushes `data/financing/index.json` to `gs://data-electionsbg-com/financing/index.json` with `Cache-Control: no-cache` (the file is small and mutable).

## Step 4 — Commit

```bash
git add data/financing
git commit -m "financing: refresh annual-reports index"
```

## What this skill does NOT do (v1 limitations)

- **Does not ingest per-party filings.** The actual financial statements live on `gfopp.bulnao.government.bg` — a legacy ASP.NET WebForms app with `s1.aspx … s4.aspx` sub-pages (filed-on-time / not-filed / filed-late / non-compliant). Direct fetches return 403 without a session cookie + __VIEWSTATE from the year landing page. Deep ingest there is a separate project.
- **Does not parse the `dokladi-subsidii` section.** That page lists state-subsidy reports and audit findings under an AJAX-driven filter UI; the static HTML has no year anchors to extract. The scraper records the section URL but returns 0 entries for it — extend the scraper with Playwright or the underlying API to add subsidy data.
- **Does not produce a frontend hook.** Once a downstream `/governments` or `/parties` page wants to surface this data, add `src/data/financing/useFinancing.tsx` that fetches via `dataUrl("/financing/index.json")`.

## Common pitfalls

### Year count drops unexpectedly
The bulnao CMS occasionally re-orders or restructures the year list when a new fiscal year's section is opened (e.g. 2025 reports become available in spring 2026). The parser looks for the literal "Годишни финансови отчети ... за YYYY г." string; if the CMS changes that wording, the parser silently misses entries. Check by opening `https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/` in a browser and counting headings.

### Watcher reports the page changed but the index didn't
The watcher hashes the *full* HTML of the parent index page (after stripping Django CSRF tokens). The page can change for reasons that don't affect the year list — new top-banner announcement, layout tweak, footer update. If `data/financing/index.json` shows no diff but the watcher flagged a change, the change was in chrome and is informational only.

### Subsidii section
Always shows `found 0 year(s)` until the scraper is extended. Don't treat this as a regression — see "v1 limitations" above.

## File map

| Path | Purpose |
|---|---|
| `scripts/financing/scrape_index.ts` | CLI entry — fetches both sections, parses, writes JSON |
| `scripts/lib/upload.ts` | Shared GCS upload helper (gsutil cp -Z wrapper) |
| `data/financing/index.json` | Year catalogue — committed |
| `scripts/watch/sources/smetna_palata.ts` | Tier-1 watcher that flags when re-running this skill is worth it |

## Quick command reference

```bash
# Daily refresh after watcher flags a change
npx tsx scripts/financing/scrape_index.ts

# Refresh + upload to bucket
npx tsx scripts/financing/scrape_index.ts --upload

# Inspect what changed
git diff data/financing/index.json
```
