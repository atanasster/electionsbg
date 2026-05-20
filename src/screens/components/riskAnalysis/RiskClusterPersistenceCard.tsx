import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { useClusterPersistence } from "@/data/riskScore/useClusterPersistence";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { localDate } from "@/data/utils";
import { StatCard } from "@/screens/dashboard/StatCard";
import { Hint } from "@/ux/Hint";
import { Tooltip } from "@/ux/Tooltip";
import { Link } from "@/ux/Link";
import { RiskBandBadge } from "@/screens/components/riskScore/RiskBandBadge";

// `/risk-analysis` section — geographic knots that clustered (screened
// elevated-or-above as a same-party bloc) in two or more elections. A
// VIEW over the per-election risk clusters; see useClusterPersistence /
// scripts/reports/cluster_persistence.ts for the methodology.

const HEADER_CLASS =
  "text-[10px] font-medium uppercase tracking-wide text-muted-foreground";
const stripPrefix = (s?: string) => (s ?? "").replace(/^\d+\.\s*/, "");

export const RiskClusterPersistenceCard: FC = () => {
  const { t, i18n } = useTranslation();
  const isBg = i18n.language === "bg";
  const { data } = useClusterPersistence();
  const { displayNameFor, colorFor } = useCanonicalParties();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();

  if (!data || data.loci.length === 0) return null;

  // Every locus is listed (not a top-N preview) — each row links to its
  // detail page, so a cap would strand the rest.
  const loci = data.loci;
  const deep = loci.filter((l) => l.electionCount >= 3).length;

  return (
    <StatCard
      label={
        <Hint text={t("risk_persistence_hint")} underline={false}>
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4" />
            <span>{t("risk_persistence_title")}</span>
          </div>
        </Hint>
      }
    >
      <p className="text-sm text-muted-foreground leading-relaxed mt-1">
        {t("risk_persistence_headline", { count: data.loci.length, deep })}
      </p>

      <div className="mt-2 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto_auto] gap-x-3 gap-y-2 items-center text-sm">
        <span className={HEADER_CLASS}>{t("risk_analysis_location")}</span>
        <span className={HEADER_CLASS}>
          {t("risk_persistence_col_timeline")}
        </span>
        <span className={`${HEADER_CLASS} text-right`}>
          {t("risk_clusters_col_sections")}
        </span>
        <span className={`${HEADER_CLASS} text-right`}>
          {t("risk_col_band")}
        </span>
        {loci.map((locus) => {
          const region = findRegion(locus.oblast);
          const muni = findMunicipality(locus.obshtina);
          const settlement = findSettlement((locus.ekatte || "").split("-")[0]);
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
          const location =
            [settlementName, muniName, oblastName]
              .filter((s, idx, arr) => !!s && arr.indexOf(s) === idx)
              .join(" · ") ||
            locus.ekatte ||
            "—";
          return (
            <div className="contents" key={locus.id}>
              <Link
                to={`/risk-analysis/cluster/${locus.id}`}
                underline={false}
                title={location}
                className="truncate text-xs font-medium hover:underline"
              >
                {location}
              </Link>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs font-semibold tabular-nums mr-0.5">
                  {locus.electionCount}×
                </span>
                {locus.appearances.map((a) => {
                  const color =
                    (a.winnerNickName && colorFor(a.winnerNickName)) ||
                    a.winnerColor ||
                    "#888";
                  const partyName = a.winnerNickName
                    ? (displayNameFor(a.winnerNickName) ?? a.winnerNickName)
                    : "—";
                  return (
                    <Tooltip
                      key={a.election}
                      content={`${localDate(a.election)} · ${partyName}`}
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    </Tooltip>
                  );
                })}
              </div>
              <span className="tabular-nums text-xs font-semibold text-right">
                {locus.sectionCount}
              </span>
              <span className="justify-self-end">
                <RiskBandBadge
                  band={locus.maxBand}
                  score={locus.maxScore}
                  size="sm"
                />
              </span>
            </div>
          );
        })}
      </div>
    </StatCard>
  );
};
