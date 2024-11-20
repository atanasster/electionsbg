import { useEffect, useState } from "react";
import {
  ElectionRegions,
  ElectionRegion,
  ElectionMunicipality,
  VoteResults,
} from "./dataTypes";
import { addVotes } from "./utils";
import {
  useSettlementsInfo,
  RegionInfo,
  MunicipalityInfo,
  SettlementInfo,
} from "./SettlementsContext";

export const useAggregatedVotes = () => {
  const [votes, setVotes] = useState<ElectionRegions>([]);
  const { findRegion, findMunicipality, findSettlement } = useSettlementsInfo();

  useEffect(() => {
    fetch("/2024_10/aggregated_votes.json")
      .then((response) => response.json())
      .then((data) => {
        setVotes(data);
      });
  }, []);
  const votesByRegion = (regionCode: string): ElectionRegion | undefined => {
    return votes.find((vote) => vote.key === regionCode);
  };
  const votesBySettlement = (
    regionCode: string,
    obshtina: string,
    ekatte: string,
  ) => {
    return votes
      .find((vote) => vote.key === regionCode)
      ?.municipalities.find((m) => m.obshtina === obshtina)
      ?.settlements.find((s) => s.ekatte === ekatte);
  };
  const votesByMunicipality = (
    regionCode: string,
    obshtina: string,
  ): ElectionMunicipality | undefined => {
    return votes
      .find((vote) => vote.key === regionCode)
      ?.municipalities.find((m) => m.obshtina === obshtina);
  };

  const countryVotes = (): VoteResults => {
    const acc: VoteResults = {
      actualTotal: 0,
      actualPaperVotes: 0,
      actualMachineVotes: 0,
      votes: [],
    };
    votes.map((r) => {
      addVotes(acc, r.results.votes, r.results.protocol);
    });

    return acc;
  };
  const findSectionLocation: (section: string) =>
    | {
        region?: RegionInfo;
        municipality?: MunicipalityInfo;
        settlement?: SettlementInfo;
      }
    | undefined = (section: string) => {
    let result:
      | {
          region?: RegionInfo;
          municipality?: MunicipalityInfo;
          settlement?: SettlementInfo;
        }
      | undefined = undefined;
    votes.find((v) =>
      v.municipalities.find((m) => {
        m.settlements.find((s) => {
          if (s.sections.includes(section)) {
            if (m.obshtina && s.ekatte) {
              result = {
                region: findRegion(v.key),
                municipality: findMunicipality(m.obshtina),
                settlement: findSettlement(s.ekatte),
              };
            }
            return true;
          }
        });
      }),
    );
    return result;
  };
  return {
    votesByRegion,
    regions: votes,
    findSectionLocation,
    votesBySettlement,
    votesByMunicipality,
    countryVotes,
  };
};
