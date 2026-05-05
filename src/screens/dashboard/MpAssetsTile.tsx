import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useAssetsRankings } from "@/data/parliament/useAssetsRankings";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { formatThousands } from "@/data/utils";
import { StatCard } from "./StatCard";

const ROWS = 5;

// Compact BGN formatter for very large values: 1.2M, 350K, 12,500.
const formatBgnCompact = (n: number, lang: string): string => {
  const abs = Math.abs(n);
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1_000_000)}M`;
  }
  if (abs >= 10_000) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(n / 1000))}K`;
  }
  return formatThousands(Math.round(n)) || "0";
};

type Props = {
  className?: string;
};

export const MpAssetsTile: FC<Props> = ({ className }) => {
  const { t, i18n } = useTranslation();
  const { rankings } = useAssetsRankings();
  const { selected } = useElectionContext();

  // Default to MPs of the currently selected parliament. Fall back to the
  // lifetime list when the selected election doesn't map to an NS we have
  // declarations for.
  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const topMps = useMemo(() => {
    if (!rankings) return [];
    if (selectedFolder && rankings.byNs[selectedFolder]?.topMps?.length) {
      return rankings.byNs[selectedFolder].topMps.slice(0, ROWS);
    }
    return rankings.topMps.slice(0, ROWS);
  }, [rankings, selectedFolder]);

  if (!rankings) return null;
  if (topMps.length === 0) return null;

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("dashboard_mp_assets_title") || "MPs by declared assets"}
            </span>
          </div>
          <Link
            to="/mp-assets"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1">
        {topMps.map((row, i) => {
          const delta = row.delta;
          return (
            <div
              key={row.mpId}
              className="text-xs flex items-center gap-2 py-1"
            >
              <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                {i + 1}.
              </span>
              <MpAvatar mpId={row.mpId} name={row.label} />
              <Link
                to={`/candidate/${encodeURIComponent(row.label)}`}
                className="hover:underline truncate flex-1"
              >
                {row.label}
              </Link>
              {row.partyGroupShort && (
                <span className="text-muted-foreground text-[10px] truncate max-w-[110px] shrink-0">
                  {row.partyGroupShort}
                </span>
              )}
              <span className="text-muted-foreground text-[10px] tabular-nums shrink-0 hidden sm:inline">
                {row.latestDeclarationYear}
              </span>
              <span className="font-mono tabular-nums shrink-0 min-w-[70px] text-right">
                {formatBgnCompact(row.netWorthBgn, i18n.language)}
              </span>
              {delta && delta.absoluteBgn !== 0 ? (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 min-w-[58px] justify-end ${
                    delta.absoluteBgn > 0 ? "text-green-600" : "text-red-600"
                  }`}
                  title={`${delta.absoluteBgn > 0 ? "+" : ""}${formatThousands(Math.round(delta.absoluteBgn))} лв ${t("vs_previous") || "vs"} ${delta.previousYear}`}
                >
                  {delta.absoluteBgn > 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {delta.pct != null
                    ? `${Math.abs(delta.pct).toFixed(0)}%`
                    : formatBgnCompact(
                        Math.abs(delta.absoluteBgn),
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
        <Link to="/mp-assets" className="text-primary hover:underline">
          {t("dashboard_mp_assets_view_all") || "All MPs by assets"} →
        </Link>
        <span>
          {t("dashboard_mp_assets_count_label") ||
            "BGN net worth, declarant + spouse"}
        </span>
      </div>
    </StatCard>
  );
};
