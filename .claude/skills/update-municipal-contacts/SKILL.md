---
name: update-municipal-contacts
description: Refresh the per-município mayor email contacts (data/officials/municipal_contacts/index.json) by scraping the iisda.government.bg "Кметове на общини" registry. Use when the daily watch report flags `iisda_mayors` as changed, when the user asks to refresh mayor contacts / municipal contacts / kmet emails, after a local-election or chmi cycle when new mayors take office, or after a fresh git clone if data/officials/municipal_contacts/index.json carries an empty `contactsByObshtina`.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update municipal contacts skill

Refreshes `data/officials/municipal_contacts/index.json` — the per-municipality mayor email contact list that powers the My-Area dashboard's "Контакти на общината" tile and the "Свържете се" button on each mayor card. Covers 260 of Bulgaria's 265 municipalities; Sofia city contributes once under the synthetic `SOF00` code that fans out to the 24 районы via the hook fallback.

Source contract:

| Field | Source | Granularity | Cadence |
|---|---|---|---|
| `email`, `mayor`, `iisda_id` | [iisda.government.bg `governing_body/<id>` detail pages](https://iisda.government.bg/ras/governing_bodies/gb_municipality_administrations) — IDs in the contiguous block 4400..4950 | per municipality (obshtina code) | shifts on regular & partial local-election cycles |

`scripts/officials/municipal_contacts/scrape_iisda.ts` walks the ID range serially with a 200 ms polite delay, caches each detail page to `raw_data/officials/iisda_mayors/<id>.html`, filters for pages whose body contains `Кмет на община` AND `Общинска администрация`, extracts the first email address + município name, and name-matches against `data/municipalities.json` with two manual aliases (`Добричка` → `DOB15`, `Столична община` → `SOF00`).

## When to run

| Trigger | Action |
|---|---|
| Daily watcher reports `iisda.government.bg — Кметове на общини` as changed | Step 1 |
| User asks to "refresh mayor contacts" / "update municipal contacts" / "rescrape iisda" | Step 1 |
| New regular-local cycle (mi*) or chmi cycle has finalized — new mayors took office | Step 1 with `--force` to refetch HTML |
| Fresh clone with empty `contactsByObshtina` | Step 1 |

The iisda registry is dormant between election cycles; routine fingerprint flips are usually individual chmi (частични избори) replacements, not bulk changes.

## Step 1 — Scrape

```bash
npx tsx scripts/officials/municipal_contacts/scrape_iisda.ts          # uses cached HTML when present
```

Force a full re-fetch (after a regular-local cycle):

```bash
rm -rf raw_data/officials/iisda_mayors
npx tsx scripts/officials/municipal_contacts/scrape_iisda.ts          # ~2 min cold
```

Expected output on a routine run:

```
  scanned 100/551 · mayors=50 · matched=50
  scanned 200/551 · mayors=100 · matched=99
  scanned 300/551 · mayors=150 · matched=149
  ...
  scanned 550/551 · mayors=260 · matched=260

Done. Wrote .../data/officials/municipal_contacts/index.json — 260/260 mayors matched, 0 unmatched.
```

## Step 2 — Spot-check

Cross-check the new entries against the email domains — they should align with the município's name conventions (`kmet@varna.bg`, `obshtina@burgas.bg`, etc.):

```bash
python3 -c "
import json
c = json.load(open('data/officials/municipal_contacts/index.json'))
samples = list(c['contactsByObshtina'].items())[:5]
for code, x in samples:
    print(f'  {code}: {x.get(\"email\")}  (iisda_id={x.get(\"iisda_id\")})')
print(f'total: {len(c[\"contactsByObshtina\"])} municipalities')
"
```

Sanity checks:
- Total ≈ 260 (5 short of 265: Sofia city is one record under SOF00; 4 other gaps mean the iisda ID range needs widening — see "Known limitations").
- BGS04 → `@burgas.bg`, RSE27 → `@ruse-bg.eu`, SOF00 → `@sofia.bg`.

If the unmatched-mayors line shows > 5, the name → obshtina-code join broke. Look at the printed "Unmatched" sample and either widen `MANUAL_ALIASES` in the script or extend the matching heuristics.

## Step 3 — Commit + bucket sync

```bash
git add data/officials/municipal_contacts/index.json
git commit -m "officials: refresh municipal mayor contacts from iisda"
npm run bucket:sync:dry
npm run bucket:sync
```

## Step 4 — Stamp success

```bash
npx tsx scripts/stamp-ingest.ts update-municipal-contacts \
  --summary "260/260 mayors matched · 0 unmatched"
```

Only stamp on the public data-changes log when emails actually changed:

```bash
if [ -n "$(git diff --stat data/officials/municipal_contacts/)" ]; then
  npx tsx scripts/append-data-change.ts update-municipal-contacts \
    --summary "260/260 mayors matched · 0 unmatched" \
    --source "iisda.government.bg — Кметове на общини"
fi
```

## Known limitations

- **iisda only exposes email** — phone, website, postal address, working hours are not on the detail pages (only declaratively in the page text). The tile renders email + tel: link if a phone shows up under a future scrape extension.
- **Sofia city contributes one record** under SOF00; the 24 районы see it via `useMunicipalContacts`' SOF00 fallback.
- The **ID range 4400..4950 is hand-chosen** based on the observed mayor-ID distribution. If iisda re-allocates IDs after a major government re-organisation, widen the range (`ID_RANGE_START` / `ID_RANGE_END` in the script) and re-run with `--force`.

## What this skill does NOT do

- **Does not refresh кметство (village-mayor) contacts.** Sub-municipal village mayors are scraped from CIK local-elections HTML by `update-local-elections` and lifted into `data/local_mayors/`; this skill is only the município-level mayor.
- **Does not touch the кметство → EKATTE lookup.** That's a `update-local-elections` derived step (`scripts/parsers_local/backfill_kmetstvo_ekatte.ts`).
- **Does not stamp the public data-changes log** when only the `scrapedAt` timestamp moved.

## File map

| Path | Purpose |
|---|---|
| `scripts/officials/municipal_contacts/scrape_iisda.ts` | CLI entry — walk iisda IDs, extract emails |
| `raw_data/officials/iisda_mayors/<id>.html` | cached detail-page HTML (skip-on-exist) |
| `data/officials/municipal_contacts/index.json` | output — `contactsByObshtina` map |
| `scripts/watch/sources/iisda_mayors.ts` | watcher — fingerprints pagination count + first-page IDs |
| `src/data/officials/useMunicipalContacts.tsx` | React Query hook with Sofia район → SOF00 fallback |
| `src/screens/myarea/MyAreaContactsTile.tsx` | "Контакти на общината" tile |
