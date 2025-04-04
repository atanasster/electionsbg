import fs from "fs";
import { PartyInfo, PreferencesInfo, PreferencesVotes } from "@/data/dataTypes";
import { matchPartyNickName } from "@/data/utils";

export const savePartyPreferences = ({
  outFolder,
  lastYearFolder,
  stringify,
  preferences,
  preferencesCountry,
  preferencesMunicipalities,
  preferencesSettlements,
}: {
  outFolder: string;
  lastYearFolder?: string;
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
  const parties: PartyInfo[] = JSON.parse(
    fs.readFileSync(`${outFolder}/cik_parties.json`, "utf-8"),
  );
  const lyParties: PartyInfo[] | undefined = lastYearFolder
    ? JSON.parse(fs.readFileSync(`${lastYearFolder}/cik_parties.json`, "utf-8"))
    : undefined;
  const preferencesFolder = `${outFolder}/parties/preferences`;
  if (!fs.existsSync(preferencesFolder)) {
    fs.mkdirSync(preferencesFolder);
  }

  const partyStats = preferencesCountry.reduce(
    (acc: Record<number, PreferencesVotes>, curr) => {
      if (curr.partyNum) {
        if (acc[curr.partyNum] === undefined) {
          const p: PreferencesVotes = {
            totalVotes: curr.totalVotes,
            paperVotes: curr.paperVotes || 0,
            machineVotes: curr.machineVotes || 0,
          };
          if (lyParties) {
            const party = parties.find((p) => p.number === curr.partyNum);
            if (party) {
              lyParties.forEach((lyp) => {
                if (matchPartyNickName(party, lyp, true)) {
                  const lyStatsFileName = `${lastYearFolder}/parties/preferences/${lyp.number}/stats.json`;
                  if (fs.existsSync(lyStatsFileName)) {
                    const lyStats: PreferencesVotes = JSON.parse(
                      fs.readFileSync(lyStatsFileName, "utf-8"),
                    );
                    p.lyTotalVotes = (p.lyTotalVotes || 0) + lyStats.totalVotes;
                    p.lyPaperVotes =
                      (p.lyPaperVotes || 0) + (lyStats.paperVotes || 0);
                    p.lyMachineVotes =
                      (p.lyMachineVotes || 0) + (lyStats.machineVotes || 0);
                  }
                }
              });
            }
          }
          acc[curr.partyNum] = p;
        } else {
          acc[curr.partyNum].totalVotes += curr.totalVotes;
          acc[curr.partyNum].paperVotes =
            (acc[curr.partyNum].paperVotes || 0) + (curr.paperVotes || 0);
          acc[curr.partyNum].machineVotes =
            (acc[curr.partyNum].machineVotes || 0) + (curr.machineVotes || 0);
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
