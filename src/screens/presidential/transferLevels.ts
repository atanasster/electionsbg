// Which presidential place levels have a runoff-transfer arm at all.
//
// ⚠⚠ REGION AND NOTHING BELOW IT, AND THAT IS THE CORPUS RATHER THAN A CHOICE. The estimate is
// an ecological regression fitted PER OBLAST — that is the unit `build_runoff_transfer.ts`
// solves on — so there is no arm to give a município or a settlement. Deriving one in the
// client would be a second implementation of the regression, which is how two surfaces come to
// publish different estimates of the same transition.
//
// ⚠ ITS OWN MODULE, so `PresidentialPlaceScreen` does not have to hold a fact about the corpus
// and `PresidentialPlaceTransfer` does not have to export a non-component (react-refresh keeps
// a component file to components, and a constant exported from one is a real warning rather
// than a style note).

import type { ElectionPlaceLevel } from "@/data/elections/surfaceTypes";

export const TRANSFER_LEVELS: ReadonlySet<
  Exclude<ElectionPlaceLevel, "country">
> = new Set(["region"]);
