# Presidential polling final test results

Date: 2026-09-26.

The first full suite ran 24,195 tests: 24,142 passed, 13 failed and 40 skipped (1,531 files; 313 seconds). The failures introduced by this implementation were repaired at their causes:

- Step 11: explicit table row-header alignment; loading/error integration assertions; localized headings in all 28 agency prerender pages.
- Steps 7/9: the corpus ID gate now recognizes the exact `-presidential` suffix used to separate races from a joint publication, while retaining agency/date validation and zero legacy-date drift.
- Steps 9/10: test fixture-presence declarations cover the committed capture/corpus paths.

Targeted verification: 37 election/alignment tests and 92 ingestion/accuracy/corpus/fixture tests passed. Independent reviews found no remaining issues.

## Existing failures outside this task

These six failures were reproduced separately (137 other tests in those files passed). Their relevant data, tests and assertions were not changed by the presidential implementation:

| Test | Observed mismatch |
| --- | --- |
| `scripts/db/tests/budget_municipal.data.test.ts` | Stalled municipal projects: 657; pinned expectation: 700. |
| `scripts/db/tests/person_identity_stability.data.test.ts` | Active persons: 135,009; baseline: 134,502 with tolerance 500. |
| `scripts/funds/interreg/ingest.test.ts` | Operation count: 1,970; pinned expectation: 1,959. |
| `scripts/data_map/model.test.ts` | Tour copy differs from three current overlap counts (procurement, funds, officials). |
| `scripts/sitemap/families.data.test.ts` | Existing person/product manifests are newer than `sitemap_static_2.xml`. |
| `scripts/prerender/ogAndSitemapCoverage.test.ts` | Three existing funds procedure routes are absent from the committed sitemap: BG-RRP-4.039, BG-RRP-4.040, BG05SFPR001-3.003. |

These failures remain visible. No test was skipped, removed or widened to hide them. Polling sitemap additions are scoped to the polling family; unrelated generated sitemap churn was restored.

The final confirmation run and publication outcome are recorded in the implementation tracker.
