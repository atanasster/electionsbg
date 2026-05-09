import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { Title } from "@/ux/Title";
import { useCensus } from "@/data/census/useCensus";
import { OblastDemographicsTable } from "./components/demographics/OblastDemographicsTable";

export const RegionsDemographicsScreen = () => {
  const { t } = useTranslation();
  const { data: census } = useCensus();

  return (
    <div className="w-full max-w-6xl mx-auto px-4 pb-12">
      <Link
        to="/demographics"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("demographics_title")}
      </Link>
      <Title description={t("demographics_regions_description")}>
        {t("demographics_regions_title")}
      </Title>
      {census && <OblastDemographicsTable oblasts={census.oblasts} lockedLevel="oblast" />}
    </div>
  );
};
