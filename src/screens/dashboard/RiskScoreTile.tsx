import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useRiskScoreSummary } from "@/data/riskScore/useRiskScore";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";

// Home-page tile — count of sections in the "critical" risk band, plus
// the three highest-scoring sections. Mirrors RiskScoreTopSections on the
// risk-analysis page but compact (3 rows, no per-signal breakdown).
export const RiskScoreTile: FC = () => {
  const { t } = useTranslation();
  const { data } = useRiskScoreSummary();
  const { data: nat } = useNationalSummary();
  const { displayNameFor } = useCanonicalParties();

  const { top, criticalCount, totalCount, criticalShare } = useMemo(() => {
    if (!data)
      return { top: [], criticalCount: 0, totalCount: 0, criticalShare: 0 };
    const sorted = [...data.topCritical]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return {
      top: sorted,
      criticalCount: data.counts.critical,
      totalCount: data.totalSections,
      criticalShare: data.totalSections
        ? (100 * data.counts.critical) / data.totalSections
        : 0,
    };
  }, [data]);

  if (!data || criticalCount === 0) return null;

  const partyMap = new Map((nat?.parties ?? []).map((p) => [p.partyNum, p]));

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_risk_score_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("dashboard_risk_score")}</span>
            </div>
          </Hint>
          <Link
            to="/risk-score"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="flex items-baseline gap-3 mt-1">
        <span className="text-2xl font-semibold tabular-nums">
          {formatThousands(criticalCount)}
        </span>
        <span className="text-xs text-muted-foreground">
          {t("dashboard_risk_score_critical_suffix", {
            total: formatThousands(totalCount),
            pct: formatPct(criticalShare, 2),
          })}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm mt-1">
        {top.map((r) => {
          const party = r.partyNum ? partyMap.get(r.partyNum) : undefined;
          return (
            <li key={r.section} className="flex items-center gap-2 min-w-0">
              {party ? (
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: party.color || "#888" }}
                  title={
                    party?.nickName
                      ? (displayNameFor(party.nickName) ?? party.nickName)
                      : undefined
                  }
                />
              ) : (
                <span className="inline-block w-2.5 h-2.5 shrink-0" />
              )}
              <Link
                to={`/section/${r.section}`}
                className="truncate text-xs font-mono"
                underline={false}
                title={r.section}
              >
                {r.section}
              </Link>
              <span className="ml-auto shrink-0">
                <RiskBandBadge band={r.band} score={r.score} size="sm" />
              </span>
            </li>
          );
        })}
      </ul>
    </StatCard>
  );
};
