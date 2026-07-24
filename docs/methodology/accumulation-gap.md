# Accumulation gap — methodology & editorial gate

This is the published methodology for the **accumulation gap** metric: the difference
between the change in a public figure's declared net worth over a period and the income
they declared over the same period. It is the discrepancy that the Anti-Corruption
Commission (КПКОНПИ) is statutorily meant to examine, and which is otherwise not
published anywhere in an accessible form.

Because the metric names individuals, it carries the same class of risk as the sanctions
and State-Security (ДС) facets, and it is governed by the same discipline. This page is the
gate — the feature must not ship in a form that contradicts it.

## Who it is computed for

Only a defined **senior accountability cohort**, decided by the site's editor
(2026-07-24):

- Members of Parliament;
- Ministers and deputy ministers (including the Prime Minister and caretaker cabinets);
- Municipal **mayors** — not deputy mayors, not councillors, not chief architects;
- Magistrates.

Everyone else — the ~4,700 municipal councillors and the long tail of lower officials — is
**excluded**. The metric is not computed for them and the page must not render a gap for a
person outside the cohort. The cohort is enforced in code by
`person_is_accountability_senior()` / the `accountability_senior` view
(`scripts/db/schema/pg/091_accountability_gate.sql`), so "who this may be shown for" is a
single source of truth, not a per-feature judgement.

The reason for the cut is proportionality: publishing a declared-vs-audited discrepancy is
defensible for the holders of the highest public office, where the public-interest weight
is greatest and the person has the platform to answer; it is not defensible to attach an
"unexplained enrichment" number to a first-term local councillor.

## How it is computed

- **Δ net worth** — the difference in declared net worth between the earlier and later
  filing. Net worth is every non-debt asset category minus the debt category, at the
  locked euro peg, exactly as the rest of the site computes it
  (`src/lib/declarations.ts` → `declarationTotals`).
- **Declared income** — the sum of the declarant's own declared income over the years
  spanned (table 12 / 13). Spouse income is stated separately, never silently folded in.
- **The gap** — Δ net worth minus declared income. A positive gap is *not* an accusation:
  it is the part of the wealth change the declared income does not by itself account for.

## The caveats that must travel with every figure

These are not optional footnotes; they are part of the claim.

1. **Declared, not audited.** Every number is what the person filed with the Court of
   Audit. The site has not verified it and does not assert it is complete or correct.
2. **The unvalued-real-estate denominator.** Real estate with no declared price counts as
   €0 in net worth. A gap computed over a portfolio that contains unvalued property is
   understated or overstated in ways the declaration does not let us resolve. The count of
   unvalued real-estate rows (`realEstateUnvalued`, already tracked) must be shown
   alongside any gap, and a gap must not be presented as precise when that count is > 0.
3. **Legitimate sources the declaration does not carry.** Inheritance, gifts, restitution,
   the sale of a previously-owned asset, a spouse's business income, loans repaid — all can
   move net worth without appearing as "income". The gap does not distinguish these from
   anything else, and the language must say so.

## Language

Descriptive, never accusatory. The page states what the declarations show and what they do
not; it does not conclude that a person enriched themselves illicitly, was corrupt, or hid
income. "The declared income over this period does not by itself account for €X of the
increase" — not "€X of unexplained/hidden wealth".

## Right of reply

A named person may dispute or contextualise the figure. The page carries a correction /
right-of-reply contact, and a substantiated correction (a documented source the
declaration omitted) is published alongside the figure.

## Family data

Separately decided (2026-07-24): declared spouse/family data is treated at **full parity**
with the declarant's own — it is queryable and searchable like the declarant's, because it
is part of the same public register filing. It is always attributed (whose asset it is,
via `is_spouse` / holder name), never presented as the declarant's personal holding.
