import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useRiskScore } from "@/data/riskScore/useRiskScore";
import { useNationalSummary } from "@/data/dashboard/useNationalSummary";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { formatPct, formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";

const TOP_N = 10;

const stripPrefix = (s?: string) => (s ?? "").replace(/^\d+\.\s*/, "");

// Risk-analysis page section — top N highest-scoring sections in the
// "critical" band, with full location labels (oblast → settlement) so
// the screening hits are recognizable without a click. Headline counts
// every section in each band so the reader sees the band distribution
// before drilling in.
export const RiskScoreTopCard: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useRiskScore();
  const { data: nat } = useNationalSummary();
  const { displayNameFor } = useCanonicalParties();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();

  const { top, totals } = useMemo(() => {
    const rows = data?.rows ?? [];
    const counts = { low: 0, elevated: 0, high: 0, critical: 0 };
    for (const r of rows) counts[r.band]++;
    const critical = rows
      .filter((r) => r.band === "critical")
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
    return { top: critical, totals: { ...counts, total: rows.length } };
  }, [data]);

  if (!data) return null;
  if (!totals.total) return null;

  const partyMap = new Map((nat?.parties ?? []).map((p) => [p.partyNum, p]));
  const criticalShare = totals.total
    ? (100 * totals.critical) / totals.total
    : 0;
  const highOrAboveShare = totals.total
    ? (100 * (totals.critical + totals.high)) / totals.total
    : 0;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("risk_analysis_sections_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span>{t("risk_analysis_sections_title")}</span>
            </div>
          </Hint>
          <Link
            to="/risk-score"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("risk_analysis_sections_see_all", {
              total: formatThousands(totals.total),
            })}{" "}
            →
          </Link>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
        {t("risk_analysis_sections_headline", {
          critical: formatThousands(totals.critical),
          criticalPct: formatPct(criticalShare, 2),
          highOrAbove: formatThousands(totals.critical + totals.high),
          highOrAbovePct: formatPct(highOrAboveShare, 2),
        })}
      </p>
      {top.length > 0 ? (
        <div className="mt-2 grid grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1.5 items-center text-sm">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("dashboard_party")}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("risk_analysis_location")}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("section")}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
            {t("votes")}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground text-right">
            {t("risk_col_band")}
          </span>
          {top.map((r) => {
            const party = r.partyNum ? partyMap.get(r.partyNum) : undefined;
            const region = findRegion(r.oblast);
            const muni = findMunicipality(r.obshtina);
            const settlement = findSettlement(r.ekatte);
            const oblastName = isBg
              ? stripPrefix(region?.long_name || region?.name)
              : stripPrefix(
                  region?.long_name_en || region?.name_en || region?.name,
                );
            const muniName = isBg
              ? muni?.long_name || muni?.name
              : muni?.long_name_en || muni?.name_en || muni?.name;
            const settlementName = isBg
              ? settlement?.name
              : settlement?.name_en || settlement?.name;
            const locParts = [settlementName, muniName, oblastName].filter(
              (s) => !!s && s !== settlementName,
            );
            const location =
              [settlementName, ...locParts].filter(Boolean).join(" · ") ||
              r.ekatte ||
              "—";
            return (
              <div className="contents" key={r.section}>
                <div className="flex items-center gap-2 min-w-0">
                  {party ? (
                    <>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: party.color || "#888" }}
                      />
                      <span className="truncate text-xs font-medium">
                        {displayNameFor(party.nickName) ?? party.nickName}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
                <span
                  className="truncate text-xs text-muted-foreground"
                  title={location}
                >
                  {location}
                </span>
                <Link
                  to={`/section/${r.section}`}
                  className="text-xs font-mono"
                  underline={false}
                >
                  {r.section}
                </Link>
                <span className="tabular-nums text-xs text-muted-foreground text-right">
                  {r.totalVotes !== undefined
                    ? formatThousands(r.totalVotes)
                    : "—"}
                </span>
                <span className="justify-self-end">
                  <RiskBandBadge band={r.band} score={r.score} size="sm" />
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </StatCard>
  );
};
