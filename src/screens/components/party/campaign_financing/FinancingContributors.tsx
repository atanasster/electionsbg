import { FinancingType } from "@/data/dataTypes";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ItemsTree, TreeItemType } from "./ItemsTree";

export const FinancingContributors: FC<{
  financing?: FinancingType;
  priorFinancing?: FinancingType;
}> = ({ financing, priorFinancing }) => {
  const { t } = useTranslation();
  return useMemo(() => {
    const items: TreeItemType[] = [
      {
        label: t("monetary"),
        amount: financing?.monetary,
        priorAmount: priorFinancing?.monetary,
      },
      {
        label: t("non_monetary"),
        amount: financing?.nonMonetary,
        priorAmount: priorFinancing?.nonMonetary,
      },
    ];
    return <ItemsTree items={items} />;
  }, [financing, priorFinancing, t]);
};
