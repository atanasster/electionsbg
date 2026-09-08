// The presidential route family, in ONE place — `docs/plans/presidential-elections-v1.md` §9.
//
// ⚠ THIS EXISTS SO THE PRODUCER AND THE ROUTER CANNOT DRIFT. `destinations.ts` opens with the
// rule: "routes come from the router's own builders, never from a template", because a
// hand-built path keeps working until the routing rule moves and then nothing compares the two.
// `build_presidential_surface.ts` had four such templates and a fifth for sections, and
// `electionsHubCycle.ts` a sixth for the country page that the header dropdown navigates by;
// all six read this function now, and `routes.tsx` is gated against it by
// `presidentialRouteFamily.test.ts`.
//
// ⚠ THE RUNOFF IS NOT A ROUTE. Resolved 2026-09-06: one `/presidential/:cycle` page with a
// round switch, because the surfaces already carry both rounds as ballots on ONE artifact.
// So there is no `round` parameter here and adding one would mint URLs nothing serves.

// ⚠ FROM abroadOblast.ts, NOT placeViews.ts. placeViews.ts imports presidentialUrl (below)
// from this file to build the presidential PlaceViewNav pill, so importing ABROAD_OBLAST back
// from placeViews.ts would cycle; both files import the constant from this shared leaf instead.
import { ABROAD_OBLAST } from "@/data/local/abroadOblast";
import type { ElectionPlaceLevel } from "./surfaceTypes";

/**
 * The place id the ONE abroad surface is stored under.
 *
 * ⚠ THE ROUTE TAKES NO ID AND THE ARTIFACT NEEDS ONE, which is why this constant exists at
 * all. `presidentialUrl(cycle, "abroad")` builds `/presidential/<cycle>/abroad`, while
 * `artifactPath("abroad", …)` folds abroad into the region directory and demands a key — so
 * the producer and the screen must agree on one, and a value invented at either end is a
 * screen that fetches a file nobody wrote.
 *
 * ⚠ IT IS `ABROAD_OBLAST`, NOT A NEW LITERAL. „32" is already this repo's id for „чужбина"
 * (`isAbroadPlace`, `toPlaceRef`, the parliamentary МИР tree), and the presidential region
 * roll-up is keyed by three-letter oblast codes — BGS, BLG, SOF — so a numeric key cannot
 * collide with a real region. Minting a second spelling here would give one concept two ids
 * and let the two halves of this family disagree silently.
 */
export const PRESIDENTIAL_ABROAD_ID = ABROAD_OBLAST;

/** The route patterns this family declares, in `routes.tsx`'s own syntax.
 *
 *  ⚠ KEYED BY LEVEL, and the keys are `ElectionPlaceLevel`'s — so a seventh level added to that
 *  union is a compile error here rather than a silently unrouted page. That is the same
 *  exhaustiveness the surface policy and the descriptor matrix rely on. */
export const PRESIDENTIAL_ROUTE_PATTERNS: Record<ElectionPlaceLevel, string> = {
  country: "presidential/:cycle",
  region: "presidential/:cycle/region/:oblast",
  municipality: "presidential/:cycle/municipality/:obshtina",
  settlement: "presidential/:cycle/settlement/:ekatte",
  section: "presidential/:cycle/section/:code",
  abroad: "presidential/:cycle/abroad",
};

/** One path segment, or `null`.
 *
 * ⚠ A SEPARATOR IS AS BAD AS AN EMPTY ID, and for the same reason: `region` + „A/B" mints
 * `/presidential/<cycle>/region/A/B`, an extra segment that matches a different route or none
 * at all, while looking exactly like a working link in the payload. Every id this family
 * carries is a corpus key today (ISO-2, three-letter oblast codes, ЕКАТТЕ, numeric section
 * codes), so this refuses rather than escapes: a value that needs escaping is not one of those
 * and publishing it under a mangled URL would hide the corpus defect instead of showing it.
 */
const seg = (s?: string): string | null => (s && !/[/?#]/.test(s) ? s : null);

/**
 * One presidential place's URL.
 *
 * ⚠ THE OVERLOADS ARE THE POINT, not decoration. `country` and `abroad` take NO id, and the
 * other four REQUIRE one — expressed in the type, an abroad call carrying a country code is a
 * compile error rather than a value silently dropped. That asymmetry was invisible while the
 * signature was uniform, and it hid a real defect: the producer fanned abroad out per country
 * and passed 302 ids into a route that has none, so 297 artifacts were unaddressable and the
 * page fetched none of them.
 *
 * ⚠ `null` HAS TWO CAUSES — an empty/unusable id, and an empty cycle. Callers that report one
 * of them must not attribute it to the other; validate the cycle where it enters instead.
 */
export function presidentialUrl(
  cycle: string,
  level: "country" | "abroad",
): string | null;
export function presidentialUrl(
  cycle: string,
  level: Exclude<ElectionPlaceLevel, "country" | "abroad">,
  id: string | undefined,
): string | null;
export function presidentialUrl(
  cycle: string,
  level: ElectionPlaceLevel,
  id?: string,
): string | null {
  if (!seg(cycle)) return null;
  switch (level) {
    case "country":
      return `/presidential/${cycle}`;
    case "abroad":
      return `/presidential/${cycle}/abroad`;
    case "region": {
      const v = seg(id);
      return v ? `/presidential/${cycle}/region/${v}` : null;
    }
    case "municipality": {
      const v = seg(id);
      return v ? `/presidential/${cycle}/municipality/${v}` : null;
    }
    case "settlement": {
      const v = seg(id);
      return v ? `/presidential/${cycle}/settlement/${v}` : null;
    }
    case "section": {
      const v = seg(id);
      return v ? `/presidential/${cycle}/section/${v}` : null;
    }
  }
}
