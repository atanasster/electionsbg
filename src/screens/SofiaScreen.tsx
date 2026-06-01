import { useTranslation } from "react-i18next";

import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { SofiaDashboardCards } from "./dashboard/SofiaDashboardCards";

export const SofiaScreen = () => {
  const { t } = useTranslation();
  const title = t("sofia_city");
  return (
    <>
      <SEO
        title={title}
        description="Interactive country map of the elections in Sofia"
      />
      {/* Unified place header — the parliamentary view of Sofia city, with
          the three-way switcher (My-Area governance / Parliamentary / Local
          elections). The Sofia aggregate carries no município row, so the
          title comes from fallbackName and the switcher resolves the triad
          via the SOF00↔SOF↔/sofia special case in placeViews. */}
      <PlaceHeader
        active="parliamentary"
        level="municipality"
        obshtina="SOF00"
        fallbackName={title}
        className="my-4"
      />
      <SofiaDashboardCards />
    </>
  );
};
