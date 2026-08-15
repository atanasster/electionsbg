// The basis a person↔company link rests on, and the one predicate that reads it.
//
// Lives beside `LinkBasisMark` rather than inside it so the rule stays importable from a
// module that renders nothing — the mark is the UI, this is the decision, and every surface
// that shows a company beside a named person must reach the same one. Two rules with two
// answers is the drift tr-attribution-basis-v1 §0.2 calls the worst defect this family can
// carry, and it was already live once.
//
// The server decides the basis, not the client — `linkBasis` comes from
// `person_company_bridge_a` (148) through both 082 and 150, so every block reads one view.

/** The server's basis for a person↔company link, as 082 and 150 both emit it. */
export type LinkBasis = "declared" | "name_match";

/** Absent linkBasis is treated as a name match, never as declared.
 *
 *  A cloud database still serving a 082/150 older than tr-attribution-basis-v1 omits the
 *  field, and the two ways to be wrong are not symmetric: calling a curated link a name match
 *  costs a caveat nobody needed, while calling a name match "declared" tells a reader we
 *  confirmed a company belongs to a named person when we did not. */
export const isNameMatch = (linkBasis?: string | null): boolean =>
  linkBasis !== "declared";
