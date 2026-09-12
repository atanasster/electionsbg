# Deferred follow-ups

This is the compact home for work deliberately left outside an otherwise completed
implementation. Entries stay only while they name an unresolved decision, a concrete trigger,
or a bounded next step. Completed implementation histories belong in Git, not here.

## Companies

- Add NKID and founding-date facets to `/companies` only after the UI can distinguish unknown
  coverage from a negative result.
- Consider director-name search as a separate person-to-company query, not as a hidden join in
  the company-name index.
- Do not expose money aggregates in the company browser until the join cardinality has been
  re-measured and guarded.

## Education

- Decide whether school `residual` and `verdict` should become relational columns so AI tools
  can query the same value-added interpretation served in place payloads. The broader education
  roadmap already owns the `maturaByPlace` and `educationGaps` tools.

## Procurement

- Cross-source reconciliation deliberately excludes date-tolerant matches. Revisit only after
  manually checking АПИ procedures `00044-2023-0015` and `00044-2023-0029`; together they
  account for €67.0m of the measured long-tail candidates. A wider rule needs an explicit date
  tolerance and new ambiguity gates.
- Add a cohort-granularity control to procurement normalcy only if readers need to inspect the
  CPV-8/CPV-4/division basis. Consider per-metric cohort widening when a fine cohort falls below
  the minimum sample instead of weakening the shared minimum itself.

## Commerce Registry ownership

- `tr_owner_share` fixes percentages but does not decide whether an owner whose latest row
  predates the current capital-table vintage is still current. Resolve that identity/dedup
  question separately; never restore the old all-non-erased-row denominator.
