---
name: update-financing
description: Refresh the Сметна палата party-financing data — re-scrape the bulnao.government.bg/bg/kontrol-partii/ section for the list of available years (data/financing/index.json), and crawl the gfopp.bulnao.government.bg register for the per-party annual-report filing-status catalogue (data/financing/reports.json — filed on time / late / non-compliant / not filed). Use when the daily watch report flags "Сметна палата party financing" as changed, when the user asks to refresh party-financing data, or to investigate which year of annual reports was added/removed.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
  - WebFetch
---

# Update Financing skill

Tier-2 ingest for Сметна палата (Court of Audit) party-financing disclosures. Two scrapers:

- **`scrape_index.ts`** — catalogs the per-year annual-report index that the Court publishes at `https://www.bulnao.government.bg/bg/kontrol-partii/otcheti-na-partii/` → `data/financing/index.json`.
- **`scrape_reports.ts`** — crawls the `gfopp.bulnao.government.bg` register for the per-party **filing-status catalogue** (which parties filed their annual financial report on time / late / non-compliant / not at all, with a deep link to each report document) → `data/financing/reports.json` + `data/financing/reports-summary.json`. Surfaced at `/financing/annual-reports`.

## When to run

| Trigger | Action |
|---|---|
| Daily watcher flags `Сметна палата party financing: index hash <new>` | Re-run `scrape_index.ts`, inspect the diff |
| User asks "what changed in party financing?" | Run `scrape_index.ts` + diff against the prior `data/financing/index.json` |
| Fresh clone (no `data/financing/index.json`) | Cold-start `scrape_index.ts` to populate the catalog |
| A new annual-report year appears (spring, after the 31 March deadline) | Run `scrape_index.ts`, then `scrape_reports.ts` to pull the new year's filings |
| Fresh clone (no `data/financing/reports.json`) | Run `scrape_index.ts` first, then `scrape_reports.ts` |

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

## Annual-report filing-status catalogue (`scrape_reports.ts`)

A second, heavier scraper crawls the gfopp WebForms register for the
per-party filing-status catalogue.

```bash
npx tsx scripts/financing/scrape_reports.ts            # ingest
npx tsx scripts/financing/scrape_reports.ts --upload   # ingest + GCS push
```

It reads the year list from `data/financing/index.json` (run `scrape_index.ts`
first), then for each year:

1. GETs `gfopp.bulnao.government.bg/?year=YYYY` to mint an ASP.NET session
   cookie — the year is bound to the session, not a query string.
2. Crawls the four status pages — `s1.aspx` (filed on time, compliant),
   `s2.aspx` (not filed), `s3.aspx` (filed late), `s4.aspx` (filed but
   non-compliant) — posting back `__VIEWSTATE` to widen the paginated
   GridView and walking the pager to the last page.
3. Captures each party, its filing status, and the report-document id (the
   `ShowWndGfoUp('id')` handler → a `GfoUp.aspx?ID=<id>` deep link).

Writes `data/financing/reports.json` (full per-year, per-party catalogue) and
`data/financing/reports-summary.json` (per-year counts only, for the
governance-page tile). Surfaced on the SPA at `/financing/annual-reports`.

Expected output:

```
→ crawling gfopp annual reports for 15 year(s)
  2025: 133 part(y/ies) — on_time=130 late=2 non_compliant=0 not_filed=1
  ...
✓ wrote .../reports.json — 15 years, 2243 filings, 237 distinct parties
✓ wrote .../reports-summary.json
```

The scraper fails loud rather than write a truncated file: it throws if the
newest year is empty, if every year reports an identical `on_time` count (the
signature of a GridView pager cap), or if the total filing count falls below a
sanity floor. If it throws, open `gfopp.bulnao.government.bg/?year=2025` in a
browser and check the page structure before adjusting the parser in
`scripts/financing/scrape_reports.ts`.

## Data-integrity contract

The scraper is designed to **fail loudly rather than write a stale or empty index**. The frontend reads this file and trusts it; we must not silently let upstream restructures corrupt that trust.

Concrete guarantees:

| Surface | Behaviour |
|---|---|
| HTTP non-2xx | Throws with status code + URL. No file is written. |
| Response < 1000 bytes (likely redirect/error page) | Throws with byte count. No file written. |
| Section with `minimumYears: N` parses fewer than N years | Throws naming the section, URL, and counts. No file written. |
| Section marked `notImplemented: true` | Emitted explicitly with `status: "not_implemented"` and a `note` explaining why. Never confused with a "found nothing" result. |
| Successful sections | Emitted with `status: "ok"` plus the actual year entries. |

Top-level `data/financing/index.json` always has `status: "ok"` — it's never partial. Any failure halts the script before write. To diagnose a thrown failure, open the URL named in the error message in a browser; if the page looks fine to a human, the parser regex in `scripts/financing/scrape_index.ts` needs updating, then re-run.

**When `minimumYears` is breached**: that's the canary signal that the upstream CMS restructured. Don't lower the minimum to make it pass — fix the parser to handle the new layout.

## What this skill does NOT do (v1 limitations)

- **Does not extract the financial figures from filed reports.** `scrape_reports.ts` catalogues the *filing status* of every party (on time / late / non-compliant / not filed) and links each report document, but the documents themselves are inconsistently-formatted scans — parsing structured income/expense/donor numbers out of them is a separate project.
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
| `scripts/financing/scrape_index.ts` | CLI entry — fetches the bulnao sections, parses, writes the year index |
| `scripts/financing/scrape_reports.ts` | CLI entry — crawls the gfopp register for the filing-status catalogue |
| `scripts/lib/upload.ts` | Shared GCS upload helper (gsutil cp -Z wrapper) |
| `data/financing/index.json` | Year catalogue — committed |
| `data/financing/reports.json` | Per-year, per-party filing-status catalogue — committed |
| `data/financing/reports-summary.json` | Per-year counts only (governance-page tile) — committed |
| `src/data/financing/useFinancingReports.tsx` | Frontend hooks for the reports artifacts |
| `src/screens/PartyAnnualReportsScreen.tsx` | The `/financing/annual-reports` screen |
| `scripts/watch/sources/smetna_palata.ts` | Tier-1 watcher that flags when re-running this skill is worth it |

## Quick command reference

```bash
# Daily refresh after watcher flags a change
npx tsx scripts/financing/scrape_index.ts

# Refresh + upload to bucket
npx tsx scripts/financing/scrape_index.ts --upload

# Refresh the per-party filing-status catalogue (run scrape_index.ts first)
npx tsx scripts/financing/scrape_reports.ts
npx tsx scripts/financing/scrape_reports.ts --upload

# Inspect what changed
git diff data/financing/
```
