# Municipal contacts ingest

**Status:** scaffolding committed; actual scrape pending.

Adds the most-asked-for piece of information: how a citizen actually
*reaches* their municipality. Phone, email, website, postal address per
município. Was explicitly requested in the brainstorm; deferred from the
initial Phase 2 ship because the source is heterogeneous and a one-off
backfill plus targeted refresh is more honest than pretending we have a
fully-automated daily scrape.

## Source priority

1. **namrb.org** — Национално сдружение на общините. Maintains a
   directory of all 265 municipalities with mayor phone/email and
   community contact details. Should cover ~95% of municipalities in one
   batch.
2. Per-município official websites — backfill for the long tail and for
   council-chair-specific numbers.
3. **gov.bg** regional governor directory — for the oblast layer.

## Planned output

```jsonc
// data/officials/municipal_contacts/index.json
{
  "contactsByObshtina": {
    "BGS01": {
      "phone": "+359 5582 1234",
      "email": "kmet@aytos.bg",
      "website": "https://www.aytos.bg",
      "address": "8500 гр. Айтос, ул. Цар Освободител 3",
      "mayor_office_phone": "+359 5582 1010",
      "council_chair_phone": "+359 5582 1020"
    }
  }
}
```

## Skill + watcher

- New skill: `update-municipal-contacts`. Per the brainstorm decision,
  this is a [one-off-backfill pattern](feedback_one_off_backfills.md) —
  the namrb.org page hash is the only daily watch source; manual
  refresh-on-change is the workflow.
- Watch source: `state/watch/namrb_directory.json`.
- Mapping row in `process-watch-report/SKILL.md`:
  `namrb_directory → update-municipal-contacts`.

## UI integration

The MyAreaContactsTile is shipped and auto-hides while
`contactsByObshtina` is empty. Once the scrape lands, every município
that has an entry surfaces a tel:/mailto:/website set of clickable
buttons.

## Privacy / freshness

Personal numbers belong to public officials in their *official* capacity —
no further sensitivity beyond what namrb.org already publishes. Refresh
should be annual or whenever the watch source flips.
