import fs from "fs";
import path from "path";
import {
  ElectionInfo,
  ElectionRegion,
  ElectionRegions,
  PartyInfo,
} from "@/data/dataTypes";
import { cikPartiesFileName, regionsVotesFileName } from "scripts/consts";
import {
  RegionHistory,
  RegionHistoryEntry,
  RegionHistoryVote,
} from "@/data/regions/regionHistoryTypes";

const round = (n: number, digits = 2) => {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
};

export const generateRegionHistory = ({
  publicFolder,
  stringify,
}: {
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const electionsFile = path.resolve(
    publicFolder,
    "../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = (
    JSON.parse(fs.readFileSync(electionsFile, "utf-8")) as ElectionInfo[]
  ).sort((a, b) => a.name.localeCompare(b.name));

  const byRegion = new Map<string, RegionHistoryEntry[]>();

  elections.forEach((e) => {
    const year = e.name;
    const votesFile = `${publicFolder}/${year}/${regionsVotesFileName}`;
    const partiesFile = `${publicFolder}/${year}/${cikPartiesFileName}`;
    if (!fs.existsSync(votesFile) || !fs.existsSync(partiesFile)) return;

    const regions: ElectionRegions = JSON.parse(
      fs.readFileSync(votesFile, "utf-8"),
    );
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(partiesFile, "utf-8"),
    );
    const partyByNum = new Map(parties.map((p) => [p.number, p]));

    regions.forEach((region: ElectionRegion) => {
      const totalVotes = region.results.votes.reduce(
        (s, v) => s + v.totalVotes,
        0,
      );
      const protocol = region.results.protocol;
      const turnoutPct =
        protocol?.numRegisteredVoters && protocol.totalActualVoters
          ? round(
              (100 * protocol.totalActualVoters) / protocol.numRegisteredVoters,
            )
          : undefined;

      const votes: RegionHistoryVote[] = region.results.votes
        .map((v) => {
          const partyInfo = partyByNum.get(v.partyNum);
          if (!partyInfo) return undefined;
          const pct = totalVotes ? (100 * v.totalVotes) / totalVotes : 0;
          return {
            partyNum: v.partyNum,
            nickName: partyInfo.nickName,
            color: partyInfo.color,
            totalVotes: v.totalVotes,
            pct: round(pct),
            commonName: partyInfo.commonName,
          } as RegionHistoryVote;
        })
        .filter((v): v is RegionHistoryVote => v !== undefined)
        .sort((a, b) => b.totalVotes - a.totalVotes);

      const entry: RegionHistoryEntry = {
        election: year,
        totalVotes,
        registeredVoters: protocol?.numRegisteredVoters,
        actualVoters: protocol?.totalActualVoters,
        turnoutPct,
        votes,
      };

      const list = byRegion.get(region.key) ?? [];
      list.push(entry);
      byRegion.set(region.key, list);
    });
  });

  const outFolder = `${publicFolder}/regions`;
  if (!fs.existsSync(outFolder)) {
    fs.mkdirSync(outFolder, { recursive: true });
  }

  byRegion.forEach((history, regionCode) => {
    const sorted = [...history].sort((a, b) =>
      a.election.localeCompare(b.election),
    );
    const data: RegionHistory = { region: regionCode, history: sorted };
    const outFile = `${outFolder}/${regionCode}_history.json`;
    fs.writeFileSync(outFile, stringify(data), "utf8");
    console.log("Successfully added file ", outFile);
  });
};
