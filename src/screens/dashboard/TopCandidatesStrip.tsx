import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import { PreferencesInfo } from "@/data/dataTypes";
import { NationalPartyResult } from "@/data/dashboard/dashboardTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useRegions } from "@/data/regions/useRegions";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { Hint } from "@/ux/Hint";
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  PreferencesInfo[] | undefined
> => {
  if (!queryKey[1]) return undefined;
  const response = await fetch(`/${queryKey[1]}/preferences/country.json`);
  if (!response.ok) return undefined;
  return response.json();
};

const initials = (name?: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
};

export const TopCandidatesStrip: FC<Props> = ({ parties }) => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { findCandidate } = useCandidates();
  const { findRegion } = useRegions();
  const { data: preferences } = useQuery({
    queryKey: ["preferences_all_country", selected] as [
      string,
      string | null | undefined,
    ],
    queryFn,
  });

  const rows = useMemo(() => {
    if (!preferences || !parties.length) return [];
    const seatedParties = parties.filter((p) => (p.seats ?? 0) > 0);

    return seatedParties
      .map((p) => {
        const partyPrefs = preferences.filter((r) => r.partyNum === p.partyNum);
        if (!partyPrefs.length) return null;
        const top = partyPrefs.reduce((a, b) =>
          b.totalVotes > a.totalVotes ? b : a,
        );
        const candidate = top.oblast
          ? findCandidate(top.oblast, top.partyNum, top.pref)
          : undefined;
        if (!candidate) return null;

        // Aggregate across all regions the same candidate appears in
        const allEntries = partyPrefs.filter(
          (r) =>
            r.oblast &&
            findCandidate(r.oblast, r.partyNum, r.pref)?.name ===
              candidate.name,
        );
        const totalVotes = allEntries.reduce((s, r) => s + r.totalVotes, 0);
        const hasPaper = allEntries.some((r) => r.paperVotes != null);
        const paperVotes = hasPaper
          ? allEntries.reduce((s, r) => s + (r.paperVotes ?? 0), 0)
          : undefined;
        const hasMachine = allEntries.some((r) => r.machineVotes != null);
        const machineVotes = hasMachine
          ? allEntries.reduce((s, r) => s + (r.machineVotes ?? 0), 0)
          : undefined;
        const hasLy = allEntries.some((r) => r.lyTotalVotes != null);
        const lyTotalVotes = hasLy
          ? allEntries.reduce((s, r) => s + (r.lyTotalVotes ?? 0), 0)
          : undefined;
        const regionCount = new Set(allEntries.map((r) => r.oblast)).size;

        const region = regionCount === 1 ? findRegion(top.oblast) : undefined;
        const regionName = region
          ? i18n.language === "bg"
            ? region.long_name || region.name
            : region.long_name_en || region.name_en
          : undefined;

        return {
          partyNum: p.partyNum,
          partyNickName: p.nickName,
          color: p.color || "#888",
          candidateName: candidate.name,
          totalVotes,
          paperVotes,
          machineVotes,
          partyVotes: p.totalVotes,
          lyTotalVotes,
          pref: top.pref,
          regionName,
          regionCount,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.candidateName)
      .sort((a, b) => b.totalVotes - a.totalVotes);
  }, [preferences, parties, findCandidate, findRegion, i18n.language]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint text={t("dashboard_top_candidates_hint")} underline={false}>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{t("dashboard_top_candidates")}</span>
            </div>
          </Hint>
          <Link
            to="/preferences"
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="flex flex-wrap gap-3 mt-1">
        {rows.map((r) => (
          <Tooltip
            key={r.partyNum}
            className="max-w-56 p-2"
            content={
              <div className="flex flex-col gap-1">
                <div className="font-semibold">{r.candidateName}</div>
                <div className="flex items-center gap-1.5 text-primary-foreground/70">
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span>{r.partyNickName}</span>
                  {r.regionCount > 1 ? (
                    <span>
                      · {r.regionCount} {t("regions").toLowerCase()}
                    </span>
                  ) : (
                    r.regionName && <span>· {r.regionName}</span>
                  )}
                  {r.pref && (
                    <span className="ml-auto font-mono">#{r.pref}</span>
                  )}
                </div>
                <div className="border-t border-primary-foreground/20 pt-1 flex flex-col gap-0.5">
                  <div className="flex justify-between gap-4">
                    <span>{t("votes")}</span>
                    <span className="font-semibold tabular-nums">
                      {formatThousands(r.totalVotes)}
                    </span>
                  </div>
                  {r.paperVotes != null && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>{t("paper_votes")}</span>
                      <span className="tabular-nums">
                        {formatThousands(r.paperVotes)}
                      </span>
                    </div>
                  )}
                  {r.machineVotes != null && r.machineVotes > 0 && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>{t("machine_votes")}</span>
                      <span className="tabular-nums">
                        {formatThousands(r.machineVotes)}
                      </span>
                    </div>
                  )}
                  {r.partyVotes != null && r.partyVotes > 0 && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>% {t("of_party_votes")}</span>
                      <span className="tabular-nums">
                        {((r.totalVotes / r.partyVotes) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {r.lyTotalVotes != null && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>{t("prev_elections")}</span>
                      <span className="tabular-nums">
                        {formatThousands(r.lyTotalVotes)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            }
          >
            <Link
              to={`/candidate/${encodeURIComponent(r.candidateName!)}`}
              underline={false}
              className="flex items-center gap-3 p-2 rounded-lg border border-border/60 hover:bg-muted/40 transition-colors min-w-0 flex-1 basis-[180px] max-w-[260px]"
            >
              <div
                className="flex items-center justify-center h-10 w-10 rounded-full text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: r.color }}
                aria-hidden
              >
                {initials(r.candidateName)}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">
                  {r.candidateName}
                </span>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block w-2 h-2 rounded-sm shrink-0"
                    style={{ backgroundColor: r.color }}
                  />
                  <span className="truncate">{r.partyNickName}</span>
                  {r.regionCount > 1 ? (
                    <span className="truncate">
                      · {r.regionCount} {t("regions").toLowerCase()}
                    </span>
                  ) : (
                    r.regionName && (
                      <span className="truncate">· {r.regionName}</span>
                    )
                  )}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatThousands(r.totalVotes)} {t("votes").toLowerCase()}
                </span>
              </div>
            </Link>
          </Tooltip>
        ))}
      </div>
    </StatCard>
  );
};
