// Country node of the Consumption (Потребление) view — the cost-of-living
// dashboard. Phase 1 ships the КЗП "Колко струва" basket layer (national index
// + cheapest chains/places + the municipality price map); fuel, wages and
// property tiles land in later phases. Mirrors GovernanceScreen's shell so the
// place header + the four-way view switcher read identically across views.

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

export const ConsumptionScreen = () => {
  const { t } = useTranslation();
  // Deep-link anchors (`/consumption#map`, `#euro`). Fires on hash change; the
  // hook's rAF gives freshly-mounted sections a tick to lay out. `[]` matches
  // GovernanceScreen — the tiles own their data, so the screen has no payload
  // sentinel to thread. A cold link to a section far below the fold can still
  // land slightly short until the async tiles grow the page; acceptable here.
  useHashScroll([]);
  const title = t("consumption_title") || "Потребление";
  const description =
    t("consumption_seo_description") ||
    "Цени, потребление и издръжка на живота в България.";

  return (
    <>
      <SEO title={title} description={description} />
      {/* Country node of the Consumption view — the unified place header
          carries the Consumption eyebrow + the switcher across to the
          Governance / parliamentary / local views of Bulgaria. */}
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
