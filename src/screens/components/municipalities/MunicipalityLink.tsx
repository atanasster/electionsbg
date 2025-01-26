import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { Link } from "@/ux/Link";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const MunicipalityLink: FC<{ obshtina?: string }> = ({ obshtina }) => {
  const { i18n } = useTranslation();
  const { findMunicipality } = useMunicipalities();
  const municipality = findMunicipality(obshtina);
  return (
    obshtina && (
      <Link to={`/settlement/${obshtina}`}>
        {i18n.language === "bg" ? municipality?.name : municipality?.name_en}
      </Link>
    )
  );
};
