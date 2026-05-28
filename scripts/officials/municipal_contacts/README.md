# Municipal contacts ingest

**Status:** shipped — covers mayor + deputy-mayor emails from iisda.

How a citizen actually *reaches* their municipality. Was explicitly
requested in the brainstorm; namrb.org turned out to be paywalled, so
we settled on iisda.government.bg's Административен регистър — which
publishes mayor + deputy-mayor emails for every município.

## Source

`iisda.government.bg/ras/governing_bodies/gb_municipality_administrations`
— Административен регистър. Each município's "Кмет на община" detail
page (ID block 4400..4950) carries one `<li class="level-1">` block
for the mayor and one block per "Заместник-кмет" in the "Заместници"
section, each with a `<span class="li-sub-text-name">` and a `mailto:`
link.

Phone, website, postal address, working hours, council-chair
contacts: **not on iisda**. Out of scope for now — would require
per-município websites or НСОРБ's directory.

## Output

```jsonc
// data/officials/municipal_contacts/index.json
{
  "contactsByObshtina": {
    "BLG01": {
      "email": "s.banenski@bansko.bg",                  // mayor's email — back-compat
      "mayor": "Стойчо Методиев Баненски",              // mayor's name (iisda spelling)
      "iisda_id": 4400,
      "officials": [
        {
          "role": "mayor",
          "roleRaw": "Кмет на община",
          "name": "Стойчо Методиев Баненски",
          "email": "s.banenski@bansko.bg"
        },
        {
          "role": "deputy_mayor",
          "roleRaw": "Заместник-кмет",
          "name": "Георги Венциславов Доневичин",
          "email": "g.donevichin@bansko.bg"
        }
        // ... one entry per Заместник-кмет
      ]
    }
  }
}
```

Cycle stats: ~259 municípios with an entry · ~600 deputy-mayor emails
across the country · Sofia's SOF00 entry holds the city-wide mayor +
12 deputies and fans out to the 24 районы via the
`useMunicipalContacts` SOF00 fallback.

## Skill + watcher

- Skill: `update-municipal-contacts` —
  [one-off-backfill pattern](feedback_one_off_backfills.md). The
  iisda mayor-list pagination count is the daily watch signal;
  refresh-on-change is the workflow.
- Watch source: `state/watch/iisda_mayors.json`.
- Mapping row in `process-watch-report/SKILL.md`:
  `iisda_mayors → update-municipal-contacts`.

## UI integration

Emails render as a small `Mail` icon (`mailto:` + tooltip) inline next
to each official's name on
[`src/screens/myarea/MyAreaGovernmentCard.tsx`](../../../src/screens/myarea/MyAreaGovernmentCard.tsx)
— mayor row, council chair (if matched), each deputy mayor and chief
architect in the expanded roster. There is no separate "Контакти на
общината" tile anymore.

Name matching: the hook tries an exact normalized full-name match
first, then a hyphen-stripped first-three-tokens stem (so the iisda
"Дончева-Терзийска" entry matches a CACBG roster "Дончева" without
hard-coding a per-município override).

## Privacy / freshness

Personal emails of public officials in their *official* capacity —
already published on a government register, no additional sensitivity.
Refresh whenever the iisda watch source flips (typically a chmi cycle
or a single zам.-кмет appointment); a forced full re-scrape after a
regular-local cycle takes ~2 minutes.
