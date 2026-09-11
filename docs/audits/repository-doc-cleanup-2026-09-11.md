# Repository documentation cleanup — 2026-09-11

## Executive summary

The repository contained 213 top-level plan files and 524 tracked Markdown files before this
pass. Most completed plans are not automatically stale: schema comments, data gates and
`CLAUDE.md` still cite many of them for measured rationale, deploy ordering or recovery rules.
This cleanup therefore removed only six self-contained records whose durable value is already
represented by current code, tests, generated evidence or canonical guidance.

No application code, data corpus or generated reference image was changed.

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

## Retention rule used

A completed plan was retained when any of these applied:

- source, schema or test comments cite it;
- it contains a deploy/recovery procedure not fully represented elsewhere;
- it records a data interpretation or safety constraint whose rationale matters;
- it contains named open or deferred work;
- it is the only record of a failed feasibility investigation that prevents repeating costly work.

The high-value cleanup still available is editorial consolidation of `CLAUDE.md` itself. At 4,881
lines it repeats historical incidents alongside current operating rules, but changing that guide
is higher risk than deleting uncited completion records and should be handled as a separate,
section-by-section extraction into focused runbooks.

Many retained historical plans also use repository-root paths or `path:line` targets in Markdown
links. Those are readable as source references but are not uniformly renderer-valid; they were
not mass-rewritten because doing so would create a large, low-value churn across historical
records.
