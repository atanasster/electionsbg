// Settlement (EKATTE) local-elections dashboard screen.
// Route: /local/:cycle/settlement/:ekatte
//
// Surfaces the village-mayor (kметство) race for this settlement plus the
// parent município context. Anchored to the parliamentary election via the
// cycle in the URL.

import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalSettlementDashboardCards } from "./dashboard/local/LocalSettlementDashboardCards";
import { PlaceHeader } from "@/screens/components/PlaceHeader";

export const LocalSettlementDashboardScreen: FC = () => {
  const { cycle, ekatte } = useParams<{ cycle: string; ekatte: string }>();
  const { i18n } = useTranslation();
  const { findSettlement } = useSettlementsInfo();
  if (!cycle || !ekatte) return null;

  const settlement = findSettlement(ekatte);
  const bg = i18n.language === "bg";
  const name = settlement
    ? bg
      ? `${settlement.t_v_m} ${settlement.name}`
      : settlement.name_en || settlement.name
    : ekatte;

  return (
    <section className="my-4 space-y-6">
      {/* No separate "← <município>" back-link: the parent município is already a link in the
          PlaceHeader location labels below. */}
      <PlaceHeader
        active="local"
        level="settlement"
        ekatte={ekatte}
        obshtina={settlement?.obshtina}
        oblast={settlement?.oblast}
        fallbackName={name}
        cycle={cycle}
        eyebrowTo={`/local/${cycle}`}
        eyebrowSuffix={friendlyCycleDate(cycle)}
      />
      <LocalSettlementDashboardCards ekatte={ekatte} cycle={cycle} />
    </section>
  );
};
