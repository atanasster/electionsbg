// Where the place badge on a "Длъжности" row points.
//
// Every office row carries a TYPED place (migration 115: `placeKind` names the namespace
// `placeCode` is in), and every one of those namespaces has a page — so the badge is a link
// for all of them, not only for the local-election seats that used to be the single case:
//
//   obshtina   → /governance/:obshtina        (the município dashboard)
//   settlement → /governance/:ekatte          (the settlement dashboard)
//   mir        → /governance/region/:oblast   (Sofia's three МИР fold to the city node)
//   judicial   → /court/:bodyCode
//
// Before this, an appointed office (a chief architect, a deputy minister, a magistrate)
// rendered its place as dead text while the councillor two rows above it was a link — the
// same badge, the same place, and no reason a reader could see for the difference.
//
// A code we cannot place resolves to null and the badge stays plain text. That is the point
// of routing through the shared builders rather than interpolating the code: `SFO_CITY` (the
// officials roster's synthetic Столична община) and an unknown oblast both look like perfectly
// good path segments and would 404 into an "unknown place" screen.

import {
  governanceUrl,
  localUrl,
  oblastGovernanceUrl,
} from "@/data/local/placeViews";

/** The typed place namespaces migration 115 can emit. */
export type PlaceKind = "mir" | "obshtina" | "settlement" | "judicial";

/** The fields the href reads. Structural, so a folded ProfileRole satisfies it.
 *
 *  `placeKind` is the CLOSED union rather than `string`: every namespace has a destination,
 *  so a fifth one added upstream must break the build here instead of falling to `null` and
 *  quietly reverting that badge to the dead text this module exists to end. */
export type OfficePlaceRef = {
  source: string;
  ref: string;
  placeKind?: PlaceKind | null;
  placeCode?: string | null;
};

const assertNever = (x: never): null => {
  void x;
  return null;
};

export const officePlaceHref = (r: OfficePlaceRef): string | null => {
  // A local-election seat keeps its CYCLE-scoped page: `<cycle>:<obshtinaCode>:…` maps 1:1
  // onto the local-elections tree for the election that produced the mandate, which says more
  // about that particular row than the place's current governance page does. Only
  // `local`-source rows carry that ref shape; anything else falls through to the place page.
  //
  // A кмет на кметство is placed at its SETTLEMENT, so it takes the settlement page rather
  // than the município one out of the ref — the badge reads "с. Ореше" and the município
  // page is about Гърмен, i.e. the same label/destination mismatch as an unlinked badge,
  // only harder to notice. Sofia's 32 villages are the case that makes this need checking:
  // settlements.json puts them in a район (S2xxx) whose shard carries no kmetstva at all,
  // so `useLocalSettlement` sources their race from the city-wide SOF bundle — without that
  // fold the page states the village has no village mayor while this badge names its holder.
  if (r.source === "local") {
    const [cycle, obshtinaCode] = r.ref.split(":");
    if (cycle && r.placeKind === "settlement" && r.placeCode)
      return `/local/${cycle}/settlement/${r.placeCode}`;
    if (cycle && obshtinaCode) return `/local/${cycle}/${obshtinaCode}`;
    // A ref with a cycle and nothing else still belongs in the local tree — `localUrl` folds
    // `SFO_CITY` onto the `SOF` bundle the shards use, which a raw interpolation would not.
    // Unreachable today: all 25,319 local refs are well-shaped.
    if (cycle && r.placeKind === "obshtina" && r.placeCode)
      return localUrl({ level: "municipality", obshtina: r.placeCode }, cycle);
  }

  const kind = r.placeKind;
  const code = r.placeCode;
  if (!kind || !code) return null;
  switch (kind) {
    // The one arm with no builder behind it, because it needs no validation: `judicial_body`
    // is the single producer of BOTH the code on the role and the page set
    // (scripts/db/lib/seo_courts.ts reads the same table), so a code that exists here has a
    // page by construction.
    case "judicial":
      return `/court/${code}`;
    case "obshtina":
      return governanceUrl({ level: "municipality", obshtina: code });
    // Unreachable today and kept deliberately: `settlement` occurs only on `local` rows
    // (8,180 of them), which return above. It is the right destination the day an
    // officials-roster seat gains a settlement place — the test for it pins intent, not a
    // live path.
    case "settlement":
      return governanceUrl({ level: "settlement", ekatte: code });
    case "mir":
      return oblastGovernanceUrl(code);
    default:
      return assertNever(kind);
  }
};
