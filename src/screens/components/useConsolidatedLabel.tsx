import { HintedSwitch } from "@/ux/HintedSwitch";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const useConsolidatedLabel = () => {
  const [isConsolidated, setIsConsolidated] = useState(
    localStorage.getItem("consolidated_history") === "true",
  );
  const { t } = useTranslation();
  const consolidated = (
    <HintedSwitch
      hint={t("consolidated_data_explainer")}
      label={t("consolidated_data")}
      value={isConsolidated}
      setValue={(value) => {
        localStorage.setItem("consolidated_history", value ? "true" : "false");
        setIsConsolidated(value);
      }}
    />
  );
  return { isConsolidated, consolidated };
};
