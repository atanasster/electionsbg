# Presidential polls release verification

Date: 2026-09-26. Implementation: [progress and commit ledger](../plans/presidential-polls-implementation.md).

## Data scope

The reviewed corpus contains 14 surveys, 118 candidate-answer rows, four hypothetical runoff observations and three participation questions. The historical reconciliation covers 62 publications. Source methods, bases, publication-date gaps and corrections are retained. No complete agency accuracy grade is justified by the accepted evidence; eligible partial candidate comparisons remain visible.

Publish `data/polls/presidential/`: polls, details, runoffs, candidates, accuracy and coverage. The scoped bucket dry run listed exactly these six JSON files. Live verification also exposed an older agency registry; `data/polls/agencies.json` was published as a required dependency, adding five already committed agencies (including GM) without changing the existing nine entries. Raw captures, drafts and operator ledgers remain local/repository evidence.

## Browser gate

`tests/presidential-polls.ui.spec.ts` exercises the production build against local reviewed data through request interception. It runs in the repository's desktop and Pixel 7 projects:

- Bulgarian and English direct loads of the presidential-only Global Metrics agency, with separate question blocks.
- Light and dark themes, responsive page width and screenshots.
- Sova Harris chart-point/table agreement, persistent cycle/candidate/round URL filters, keyboard focus, CSV and JSON downloads with provenance.
- 2016 round-two observations and 2001's explicit coverage gap.
- A failed artifact request and successful user-triggered retry.

Accessibility repairs use existing theme tokens for points and tick labels, add the agency section heading, and give native filters explicit names matching visible labels.

## Release sequence

After the final commit and unit suite: upload the six accepted JSON artifacts, deploy hosting, refresh the db function's cached SPA shell, then redeploy the same hosting artifact to purge stale edge entries. This follows CLAUDE.md's required three-step application release order. Verify live BG/EN agency routes, election polling sections and all six data artifacts.

## Status

Published and verified on 2026-09-26. Both hosting releases and the db function refresh succeeded. All six presidential artifacts match the accepted local JSON. Normal browser requests now receive the updated fourteen-agency registry. Live BG/EN GM pages, SH 2021 history and the 2016 second-round view passed with no runtime errors. Static and function-served pages point at the same current entry bundle.

Final confirmation: 24,154 unit/component tests passed; six pre-existing failures and 41 skips are recorded in [the test report](presidential-final-test-results.md). All ten desktop/mobile browser checks passed. [The implementation tracker](../plans/presidential-polls-implementation.md) contains the scoped commits and repair history.
