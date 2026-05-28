---
name: update-municipal-contacts
description: Refresh the per-município mayor + deputy-mayor email contacts (data/officials/municipal_contacts/index.json) by scraping the iisda.government.bg "Кметове на общини" registry. Use when the daily watch report flags `iisda_mayors` as changed, when the user asks to refresh mayor contacts / municipal contacts / kmet emails, after a local-election or chmi cycle when new mayors take office, or after a fresh git clone if data/officials/municipal_contacts/index.json carries an empty `contactsByObshtina`.
allowed-tools:
  - Read
  - Bash
  - Edit
  - Write
---

# Update municipal contacts skill

Refreshes `data/officials/municipal_contacts/index.json` — the per-municipality mayor + deputy-mayor email contacts that power the inline `mailto:` icons next to each official's name on the My-Area dashboard's `MyAreaGovernmentCard`. Covers 258 of Bulgaria's 265 municipalities with at least one official, and ~600 deputy-mayor emails on top of the 260 município mayors. Sofia city contributes once under the synthetic `SOF00` code (with the 12 city-wide deputies) and fans out to the 24 районы via the hook fallback.

Source contract:

| Field | Source | Granularity | Cadence |
|---|---|---|---|
| `email`, `mayor`, `iisda_id`, `officials[]` (role + name + email per person) | [iisda.government.bg `governing_body/<id>` detail pages](https://iisda.government.bg/ras/governing_bodies/gb_municipality_administrations) — IDs in the contiguous block 4400..4950 | per municipality (obshtina code) | shifts on regular & partial local-election cycles, and on individual zам.-кмет appointments/dismissals |

`scripts/officials/municipal_contacts/scrape_iisda.ts` walks the ID range serially with a 200 ms polite delay, caches each detail page to `raw_data/officials/iisda_mayors/<id>.html`, filters for pages whose body contains `Кмет на община` AND `Общинска администрация`, then walks every `<li class="level-1">` block on the page to pull (role label, full name, `mailto:` email) — one row for the mayor plus one per deputy mayor in the "Заместници" section. Each block must carry a `<span class="li-sub-text-name">` and a `mailto:` href to be emitted; iisda's "Степен на разпоредител с бюджет" block doesn't and is skipped. Município name is matched against `data/municipalities.json` with two manual aliases (`Добричка` → `DOB15`, `Столична община` → `SOF00`).

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

Cross-check the new entries against the email domains — they should align with the município's name conventions (`kmet@varna.bg`, `obshtina@burgas.bg`, etc.) — and confirm deputy-mayor coverage:

```bash
python3 -c "
import json
c = json.load(open('data/officials/municipal_contacts/index.json'))['contactsByObshtina']
samples = list(c.items())[:5]
for code, x in samples:
    deputies = len([o for o in x.get('officials', []) if o['role'] == 'deputy_mayor'])
    print(f'  {code}: {x.get(\"email\")}  (iisda_id={x.get(\"iisda_id\")}, deputies={deputies})')
deputy_total = sum(len([o for o in v.get('officials', []) if o['role']=='deputy_mayor']) for v in c.values())
with_officials = sum(1 for v in c.values() if v.get('officials'))
print(f'total: {len(c)} municipalities · {with_officials} with officials[] · {deputy_total} deputy-mayor emails')
"
```

Sanity checks:
- Total municipalities ≈ 260 (5 short of 265: Sofia city is one record under SOF00; 4 other gaps mean the iisda ID range needs widening — see "Known limitations").
- Deputy-mayor emails ≈ 600 (cycle average; varies with chmi appointments).
- BGS04 → `@burgas.bg`, RSE27 → `@ruse-bg.eu`, SOF00 → `@sofia.bg` with 12 deputies.

If the unmatched-mayors line shows > 5, the name → obshtina-code join broke. Look at the printed "Unmatched" sample and either widen `MANUAL_ALIASES` in the script or extend the matching heuristics. If the deputy-mayor count drops sharply (< 400), the `extractPeople()` per-block parse likely broke — re-check the iisda HTML for layout changes in the `<li class="level-1">` blocks.

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
  --summary "260/260 mayors matched · 0 unmatched · ~600 deputy-mayor emails"
```

Only stamp on the public data-changes log when emails actually changed:

```bash
if [ -n "$(git diff --stat data/officials/municipal_contacts/)" ]; then
  npx tsx scripts/append-data-change.ts update-municipal-contacts \
    --summary "260/260 mayors matched · 0 unmatched · ~600 deputy-mayor emails" \
    --source "iisda.government.bg — Кметове на общини"
fi
```

## Known limitations

- **iisda only exposes email** — phone, website, postal address, working hours are not on the detail pages (only declaratively in the page text). Email is the only channel we surface today.
- **Mayor + deputy mayors only.** Council chairs, council members, chief architects, and кмет на кметство (village mayors) are NOT in iisda's executive registry — they live in CACBG declarations (the `update-officials` municipal slice) and in CIK local-elections HTML. The hook returns `undefined` for those names; the icon silently omits.
- **Sofia city contributes one record** under SOF00 with the city-wide mayor + 12 deputies; the 24 районы see it via `useMunicipalContacts`' SOF00 fallback. Each Sofia район has its own iisda detail page in the "Кметове на райони" section (different ID block) which is NOT scraped today — extending to that block would surface per-район mayor + deputy emails.
- **Name match is tolerant but not perfect.** The hook tries an exact normalized full-name match, then falls back to a first-three-tokens hyphen-stripped stem (so iisda's "Дончева-Терзийска" matches the CACBG roster's "Дончева"). Other transliteration mismatches still drop through silently.
- The **ID range 4400..4950 is hand-chosen** based on the observed mayor-ID distribution. If iisda re-allocates IDs after a major government re-organisation, widen the range (`ID_RANGE_START` / `ID_RANGE_END` in the script) and re-run with `--force`.

## What this skill does NOT do

- **Does not refresh кметство (village-mayor) contacts.** Sub-municipal village mayors are scraped from CIK local-elections HTML by `update-local-elections` and lifted into `data/local_mayors/`; this skill is only the município-level mayor + deputies.
- **Does not touch the кметство → EKATTE lookup.** That's a `update-local-elections` derived step (`scripts/parsers_local/backfill_kmetstvo_ekatte.ts`).
- **Does not scrape "Кметове на райони".** Sofia/Varna/Plovdiv районы have their own iisda detail-page block (not in the 4400..4950 mayor range); folding it in would extend `MunicipalityInfo` join logic + add a second ID-range scan.
- **Does not stamp the public data-changes log** when only the `scrapedAt` timestamp moved.

## File map

| Path | Purpose |
|---|---|
| `scripts/officials/municipal_contacts/scrape_iisda.ts` | CLI entry — walk iisda IDs, extract mayor + deputy-mayor emails via per-`<li class="level-1">` block parser |
| `raw_data/officials/iisda_mayors/<id>.html` | cached detail-page HTML (skip-on-exist) |
| `data/officials/municipal_contacts/index.json` | output — `contactsByObshtina` map with `{email, mayor, iisda_id, officials[]}` per município |
| `scripts/watch/sources/iisda_mayors.ts` | watcher — fingerprints pagination count + first-page IDs |
| `src/data/officials/useMunicipalContacts.tsx` | React Query hook with Sofia район → SOF00 fallback + `emailForName()` lookup (exact + hyphen-stem fallback) |
| `src/screens/myarea/MyAreaGovernmentCard.tsx` | renders inline `Mail` icon (`mailto:` link) next to each official's name — mayor, council chair (if matched), deputy mayors, chief architect |
