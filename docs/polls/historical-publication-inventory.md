# Historical presidential publication inventory

Checked 26 September 2026. Captures retain primary HTML, reports, chart images and SHA-256 source stamps. Capture is not acceptance: content, questions, dates and percentages still require evidence review.

| Agency | 2016 listing | 2021 listing | Capture result |
| --- | --- | --- | --- |
| Trend | 2 publications; 1 electoral | 22 publications; 7 electoral | All electoral releases captured, including existing historical captures |
| Alpha Research | 416 undated archive entries | The same 416-entry archive | 25 selected historical entries captured; the ledger also retains existing captures. Undated entries are not assigned to either year by listing alone |
| Market Links | 8 publications; 5 electoral | 9 publications; 6 electoral | All 11 electoral releases captured; report links now respect the HTML base URL |
| Sova Harris | 3 historical-category entries | 8 entries; 6 electoral | Captured, including original-resolution chart scans. The 2016 pages have migrated 2021 publication timestamps and need original-date evidence |
| Мяра | No entries in date window | No entries in date window | No accepted historical coverage implied |
| Global Metrics | One electoral-keyword match | One non-electoral release | Existing 2016 capture retained; title match does not establish a presidential poll |
| Gallup International Balkan | Listing unavailable | Listing unavailable | Fetch failed; this is an explicit coverage gap |

The durable inventories are `state/polls/inventory-2016-01-01-2016-12-31.json` and `state/polls/inventory-2021-01-01-2021-12-31.json`. `state/polls/backfill-selection.json` records 53 selected publications and selection reasons; it includes some Alpha Research exit-poll and retrospective releases for classification, not acceptance. Agency ledgers record capture versions and processing progress separately from watcher cursors.

Alpha Research's listing has no reliable publication dates. Its complete archive is retained in both inventory windows, with unreviewed entries pending. Selected article IDs and primary content identify historical candidates for review. Counts from these two inventories must not be added together.

Archive traversal now covers all WordPress pages (including a completely full final page), Market Links news pagination, and the full Alpha Research listing. Historical Sova categories follow requested years rather than the current year. Existing URL identities are reconciled across percent-escape casing. Attachments missed by earlier filename rules are recaptured as new versions; earlier evidence is preserved.
