import fs from "fs";
import {
  CandidatesInfo,
  PreferencesInfo,
  SOFIA_REGIONS,
} from "@/data/dataTypes";
import {
  municipalityDataReader,
  regionDataReader,
  saveSplitObject,
  settlementDataReader,
} from "scripts/dataReaders";
import { savePartyPreferences } from "./save_party_preferences";
import { assignPrevYearPreferences } from "./pref_utils";
import { totalAllVotes } from "@/data/utils";

const readLastYearPreferences = ({
  preferences,
  candidates,
  lyCandidates,
  lyFileName,
}: {
  lyFileName: string;
  preferences: PreferencesInfo[];
  candidates: CandidatesInfo[];
  lyCandidates?: CandidatesInfo[];
}) => {
  if (fs.existsSync(lyFileName)) {
    const lyPreferences: PreferencesInfo[] = JSON.parse(
      fs.readFileSync(lyFileName, "utf-8"),
    );
    assignPrevYearPreferences({
      tyCandidates: candidates,
      tyPreferences: preferences,
      lyCandidates,
      lyPreferences,
    });
  }
};

const readLastYearObjectPreferences = ({
  tyPreferences,
  lastYearFolder,
  candidates,
  lyCandidates,
}: {
  tyPreferences: Record<string, PreferencesInfo[]>;
  candidates: CandidatesInfo[];
  lastYearFolder?: string;
  lyCandidates?: CandidatesInfo[];
}) => {
  assignPartyPreferences(tyPreferences);
  if (lastYearFolder) {
    Object.keys(tyPreferences).forEach((key) => {
      const preferences = tyPreferences[key];
      const lyFileName = `${lastYearFolder}/${key}.json`;
      readLastYearPreferences({
        candidates,
        lyCandidates,
        lyFileName,
        preferences,
      });
    });
  }
};
const assignPartyPreferences = (
  preferences: Record<string, PreferencesInfo[]>,
) => {
  Object.keys(preferences).forEach((key) => {
    const prefs = preferences[key];
    prefs.forEach((p) => {
      p.partyPrefs = prefs.reduce(
        (acc, curr) =>
          curr.partyNum === p.partyNum ? acc + curr.totalVotes : acc,
        0,
      );
    });
  });
};

