// /water/funds — the EU programme funds (ИСУН) contracted to and paid to the
// water operators. Lifetime figures, so the page carries NO scope control (W4):
// the old /water put this tile under the toggle, where it appeared to filter.

import { FC } from "react";
import { useVikFunds } from "@/data/procurement/useVik";
import { WATER_SECTOR_EIKS } from "@/lib/vikReferenceData";
import { VikEuFundsTile } from "@/screens/components/procurement/vik/VikEuFundsTile";
import { WaterPageFrame } from "./WaterPageFrame";

export const WaterFundsScreen: FC = () => {
  const { funds, isLoading, isError } = useVikFunds(WATER_SECTOR_EIKS);
  return (
    <WaterPageFrame
      title={{
        bg: "Еврофондове във водния сектор",
        en: "EU funds in the water sector",
      }}
      description={{
        bg: "Договорените и изплатените средства по европейските програми (ИСУН) за ВиК операторите и другите дружества във водния сектор — за целия програмен период, отделно от обществените поръчки.",
        en: "EU programme funds (ИСУН) contracted and paid to the water operators and the other water-sector companies — over the whole programme period, separate from public procurement.",
      }}
      scoped={false}
      status={{ isLoading, isError }}
    >
      <VikEuFundsTile funds={funds} />
    </WaterPageFrame>
  );
};
