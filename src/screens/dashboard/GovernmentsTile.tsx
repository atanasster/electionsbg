import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { useGovernments } from "@/data/governments/useGovernments";
import { useMacro } from "@/data/macro/useMacro";
import {
  CabinetStrip,
  GovernmentTimeline,
} from "@/screens/components/governments/GovernmentTimeline";
import { xDomainFor } from "@/screens/components/governments/governmentTimelineUtils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

export const GovernmentsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: governments } = useGovernments();
  const { data: macro } = useMacro();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const xDomain = useMemo<[number, number] | null>(
    () => (governments ? xDomainFor(governments) : null),
    [governments],
  );

  if (!governments?.length || !macro) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_governments_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4" />
              <span>{t("governments_title")}</span>
            </div>
          </Hint>
          <Link
            to="/governments"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
      className="overflow-hidden"
    >
      {xDomain ? (
        <CabinetStrip governments={governments} xDomain={xDomain} lang={lang} />
      ) : null}
      <GovernmentTimeline
        governments={governments}
        macro={macro}
        indicatorKeys={["gdpGrowth", "inflation", "unemployment"]}
        yAxisFormatter={(v) => `${v}%`}
        unitFormatter={(_k, v) => `${v.toFixed(1)}%`}
        showZeroLine
        height={240}
        hideToggles
      />
    </StatCard>
  );
};
