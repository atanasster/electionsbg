import fs from "fs";
import {
  ElectionInfo,
  ElectionMunicipality,
  ElectionRegions,
  ElectionSettlement,
  PartyInfo,
  VoteResults,
} from "@/data/dataTypes";
import { addVotes } from "@/data/utils";
import {
  cikPartiesFileName,
  municipalityVotesFileName,
  regionsVotesFileName,
  settlementsVotesFileName,
} from "./consts";

const statsByRegion = (elections: ElectionInfo[], publicFolder: string) => {
  const collectedVotes: { [key: string]: ElectionInfo[] } = {};
  elections.forEach((e) => {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );
    const regionVotes: ElectionRegions = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${regionsVotesFileName}`,
        "utf-8",
      ),
    );
    regionVotes.forEach((r) => {
      if (collectedVotes[r.key] === undefined) {
        collectedVotes[r.key] = [];
      }
      const res: VoteResults = {
        actualTotal: 0,
        actualPaperVotes: 0,
        actualMachineVotes: 0,
        votes: [],
      };
      addVotes(res, r.results.votes, r.results.protocol);
      collectedVotes[r.key].push({
        ...e,
        results: {
          ...res,
          protocol: res.protocol,
          votes: res.votes.map((v) => {
            const party = parties.find((p) => p.number === v.partyNum);
            return {
              ...v,
              nickName: party?.nickName,
            };
          }),
        },
      });
    });
  });
  return collectedVotes;
};

const statsByMunicipality = (
  elections: ElectionInfo[],
  publicFolder: string,
) => {
  const collectedVotes: { [key: string]: ElectionInfo[] } = {};
  elections.forEach((e) => {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );
    const municipalityVotes: ElectionMunicipality[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${municipalityVotesFileName}`,
        "utf-8",
      ),
    );
    municipalityVotes.forEach((r) => {
      if (collectedVotes[r.obshtina] === undefined) {
        collectedVotes[r.obshtina] = [];
      }
      const res: VoteResults = {
        actualTotal: 0,
        actualPaperVotes: 0,
        actualMachineVotes: 0,
        votes: [],
      };
      addVotes(res, r.results.votes, r.results.protocol);
      collectedVotes[r.obshtina].push({
        ...e,
        results: {
          ...res,
          protocol: res.protocol,
          votes: res.votes.map((v) => {
            const party = parties.find((p) => p.number === v.partyNum);
            return {
              ...v,
              nickName: party?.nickName,
            };
          }),
        },
      });
    });
  });
  return collectedVotes;
};
const statsBySettlement = (elections: ElectionInfo[], publicFolder: string) => {
  const collectedVotes: { [key: string]: ElectionInfo[] } = {};
  elections.forEach((e) => {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );
    const settlementVotes: ElectionSettlement[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${settlementsVotesFileName}`,
        "utf-8",
      ),
    );
    settlementVotes.forEach((r) => {
      if (collectedVotes[r.ekatte] === undefined) {
        collectedVotes[r.ekatte] = [];
      }
      const res: VoteResults = {
        actualTotal: 0,
        actualPaperVotes: 0,
        actualMachineVotes: 0,
        votes: [],
      };
      addVotes(res, r.results.votes, r.results.protocol);
      collectedVotes[r.ekatte].push({
        ...e,
        results: {
          ...res,
          protocol: res.protocol,
          votes: res.votes.map((v) => {
            const party = parties.find((p) => p.number === v.partyNum);
            return {
              ...v,
              nickName: party?.nickName,
            };
          }),
        },
      });
    });
  });
  return collectedVotes;
};
export const collectStats = (
  elections: ElectionInfo[],
  publicFolder: string,
) => {
  const cumulateVotes = (votes: VoteResults[]) => {
    const acc: VoteResults = {
      actualTotal: 0,
      actualPaperVotes: 0,
      actualMachineVotes: 0,
      votes: [],
    };
    if (votes) {
      votes.map((r) => {
        addVotes(acc, r.votes, r.protocol);
      });
    }

    return acc;
  };

  const data = elections.map((e) => {
    const regionVotes: ElectionRegions = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${regionsVotesFileName}`,
        "utf-8",
      ),
    );

    const results = cumulateVotes(regionVotes.map((v) => v.results));
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );

    return {
      ...e,
      results: {
        protocol: results.protocol,
        votes: results.votes.map((v) => {
          const party = parties.find((p) => p.number === v.partyNum);
          return {
            ...v,
            nickName: party?.nickName,
          };
        }),
      },
    };
  });
  return {
    country: data,
    byRegion: statsByRegion(elections, publicFolder),
    byMunicipality: statsByMunicipality(elections, publicFolder),
    bySettlement: statsBySettlement(elections, publicFolder),
  };
};
