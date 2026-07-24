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

- Members of Parliament — **sitting and former**;
- Ministers and deputy ministers (including the Prime Minister and caretaker cabinets);
- Municipal **mayors**, including **кметове на кметства** (village mayors) where the
  register carries them — they are directly elected and control real local budgets, so the
  public-interest case holds. Deputy mayors, councillors and chief architects are **not**
  in scope;
- Magistrates.

Everyone else — the ~4,700 municipal councillors and the long tail of lower officials — is
**excluded**. The metric is not computed for them and the page must not render a gap for a
person outside the cohort. The cohort is enforced in code by
`person_is_accountability_senior()` / the `accountability_senior` view
(`scripts/db/schema/pg/091_accountability_gate.sql`), so "who this may be shown for" is a
single source of truth, not a per-feature judgement.

The reason for the cut is proportionality: publishing a declared-vs-audited discrepancy is
defensible for the holders of directly-elected or senior appointed office, where the
public-interest weight is greatest and the person has the platform to answer; it is not
defensible to attach an "unexplained enrichment" number to a first-term local councillor
or an appointed administrator.

Two boundary calls, decided explicitly rather than left to the code:

- **Former MPs are in scope.** A person who has sat in any National Assembly stays in the
  cohort; the metric is about the office they held when the wealth was declared, not about
  whether they hold it today. (In the current corpus the `mp` role already spans every
  parliament, so this is belt-and-braces rather than a widening — but the predicate now
  says so explicitly instead of depending on that.)
- **Кметове на кметства are in scope** — a village mayor is an elected executive with a
  budget, not a member of a deliberative body, so the councillor exclusion does not reach
  them. This is a forward-looking rule today: the Court-of-Audit register's only mayor
  category covers общини and райони, so no кметство mayor currently appears in the cohort.
  Кметски наместници are **appointed**, not elected, and are therefore **out** of scope —
  the same reasoning that excludes appointed administrators above.

## How it is computed

- **Δ net worth** — the difference in declared net worth between the first and last
  filing. Net worth is every non-debt asset category minus the debt category, at the
  locked euro peg, exactly as the rest of the site computes it
  (`src/lib/declarations.ts` → `declarationTotals`).
- **Declared income** — the declarant's own declared income (table 12 / 13) summed over
  **(fromYear, toYear]** — strictly *after* the opening snapshot, because only income
  earned after it could have produced the change. Including the opening year's income
  overstates income and understates the gap by 20-33%. Spouse income is stated
  separately, never silently folded in.
- **The gap** — Δ net worth minus declared income. A positive gap is *not* an accusation:
  it is the part of the wealth change the declared income does not by itself account for.

### When it is withheld entirely

The figure is **not computed** — the page renders nothing — unless all of these hold:

- The person is in the cohort above.
- They filed in **every year of the span**. 336 of 815 otherwise-eligible people have
  gaps in their filing history; comparing a ten-year wealth change against four years of
  income manufactures a difference that does not exist. Under-inclusive by design.
- The declarations carry **non-zero income** for the span. A zero total is a data absence,
  not a finding about a person — 62 people would otherwise have had their entire wealth
  change published as "unaccounted for".

## The caveats that must travel with every figure

These are not optional footnotes; they are part of the claim.

1. **Declared, not audited.** Every number is what the person filed with the Court of
   Audit. The site has not verified it and does not assert it is complete or correct.
2. **The unvalued-real-estate denominator.** Real estate with no declared price counts as
   €0 in net worth. A gap computed over a portfolio that contains unvalued property is
   understated or overstated in ways the declaration does not let us resolve. The count is
   shown alongside any gap, and the gap is explicitly labelled imprecise when it is > 0.
   Two details matter: "unvalued" means a price of **NULL or zero** (the €0-priced rows,
   26,347, outnumber the NULLs, 16,172 — counting only NULLs suppressed this caveat for
   268 people), and the count is taken on the **closing filing only**, because summing
   every row a person ever filed restates the same property once per year.
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

A named person may dispute or contextualise the figure. This methodology and the
right-of-reply contact are published at **`/about#accumulation-gap`**, linked from every
rendered figure; a substantiated correction (a documented source the declaration omitted)
is published alongside the figure itself.

## Family data

Separately decided (2026-07-24): declared spouse/family data is treated at **full parity**
with the declarant's own — it is queryable and searchable like the declarant's, because it
is part of the same public register filing. It is always attributed (whose asset it is,
via `is_spouse` / holder name), never presented as the declarant's personal holding.