export const savePreferences = ({
  publicFolder,
  dataFolder,
  year,
  prevYears,
  stringify,
  preferences,
  preferencesMunicipalities,
  preferencesRegions,
  preferencesSettlements,
  preferencesSections,
  candidates,
}: {
  publicFolder: string;
  dataFolder: string;
  year: string;
  prevYears: string[];

  stringify: (o: object) => string;
  preferences: PreferencesInfo[];

  preferencesRegions: Record<string, PreferencesInfo[]>;
  preferencesMunicipalities: Record<string, PreferencesInfo[]>;
  preferencesSettlements: Record<string, PreferencesInfo[]>;
  preferencesSections: Record<string, PreferencesInfo[]>;
  candidates: CandidatesInfo[];
}) => {
  const outFolder = `${publicFolder}/${year}`;
  const prefFolder = `${outFolder}/preferences`;
  const lastYear = prevYears.length
    ? prevYears[prevYears.length - 1]
    : undefined;
  const lastYearFolder = lastYear ? `${publicFolder}/${lastYear}` : undefined;
  if (!fs.existsSync(prefFolder)) {
    fs.mkdirSync(prefFolder);
  }
  const lyCandidates: CandidatesInfo[] | undefined = lastYearFolder
    ? JSON.parse(fs.readFileSync(`${lastYearFolder}/candidates.json`, "utf-8"))
    : undefined;
  const lyPrefFolder = `${lastYearFolder}/preferences`;

  const prefByRegionFolder = `${prefFolder}/by_region`;
  if (!fs.existsSync(prefByRegionFolder)) {
    fs.mkdirSync(prefByRegionFolder);
  }
  const regionVotes = regionDataReader(dataFolder, year);
  Object.keys(preferencesRegions).forEach((key) => {
    const preferences = preferencesRegions[key];
    const votes = regionVotes?.find((r) => r.key === key);
    if (votes) {
      preferences.forEach((p) => {
        p.allVotes = totalAllVotes(votes.results.votes);
        p.partyVotes = votes.results.votes.find(
          (v) => v.partyNum === p.partyNum,
        )?.totalVotes;
      });
    }
  });
  readLastYearObjectPreferences({
    candidates,
    lyCandidates,
    lastYearFolder: `${lyPrefFolder}/by_region`,
    tyPreferences: preferencesRegions,
  });
  saveSplitObject(preferencesRegions, stringify, prefByRegionFolder);
  const countryPreferencesFileName = `${prefFolder}/country.json`;
  const preferencesCountry: PreferencesInfo[] = Object.keys(
    preferencesRegions,
  ).reduce(
    (acc: PreferencesInfo[], key) => [...acc, ...preferencesRegions[key]],
    [],
  );
  fs.writeFileSync(
    countryPreferencesFileName,
    stringify(preferencesCountry),
    "utf8",
  );

  console.log("Successfully added file ", countryPreferencesFileName);
  const sofiaPreferencesFileName = `${prefFolder}/sofia.json`;
  const preferencesSofia: PreferencesInfo[] = Object.keys(
    preferencesRegions,
  ).reduce((acc: PreferencesInfo[], key) => {
    if (SOFIA_REGIONS.includes(key)) {
      return [...acc, ...preferencesRegions[key]];
    }
    return acc;
  }, []);

  fs.writeFileSync(
    sofiaPreferencesFileName,
    stringify(preferencesSofia),
    "utf8",
  );
  console.log("Successfully added file ", sofiaPreferencesFileName);

  const prefByMuniFolder = `${prefFolder}/by_municipality`;
  if (!fs.existsSync(prefByMuniFolder)) {
    fs.mkdirSync(prefByMuniFolder);
  }
  const muniVotes = municipalityDataReader(dataFolder, year);
  Object.keys(preferencesMunicipalities).forEach((key) => {
    const preferences = preferencesMunicipalities[key];
    const votes = muniVotes?.find((r) => r.obshtina === key);
    if (votes) {
      preferences.forEach((p) => {
        p.allVotes = totalAllVotes(votes.results.votes);
        p.partyVotes = votes.results.votes.find(
          (v) => v.partyNum === p.partyNum,
        )?.totalVotes;
      });
    }
  });
  readLastYearObjectPreferences({
    candidates,
    lyCandidates,
    lastYearFolder: `${lyPrefFolder}/by_municipality`,
    tyPreferences: preferencesMunicipalities,
  });
  saveSplitObject(preferencesMunicipalities, stringify, prefByMuniFolder);
  const prefBySettlementFolder = `${prefFolder}/by_settlement`;
  if (!fs.existsSync(prefBySettlementFolder)) {
    fs.mkdirSync(prefBySettlementFolder);
  }
  const settlementVotes = settlementDataReader(dataFolder, year);
  Object.keys(preferencesSettlements).forEach((key) => {
    const preferences = preferencesSettlements[key];
    const votes = settlementVotes?.find((r) => r.ekatte === key);
    if (votes) {
      totalAllVotes(votes.results.votes);
      preferences.forEach((p) => {
        p.allVotes = totalAllVotes(votes.results.votes);
        p.partyVotes = votes.results.votes.find(
          (v) => v.partyNum === p.partyNum,
        )?.totalVotes;
      });
    }
  });
  readLastYearObjectPreferences({
    candidates,
    lyCandidates,
    lastYearFolder: `${lyPrefFolder}/by_settlement`,
    tyPreferences: preferencesSettlements,
  });
  saveSplitObject(preferencesSettlements, stringify, prefBySettlementFolder);

  const prefBySectionFolder = `${prefFolder}/by_section`;
  if (!fs.existsSync(prefBySectionFolder)) {
    fs.mkdirSync(prefBySectionFolder);
  }
  saveSplitObject(preferencesSections, stringify, prefBySectionFolder);

  const candidatesFolder = `${outFolder}/candidates`;
  if (!fs.existsSync(candidatesFolder)) {
    fs.mkdirSync(candidatesFolder);
  }

  const consolidatedCandidates = candidates.reduce(
    (acc: Record<string, CandidatesInfo[]>, curr) => {
      if (acc[curr.name] === undefined) {
        acc[curr.name] = [];
      }
      acc[curr.name].push(curr);
      return acc;
    },
    {},
  );
  Object.keys(consolidatedCandidates).forEach((name, index) => {
    const candidateFolder = `${candidatesFolder}/${name}`;
    if (!fs.existsSync(candidateFolder)) {
      fs.mkdirSync(candidateFolder);
    }
    const byRegion: PreferencesInfo[] = [];
    const bySection: PreferencesInfo[] = [];
    const byMunicipality: PreferencesInfo[] = [];
    const bySettlement: PreferencesInfo[] = [];

    consolidatedCandidates[name].forEach((c) => {
      preferencesCountry
        .filter(
          (v) =>
            v.partyNum === c.partyNum &&
            v.pref === c.pref &&
            c.oblast === v.oblast,
        )
        .forEach((v) => {
          byRegion.push({
            ...v,
          });
        });

      //by municipalities
      Object.keys(preferencesMunicipalities).forEach((muni) => {
        preferencesMunicipalities[muni]
          .filter(
            (v) =>
              v.partyNum === c.partyNum &&
              v.pref === c.pref &&
              c.oblast === v.oblast,
          )
          .forEach((v) => {
            byMunicipality.push({
              obshtina: muni,
              ...v,
            });
          });
      });

      //by settlements
      Object.keys(preferencesSettlements).forEach((ekatte) => {
        preferencesSettlements[ekatte]
          .filter(
            (v) =>
              v.partyNum === c.partyNum &&
              v.pref === c.pref &&
              c.oblast === v.oblast,
          )
          .forEach((v) => {
            bySettlement.push({
              ekatte,
              ...v,
            });
          });
      });

      //by sections

      const votes = preferences.filter(
        (v) =>
          v.partyNum === c.partyNum &&
          v.pref === c.pref &&
          v.oblast === c.oblast,
      );
      bySection.push(...votes);
    });
    process.stdout.write(
      (
        "\rSaving candidate " +
        (index + 1) +
        "/" +
        Object.keys(consolidatedCandidates).length +
        " - " +
        name
      ).padEnd(80, " "),
    );
    const byRegionFileName = `${candidateFolder}/regions.json`;
    fs.writeFileSync(byRegionFileName, stringify(byRegion), "utf8");

    const byMuniFileName = `${candidateFolder}/municipalities.json`;
    fs.writeFileSync(byMuniFileName, stringify(byMunicipality), "utf8");

    const bySettlementFileName = `${candidateFolder}/settlements.json`;
    fs.writeFileSync(bySettlementFileName, stringify(bySettlement), "utf8");

    const bySectionFileName = `${candidateFolder}/sections.json`;
    fs.writeFileSync(bySectionFileName, stringify(bySection), "utf8");
  });
  savePartyPreferences({
    publicFolder,
    year,
    prevYears,
    preferences,
    preferencesCountry,
    preferencesMunicipalities,
    preferencesSettlements,
    stringify,
  });
};
