import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { dataUrl } from "@/data/dataUrl";
import { ReportRow } from "../dataTypes";

// Top-N pre-resolved dashboard rollup for the wasted-vote feature.
// Generated offline by scripts/reports/wasted_votes_dashboard.ts so the
// landing-page tiles don't have to pull the full ~1.5MB section report.
export type WastedVoteTopRow = {
  key: string;
  name_bg?: string;
  name_en?: string;
  region_name_bg?: string;
  region_name_en?: string;
  share: number;
  partyNum?: number;
  partyVotes?: number;
};

export type WastedVoteDashboard = {
  election: string;
  topRegions: WastedVoteTopRow[];
  topMunicipalities: WastedVoteTopRow[];
  topSettlements: WastedVoteTopRow[];
  topSections: WastedVoteTopRow[];
};

// Per-region wasted-vote rollup (28 NUTS3 regions + diaspora "32").
export type RegionWastedVoteRow = {
  key: string;
  nuts3?: string;
  share: number;
  wastedVotes: number;
  validVotes: number;
  topParties: { partyNum: number; totalVotes: number; share: number }[];
};

// Cross-area report rows for municipality/settlement/section — share the
// existing flat-array shape produced by saveReport: {oblast, obshtina,
// ekatte?, section?, partyNum, totalVotes, pctPartyVote, value}.
// `value` is the wasted-vote share in percent. `partyNum`/`totalVotes`/
// `pctPartyVote` describe the largest below-threshold party in the area.
export type WastedVoteReportRow = ReportRow;

const regionQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  RegionWastedVoteRow[] | null
> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/reports/region/wasted_votes.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

const reportQueryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string, string | null | undefined]>): Promise<
  WastedVoteReportRow[] | null
> => {
  if (!queryKey[2]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[2]}/reports/${queryKey[1]}/wasted_votes.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useRegionWastedVotes = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["wasted_votes_region", selected],
    queryFn: regionQueryFn,
  });
};

export const useMunicipalityWastedVotes = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["wasted_votes", "municipality", selected],
    queryFn: reportQueryFn,
  });
};

export const useSettlementWastedVotes = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["wasted_votes", "settlement", selected],
    queryFn: reportQueryFn,
  });
};

export const useSectionWastedVotes = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["wasted_votes", "section", selected],
    queryFn: reportQueryFn,
  });
};

const dashboardQueryFn = async ({
  queryKey,
}: QueryFunctionContext<
  [string, string | null | undefined]
>): Promise<WastedVoteDashboard | null> => {
  if (!queryKey[1]) return null;
  const response = await fetch(
    dataUrl(`/${queryKey[1]}/dashboard/wasted_votes.json`),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useWastedVoteDashboard = () => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["wasted_votes_dashboard", selected],
    queryFn: dashboardQueryFn,
  });
};
