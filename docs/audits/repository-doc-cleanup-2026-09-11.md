# Repository documentation cleanup — 2026-09-11–12

## Executive summary

The repository contained 213 top-level plan files and 524 tracked Markdown files before this
cleanup. The first pass removed six plainly superseded records. A second pass adopted a stricter
rule: a backlink from code or a test does not justify retaining a completed implementation plan.
Durable rules now live beside the implementation, in `CLAUDE.md`, or in the owning skill; work
that genuinely remains is consolidated in `docs/deferred-followups.md`.

Across both passes, 24 completed plan files were removed, leaving 189. No application behavior,
data corpus or generated reference image was changed.

## Removed records

- `ai-evals-2026-09-10.md` — superseded by the v2 report and immutable raw/current evaluation
  artifacts under `data/ai/evals/`.
- `ai-tools-workspace-v1.md` — implementation is complete; the capability ledger, dated inventory
  and `docs/audits/tools-workspace-2026-09-10/verification.md` retain the live contract and evidence.
- `home-dashboard-baseline-2026-09-01.md` — a pre-cutover measurement record with no remaining
  consumer; current performance gates are authoritative.
- `mayor-pay-dashboard-polish-v1.md` — all tiers and acceptance checks are complete and encoded in
  the screen, navigation and focused tests.
- `news-story-card-ux-v3.md` — the responsive/accessibility contract is enforced by
  `tests/news/story-cards.spec.ts`; its reference captures remain because that test reads them.
- `council-resolution-count-v1.md` — the repair shipped; the durable-tree counting rule, rebuild
  command, attribution constraints and remaining ledger behavior are documented in `CLAUDE.md`
  and guarded by the council corpus tests.

All removed files remain recoverable from Git history.

## Second pass — completed implementation plans retired

The following 18 records described shipped work. Their current contracts are enforced by the
implementation and focused tests, so retaining thousands of lines of build sequencing made the
repository harder to navigate without improving operability:

- Data and database gates: `awarder-seats-freshness-gate-v1.md`,
  `db-refresh-loader-gaps-v1.md`, `db-route-timeouts-v1.md`,
  `grant-role-guard-sweep-v1.md`, and `kzk-gate-d-ambiguity-v1.md`.
- Person, company and education surfaces: `company-browse-dashboard-v1.md`,
  `declaration-filed-position-serving-v1.md`, `education-place-card-v1.md`,
  `person-candidate-merge-v1.md`, `person-connection-second-degree-v1.md`,
  `person-connections-scan-v1.md`, and `tr-owner-share-v1.md`.
- Product and procurement surfaces: `home-kpi-destination-continuity-v1.md`,
  `hub-search-v1.md`, `products-browse-registry-v1.md`,
  `procurement-cross-source-dedup-v2.md`, `procurement-dashboard-redesign-v1.md`, and
  `procurement-normalcy-v1.md`.

The still-actionable company, education, procurement and ownership questions were extracted into
`docs/deferred-followups.md`. Historical source comments were shortened to state the invariant
locally, and operational backlinks in `CLAUDE.md` and the update skills were replaced with current
commands, helpers and tests.

## Restored canonical documentation and repaired stale references

- Restored the deleted root `METHODOLOGY.md`. It is a licensed public index, is linked from
  `README.md` and `CONTRIBUTING.md`, and is enforced by
  `scripts/licensing/methodology_index.test.ts`; it was not a stale plan.
- Replaced two links to the deleted competitive-review snapshot with the condensed comparison
  retained in `cross-linking-strategy-v2.md`.
- Removed stale dependencies on the deleted root `CODE_REVIEW_REPORT.md` from the active account
  plans and corrected an obsolete claim that the artifact still lived at the repository root;
  the relevant account findings were already incorporated into the architecture specification.
- Repaired three unrelated broken links found during the audit: a deliberately retired video
  plan, the municipal-contact skill runbook, and the Smetna Palata scripts directory.
- Clarified in `CONTRIBUTING.md` that `docs/plans/` contains both open PRDs and deliberately kept
  dated design records.

## Retention rule used after consolidation

A completed plan is not retained merely because another file cites it. Move the useful part to
its durable owner, remove the backlink, then retire the plan. A record remains under `docs/plans/`
only when at least one of these applies:

- implementation or publication is incomplete;
- it is an active research/design decision awaiting execution;
- it contains a deploy/recovery procedure that cannot yet move into an owning runbook;
- it is the only record of a failed feasibility investigation that prevents repeating costly work.

The high-value cleanup still available is broader editorial consolidation of `CLAUDE.md` itself.
At 4,881 lines before this pass it mixes historical incidents with current operating rules;
rewriting whole sections remains higher risk than removing obsolete backlinks and should be
handled section by section into focused runbooks.

Many retained historical plans also use repository-root paths or `path:line` targets in Markdown
links. Those are readable as source references but are not uniformly renderer-valid; they were
not mass-rewritten because doing so would create a large, low-value churn across historical
records.
