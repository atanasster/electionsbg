import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { useHashScroll } from "@/ux/useHashScroll";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { GovernanceCards } from "./governance/GovernanceCards";

export const GovernanceScreen = () => {
  const { t } = useTranslation();
  // Re-run on every render so the scroll catches up after the cards
  // render asynchronously. Empty dep array is fine — the hook itself
  // gates on the hash being present.
  useHashScroll([]);
  const title = t("governance_title") || "Governance";
  const description =
    t("governance_seo_description") ||
    "Parliament voting, MP declarations, state budget, public procurement, party financing and macroeconomic context for Bulgaria.";
  return (
    <>
      <SEO title={title} description={description} />
      {/* Country node of the Governance view — the unified place header
          carries the Governance eyebrow + the switcher across to the
          parliamentary home (/) and the local-country overview. */}
      <PlaceHeader active="governance" level="country" className="my-4" />
      <GovernanceCards />
    </>
  );
};
