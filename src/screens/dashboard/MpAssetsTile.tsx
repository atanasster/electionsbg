import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useAssetsRankings } from "@/data/parliament/useAssetsRankings";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { formatThousands } from "@/data/utils";
import { StatCard } from "./StatCard";

const ROWS = 5;

// Compact euro formatter for very large values: €1.2M, €350K, €12 500.
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

type Props = {
  /** Optional region code (e.g. "S23"). When provided, the tile focuses on
   * MPs from that region; when omitted, it shows nationwide top MPs.
   * Mutually exclusive with `regionCodes`. */
  regionCode?: string;
  /** Optional set of region codes (e.g. Sofia's three MIRs). Used to union
   * MPs across multiple regions for a city-level view. */
  regionCodes?: string[];
  className?: string;
};

export const MpAssetsTile: FC<Props> = ({
  regionCode,
  regionCodes,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { rankings } = useAssetsRankings();
  const { selected } = useElectionContext();
  const { findMpsByRegion } = useMps();

  // Default to MPs of the currently selected parliament. Fall back to the
  // lifetime list when the selected election doesn't map to an NS we have
  // declarations for.
  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const regionMpIds = useMemo(() => {
    const codes = regionCodes ?? (regionCode ? [regionCode] : null);
    if (!codes || codes.length === 0) return null;
    if (!selectedFolder) return null;
    const ids = new Set<number>();
    for (const code of codes) {
      const mir = oblastToMir(code);
      if (!mir) continue;
      for (const m of findMpsByRegion(mir, selectedFolder)) ids.add(m.id);
    }
    return ids;
  }, [regionCode, regionCodes, selectedFolder, findMpsByRegion]);

  const isRegional = regionMpIds != null;

  const topMps = useMemo(() => {
    if (!rankings) return [];
    if (isRegional) {
      return rankings.topMps
        .filter((m) => regionMpIds!.has(m.mpId))
        .slice(0, ROWS);
    }
    if (selectedFolder && rankings.byNs[selectedFolder]?.topMps?.length) {
      return rankings.byNs[selectedFolder].topMps.slice(0, ROWS);
    }
    return rankings.topMps.slice(0, ROWS);
  }, [rankings, isRegional, regionMpIds, selectedFolder]);

  const detailsTo = useMemo(() => {
    if (regionCodes && regionCodes.length > 0) {
      const params = new URLSearchParams({ regions: regionCodes.join(",") });
      return `/mp-assets?${params.toString()}`;
    }
    if (regionCode) {
      const params = new URLSearchParams({ region: regionCode });
      return `/mp-assets?${params.toString()}`;
    }
    return "/mp-assets";
  }, [regionCode, regionCodes]);

  if (!rankings) return null;
  if (topMps.length === 0) return null;

  const titleKey = isRegional
    ? "dashboard_mp_assets_region_title"
    : "dashboard_mp_assets_title";
  const titleFallback = isRegional
    ? "Region MPs by declared assets"
    : "MPs by declared assets";

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="h-4 w-4 shrink-0" />
            <span className="truncate">{t(titleKey) || titleFallback}</span>
          </div>
          <Link
            to={detailsTo}
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
                to={candidateUrlForMp(row.mpId)}
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
        <Link to={detailsTo} className="text-primary hover:underline">
          {t("dashboard_mp_assets_view_all") || "All MPs by assets"} →
        </Link>
        <span>
          {t("dashboard_mp_assets_count_label") ||
            "Net worth (€), declarant + spouse"}
        </span>
      </div>
    </StatCard>
  );
};
