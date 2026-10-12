// /water/floods — riverbed cleaning and regulation spend. A TOPIC selection over
// every awarder in the corpus (by CPV and contract subject — see
// scripts/water/flood_predicate.ts), not the water sector's operators, so it is
// never summed with their procurement (W5). Re-aggregated to ?pscope client-side.

import { FC } from "react";
import { useFloodMaintenance } from "@/data/water/useFloodMaintenance";
import { WaterFloodTile } from "./WaterFloodTile";
import { WaterPageFrame } from "./WaterPageFrame";

export const WaterFloodsScreen: FC = () => {
  // The tile reads the same query (deduplicated by React Query); the frame needs
  // its status so a failed fetch is not a blank page.
  const { isLoading, isError } = useFloodMaintenance();
  return (
    <WaterPageFrame
      title={{
        bg: "Почистване на речни корита",
        en: "Riverbed cleaning",
      }}
      description={{
        bg: "Колко се харчи за почистване и корекция на речни корита и дерета, кой възлага и в кои области — по данни от регистъра на обществените поръчки.",
        en: "How much is spent on cleaning and regulating riverbeds and gullies, who awards it and in which provinces — from the public-procurement register.",
      }}
      scoped
      status={{ isLoading, isError }}
    >
      <WaterFloodTile />
    </WaterPageFrame>
  );
};
