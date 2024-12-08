import fs from "fs";
import {
  ElectionInfo,
  ElectionMunicipality,
  ElectionRegions,
  PartyInfo,
  VoteResults,
} from "@/data/dataTypes";
import { addVotes } from "@/data/utils";
import {
  cikPartiesFileName,
  municipalityVotesFileName,
  regionsVotesFileName,
} from "./consts";

const statsByRegion = (elections: ElectionInfo[], publicFolder: string) => {
  const municipalityVotes: { [key: string]: ElectionInfo[] } = {};
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
      if (municipalityVotes[r.key] === undefined) {
        municipalityVotes[r.key] = [];
      }
      const res: VoteResults = {
        actualTotal: 0,
        actualPaperVotes: 0,
        actualMachineVotes: 0,
        votes: [],
      };
      addVotes(res, r.results.votes, r.results.protocol);
      municipalityVotes[r.key].push({
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
  return municipalityVotes;
};

const statsByMunicipality = (
  elections: ElectionInfo[],
  publicFolder: string,
) => {
  const settlementVotes: { [key: string]: ElectionInfo[] } = {};
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
      if (settlementVotes[r.obshtina] === undefined) {
        settlementVotes[r.obshtina] = [];
      }
      const res: VoteResults = {
        actualTotal: 0,
        actualPaperVotes: 0,
        actualMachineVotes: 0,
        votes: [],
      };
      addVotes(res, r.results.votes, r.results.protocol);
      settlementVotes[r.obshtina].push({
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
  return settlementVotes;
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
  };
};
