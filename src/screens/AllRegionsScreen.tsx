import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";
import { RegionsAreasTable } from "./components/regions/RegionsAreasTable";

export const AllRegionsScreen: FC = () => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const title = `${t("top_regions")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_regions_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <RegionsAreasTable />
      </div>
    </>
  );
};
