import { useRegions } from "@/data/regions/useRegions";
import { Link } from "@/ux/Link";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const RegionLink: FC<{ oblast?: string }> = ({ oblast }) => {
  const { findRegion } = useRegions();
  const { i18n } = useTranslation();
  const region = findRegion(oblast);
  return (
    region && (
      <Link to={`/municipality/${oblast}`}>
        {i18n.language === "bg"
          ? region?.long_name || region?.name
          : region?.long_name_en || region?.name_en}
      </Link>
    )
  );
};
