import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { GovernanceCards } from "./governance/GovernanceCards";

export const GovernanceScreen = () => {
  const { t } = useTranslation();
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
