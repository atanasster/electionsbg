import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { useDemographicCleavages } from "@/data/dashboard/useDemographicCleavages";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import { selectCleavageRows } from "./selectCleavageRows";
import { DemographicCleavagesPlot } from "@/screens/components/demographics/DemographicCleavagesPlot";

export const DemographicCleavagesTile: FC = () => {
  const { t } = useTranslation();
  const { data: payload } = useDemographicCleavages();

  const rows = useMemo(
    () => (payload ? selectCleavageRows(payload.rows) : []),
    [payload],
  );

  if (!payload || rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_demographic_cleavages_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{t("dashboard_demographic_cleavages")}</span>
            </div>
          </Hint>
          <Link
            to="/party-demographics"
            className="text-[10px] normal-case text-primary hover:underline"
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <DemographicCleavagesPlot payload={payload} rows={rows} />
    </StatCard>
  );
};
