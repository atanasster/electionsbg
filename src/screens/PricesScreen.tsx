// /prices — the КЗП "Колко струва" price explorer. Assembles the national
// basket index since the euro (GovernancePricesTile) + the cheapest-place
// choropleth. A monitoring basket index, NOT official CPI.

import { useTranslation } from "react-i18next";
import { Map as MapIcon, ShoppingBasket } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { Title } from "@/ux/Title";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { useHashScroll } from "@/ux/useHashScroll";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { GovernancePricesTile } from "@/screens/governance/GovernancePricesTile";
import { PriceHeatmapTile } from "@/screens/components/prices/PriceHeatmapTile";

export const PricesScreen = () => {
  const { t } = useTranslation();
  useHashScroll([]);
  const title = t("prices_page_title") || "Цени";
  const description =
    t("prices_page_description") ||
    "Цените на голямата потребителска кошница от въвеждането на еврото — по продукти, вериги и населени места.";

  return (
    <>
      <SEO title={title} description={description} />
      <ConsumptionBreadcrumb
        section={t("prices_section_map") || "Карта на цените"}
        className="mt-4 mb-2"
      />
      <Title description={description}>{title}</Title>

      <section aria-label={title} className="my-4">
        <DashboardSection
          id="prices"
          title={t("prices_section_overview") || "Кошница на цените"}
          subtitle={t("prices_not_cpi")}
          icon={ShoppingBasket}
        >
          <GovernancePricesTile />
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
