import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/ux/Hint";
import { useTouch } from "@/ux/TouchProvider";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export const useConsolidatedLabel = () => {
  const [isConsolidated, setIsConsolidated] = useState(
    localStorage.getItem("consolidated_history") === "true",
  );
  const { t } = useTranslation();
  const isTouch = useTouch();
  const consolidated = (
    <Hint text={t("consolidated_data_explainer")}>
      <div className="flex items-center space-x-2 pb-4 justify-end">
        <Switch
          id="consolidated-mode"
          checked={isConsolidated}
          onCheckedChange={(value) => {
            localStorage.setItem(
              "consolidated_history",
              value ? "true" : "false",
            );
            setIsConsolidated(value);
          }}
        />
        <Label
          className="text-secondary-foreground"
          htmlFor={isTouch ? undefined : "consolidated-mode"}
        >
          {t("consolidated_data")}
        </Label>
      </div>
    </Hint>
  );
  return { isConsolidated, consolidated };
};
