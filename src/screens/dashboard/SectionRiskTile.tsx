import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Hint } from "@/ux/Hint";
import { useRiskScoreForSection } from "@/data/riskScore/useRiskScore";
import { StatCard } from "./StatCard";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";
import { RiskWaterfall } from "@/screens/components/riskScore/RiskWaterfall";
import { MethodologyCallout } from "@/screens/components/MethodologyCallout";
import { formatPct } from "@/data/utils";

// Risk-screening tile on the section detail page. Renders only when the
// section has a computed risk row (i.e. we have signal data for it). The
// tile is the dedicated home for the score decomposition now — the old
// /risk-score/:sectionId route was redundant once we moved this onto the
// section page itself.
export const SectionRiskTile: FC<{ sectionCode: string }> = ({
  sectionCode,
}) => {
  const { t } = useTranslation();
  const { row } = useRiskScoreForSection(sectionCode);
  if (!row) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2 flex-wrap">
          <Hint text={t("risk_score_description")} underline={false}>
            <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("risk_score_section_title")}</span>
            </div>
          </Hint>
          <RiskBandBadge
            band={row.band}
            score={row.score}
            signalsAvailable={row.signalsAvailable}
            signalsTotal={row.signalsTotal}
            size="sm"
          />
        </div>
      }
      className="overflow-hidden"
    >
      <MethodologyCallout variant="disputed" className="text-[11px] my-2">
        {t("risk_score_caveat_body")}
      </MethodologyCallout>

      {/* Compact KPI row */}
      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("risk_score_label")}
          </div>
          <div className="text-xl font-bold tabular-nums">
            {row.score.toFixed(1)}
            <span className="text-xs text-muted-foreground ml-1">/100</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("risk_percentile_label")}
          </div>
          <div className="text-xl font-bold tabular-nums">
            {row.percentileInMunicipality !== undefined
              ? formatPct(row.percentileInMunicipality * 100, 0)
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("risk_signals_label")}
          </div>
          <div className="text-xl font-bold tabular-nums">
            {row.signalsAvailable}
            <span className="text-xs text-muted-foreground ml-1">
              / {row.signalsTotal}
            </span>
          </div>
        </div>
      </div>

      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        {t("risk_decomposition_label")}
      </div>
      <RiskWaterfall row={row} />
    </StatCard>
  );
};
