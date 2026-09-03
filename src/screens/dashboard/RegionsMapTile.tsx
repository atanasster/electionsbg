import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { RegionsMap } from "@/screens/components/regions/RegionsMap";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { StatCard } from "./StatCard";

export const RegionsMapTile: FC = () => {
  const { t } = useTranslation();
  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4" />
          <span>{t("dashboard_regional_map")}</span>
        </div>
      }
      hint={t("dashboard_regional_map_hint")}
    >
      {/* The measuring box is shared with the shell's map adapter — see MeasuredMapBox. */}
      <MeasuredMapBox>{(size) => <RegionsMap size={size} />}</MeasuredMapBox>
    </StatCard>
  );
};
