// /governance/overview — the country node of the Governance place-view (the
// national at-a-glance dashboard). This is the former /governance body: the
// unified PlaceHeader (Governance eyebrow + the view switcher across to the
// parliamentary home and the local-country overview) over the live
// GovernanceCards dashboard. /governance itself is now the Управление tile-hub
// (GovernanceScreen); the place-view's country URL points here
// (placeViews.governanceUrl).

import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { useHashScroll } from "@/ux/useHashScroll";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { GovernanceCards } from "./GovernanceCards";

export const GovernanceOverviewScreen = () => {
  const { t } = useTranslation();
  // Re-run on every render so the scroll catches up after the cards render
  // asynchronously; the hook gates on the hash being present.
  useHashScroll([]);
  const title = t("gov_hub_overview_title") || "National overview";
  const description =
    t("governance_seo_description") ||
    "Parliament voting, MP declarations, state budget, public procurement, party financing and macroeconomic context for Bulgaria.";
  return (
    <>
      <SEO title={title} description={description} />
      <div data-og="governance-overview">
        <PlaceHeader active="governance" level="country" className="my-4" />
        <GovernanceCards />
      </div>
    </>
  );
};
