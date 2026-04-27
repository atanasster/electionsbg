import { FC } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { SettlementSuemgTable } from "./components/settlements/SettlementSuemgTable";

export const MunicipalityFlashMemoryScreen: FC = () => {
  const { id: muniCode } = useParams();
  const { findMunicipality } = useMunicipalities();
  const { selected } = useElectionContext();
  const { t, i18n } = useTranslation();
  if (!muniCode) return null;
  const info = findMunicipality(muniCode);
  const name =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || muniCode;
  const title = `${name} — ${t("dashboard_flash_memory_diff")} — ${localDate(selected)}`;
  return (
    <>
      <Title description={t("all_flash_memory_description")}>{title}</Title>
      <div className="w-full max-w-7xl mx-auto px-4 pb-12">
        <SettlementSuemgTable municipality={muniCode} title={title} />
      </div>
    </>
  );
};
