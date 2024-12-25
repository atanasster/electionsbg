import { PartyFilingIncome } from "@/data/dataTypes";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ItemsTree, TreeItemType } from "./ItemsTree";

export const NonMonetary: FC<{
  income?: PartyFilingIncome;
  priorIncome?: PartyFilingIncome;
}> = ({ income, priorIncome }) => {
  const { t } = useTranslation();
  return useMemo(() => {
    const items: TreeItemType[] = [
      {
        label: t("donors"),
        amount: income?.donors.nonMonetary,
        priorAmount: priorIncome?.donors.nonMonetary,
      },
      {
        label: t("candidates"),
        amount: income?.candidates.nonMonetary,
        priorAmount: priorIncome?.candidates.nonMonetary,
      },
      {
        label: t("parties"),
        amount: income?.party.nonMonetary,
        priorAmount: priorIncome?.party.nonMonetary,
      },
    ];
    return <ItemsTree items={items} />;
  }, [income, priorIncome, t]);
};
