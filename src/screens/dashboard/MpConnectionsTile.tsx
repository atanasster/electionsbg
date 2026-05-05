import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Network, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useConnectionsRankings } from "@/data/parliament/useConnectionsRankings";
import { useDataProvenance } from "@/data/parliament/useDataProvenance";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder, oblastToMir } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";
import {
  provenanceText,
  provenanceTooltip,
} from "./MpDeclarationsProvenance";
import type { ConnectionsTopMp } from "@/data/dataTypes";

type Props = {
  /** Optional region code (e.g. "S23"). When provided, the tile focuses on
   * MPs from that region; when omitted, it shows nationwide top MPs.
   * Mutually exclusive with `regionCodes`. */
  regionCode?: string;
  /** Optional set of region codes (e.g. Sofia's three MIRs). Used to union
   * MPs across multiple regions for a city-level view. */
  regionCodes?: string[];
  /** When true, the tile suppresses its own provenance footer — the parent
   * (typically a DashboardSection subtitle) is showing it instead. */
  hideProvenance?: boolean;
  className?: string;
};

const ROWS = 5;

export const MpConnectionsTile: FC<Props> = ({
  regionCode,
  regionCodes,
  hideProvenance = false,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { rankings } = useConnectionsRankings();
  const { provenance } = useDataProvenance();
  const { selected } = useElectionContext();
  const { findMpsByRegion } = useMps();

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

  const topMps: ConnectionsTopMp[] = useMemo(() => {
    if (!rankings) return [];
    if (isRegional) {
      return rankings.topMps
        .filter((m) => regionMpIds!.has(m.mpId))
        .slice(0, ROWS);
    }
    if (selectedFolder && rankings.byNs[selectedFolder]) {
      return rankings.byNs[selectedFolder].topMps.slice(0, ROWS);
    }
    return rankings.topMps.slice(0, ROWS);
  }, [rankings, isRegional, regionMpIds, selectedFolder]);

  const provenanceScope = useMemo(() => {
    if (!provenance) return undefined;
    if (selectedFolder && provenance.byNs[selectedFolder]) {
      return provenance.byNs[selectedFolder];
    }
    return provenance.all;
  }, [provenance, selectedFolder]);

  if (!rankings) return null;
  if (topMps.length === 0) return null;

  const titleKey = isRegional
    ? "dashboard_mp_connections_region_title"
    : "dashboard_mp_connections_title";
  const titleFallback = isRegional
    ? "Region MP business connections"
    : "MP business connections";

  const mpsHeaderKey = isRegional
    ? "dashboard_mp_connections_region_mps"
    : "dashboard_mp_connections_top_mps_label";
  const mpsHeaderFallback = isRegional
    ? "Most connected MPs in region"
    : "Most connected MPs";

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
            {t("dashboard_mp_connections_open_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {t(mpsHeaderKey) || mpsHeaderFallback}
        </div>
        {topMps.map((row, i) => {
          const tieTooltip = t(
            "dashboard_mp_connections_mp_ties_full",
            "{{direct}} co-MP · {{ties}} total ties",
            { direct: row.mpMpDirectDegree, ties: row.highConfDegree },
          );
          const directZero = row.mpMpDirectDegree === 0;
          return (
            <div
              key={row.mpId}
              className="text-xs flex items-center gap-2 py-0.5"
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
              <Hint text={tieTooltip} underline={false}>
                <span
                  className={`tabular-nums shrink-0 ${
                    directZero
                      ? "text-muted-foreground/60"
                      : "text-foreground font-medium"
                  }`}
                >
                  {row.mpMpDirectDegree}
                </span>
              </Hint>
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t flex items-center justify-between text-[11px] text-muted-foreground gap-2">
        <Link to="/mp/companies" className="text-primary hover:underline">
          {t("dashboard_mp_connections_view_companies") || "All companies"} →
        </Link>
        {!isRegional && !hideProvenance && provenanceScope && (
          <Hint
            text={provenanceTooltip(provenanceScope)}
            underline={false}
            className="truncate text-right"
          >
            <span className="truncate">
              {provenanceText(
                provenanceScope,
                provenance?.generatedAt,
                i18n.language,
                (key, fallback, opts) => t(key, fallback ?? key, opts),
              )}
            </span>
          </Hint>
        )}
        {isRegional && (
          <span>
            {t("dashboard_mp_connections_count_label_region") || "ties"}
          </span>
        )}
      </div>
    </StatCard>
  );
};
