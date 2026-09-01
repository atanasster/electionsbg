// `isSharedNameIdentity` — the ONE reading of "the registry says several people share this
// name". Its own module, so the search adapters and the profile share one answer.
//
// A dropdown row that omits this caveat makes a stronger claim about a named person than the
// profile it links to, so the predicate has to be shared rather than re-decided. It lived in
// `usePersonProfile.ts`, a ~500-line module of profile types and hooks; importing it from
// there for one pure boolean pulls all of that into every consumer's graph.
//
// ⚠️ THE COST IS SMALLER THAN IT LOOKS, AND THE FIRST DRAFT OVERSTATED IT — worth recording
// so nobody cites this as precedent for a split that is not worth making.
// `usePersonProfile.ts` imports only `react`, not React Query, and `src/entryGraph.test.ts`
// guards the SECTOR REGISTRIES specifically, so it would not have caught this import either
// way. The split is right on tree-shaking and clarity grounds; it is not a gate fix.
// `usePersonProfile.ts` re-exports it, so every existing consumer is untouched.
//
//   npm run test:unit -- src/screens/person/sharedNameIdentity.test.ts

/** Does the registry itself say several people share this person's name?
 *
 *  Reads BOTH signals and returns true if EITHER says so, because they are written by
 *  different steps of the same resolve: `fold_people_n` is copied onto every person, while
 *  `identity_confidence = 'shared_name'` is set only on the Tier-V mint. A resolver that
 *  populated one and dropped the other — the `copyRows` / `date_basis` failure class this
 *  repo has shipped before — would otherwise leave the profile card and the browser chip
 *  making different claims about one named person, which tr-attribution-basis-v1 §0.2 calls
 *  the worst bug this family can carry.
 *
 *  Fail-safe by construction: disagreement produces the caveat, never its absence. */
export const isSharedNameIdentity = (p: {
  foldPeopleN?: number | null;
  identityConfidence?: string;
}): boolean =>
  p.identityConfidence === "shared_name" || (p.foldPeopleN ?? 0) > 1;
