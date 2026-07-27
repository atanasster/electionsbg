import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Car, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery, QueryFunctionContext } from "@tanstack/react-query";
import { useCarMakesAgg } from "@/data/parliament/useCarMakes";
import { toScopedMpIds } from "@/data/parliament/useAssetsRankings";
import { useMps } from "@/data/parliament/useMps";
import { useElectionContext } from "@/data/ElectionContext";
import { useCandidates } from "@/data/preferences/useCandidates";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { CarMakeEntry, PreferencesInfo } from "@/data/dataTypes";
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

type Props = { data: PartyDashboardSummary };

export const PartyCarMakesTile: FC<Props> = ({ data }) => {
  const { t } = useTranslation();
  const { selected } = useElectionContext();
  const { findCandidate } = useCandidates();
  const { findMpByName } = useMps();
  const { findParty } = usePartyInfo();
  const { canonicalIdFor } = useCanonicalParties();

  const folder = useMemo(() => electionToNsFolder(selected), [selected]);

  const { data: stats } = useQuery({
    queryKey: ["party_preferences_stats", selected, data.partyNum] as [
      string,
      string | null | undefined,
      number | null | undefined,
    ],
    queryFn,
  });

  const partyMpIds = useMemo<Set<number> | null>(() => {
    if (!stats?.top) return null;
    const ids = new Set<number>();
    const seenNames = new Set<string>();
    for (const p of stats.top) {
      if (!p.oblast) continue;
      const c = findCandidate(p.oblast, p.partyNum, p.pref);
      if (!c || seenNames.has(c.name)) continue;
      seenNames.add(c.name);
      const mp = findMpByName(c.name);
      if (mp) ids.add(mp.id);
    }
    return ids;
  }, [stats, findCandidate, findMpByName]);

  // Distinct-MP-per-make for the party's MPs within the selected parliament's ns bucket, from
  // the car-makes route (replaces the client rollup over the flat mp-cars.json list; the old
  // screen filtered that list by nsFolders.includes(folder), which the ns bucket already is).
  const mpIds = useMemo(
    () => toScopedMpIds(partyMpIds ? [...partyMpIds] : null),
    [partyMpIds],
  );
  const { makes } = useCarMakesAgg({
    ns: folder ?? "all",
    mpIds,
    enabled: partyMpIds != null,
  });
  const topCars: CarMakeEntry[] = makes.slice(0, ROWS);

  const detailsTo = useMemo(() => {
    const party = findParty(data.partyNum);
    const canonicalId = party?.nickName
      ? canonicalIdFor(party.nickName)
      : undefined;
    return canonicalId
      ? `/mp-cars?partyId=${encodeURIComponent(canonicalId)}`
      : `/mp-cars?partyNum=${data.partyNum}`;
  }, [findParty, canonicalIdFor, data.partyNum]);

  if (!stats || topCars.length === 0) return null;

  return (
    <StatCard
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Car className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("party_car_makes_title") || "Candidate MPs' car makes"}
            </span>
          </div>
          <Link
            to={detailsTo}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_car_makes_open_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="mt-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          {t("dashboard_mp_connections_top_cars_label") || "Top car makes"}
        </div>
        {topCars.map((row, i) => (
          <div
            key={row.make}
            className="text-xs flex items-baseline gap-2 py-0.5"
          >
            <span className="text-muted-foreground w-4 shrink-0 text-right tabular-nums">
              {i + 1}.
            </span>
            <span className="truncate flex-1">{row.make}</span>
            <span className="text-muted-foreground tabular-nums shrink-0">
              {row.mpCount}
            </span>
          </div>
        ))}
      </div>
    </StatCard>
  );
};
