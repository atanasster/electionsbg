// Whether the /budget hub's national municipal-commitments line has something true to say.
//
// A PURE predicate, in its own module because the two ways this goes wrong are both
// „renders when it should not": a database that never ran migration 149 (`mc` is null), and
// a quarter where МФ froze the column and the ingest withheld it (`commitmentsEur` is null
// while every other column filed). Both must yield NO LINE — „€0 поети ангажименти" is the
// healthiest figure in the country and completely false. Gating the JSX alone left the
// property untestable through the rendered tree.

export const showsMunicipalCommitments = (
  mc: { commitmentsEur?: number | null } | null | undefined,
): boolean => mc != null && mc.commitmentsEur != null;
