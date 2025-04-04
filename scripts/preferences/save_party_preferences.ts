import fs from "fs";
import { PreferencesInfo } from "@/data/dataTypes";

export const savePartyPreferences = ({
  outFolder,
  stringify,
  preferences,
  preferencesCountry,
  preferencesMunicipalities,
  preferencesSettlements,
}: {
  outFolder: string;
  stringify: (o: object) => string;
  preferences: PreferencesInfo[];
  preferencesCountry: PreferencesInfo[];
  preferencesMunicipalities: Record<string, PreferencesInfo[]>;
  preferencesSettlements: Record<string, PreferencesInfo[]>;
}) => {
  const regionPrefsByParty = preferencesCountry.reduce(
    (acc: Record<number, PreferencesInfo[]>, curr) => {
      if (curr.partyNum) {
        if (acc[curr.partyNum] === undefined) {
          acc[curr.partyNum] = [];
        }
        acc[curr.partyNum].push(curr);
      }
      return acc;
    },
    {},
  );
  const muniPrefsByParty = Object.keys(preferencesMunicipalities).reduce(
    (acc: Record<number, PreferencesInfo[]>, key) => {
      preferencesMunicipalities[key].forEach((curr) => {
        if (acc[curr.partyNum] === undefined) {
          acc[curr.partyNum] = [];
        }
        acc[curr.partyNum].push(curr);
      });
      return acc;
    },
    {},
  );
  const settlementPrefsByParty = Object.keys(preferencesSettlements).reduce(
    (acc: Record<number, PreferencesInfo[]>, key) => {
      preferencesSettlements[key].forEach((curr) => {
        if (acc[curr.partyNum] === undefined) {
          acc[curr.partyNum] = [];
        }
        acc[curr.partyNum].push(curr);
      });
      return acc;
    },
    {},
  );

  const sectionPrefsByParty = preferences.reduce(
    (acc: Record<number, PreferencesInfo[]>, curr) => {
      if (acc[curr.partyNum] === undefined) {
        acc[curr.partyNum] = [];
      }
      acc[curr.partyNum].push(curr);
      return acc;
    },
    {},
  );
  const preferencesFolder = `${outFolder}/parties/preferences`;
  if (!fs.existsSync(preferencesFolder)) {
    fs.mkdirSync(preferencesFolder);
  }
  const partyStats = preferencesCountry.reduce(
    (
      acc: Record<
        number,
        {
          totalVotes: number;
          paperVotes: number;
          machineVotes: number;
          lyTotalVotes: number;
          lyPaperVotes: number;
          lyMachineVotes: number;
        }
      >,
      curr,
    ) => {
      if (curr.partyNum) {
        if (acc[curr.partyNum] === undefined) {
          acc[curr.partyNum] = {
            totalVotes: curr.totalVotes,
            paperVotes: curr.paperVotes || 0,
            machineVotes: curr.machineVotes || 0,
            lyTotalVotes: curr.lyTotalVotes || 0,
            lyPaperVotes: curr.lyPaperVotes || 0,
            lyMachineVotes: curr.lyMachineVotes || 0,
          };
        } else {
          acc[curr.partyNum].totalVotes += curr.totalVotes;
          acc[curr.partyNum].paperVotes += curr.paperVotes || 0;
          acc[curr.partyNum].machineVotes += curr.machineVotes || 0;
          acc[curr.partyNum].lyTotalVotes += curr.lyTotalVotes || 0;
          acc[curr.partyNum].lyPaperVotes += curr.lyPaperVotes || 0;
          acc[curr.partyNum].lyMachineVotes += curr.lyMachineVotes || 0;
        }
      }
      return acc;
    },
    {},
  );
  Object.keys(regionPrefsByParty).forEach((key) => {
    const partyFolder = `${preferencesFolder}/${key}`;
    if (!fs.existsSync(partyFolder)) {
      fs.mkdirSync(partyFolder);
    }
    const partyNum = parseInt(key);
    const regions = regionPrefsByParty[partyNum];
    const byRegionFileName = `${partyFolder}/regions.json`;
    fs.writeFileSync(byRegionFileName, stringify(regions), "utf8");

    const municipalities = muniPrefsByParty[partyNum];
    const byMuniFileName = `${partyFolder}/municipalities.json`;
    fs.writeFileSync(byMuniFileName, stringify(municipalities), "utf8");

    const settlements = settlementPrefsByParty[partyNum];
    const bySettlementFileName = `${partyFolder}/settlements.json`;
    fs.writeFileSync(bySettlementFileName, stringify(settlements), "utf8");

    const sections = sectionPrefsByParty[partyNum] || [];
    const bySectionFileName = `${partyFolder}/sections.json`;
    fs.writeFileSync(bySectionFileName, stringify(sections), "utf8");

    const stats = partyStats[partyNum];
    const statsFileName = `${partyFolder}/stats.json`;
    fs.writeFileSync(statsFileName, stringify(stats), "utf8");
  });
};
