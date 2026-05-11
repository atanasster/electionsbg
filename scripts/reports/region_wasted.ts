import fs from "fs";
import { ElectionRegion, PartyInfo } from "@/data/dataTypes";
import { regionsVotesFileName } from "scripts/consts";

// Roll up wasted-vote share per region (the 28 NUTS3 areas plus the diaspora
// pseudo-region "32"). Writes data/{year}/reports/region/wasted_votes.json
// as a flat array sorted by share descending — matches the shape of every
// other report file so the SPA can reuse the existing report-table machinery.

export type RegionWastedVoteRow = {
  key: string;
  nuts3?: string;
  share: number;
  wastedVotes: number;
  validVotes: number;
  // Up to 5 parties contributing the most wasted votes in this region.
  topParties: { partyNum: number; totalVotes: number; share: number }[];
};

const round = (n: number) => Math.round(n * 100) / 100;

export const regionWastedReport = ({
  publicFolder,
  reportsFolder,
  year,
  parties,
  belowThresholdPartyNums,
  stringify,
}: {
  publicFolder: string;
  reportsFolder: string;
  year: string;
  parties: PartyInfo[];
  belowThresholdPartyNums: Set<number>;
  stringify: (o: object) => string;
}): void => {
  const regionsFile = `${publicFolder}/${year}/${regionsVotesFileName}`;
  if (!fs.existsSync(regionsFile)) return;
  const regions: ElectionRegion[] = JSON.parse(
    fs.readFileSync(regionsFile, "utf-8"),
  );
  void parties;

  const rows: RegionWastedVoteRow[] = regions
    .map((r) => {
      const votes = r.results?.votes ?? [];
      let validVotes = 0;
      let wastedVotes = 0;
      const wastedParties: { partyNum: number; totalVotes: number }[] = [];
      for (const v of votes) {
        validVotes += v.totalVotes;
        if (belowThresholdPartyNums.has(v.partyNum)) {
          wastedVotes += v.totalVotes;
          if (v.totalVotes > 0)
            wastedParties.push({
              partyNum: v.partyNum,
              totalVotes: v.totalVotes,
            });
        }
      }
      const share = validVotes ? round((100 * wastedVotes) / validVotes) : 0;
      wastedParties.sort((a, b) => b.totalVotes - a.totalVotes);
      const topParties = wastedParties.slice(0, 5).map((p) => ({
        partyNum: p.partyNum,
        totalVotes: p.totalVotes,
        share: validVotes ? round((100 * p.totalVotes) / validVotes) : 0,
      }));
      return {
        key: r.key,
        nuts3: r.nuts3,
        share,
        wastedVotes,
        validVotes,
        topParties,
      } satisfies RegionWastedVoteRow;
    })
    .sort((a, b) => b.share - a.share);

  const folder = `${reportsFolder}/region`;
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
  const outFile = `${folder}/wasted_votes.json`;
  fs.writeFileSync(outFile, stringify(rows), "utf8");
  console.log("Successfully added file ", outFile);
};
