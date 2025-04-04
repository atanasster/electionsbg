import fs from "fs";
import {
  CandidatesInfo,
  PreferencesInfo,
  SOFIA_REGIONS,
} from "@/data/dataTypes";
import { saveSplitObject } from "scripts/dataReaders";
import { savePartyPreferences } from "./save_party_preferences";
import { assignPrevYearPreferences } from "./pref_utils";

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
export const savePreferences = ({
  outFolder,
  lastYearFolder,
  lyCandidates,
  stringify,
  preferences,
  preferencesCountry,
  preferencesMunicipalities,
  preferencesRegions,
  preferencesSettlements,
  preferencesSections,
  candidates,
}: {
  outFolder: string;
  lastYearFolder?: string;
  stringify: (o: object) => string;
  preferences: PreferencesInfo[];
  preferencesCountry: PreferencesInfo[];
  preferencesRegions: Record<string, PreferencesInfo[]>;
  preferencesMunicipalities: Record<string, PreferencesInfo[]>;
  preferencesSettlements: Record<string, PreferencesInfo[]>;
  preferencesSections: Record<string, PreferencesInfo[]>;
  candidates: CandidatesInfo[];
  lyCandidates?: CandidatesInfo[];
}) => {
  const prefFolder = `${outFolder}/preferences`;
  if (!fs.existsSync(prefFolder)) {
    fs.mkdirSync(prefFolder);
  }
  const lyPrefFolder = `${lastYearFolder}/preferences`;
  readLastYearPreferences({
    candidates,
    lyCandidates,
    lyFileName: `${lyPrefFolder}/country.json`,
    preferences: preferencesCountry,
  });
  const countryPreferencesFileName = `${prefFolder}/country.json`;
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

  const prefByRegionFolder = `${prefFolder}/by_region`;
  if (!fs.existsSync(prefByRegionFolder)) {
    fs.mkdirSync(prefByRegionFolder);
  }
  readLastYearObjectPreferences({
    candidates,
    lyCandidates,
    lastYearFolder: `${lyPrefFolder}/by_region`,
    tyPreferences: preferencesRegions,
  });
  saveSplitObject(preferencesRegions, stringify, prefByRegionFolder);
  const prefByMuniFolder = `${prefFolder}/by_municipality`;
  if (!fs.existsSync(prefByMuniFolder)) {
    fs.mkdirSync(prefByMuniFolder);
  }
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

  const regionPrefsByParty = preferencesCountry.reduce(
    (acc: Record<string, Record<number, number>>, curr) => {
      if (curr.oblast) {
        if (acc[curr.oblast] === undefined) {
          acc[curr.oblast] = {};
        }
        if (acc[curr.oblast][curr.partyNum] === undefined) {
          acc[curr.oblast][curr.partyNum] = curr.totalVotes;
        } else {
          acc[curr.oblast][curr.partyNum] += curr.totalVotes;
        }
      }
      return acc;
    },
    {},
  );
  const muniPrefsByParty = Object.keys(preferencesMunicipalities).reduce(
    (acc: Record<string, Record<number, number>>, key) => {
      acc[key] = preferencesMunicipalities[key].reduce(
        (prefs: Record<number, number>, curr) => {
          if (prefs[curr.partyNum] === undefined) {
            prefs[curr.partyNum] = curr.totalVotes;
          } else {
            prefs[curr.partyNum] += curr.totalVotes;
          }
          return prefs;
        },
        {},
      );
      return acc;
    },
    {},
  );
  const settlementPrefsByParty = Object.keys(preferencesSettlements).reduce(
    (acc: Record<string, Record<number, number>>, key) => {
      acc[key] = preferencesSettlements[key].reduce(
        (prefs: Record<number, number>, curr) => {
          if (prefs[curr.partyNum] === undefined) {
            prefs[curr.partyNum] = curr.totalVotes;
          } else {
            prefs[curr.partyNum] += curr.totalVotes;
          }
          return prefs;
        },
        {},
      );
      return acc;
    },
    {},
  );

  const sectionPrefsByParty = preferences.reduce(
    (acc: Record<string, Record<number, number>>, curr) => {
      if (curr.section) {
        if (acc[curr.section] === undefined) {
          acc[curr.section] = {};
        }
        if (acc[curr.section][curr.partyNum] === undefined) {
          acc[curr.section][curr.partyNum] = curr.totalVotes;
        } else {
          acc[curr.section][curr.partyNum] += curr.totalVotes;
        }
      }
      return acc;
    },
    {},
  );
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
          const partyPrefs = v.oblast
            ? regionPrefsByParty[v.oblast]?.[v.partyNum]
            : v.totalVotes;
          byRegion.push({
            partyPrefs,
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
            const partyPrefs = v.obshtina
              ? muniPrefsByParty[v.obshtina]?.[v.partyNum]
              : v.totalVotes;
            byMunicipality.push({
              partyPrefs,
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
            const partyPrefs = v.ekatte
              ? settlementPrefsByParty[v.ekatte]?.[v.partyNum]
              : v.totalVotes;
            bySettlement.push({
              ekatte,
              partyPrefs,
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
      bySection.push(
        ...votes.map((v) => {
          const partyPrefs = v.section
            ? sectionPrefsByParty[v.section]?.[v.partyNum]
            : v.totalVotes;
          return { ...v, partyPrefs };
        }),
      );
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
    outFolder,
    preferences,
    preferencesCountry,
    preferencesMunicipalities,
    preferencesSettlements,
    stringify,
  });
  console.log();
};
