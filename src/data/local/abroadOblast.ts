// МИР 32 — the abroad-voters district.
//
// ⚠ SPLIT OUT OF placeViews.ts SO presidentialRoutes.ts CAN IMPORT IT WITHOUT A CYCLE.
// placeViews.ts now imports presidentialUrl from presidentialRoutes.ts (to build the
// presidential pill's URL), so presidentialRoutes.ts importing this constant BACK from
// placeViews.ts would form a cycle. Both files import it from here instead; placeViews.ts
// re-exports it so every existing `import { ABROAD_OBLAST } from "@/data/local/placeViews"`
// keeps working unchanged.
//
// ⚠ AN ABROAD PLACE HAS EXACTLY ONE VIEW, AND THE OTHER THREE MUST REFUSE RATHER THAN
// TEMPLATE. Its "settlements" are COUNTRIES carrying ISO codes where an EKATTE would be
// (IT, DE, FR…), so every builder in placeViews.ts happily produced `/governance/IT` and
// `/consumption/IT` — pages that do not exist and cannot. Measured 2026-09-04 on
// `/sections/IT`: the place digest rendered both, captioned „депутатите и общинският съвет",
// about Italy. `PlaceHeaderView` already dropped the SWITCHER for abroad, which is what hid
// this — the pills were gone while the digest, a different consumer of the same builders,
// kept them.
//
// Refusing here rather than at each call site is the point: `isAbroad` was a rendering flag
// held by one component, and a second consumer had no way to know.
export const ABROAD_OBLAST = "32";
