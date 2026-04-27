import { useTranslation } from "react-i18next";

import { Title } from "@/ux/Title";
import { SofiaDashboardCards } from "./dashboard/SofiaDashboardCards";

export const SofiaScreen = () => {
  const { t } = useTranslation();
  const title = t("sofia_city");
  return (
    <>
      <Title description="Interactive country map of the elections in Sofia">
        {title}
      </Title>
      <SofiaDashboardCards />
    </>
  );
};
