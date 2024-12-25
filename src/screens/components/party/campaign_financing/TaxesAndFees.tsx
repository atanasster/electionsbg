import { FilingTaxes } from "@/data/dataTypes";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ItemsTree, TreeItemType } from "./ItemsTree";

export const TaxesAndFees: FC<{
  taxes?: FilingTaxes;
  priorTaxes?: FilingTaxes;
}> = ({ taxes, priorTaxes }) => {
  const { t } = useTranslation();
  return useMemo(() => {
    const items: TreeItemType[] = [
      {
        label: t("tax_on_donations"),
        amount: taxes?.taxOnDonations,
        priorAmount: priorTaxes?.taxOnDonations,
      },
      {
        label: t("other"),
        amount: taxes?.otherTaxes,
        priorAmount: priorTaxes?.otherTaxes,
      },
      {
        label: t("taxes"),
        amount: taxes?.taxes,
        priorAmount: priorTaxes?.taxes,
      },
    ];
    return <ItemsTree items={items} />;
  }, [taxes, priorTaxes, t]);
};
