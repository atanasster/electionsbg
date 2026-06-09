// Region (oblast) node of the Consumption (Потребление) view.
// Route: /consumption/region/:oblast
//
// The oblast's basket price index since the euro + its cheapest settlements
// and biggest risers, from the КЗП monitoring feed. Mirrors
// RegionGovernanceScreen's shell. Sofia city (SOF) is its own município that is
// also its own oblast with no region GeoJSON — send it to the city/município
// consumption dashboard instead of a degenerate one-município region page.

import { FC } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShoppingBasket, Scale } from "lucide-react";
import { SEO } from "@/ux/SEO";
import { useRegions } from "@/data/regions/useRegions";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { GovernancePricesTile } from "@/screens/governance/GovernancePricesTile";
import { ConsumptionAffordabilityTile } from "@/screens/consumption/ConsumptionAffordabilityTile";

export const RegionConsumptionScreen: FC = () => {
  const { oblast } = useParams<{ oblast: string }>();
  const { t, i18n } = useTranslation();
  const { findRegion } = useRegions();
  if (!oblast) return null;
  if (oblast === "SOF") {
    return <Navigate to="/consumption/SOF00" replace />;
  }

  const info = findRegion(oblast);
  const name = info
    ? (i18n.language === "bg"
        ? info.long_name || info.name
        : info.long_name_en || info.name_en) || oblast
    : oblast;

  return (
    <>
      <SEO
        title={`${t("consumption_title")} — ${name}`}
        description={t("consumption_seo_description")}
        // Thin place-tier variant of the prerendered governance region page
        // (shares its basket tile) — consolidate signal there rather than be
        // indexed as a near-duplicate. Region/place consumption nodes are
        // SPA-only (not prerendered / not in the sitemap).
        canonical={`https://electionsbg.com/governance/region/${oblast}`}
      />
      <section className="my-4 space-y-6">
        <PlaceHeader
          active="consumption"
          level="region"
          oblast={oblast}
          fallbackName={name}
        />
        <DashboardSection
          id="prices"
          title={t("prices_section_overview") || "Кошница на цените"}
          subtitle={t("prices_not_cpi")}
          icon={ShoppingBasket}
        >
          <GovernancePricesTile oblast={oblast} />
        </DashboardSection>
        <DashboardSection
          id="finances"
          title={
            t("consumption_section_affordability") || "Достъпност на кошницата"
          }
          icon={Scale}
        >
          <ConsumptionAffordabilityTile oblast={oblast} />
        </DashboardSection>
      </section>
    </>
  );
};
