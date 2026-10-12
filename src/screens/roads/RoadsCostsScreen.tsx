// /sector/roads/costs — what a kilometre costs, where that is defensible, and
// what kind of work the money buys. €/km is gated by the engine (eurPerKmOf,
// EUR_PER_KM_MIN_N): most contracts carry no defensible unit cost and are
// deliberately not unit-costed.

import { FC } from "react";
import { RoadCostPerKmTile } from "@/screens/components/procurement/roads/RoadCostPerKmTile";
import { RoadCostBenchmarkTile } from "@/screens/components/procurement/roads/RoadCostBenchmarkTile";
import { RoadComponentsTile } from "@/screens/components/procurement/roads/RoadComponentsTile";
import { RoadWorkGroupDonut } from "@/screens/components/procurement/roads/RoadWorkGroupDonut";
import { RoadCostExplainer } from "@/screens/components/procurement/roads/RoadCostExplainer";
import { RoadsPageFrame } from "./RoadsPageFrame";
import { useTranslation } from "react-i18next";
import { isBg } from "@/i18n";
import { formatInt } from "@/lib/currency";
import type { RoadsModel } from "@/lib/roadAttributes";

/** How many contracts carry a defensible €/km — the figure the hub tile quotes. */
const PerKmSummary: FC<{ model: RoadsModel }> = ({ model }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const n = model.rows.filter((r) => r.perKm).length;
  return (
    <p className="text-sm text-muted-foreground">
      {isBg(lang)
        ? `${formatInt(n, lang)} от ${formatInt(model.rows.length, lang)} договора в избрания период имат защитима цена на километър — физически строителни работи с разчетен участък и реална стойност. Останалите умишлено не се остойностяват.`
        : `${formatInt(n, lang)} of ${formatInt(model.rows.length, lang)} contracts in the selected window carry a defensible cost per kilometre — physical works with a parsed segment and a real value. The rest are deliberately not unit-costed.`}
    </p>
  );
};

export const RoadsCostsScreen: FC = () => (
  <RoadsPageFrame
    title={{ bg: "Цена на километър", en: "Cost per kilometre" }}
    description={{
      bg: "Колко струва километър път по коридор — само за договорите със защитима единична цена — сравнено с международни ориентири, и какви видове работа купуват АПИ и НКСИП.",
      en: "What a kilometre of road costs by corridor — only for contracts with a defensible unit cost — against international reference levels, and what kinds of work АПИ and НКСИП buy.",
    }}
  >
    {(model) => (
      <>
        <PerKmSummary model={model} />
        <div className="grid gap-4 xl:grid-cols-2">
          <RoadCostPerKmTile corridors={model.corridors} />
          <RoadWorkGroupDonut
            groups={model.workGroups}
            totalEur={model.totalEur}
          />
        </div>
        <RoadCostBenchmarkTile corridors={model.corridors} />
        <RoadComponentsTile components={model.components} />
        <RoadCostExplainer />
      </>
    )}
  </RoadsPageFrame>
);
