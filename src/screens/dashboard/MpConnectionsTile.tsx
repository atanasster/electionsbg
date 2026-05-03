import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Network, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useConnectionsRankings } from "@/data/parliament/useConnectionsRankings";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { StatCard } from "./StatCard";

type Props = {
  /** Optional region code (e.g. "S23"). When provided, the tile focuses on
   * MPs from that region; when omitted, it shows nationwide top MPs and top
   * companies. Mutually exclusive with `regionCodes`. */
  regionCode?: string;
  /** Optional set of region codes (e.g. Sofia's three MIRs). Used to union
   * MPs across multiple regions for a city-level view. */
  regionCodes?: string[];
  /** Custom tile width hint when used as a single-column item; defaults to
   * full width of its grid cell. */
  className?: string;
};

const ROWS = 5;

export const MpConnectionsTile: FC<Props> = ({
  regionCode,
  regionCodes,
  className,
}) => {
  const { t } = useTranslation();
  const { rankings } = useConnectionsRankings();
  const { selected } = useElectionContext();
  const { findMpsByRegion } = useMps();

  // For region mode: build the set of MP ids spanning the supplied region(s)
  // for the currently-selected NS, then intersect with the rankings.
  const regionMpIds = useMemo(() => {
    const codes = regionCodes ?? (regionCode ? [regionCode] : null);
    if (!codes || codes.length === 0) return null;
    const folder = electionToNsFolder(selected);
    if (!folder) return null;
    const ids = new Set<number>();
    for (const code of codes) {
      const mir = oblastToMir(code);
      if (!mir) continue;
      for (const m of findMpsByRegion(mir, folder)) ids.add(m.id);
    }
    return ids;
  }, [regionCode, regionCodes, selected, findMpsByRegion]);

  // Folder for the selected election. In country mode we restrict the
  // ranking to MPs who actually sat in *this* parliament — otherwise the
  // dashboard would headline declarants who never made the bench (or who
  // sat in some unrelated NS), which the user would not recognise as part
  // of "this election's MPs". Region mode already implies parliament
  // membership via findMpsByRegion.
  const selectedFolder = useMemo(
    () => electionToNsFolder(selected),
    [selected],
  );

  const topMps = useMemo(() => {
    if (!rankings) return [];
    let filtered = rankings.topMps;
    if (regionMpIds != null) {
      filtered = filtered.filter((m) => regionMpIds.has(m.mpId));
    } else if (selectedFolder) {
      filtered = filtered.filter((m) =>
        m.nsFolders?.includes(selectedFolder),
      );
    }
    return filtered.slice(0, ROWS);
  }, [rankings, regionMpIds, selectedFolder]);

  // Country mode shows companies alongside; region mode would not have a
  // useful "top companies in this region" sort, so we skip it there.
  const topCompanies = useMemo(() => {
    if (!rankings || regionMpIds != null) return [];
    return rankings.topCompanies.slice(0, ROWS);
  }, [rankings, regionMpIds]);

  if (!rankings) return null;
  if (topMps.length === 0 && topCompanies.length === 0) return null;

  const isRegional = regionMpIds != null;
  const titleKey = isRegional
    ? "dashboard_mp_connections_region_title"
    : "dashboard_mp_connections_title";
  const titleFallback = isRegional
    ? "Region MP business connections"
    : "MP business connections";

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Network className="h-4 w-4 shrink-0" />
            <span className="truncate">{t(titleKey) || titleFallback}</span>
          </div>
          <Link
            to="/connections"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_mp_connections_open_graph") || "Graph"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="grid gap-x-6 gap-y-1 grid-cols-1 md:grid-cols-2 mt-1">
        {topMps.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {isRegional
                ? t("dashboard_mp_connections_region_mps") ||
                  "Region MPs by ties"
                : t("connections_rankings_top_mps") || "Top MPs"}
            </div>
            {topMps.map((row, i) => (
              <div
                key={row.mpId}
                className="text-xs flex items-center gap-2 py-0.5"
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
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {row.highConfDegree || row.totalDegree}
                </span>
              </div>
            ))}
          </div>
        )}
        {topCompanies.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              {t("connections_rankings_top_companies") || "Top companies"}
            </div>
            {topCompanies.map((row, i) => (
              <div
                key={row.nodeId}
                className="text-xs flex items-baseline gap-2 py-0.5"
              >
                <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
                  {i + 1}.
                </span>
                {row.slug ? (
                  <Link
                    to={`/mp/company/${encodeURIComponent(row.slug)}`}
                    className="hover:underline truncate flex-1"
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="truncate flex-1">{row.label}</span>
                )}
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {row.mpCount}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-2 pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground">
        <Link to="/mp/companies" className="text-primary hover:underline">
          {t("dashboard_mp_connections_view_companies") ||
            "All companies"}{" "}
          →
        </Link>
        <span>
          {isRegional
            ? t("dashboard_mp_connections_count_label_region") || "ties"
            : t("dashboard_mp_connections_count_label") ||
              "high-confidence ties"}
        </span>
      </div>
    </StatCard>
  );
};
