// /consumption/overview — the Consumption analytics dashboard. This is the
// deep-dive that used to be the /consumption landing; /consumption is now a
// navigation-first hub (ConsumptionScreen) that fronts this via the "Обзор"
// tile. The КЗП "Колко струва" basket layer (national index + cheapest
// chains/places + the municipality price map) plus the euro verdict, official
// inflation and regional affordability. Section ids (euro / macro / finances /
// map) are the anchors the hub tiles deep-link to.

import { useTranslation } from "react-i18next";
import {
  Map as MapIcon,
  ShoppingBasket,
  LineChart,
  Scale,
  Euro,
} from "lucide-react";
import { SEO } from "@/ux/SEO";
import { useHashScroll } from "@/ux/useHashScroll";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { GovernancePricesTile } from "@/screens/governance/GovernancePricesTile";
import { ConsumptionInflationTile } from "@/screens/consumption/ConsumptionInflationTile";
import { ConsumptionAffordabilityTile } from "@/screens/consumption/ConsumptionAffordabilityTile";
import { EuroVerdictTile } from "@/screens/consumption/EuroVerdictTile";
import { PriceHeatmapTile } from "@/screens/components/prices/PriceHeatmapTile";

export const ConsumptionOverviewScreen = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // Deep-link anchors (`/consumption/overview#map`, `#euro`). The hook's rAF
  // gives freshly-mounted sections a tick to lay out before scrolling.
  useHashScroll([]);
  const title = `${t("consumption_title") || "Потребление"} · ${
    bg ? "Обзор" : "Overview"
  }`;
  const description =
    t("consumption_seo_description") ||
    "Цени, потребление и издръжка на живота в България.";

  return (
    <>
      <SEO title={title} description={description} />
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <section aria-label={title}>
        <DashboardSection
          id="prices"
          title={t("prices_section_overview") || "Кошница на цените"}
          subtitle={t("prices_not_cpi")}
          icon={ShoppingBasket}
        >
          <GovernancePricesTile />
        </DashboardSection>

        <DashboardSection
          id="euro"
          title={
            t("consumption_section_euro") ||
            "Поскъпна ли храната заради еврото?"
          }
          icon={Euro}
        >
          <EuroVerdictTile />
        </DashboardSection>

        <DashboardSection
          id="macro"
          title={t("consumption_section_inflation") || "Официална инфлация"}
          icon={LineChart}
        >
          <ConsumptionInflationTile />
        </DashboardSection>

        <DashboardSection
          id="finances"
          title={
            t("consumption_section_affordability") || "Достъпност по региони"
          }
          icon={Scale}
        >
          <ConsumptionAffordabilityTile />
        </DashboardSection>

        <DashboardSection
          id="map"
          title={t("prices_section_map") || "Карта на цените"}
          icon={MapIcon}
        >
          <PriceHeatmapTile />
        </DashboardSection>
      </section>
    </>
  );
};
