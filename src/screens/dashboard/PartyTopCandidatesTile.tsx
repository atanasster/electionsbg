import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import { PartyDashboardSummary } from "@/data/dashboard/partyDashboardTypes";
import { PreferencesInfo, PreferencesVotes } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";
import { useRegions } from "@/data/regions/useRegions";
import { formatThousands } from "@/data/utils";
import { Link } from "@/ux/Link";
import { Tooltip } from "@/ux/Tooltip";
import { Hint } from "@/ux/Hint";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/utils";
import { StatCard } from "./StatCard";

const TOP_N = 10;

type PartyPrefStats = PreferencesVotes & {
  history?: Record<string, PreferencesVotes>;
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

type Props = { data: PartyDashboardSummary };

export const PartyTopCandidatesTile: FC<Props> = ({ data }) => {
  const { t, i18n } = useTranslation();
  const { selected } = useElectionContext();
  const { findCandidate } = useCandidates();
  const { findMpByName } = useMps();
  const { lookup: lookupParliamentGroup } = useParliamentGroups();
  const { findRegion } = useRegions();
  const color = data.color ?? "#888";

  const { data: stats } = useQuery({
    queryKey: ["party_preferences_stats", selected, data.partyNum] as [
      string,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn,
  });

  const rows = useMemo(() => {
    if (!stats?.top?.length) return [];
    return stats.top
      .slice(0, TOP_N)
      .map((p) => {
        const candidate = p.oblast
          ? findCandidate(p.oblast, p.partyNum, p.pref)
          : undefined;
        if (!candidate) return null;
        const region = findRegion(p.oblast);
        const regionName = region
          ? i18n.language === "bg"
            ? region.long_name || region.name
            : region.long_name_en || region.name_en
          : undefined;
        const mp = findMpByName(candidate.name);
        // For coalitions that splinter into parliamentary groups (e.g. ПП-ДБ),
        // mark each candidate with their current group so the party page can
        // visually distinguish ПП MPs from ДБ MPs even though the row lives
        // under the coalition's data.
        const group =
          mp?.isCurrent && mp.currentPartyGroupShort
            ? lookupParliamentGroup(mp.currentPartyGroupShort)
            : undefined;
        const partyVotes = p.partyVotes ?? 0;
        const pctOfPartyVotes = partyVotes
          ? (100 * p.totalVotes) / partyVotes
          : undefined;
        return {
          name: candidate.name,
          totalVotes: p.totalVotes,
          paperVotes: p.paperVotes,
          machineVotes: p.machineVotes,
          lyTotalVotes: p.lyTotalVotes,
          pref: p.pref,
          regionName,
          regionCode: p.oblast,
          pctOfPartyVotes,
          photoUrl: mp?.photoUrl,
          groupLabel: group?.displayName,
          groupColor: group?.color,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  }, [
    stats,
    findCandidate,
    findMpByName,
    findRegion,
    i18n.language,
    lookupParliamentGroup,
  ]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full">
          <Hint
            text={t("dashboard_party_top_candidates_hint")}
            underline={false}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{t("dashboard_party_top_candidates")}</span>
            </div>
          </Hint>
          <Link
            to={`/party/${data.nickName}/preferences`}
            className="text-[10px] normal-case text-primary hover:underline"
            underline={false}
          >
            {t("dashboard_see_details")} →
          </Link>
        </div>
      }
    >
      <div className="flex flex-wrap gap-3 mt-1">
        {rows.map((r, idx) => (
          <Tooltip
            key={`${r.name}-${idx}`}
            className="max-w-56 p-2"
            content={
              <div className="flex flex-col gap-1">
                <div className="font-semibold">{r.name}</div>
                <div className="flex items-center gap-1.5 text-primary-foreground/70">
                  {r.regionName && <span>{r.regionName}</span>}
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
                  {r.pctOfPartyVotes != null && (
                    <div className="flex justify-between gap-4 text-primary-foreground/70">
                      <span>% {t("of_party_votes")}</span>
                      <span className="tabular-nums">
                        {r.pctOfPartyVotes.toFixed(1)}%
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
              to={`/candidate/${encodeURIComponent(r.name)}`}
              underline={false}
              className="flex items-center gap-3 p-2 rounded-lg border border-border/60 hover:bg-muted/40 transition-colors min-w-0 flex-1 basis-[200px] max-w-[280px]"
            >
              <Avatar
                className="h-10 w-10 shrink-0 ring-2"
                style={{
                  ["--tw-ring-color" as string]: r.groupColor ?? color,
                }}
              >
                {r.photoUrl && (
                  <AvatarImage
                    src={r.photoUrl}
                    alt={r.name}
                    className="object-cover"
                  />
                )}
                <AvatarFallback
                  className="text-white text-sm font-bold"
                  style={{ backgroundColor: r.groupColor ?? color }}
                >
                  {initials(r.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold truncate">{r.name}</span>
                <span className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
                  {r.groupLabel && (
                    <>
                      <span
                        className="inline-block w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: r.groupColor ?? color }}
                      />
                      <span className="font-semibold">{r.groupLabel}</span>
                      <span>·</span>
                    </>
                  )}
                  <span className="truncate">
                    {r.regionName ?? r.regionCode}
                    {r.pref ? ` · #${r.pref}` : ""}
                  </span>
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
