import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import {
  eur,
  toScopedMpIds,
  useMpAssetsTopRows,
} from "@/data/parliament/useAssetsRankings";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
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
  const { selected } = useElectionContext();
  const { findMpsByRegion, findMpById } = useMps();
  const { mpName } = useCandidateName();
  const { partyGroupShortLabel } = useCanonicalParties();

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

  // Registry top-N (mp_assets_rankings). Regional → an mp_id IN filter; an empty region set
  // becomes the -1 sentinel (via toScopedMpIds) so it yields zero rows, not the whole scope.
  const mpIds = useMemo(
    () => toScopedMpIds(regionMpIds ? [...regionMpIds] : null),
    [regionMpIds],
  );

  // Prefer the selected parliament's ns bucket; fall back to the lifetime ('all') list when
  // that bucket has no rows. (Slightly more eager than the old pool-level fallback for the
  // regional case — an ns bucket present but holding none of the region's MPs also falls
  // back — which shows the region's lifetime top rather than an empty tile.)
  const primaryNs = selectedFolder ?? "all";
  const primary = useMpAssetsTopRows({ ns: primaryNs, mpIds, limit: ROWS });
  const doFallback =
    selectedFolder != null && !primary.isLoading && primary.rows.length === 0;
  const fallback = useMpAssetsTopRows({
    ns: "all",
    mpIds,
    limit: ROWS,
    enabled: doFallback,
  });
  const topMps = primary.rows.length ? primary.rows : fallback.rows;

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
            {t("dashboard_mp_assets_view_all") || "View all"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1">
        {topMps.map((row, i) => {
          const deltaAbs = eur(row.deltaAbsoluteEur);
          const deltaPct = eur(row.deltaPct);
          const net = eur(row.netWorthEur);
          const mp = findMpById(row.mpId);
          const display = mp ? mpName(mp) : row.name;
          return (
            <div
              key={row.mpId}
              className="text-xs flex items-center gap-2 py-1"
            >
              <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                {i + 1}.
              </span>
              <MpAvatar mpId={row.mpId} name={display} />
              <Link
                to={candidateUrlForMp(row.mpId)}
                className="hover:underline truncate flex-1"
              >
                {display}
              </Link>
              {row.partyGroupShort && (
                <span className="text-muted-foreground text-[10px] truncate max-w-[110px] shrink-0">
                  {partyGroupShortLabel(row.partyGroupShort) ??
                    row.partyGroupShort}
                </span>
              )}
              <span className="text-muted-foreground text-[10px] tabular-nums shrink-0 hidden sm:inline">
                {row.latestDeclarationYear}
              </span>
              <span className="font-mono tabular-nums shrink-0 min-w-[70px] text-right">
                {net == null ? "—" : formatEurCompact(net, i18n.language)}
              </span>
              {deltaAbs != null && deltaAbs !== 0 ? (
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 min-w-[58px] justify-end ${
                    deltaAbs > 0 ? "text-green-600" : "text-red-600"
                  }`}
                  title={`${deltaAbs > 0 ? "+" : ""}€${formatThousands(Math.round(deltaAbs))}${row.deltaPreviousYear != null ? ` ${t("vs_previous") || "vs"} ${row.deltaPreviousYear}` : ""}`}
                >
                  {deltaAbs > 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {deltaPct != null
                    ? `${Math.abs(deltaPct).toFixed(0)}%`
                    : formatEurCompact(Math.abs(deltaAbs), i18n.language)}
                </span>
              ) : (
                <span className="text-[10px] shrink-0 min-w-[58px]" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t flex items-center justify-end text-[11px] text-muted-foreground">
        <span>
          {t("dashboard_mp_assets_count_label") ||
            "Net worth (€), all holders in the declaration"}
        </span>
      </div>
    </StatCard>
  );
};
