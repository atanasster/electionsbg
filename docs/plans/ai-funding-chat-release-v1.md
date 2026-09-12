# Funding chat release record

Implementation: all nine steps completed and verified locally, 2026-09-12. Production deployment and representative UI checks subsequently completed on the same date; see the [deployed verification record](ai-funding-chat-deployed-ui-v1.md) for release gates, repairs, results and limits. Scoped AI-mode checks used the deterministic data path; no live model-generation test is claimed.

## Delivered behavior

Four independently scoped populations: ISUN projects, DFZ annual beneficiary/scheme records, Interreg operations, and Interreg partnerships. Canonical queries carry period, operation, programme/scheme, entity, theme/institutional sector, geography, money basis, bounds, supported predicates, denominator and revisions through deterministic providers, chat, follow-ups, result URLs and capped CSV exports.

Twenty-four starter definitions include an input-driven EIK/year/scheme question; the unsupported ISUN signing-date starter remains hidden. Sixteen bilingual follow-up intents either preserve a compatible scope or require an explicit clarification. Interreg parent hops and beneficiary-to-procurement relationships select the entire supported parent cohort, not its displayed page. The latter is labeled EIK co-presence, not proof of project financing. Open-call handoff explicitly explains that an award period is not a current opportunity period; topic/place remain context, not verified eligibility, and Interreg calls are not covered.

## Source boundaries

- ISUN has no verified signing/payment-event dates in the serving data or cached exports. First observation is explicitly labeled ingestion observation. Paid values are current cumulative amounts.
- DFZ years are financial reporting years. Missing years are unavailable, not zero; month or calendar-year scopes are not approximated. The default recipient population excludes the DFZ payer EIK, consistently across metrics.
- Interreg operation and partnership identities and budgets are separate. Missing published budgets are not zero; schedule overlap is not proof of historical administrative status. Whole-project inclusion is not geographic allocation.
- Signal evidence is current unless explicitly sourced otherwise. A debarred-name overlap is not verified legal identity; political-link unknowns are not negatives. Procurement-only risks cannot be applied to grants.
- Grouped/compared funding parents that cannot preserve membership exactly are rejected for procurement hops; there is no first-page EIK fallback.

## Verification

- Affected application, parser, provider, contract, source-parser and UI regression suite: **3,046 tests passed across 73 files**.
- Backend routing, compiler and rollback suite: **65 tests passed**.
- PostgreSQL suite: **8 tests passed across 5 files**, without skips. Transactional fixtures cover independent arithmetic, identity, date boundaries, three-valued predicates, parent cohorts and revision rollback; populated smoke tests execute as local `app_readonly`.
- TypeScript checks for the main app and AI app, scoped lint, generated-validator checks, and both production builds passed. Vite retains existing chunk-size/font warnings.
- Local migration 198 was reapplied to install the debarred-source revision trigger. No source refresh or cloud mutation was needed.

The final independent review identified two issues (starter capability prerequisites and overstated acceptance evidence); both were verified and repaired. Release stabilization also corrected ratio evidence labels, isolated per-source name lookups, preserved legacy discovery routing, and repaired mounted-chat test typing.

The [100-case ledger](ai-funding-chat-acceptance-v1.md) links each requirement to its evidence and calls out conditional/manual boundaries. The [performance record](ai-funding-chat-performance-v1.json) records sample counts, local environment and revisions.

The final isolated benchmark exercised 11 query shapes with six samples each, plus custom/generic prepared plans and a two-query concurrent run. All final warm p95 samples were below two seconds (largest: DFZ scheme ranking, 1,743 ms). Earlier local samples exceeded the target, so this is measured evidence rather than a latency guarantee. The optimized ISUN health filter measured 1,401 ms warm p95, versus approximately 6,200 ms before restricting theme matching to requested themes.

An initial simultaneous build + benchmark + database-suite run hit the 20-second DFZ timeout. The isolated DFZ fixture passed afterward. Performance measurements must therefore be read as local measurements on a shared developer machine, not a production latency guarantee.

## Rollout and rollback procedure

1. Apply migration 198 and publish the funding catalog/observation projections atomically using the existing local-tested loader hooks; verify the exact source revision and app_readonly grants on the target environment.
2. Deploy the compatible generated validators and funding endpoints before enabling capability-gated UI templates. Old/future encodings fail closed.
3. Smoke-test representative corpus queries, one supported parent hop, retry, page revision change and page export on the deployed role. Run a small explicitly authorized live-provider smoke separately if desired; CI provider tests use deterministic fakes.
4. Roll back analytics using `FUNDING_QUERY_DISABLED=1`. Capability descriptors become not-ready and scoped queries stay unavailable; filters must not fall through to broad legacy summaries. Keep additive schema tables in place. Re-enable only after source/capability checks pass.

Manual rollout checks: production permissions/migrations, live-provider connectivity, keyboard and screen-reader smoke on the deployed app. Local component tests verify semantic controls and lifecycle; they do not claim an assistive-technology audit.

## Step commits

0 `d5b917f0fa`; 1 `33813965dd`; 2 `a3903addb5`; 3 `2bae9b10eb`; 4 `131bf8f085`; 5 `ee69f6a0e4`; 6 `a73eaee987`; 7 `0e07033eab`. Step 8 is this release verification commit.
