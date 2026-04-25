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
import { StatCard } from "./StatCard";

type Props = {
  parties: NationalPartyResult[];
  topN?: number;
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

export const TopCandidatesStrip: FC<Props> = ({ parties, topN = 4 }) => {
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
    const seatedParties = parties
      .filter((p) => (p.seats ?? 0) > 0)
      .slice(0, topN);

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
        const region = findRegion(top.oblast);
        const regionName =
          i18n.language === "bg"
            ? region?.long_name || region?.name
            : region?.long_name_en || region?.name_en;
        return {
          partyNum: p.partyNum,
          partyNickName: p.nickName,
          color: p.color || "#888",
          candidateName: candidate?.name,
          totalVotes: top.totalVotes,
          regionName,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r && !!r.candidateName);
  }, [preferences, parties, topN, findCandidate, findRegion, i18n.language]);

  if (rows.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span>{t("dashboard_top_candidates")}</span>
        </div>
      }
      hint={t("dashboard_top_candidates_hint")}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-1">
        {rows.map((r) => (
          <Link
            key={r.partyNum}
            to={`/candidate/${encodeURIComponent(r.candidateName!)}`}
            underline={false}
            className="flex items-center gap-3 p-2 rounded-lg border border-border/60 hover:bg-muted/40 transition-colors min-w-0"
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
                {r.regionName && (
                  <span className="truncate">· {r.regionName}</span>
                )}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatThousands(r.totalVotes)} {t("votes").toLowerCase()}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </StatCard>
  );
};
