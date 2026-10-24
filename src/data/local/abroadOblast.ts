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

// The six МИР 32 "municipalities" — continent buckets keyed by a two-letter code.
export const ABROAD_CONTINENTS = ["AF", "AS", "EU", "NA", "OC", "SA"] as const;

/** ⚠ A COUNTRY CODE AND A CONTINENT CODE SHARE THE /settlement/:id URL SPACE. That route is
 *  the MUNICIPALITY dashboard and drops to the settlement view only for an id it recognises
 *  as a settlement — historically "starts with a digit", which every domestic EKATTE does and
 *  no abroad country does. So `/settlement/NZ` (prerendered with New Zealand's title, linked
 *  from its section breadcrumbs) hydrated into „Община NZ" with empty tiles. A country is any
 *  two-character id that is not a continent — Kosovo's key is the Cyrillic `КО`, so this is a
 *  length test, not `[A-Z]{2}`. Two countries collide with a continent and LOSE here: AF
 *  (Afghanistan / Africa) and SA (Saudi Arabia / South America) — their only unambiguous
 *  parliamentary URL is `/sections/:code`, which is why no builder may mint `/settlement/` for
 *  a country. */
export const isAbroadCountryCode = (id?: string): boolean =>
  !!id &&
  [...id].length === 2 &&
  !(ABROAD_CONTINENTS as readonly string[]).includes(id);
