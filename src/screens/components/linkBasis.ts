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

/** Last-resort fallback for the `person_namesake_disclosure` key.
 *
 *  ONE copy. src/locales/{bg,en}/translation.json stays the source translators edit; this is
 *  what renders if that key is ever dropped or renamed — i.e. the exact scenario in which
 *  hand-copied duplicates go stale unnoticed, since a `defaultValue` is invisible until the
 *  key is gone. It lived in four files (both profile blocks' tooltips, the shared footer, and
 *  the /persons money cell) before this was extracted.
 *
 *  It belongs beside `isNameMatch` for the same reason that predicate does: this module
 *  renders nothing, so any surface can reach the one sentence without importing a component. */
export const NAMESAKE_FALLBACK =
  "Лицата в Търговския регистър се идентифицират тук по име — регистърът публикува и идентификатор от ЕГН, но ние не го използваме, затова тези записи може да обединяват различни хора с еднакво име.";
