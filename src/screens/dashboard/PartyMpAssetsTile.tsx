import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Wallet, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import { useAssetsRankings } from "@/data/parliament/useAssetsRankings";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { formatThousands } from "@/data/utils";
import type { MpAssetsRankingEntry, PreferencesInfo } from "@/data/dataTypes";
import type { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { StatCard } from "./StatCard";

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
    `/${election}/parties/preferences/${partyNum}/stats.json`,
  );
  if (!res.ok) return undefined;
  return res.json();
};

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

type Props = { data: PartyDashboardSummary };

export const PartyMpAssetsTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { rankings } = useAssetsRankings();
  const { findCandidate } = useCandidates();
  const { findMpByName } = useMps();

  const { data: stats } = useQuery({
    queryKey: ["party_preferences_stats", selected, data.partyNum] as [
      string,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn,
  });

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);

  const topMps = useMemo(() => {
    if (!rankings || !stats?.top) return [];

    // Map of mpId → ranking entry for O(1) lookup
    const byId = new Map<number, MpAssetsRankingEntry>();
    const source =
      folder && rankings.byNs[folder]?.topMps?.length
        ? rankings.byNs[folder].topMps
        : rankings.topMps;
    for (const e of source) byId.set(e.mpId, e);

    const partyMps: MpAssetsRankingEntry[] = [];
    const seen = new Set<number>();
    for (const p of stats.top) {
      const candidate = p.oblast
        ? findCandidate(p.oblast, p.partyNum, p.pref)
        : undefined;
      if (!candidate) continue;
      const mp = findMpByName(candidate.name);
      if (!mp) continue;
      if (seen.has(mp.id)) continue;
      const entry = byId.get(mp.id);
      if (!entry) continue;
      seen.add(mp.id);
      partyMps.push(entry);
    }
    partyMps.sort((a, b) => b.netWorthBgn - a.netWorthBgn);
    return partyMps.slice(0, ROWS);
  }, [rankings, stats, folder, findCandidate, findMpByName]);

  if (!rankings || !stats || topMps.length === 0) return null;

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
            to="/mp-assets"
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
      <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground">
        {t("dashboard_mp_assets_count_label") ||
          "BGN net worth, declarant + spouse"}
      </div>
    </StatCard>
  );
};
