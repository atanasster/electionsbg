// /water/procurement — what the water operators buy, from whom and with how much
// competition. The five procurement tiles that used to sit on /water, over the
// whole sector (WATER_SECTOR_EIKS) and the page's ?pscope window. Plan:
// docs/plans/water-hub-v1.md §3. The hub's tiles link #functions,
// #competition and #contractors.

import { FC } from "react";
import { isBg } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useWaterSector } from "@/data/procurement/useVik";
import { VikSubsidiaryTile } from "@/screens/components/procurement/vik/VikSubsidiaryTile";
import { VikCategoryTile } from "@/screens/components/procurement/vik/VikCategoryTile";
import { VikContractorHhiTile } from "@/screens/components/procurement/vik/VikContractorHhiTile";
import { VikCompetitionTile } from "@/screens/components/procurement/vik/VikCompetitionTile";
import { WaterPageFrame } from "./WaterPageFrame";

export const WaterProcurementScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = isBg(i18n.language);
  const { model, operators, groupEiks, isLoading, isError } = useWaterSector();
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
          <section id="competition" className="scroll-mt-20">
            <VikCompetitionTile operators={operators} />
          </section>
          <section id="contractors" className="scroll-mt-20">
            <VikContractorHhiTile
              memberEiks={groupEiks}
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
