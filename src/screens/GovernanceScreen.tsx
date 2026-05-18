import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useHashScroll } from "@/ux/useHashScroll";
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
      <Title description={description}>{title}</Title>
      <GovernanceCards />
    </>
  );
};
