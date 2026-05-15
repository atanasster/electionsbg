// Companion to MpAssetsTile, scoped to non-MP officials (cabinet members,
// state agency heads, regional governors). Lists the top 5 by declared net
// worth with a deep link to the full /officials/assets ranking. Renders
// nothing when the rankings file is missing (fresh clone before the
// officials scraper has run).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUp, Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import { useOfficialsRankings } from "@/data/officials/useOfficialsRankings";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { formatThousands } from "@/data/utils";
import { StatCard } from "./StatCard";

const ROWS = 5;

const formatEurCompact = (n: number, lang: string): string => {
  const abs = Math.abs(n);
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  if (abs >= 1_000_000) {
    return `€${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1_000_000)}M`;
  }
  if (abs >= 10_000) {
    return `€${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n / 1000))}K`;
  }
  return `€${formatThousands(Math.round(n)) || "0"}`;
};

export const OfficialsAssetsTile: FC<{ className?: string }> = ({
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { rankings } = useOfficialsRankings();
  const { nameForBg } = useCandidateName();

  const topOfficials = useMemo(() => {
    if (!rankings) return [];
    return rankings.topOfficials.slice(0, ROWS);
  }, [rankings]);

  if (!rankings || topOfficials.length === 0) return null;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Briefcase className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("dashboard_officials_assets_title") ||
                "Officials by declared assets"}
            </span>
          </div>
          <Link
            to="/officials/assets"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1">
        {topOfficials.map((row, i) => {
          const delta = row.delta;
          return (
            <div
              key={row.slug}
              className="text-xs flex items-center gap-2 py-1"
            >
              <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                {i + 1}.
              </span>
              <Link
                to={`/officials/${row.slug}`}
                className="truncate flex-1 min-w-0 hover:underline"
              >
                <span className="block truncate">{nameForBg(row.name)}</span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {row.positionTitle ?? row.institution}
                </span>
              </Link>
              <span className="text-muted-foreground text-[10px] tabular-nums shrink-0 hidden sm:inline">
                {row.latestDeclarationYear}
              </span>
              <span className="font-mono tabular-nums shrink-0 min-w-[70px] text-right">
                {formatEurCompact(row.netWorthEur, i18n.language)}
              </span>
              {delta && delta.absoluteEur !== 0 ? (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 min-w-[58px] justify-end ${
                    delta.absoluteEur > 0 ? "text-green-600" : "text-red-600"
                  }`}
                  title={`${delta.absoluteEur > 0 ? "+" : ""}€${formatThousands(Math.round(delta.absoluteEur))} ${t("vs_previous") || "vs"} ${delta.previousYear}`}
                >
                  {delta.absoluteEur > 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {delta.pct != null
                    ? `${Math.abs(delta.pct).toFixed(0)}%`
                    : formatEurCompact(
                        Math.abs(delta.absoluteEur),
                        i18n.language,
                      )}
                </span>
              ) : (
                <span className="text-[10px] shrink-0 min-w-[58px]" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
        <Link to="/officials/assets" className="text-primary hover:underline">
          {t("dashboard_officials_view_all") || "All officials by assets"} →
        </Link>
        <span>
          {t("dashboard_officials_count_label") ||
            "Cabinet, agencies, governors"}
        </span>
      </div>
    </StatCard>
  );
};
