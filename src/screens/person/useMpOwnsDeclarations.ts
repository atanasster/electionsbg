import { useMpAssets } from "@/data/parliament/useMpAssets";
import { useMpDeclarations } from "@/data/parliament/useMpDeclarations";

/** Does the MP block own the person page's ONE `#declarations` section?
 *
 * Three components can open that section — PersonMpSections, PersonDeclarations and
 * PersonNoDeclarationNote — and it is a deep-link target (MpScorecardTile's net-worth
 * metric drills to `#${DECLARATIONS_ANCHOR}`). This predicate coordinates the first TWO,
 * which are the pair that can both claim it for the same person; the third is disjoint by
 * ROLE (it fires only when every office the person holds is exempt from filing, which no MP
 * is) and is gated on this predicate as well, belt and braces.
 *
 * The two coordinated callers must read the SAME predicate rather than each testing a
 * lookalike: `rollup != null` and `!rollup` disagree while the queries are in flight, which
 * is how the page could paint two sections at once.
 *
 * MUST BE CALLED INSIDE `CandidateMpProvider`, which PersonDashboard establishes for the
 * whole page. Outside it, `useMpIdForName` falls back to the ~950 KB roster and returns
 * `undefined` until that lands — and a DISABLED query reports `isLoading === false`
 * (query-core: `isLoading = isPending && isFetching`), so this would return **false for an
 * MP who owns the section** for the entire roster window. The page then paints the
 * standalone block and swaps it out when the roster arrives. Inside the provider the id is
 * known on render 1, both queries are enabled immediately, and the answer is stable from
 * the first paint.
 *
 * Lives in its own module rather than beside either caller: a hook exported from a
 * component file breaks fast refresh, and neither component is the natural owner of a rule
 * that exists to keep the two of them in step.
 */
export const useMpOwnsDeclarations = (
  name: string,
  mpId: number | null,
): boolean => {
  // `undefined`, not the name, when there is no mp id: both hooks are `enabled: !!id`, so
  // this skips the two `/api/db/mp-*` calls for a non-MP.
  //
  // It does NOT skip the roster — `useMpIdForName` enables `useMps` on any context miss,
  // including a falsy name (CandidateMpContext.ts). Inside the provider a non-MP passes
  // `null` as the context value, so that miss still happens for them. What the guard DOES
  // buy is correctness: without it, a non-MP who shares a normalized name with an MP
  // resolved to that stranger's rollup and had their own declarations block suppressed with
  // no MP section to replace it — zero blocks, at a 200.
  const lookup = mpId != null ? name : undefined;
  const { rollup, isLoading: assetsLoading } = useMpAssets(lookup);
  const { isLoading: declsLoading } = useMpDeclarations(lookup);
  return mpId != null && (rollup != null || assetsLoading || declsLoading);
};
