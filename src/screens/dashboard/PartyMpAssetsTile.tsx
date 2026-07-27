import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import {
  eur,
  toScopedMpIds,
  useMpAssetsTopRows,
} from "@/data/parliament/useAssetsRankings";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { candidateUrlForMp } from "@/data/candidates/candidateSlug";
import { formatThousands } from "@/data/utils";
import type { PreferencesInfo } from "@/data/dataTypes";
import type { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { StatCard } from "./StatCard";
import { dataUrl } from "@/data/dataUrl";

const ROWS = 5;

type PartyPrefStats = {
  top?: PreferencesInfo[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined, number | null | undefined]
>): Promise<PartyPrefStats | undefined> => {
  const [, election, partyNum] = queryKey;
  if (!election || !partyNum) return undefined;
  const res = await fetch(
    dataUrl(`/${election}/parties/preferences/${partyNum}/stats.json`),
  );
  if (!res.ok) return undefined;
  return res.json();
};

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

type Props = { data: PartyDashboardSummary };

export const PartyMpAssetsTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { findCandidate } = useCandidates();
  const { findMpByName, findMpById } = useMps();
  const { mpName } = useCandidateName();
  const { findParty } = usePartyInfo();
  const { canonicalIdFor } = useCanonicalParties();

  const { data: stats } = useQuery({
    queryKey: ["party_preferences_stats", selected, data.partyNum] as [
      string,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn,
  });

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);

  const detailsTo = useMemo(() => {
    const party = findParty(data.partyNum);
    const canonicalId = party?.nickName
      ? canonicalIdFor(party.nickName)
      : undefined;
    return canonicalId
      ? `/mp-assets?partyId=${encodeURIComponent(canonicalId)}`
      : `/mp-assets?partyNum=${data.partyNum}`;
  }, [findParty, canonicalIdFor, data.partyNum]);

  // The party's MPs, resolved from its preference-stats leaders (name → MP id). The registry
  // then returns their wealth rows sorted + capped server-side, so no client-side ranking.
  const partyMpIds = useMemo<number[] | null>(() => {
    if (!stats?.top) return null;
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const p of stats.top) {
      const candidate = p.oblast
        ? findCandidate(p.oblast, p.partyNum, p.pref)
        : undefined;
      if (!candidate) continue;
      const mp = findMpByName(candidate.name);
      if (!mp || seen.has(mp.id)) continue;
      seen.add(mp.id);
      ids.push(mp.id);
    }
    return ids;
  }, [stats, findCandidate, findMpByName]);

  // ns bucket for the selected parliament, lifetime ('all') fallback when it has no rows.
  const mpIds = useMemo(() => toScopedMpIds(partyMpIds), [partyMpIds]);
  const primary = useMpAssetsTopRows({
    ns: folder ?? "all",
    mpIds,
    limit: ROWS,
    enabled: partyMpIds != null,
  });
  const doFallback =
    folder != null && !primary.isLoading && primary.rows.length === 0;
  const fallback = useMpAssetsTopRows({
    ns: "all",
    mpIds,
    limit: ROWS,
    enabled: doFallback && partyMpIds != null,
  });
  const topMps = primary.rows.length ? primary.rows : fallback.rows;

  if (!stats || topMps.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            <span>
              {t("party_mp_assets_title") || "MPs by declared assets"}
            </span>
          </div>
          <Link
            to={detailsTo}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case"
          >
            {t("dashboard_see_details") || "See details"}
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
          // The registry `name` is Bulgarian-only; recover the MP record for the
          // locale-correct display name.
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
      <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground">
        {t("dashboard_mp_assets_count_label") ||
          "Net worth (€), declarant + spouse"}
      </div>
    </StatCard>
  );
};
