// /consumption/analysis (path kept as /consumption/overview) — the Consumption
// ANALYSIS deep-dive: the euro verdict, official inflation vs the basket, and
// regional affordability. The basket summary and the price map that used to lead
// this page now live on the /prices dashboard and /prices/map, so this page is
// purely the analytical trio (no duplication). Section ids (euro / macro /
// finances) are the anchors the hub tiles deep-link to.

import { useTranslation } from "react-i18next";
import { LineChart, Scale, Euro } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { useHashScroll } from "@/ux/useHashScroll";
import { usePriceIndex, usePriceRanking } from "@/data/prices/usePrices";
import { useEuroVerdict } from "@/data/prices/useProducts";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { Title } from "@/ux/Title";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { ConsumptionInflationTile } from "@/screens/consumption/ConsumptionInflationTile";
import { ConsumptionAffordabilityTile } from "@/screens/consumption/ConsumptionAffordabilityTile";
import { EuroVerdictTile } from "@/screens/consumption/EuroVerdictTile";

export const ConsumptionOverviewScreen = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  // Deep-link anchors (`/consumption/overview#macro`, `#euro`, `#finances`).
  // The sections settle late (charts/aggregates), so a cold deep-link to a lower
  // section would otherwise scroll before their heights land. Pass those payloads
  // as settle sentinels (React Query dedupes — the tiles below fetch the same
  // queries) so the scroll re-runs once layout settles.
  const { data: priceIndex } = usePriceIndex();
  const { data: priceRanking } = usePriceRanking();
  const { data: euroVerdict } = useEuroVerdict();
  useHashScroll([priceIndex, priceRanking, euroVerdict]);
  const heading = bg ? "Анализ" : "Analysis";
  const title = `${t("consumption_title") || "Потребление"} · ${heading}`;
  const description =
    t("consumption_seo_description") ||
    "Цени, потребление и издръжка на живота в България.";

  return (
    <>
      <SEO title={title} description={description} />
      <ConsumptionBreadcrumb section={heading} className="mt-4 mb-2" />
      <Title>{heading}</Title>

      <section aria-label={title}>
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
      </section>
    </>
  );
};
