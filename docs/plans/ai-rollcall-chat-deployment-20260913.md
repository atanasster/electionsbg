# Roll-call chat production deployment — 2026-09-13

Deployed the implementation through `c05cea6030` and the live-test correction `c704507e21` to https://naiasno.bg/chat. Final backend revision: `db-00151-dug`. Main entry asset: `/assets/index-CaVTiQ42.js`.

## Release operations

- Confirmed successful Cloud SQL backup `1789171200000` and the existing production proxy.
- Installed additive migration 199 and its catalog metadata using `installRollcallQuery()`. Verified app_readonly SELECT privileges for all 13 revision-tracked sources. The production administrator cannot SET ROLE app_readonly; verification used explicit privilege checks and actual serving API requests instead. No role memberships were changed.
- Deployed the DB function before the new main hosting release. Updated the standalone recovery/chat bundle as well.
- Full main hosting predeploy gates passed: lint, budget tests, AI regressions, AI harness, production build, prerender and production article checks.
- After the live-test fix, reran focused tests (17 passed), AI type checks, scoped lint and both production builds. Published the corrected hosting build, refreshed the DB function, then published the same hosting tree again to purge the edge.
- Confirmed `/`, `/chat`, and `/person/mp-3643` all serve the same main asset hash. All four roll-call API endpoints return HTTP 200 and `Cache-Control: no-store` for valid requests.

## Browser verification

On the final **main live site**, in deterministic mode:

- Original sessions prompt → 49 NS52 indexed sittings, latest 2026-09-11.
- Original parliamentary-votes prompt → 1,396 records with the source coverage notice.
- Rashkov latest ten votes → ten named source casts; the 2025 follow-up retains the person and latest-ten limit with 2025-01-01 ≤ date < 2026-01-01.
- Budget topic, 04/2025 through 01/2026 → 42 records, 2025-04-01 ≤ date < 2026-02-01, partial title coverage disclosed.
- Русе council resolutions → 426 records; against-vote follow-up explicitly reports that named rolls are not published.
- Common name Иван Иванов → asks for full name or a particular parliament, without an empty chooser.
- Exact-scope result link → query page with official parliament PDF source links.
- Council coverage query page → six second-page bodies, ten distinct first-page bodies, correct previous/next button states. Хасково displays only 2022.
- CSV downloaded and inspected: visible Bulgarian column labels, six second-page records, year-only Хасково dates, scope/revision metadata, no raw internal row keys.

Additional browser checks on the published **standalone recovery/chat bundle**: edited council starter accepts Русе and submits the rendered question; coverage follow-up pages ten plus six distinct bodies; English sessions prompt returns 49 sittings and the latest date. These share the production data backend but are distinguished from main-site checks here.

Production API checks also confirmed all six corpora ready, verified Rashkov identity across NS48–52, missing council named-roll status, and HTTP 409 stale-revision rejection.

## Issue found and repaired

The resolver deliberately returns no candidates for a name matching more than 100 seats. The frontend opened an empty chooser. Commit `c704507e21` adds bilingual refinement/no-match messages, avoids empty dialogs, and does not let an empty candidate array hide council source-row choices. Tests assert no broad query is executed. The initial main upload was interrupted before release; the corrected behavior was retested on both published surfaces.

## Limit of AI-mode verification

The published AI mode reported an allowance limit. Structured roll-call answers still worked with AI selected, but were labelled as deterministic answers. No successful model-generated narration is claimed; testing did not alter quotas or bypass verification controls.
