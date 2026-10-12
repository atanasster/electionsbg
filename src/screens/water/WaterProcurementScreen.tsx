// /water/procurement — what the water operators buy, from whom and with how much
// competition. The five procurement tiles that used to sit on /water, over the
// whole sector (WATER_SECTOR_EIKS) and the page's ?pscope window. Plan:
// docs/plans/water-hub-v1.md §3. The hub's tiles link #functions,
// #competition and #contractors; #intragroup is the W2 disclosure.

import { FC } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useVikGroupRollup, useWaterSector } from "@/data/procurement/useVik";
import { WATER_SECTOR_EIKS } from "@/lib/vikReferenceData";
import { VikSubsidiaryTile } from "@/screens/components/procurement/vik/VikSubsidiaryTile";
import { VikCategoryTile } from "@/screens/components/procurement/vik/VikCategoryTile";
import { VikContractorHhiTile } from "@/screens/components/procurement/vik/VikContractorHhiTile";
import { VikCompetitionTile } from "@/screens/components/procurement/vik/VikCompetitionTile";
import { WaterPageFrame } from "./WaterPageFrame";
import { WaterCompetitionBaseline } from "./WaterCompetitionBaseline";
import { WaterIntraGroupCard } from "./WaterIntraGroupCard";

export const WaterProcurementScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { model, groupEiks, isLoading, isError } = useWaterSector();
  // ONE per-operator rollup, on the ex-member basis, feeds the operator tile,
  // the competition card and the per-operator heatmap — so the rows beneath a
  // headline add up to it, and „both sides exclude members" is true of every
  // figure in #competition. The by-function model (useWaterSector) carries €,
  // which member rows (€0) cannot move.
  const { operators, exMembers } = useVikGroupRollup(WATER_SECTOR_EIKS);
  return (
    <WaterPageFrame
      title={{
        bg: "Поръчките на ВиК сектора",
        en: "Water-sector procurement",
      }}
      description={{
        bg: "Какво купуват ВиК операторите, от кого и при каква конкуренция — по оператор, по функция и по изпълнител.",
        en: "What the water operators buy, from whom and with how much competition — by operator, by function and by contractor.",
      }}
      scoped
      ready={[model]}
      status={{ isLoading, isError }}
    >
      {model && model.totalEur > 0 ? (
        <>
          <section id="operators" className="scroll-mt-20">
            <VikSubsidiaryTile operators={operators} universeEiks={groupEiks} />
          </section>
          <section id="functions" className="scroll-mt-20">
            <VikCategoryTile
              categories={model.categories}
              totalEur={model.totalEur}
            />
          </section>
          <section id="competition" className="scroll-mt-20 space-y-4">
            <WaterCompetitionBaseline
              operators={operators}
              exMembers={exMembers}
            />
            <VikCompetitionTile operators={operators} />
          </section>
          <section id="contractors" className="scroll-mt-20">
            <VikContractorHhiTile
              memberEiks={groupEiks}
              suppliers={model.suppliers}
              totalEur={model.totalEur}
            />
          </section>
          <section id="intragroup" className="scroll-mt-20">
            <WaterIntraGroupCard
              suppliers={model.suppliers}
              totalEur={model.totalEur}
            />
          </section>
        </>
      ) : (
        <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Няма договори в избрания период."
            : "No contracts in the selected window."}
        </p>
      )}
    </WaterPageFrame>
  );
};
