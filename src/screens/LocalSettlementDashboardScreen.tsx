// Settlement (EKATTE) local-elections dashboard screen.
// Route: /local/:cycle/settlement/:ekatte
//
// Surfaces the village-mayor (kметство) race for this settlement plus the
// parent município context. Anchored to the parliamentary election via the
// cycle in the URL.

import { FC } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { friendlyCycleDate } from "@/data/local/cycleDate";
import { LocalSettlementDashboardCards } from "./dashboard/local/LocalSettlementDashboardCards";

export const LocalSettlementDashboardScreen: FC = () => {
  const { cycle, ekatte } = useParams<{ cycle: string; ekatte: string }>();
  const { t, i18n } = useTranslation();
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  if (!cycle || !ekatte) return null;

  const settlement = findSettlement(ekatte);
  const bg = i18n.language === "bg";
  const name = settlement
    ? bg
      ? `${settlement.t_v_m} ${settlement.name}`
      : settlement.name_en || settlement.name
    : ekatte;
  const muni = settlement?.obshtina
    ? findMunicipality(settlement.obshtina)
    : undefined;
  const muniName = muni ? (bg ? muni.name : muni.name_en || muni.name) : null;

  return (
    <main className="container mx-auto px-4 py-6 space-y-6">
      <div className="text-xs text-muted-foreground">
        <Link to={`/local/${cycle}`} className="hover:underline">
          {t("local_election_screen_back")}
        </Link>
        {settlement?.obshtina && muniName ? (
          <>
            <span className="mx-2">·</span>
            <Link
              to={`/local/${cycle}/${settlement.obshtina}`}
              className="hover:underline"
            >
              {muniName}
            </Link>
          </>
        ) : null}
        <span className="mx-2">·</span>
        <span>{friendlyCycleDate(cycle)}</span>
      </div>
      <h1 className="text-2xl font-semibold">{name}</h1>
      <LocalSettlementDashboardCards ekatte={ekatte} cycle={cycle} />
    </main>
  );
};
