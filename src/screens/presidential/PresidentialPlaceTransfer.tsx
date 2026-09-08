// The runoff transfer section on a presidential PLACE page — region only.
//
// ⚠⚠ REGION AND NOTHING BELOW IT — `transferLevels.ts` says why, and holds the rule so that
// neither this component nor the five-level screen above it has to carry a fact about the
// corpus. The hook is called at every level and simply stays disabled where there is no arm,
// because a hook may not be called conditionally.
//
// ⚠ THE TILE IS LAZY, and that is not premature. `PresidentialPlaceScreen` serves FIVE levels
// from one component, and the tile's static closure reaches `VoteFlowSankey` and therefore
// d3-sankey. Imported eagerly, every settlement, section, município and „чужбина" page would
// download a chart none of them can ever render.
//
// ⚠ IT RENDERS NOTHING IN THREE OF THE FOUR STATES. „Not published yet" is the ordinary answer
// — `data/*_pvr` is gitignored and reaches the bucket only through `bucket:gz` — and a cycle
// decided in round 1 has no shards at all. A heading over an empty box would report a routine
// absence as a defect.

import { FC, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Shuffle } from "lucide-react";
// ⚠ THE PARLIAMENTARY DASHBOARD'S SECTION SHELL, so this page's analysis sections wear the same
// micro-caps kicker the country page's do — see `PresidentialCycleScreen`'s import note.
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useOblastTransfer } from "@/data/presidential/useOblastTransfer";
import { TRANSFER_LEVELS } from "./transferLevels";
import type { PresidentialPlaceLevel } from "./PresidentialPlaceScreen";

/** What the tile occupies once it arrives — `SANKEY_HEIGHT` plus its captions, restated here
 *  rather than imported so the lazy boundary keeps its point. */
const TILE_MIN_HEIGHT = 520;

const OblastTransferTile = lazy(() =>
  import("./PresidentialOblastTransferTile").then((m) => ({
    default: m.PresidentialOblastTransferTile,
  })),
);

export const PresidentialPlaceTransfer: FC<{
  cycle: string;
  level: PresidentialPlaceLevel;
  /** The place id. ⚠ THE HOOK IS CALLED AT EVERY LEVEL — React hook order — and simply stays
   *  disabled where there is no arm. */
  id: string | undefined;
}> = ({ cycle, level, id }) => {
  const { t } = useTranslation();
  const state = useOblastTransfer(
    cycle,
    TRANSFER_LEVELS.has(level) ? id : undefined,
  );
  // ⚠ `absent` AND `unusable` RENDER THE SAME, deliberately, and the country tile does too.
  // The distinction the hook goes to trouble over is for the OPERATOR, not the reader:
  // `unusable` is the only one of the two that logs, and an error box about a data defect a
  // reader cannot act on is worse than a missing section.
  if (state.status !== "ready") return null;
  return (
    <DashboardSection
      id="presidential-transfer"
      title={t("presidential_transfer_heading")}
      icon={Shuffle}
      headingLevel={2}
    >
      {/* ⚠ THE FALLBACK RESERVES HEIGHT rather than being `null`. This file's own rule is that
          a heading over an empty box reports a routine absence as a defect — and with no
          fallback that is exactly the visible state while the chart chunk downloads on a cold
          cache. The constant is local on purpose: importing `SANKEY_HEIGHT` would put the
          chart's module back into this one's static closure, which is what the lazy boundary
          exists to prevent. */}
      <Suspense
        fallback={
          <div aria-hidden="true" style={{ minHeight: TILE_MIN_HEIGHT }} />
        }
      >
        <OblastTransferTile transfer={state.transfer} />
      </Suspense>
    </DashboardSection>
  );
};
