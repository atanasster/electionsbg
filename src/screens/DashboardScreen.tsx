import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { DashboardCards } from "./dashboard/DashboardCards";
import { ToLocalLink } from "@/screens/components/CrossElectionLink";

export const DashboardScreen = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const title = `${t("general_elections")} ${localDate(selected)}`;
  return (
    <>
      <Title description="Interactive country map of the elections in Bulgaria">
        {title}
      </Title>
      <div className="-mt-4 mb-6 flex justify-center">
        <ToLocalLink level="country" />
      </div>
      <DashboardCards />
    </>
  );
};
