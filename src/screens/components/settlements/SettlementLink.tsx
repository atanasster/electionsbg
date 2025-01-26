import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { Link } from "@/ux/Link";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const SettlementLink: FC<{ ekatte?: string }> = ({ ekatte }) => {
  const { findSettlement } = useSettlementsInfo();
  const { i18n } = useTranslation();
  const settlement = findSettlement(ekatte);
  return (
    settlement && (
      <Link to={`/sections/${ekatte}`}>
        {i18n.language === "bg" ? settlement?.name : settlement?.name_en}
      </Link>
    )
  );
};
