import { HintedSwitch } from "@/ux/HintedSwitch";
import { useTranslation } from "react-i18next";
import { useConsolidated } from "@/data/ConsolidatedContext";

export const useConsolidatedLabel = () => {
  const { isConsolidated, setIsConsolidated } = useConsolidated();
  const { t } = useTranslation();
  const consolidated = (
    <HintedSwitch
      hint={t("consolidated_data_explainer")}
      label={t("consolidated_data")}
      value={isConsolidated}
      setValue={setIsConsolidated}
    />
  );
  return { isConsolidated, consolidated };
};
