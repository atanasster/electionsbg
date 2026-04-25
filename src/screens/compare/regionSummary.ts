import { ElectionRegion, PartyInfo } from "@/data/dataTypes";

export type RegionSummaryParty = {
  partyNum: number;
  nickName: string;
  color?: string;
  totalVotes: number;
  pct: number;
};

export type RegionSummary = {
  region: string;
  regionName: string;
  election: string;
  turnout: {
    actual: number;
    registered: number;
    pct: number;
  };
  totalValidVotes: number;
  parties: RegionSummaryParty[];
};

// Client-side computation of a single region's summary at a specific election.
// Mirrors the shape of NationalSummary for the metrics CompareTable shows, but
// without anomalies (anomaly counts are computed at section-level and don't
// roll up into the region_votes.json bundle we already fetch).
export const computeRegionSummary = (
  region: ElectionRegion,
  regionName: string,
  election: string,
  parties: PartyInfo[] | undefined,
): RegionSummary => {
  const total = region.results.votes.reduce((s, v) => s + v.totalVotes, 0);
  const protocol = region.results.protocol;
  const partyByNum = new Map(parties?.map((p) => [p.number, p]) ?? []);
  return {
    region: region.key,
    regionName,
    election,
    turnout: {
      actual: protocol?.totalActualVoters ?? 0,
      registered: protocol?.numRegisteredVoters ?? 0,
      pct:
        protocol?.numRegisteredVoters && protocol.totalActualVoters
          ? (100 * protocol.totalActualVoters) / protocol.numRegisteredVoters
          : 0,
    },
    totalValidVotes: total,
    parties: region.results.votes
      .map((v) => {
        const info = partyByNum.get(v.partyNum);
        return {
          partyNum: v.partyNum,
          nickName: info?.nickName ?? `#${v.partyNum}`,
          color: info?.color,
          totalVotes: v.totalVotes,
          pct: total ? (100 * v.totalVotes) / total : 0,
        };
      })
      .sort((a, b) => b.totalVotes - a.totalVotes),
  };
};
