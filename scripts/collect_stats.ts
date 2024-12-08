import fs from "fs";
import {
  ElectionInfo,
  ElectionRegions,
  PartyInfo,
  VoteResults,
} from "@/data/dataTypes";
import { addVotes } from "@/data/utils";
import { cikPartiesFileName, regionsVotesFileName } from "./consts";

export const collectStats = (
  elections: ElectionInfo[],
  publicFolder: string,
) => {
  const municipalityVotes: { [key: string]: ElectionInfo[] } = {};
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
  return { country: data, byRegion: municipalityVotes };
};
