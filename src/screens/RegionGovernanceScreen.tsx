// Region (oblast) node of the Governance view.
// Route: /governance/region/:oblast
//
// The regional money + representation picture, minus the elected-local-
// government block: an oblast has no council of its own (appointed governor),
// so the mayor/council/kmetstvo/LISI/local-tax tiles that the município node
// carries have no oblast equivalent. What remains is the "programmes filtered
// by region" cut — Чл.53 transfers, regional indicators, census, property/
// land-use — plus the region's MPs and their declarations.
//
// Sofia city (SOF) is a single município that is also its own oblast, with no
// region GeoJSON of its own — send it to the dedicated city/município
// governance dashboard instead of a degenerate one-município region page.

import { FC } from "react";
import { useParams, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { useRegions } from "@/data/regions/useRegions";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { RegionGovernanceCards } from "./dashboard/RegionGovernanceCards";

export const RegionGovernanceScreen: FC = () => {
  const { oblast } = useParams<{ oblast: string }>();
  const { i18n } = useTranslation();
  const { findRegion } = useRegions();
  if (!oblast) return null;
  if (oblast === "SOF") {
    return <Navigate to="/governance/SOF00" replace />;
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
        title={name}
        description="Regional governance — transfers, indicators and representation for an oblast in Bulgaria"
      />
      <section className="my-4 space-y-6">
        <PlaceHeader
          active="governance"
          level="region"
          oblast={oblast}
          fallbackName={name}
        />
        <RegionGovernanceCards regionCode={oblast} />
      </section>
    </>
  );
};
