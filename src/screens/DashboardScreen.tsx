import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { DashboardCards } from "./dashboard/DashboardCards";
import { PlaceHeader } from "@/screens/components/PlaceHeader";

export const DashboardScreen = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const title = `${t("general_elections")} ${localDate(selected)}`;
  return (
    <>
      <SEO
        title={title}
        description="Interactive country map of the elections in Bulgaria"
      />
      <PlaceHeader active="parliamentary" level="country" className="my-4" />
      <DashboardCards />
    </>
  );
};
