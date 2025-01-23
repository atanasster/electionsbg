import fs from "fs";
import { PreferencesInfo } from "@/data/dataTypes";
import { saveSplitObject } from "scripts/dataReaders";

export const savePreferences = ({
  outFolder,
  stringify,
  preferencesCountry,
  preferencesMunicipalities,
  preferencesRegions,
  preferencesSettlements,
  preferencesSofia,
}: {
  outFolder: string;
  stringify: (o: object) => string;
  preferencesCountry: PreferencesInfo[];
  preferencesSofia: PreferencesInfo[];
  preferencesRegions: Record<string, PreferencesInfo[]>;
  preferencesMunicipalities: Record<string, PreferencesInfo[]>;
  preferencesSettlements: Record<string, PreferencesInfo[]>;
}) => {
  const prefFolder = `${outFolder}/preferences`;
  if (!fs.existsSync(prefFolder)) {
    fs.mkdirSync(prefFolder);
  }
  const countryPreferencesFileName = `${prefFolder}/country.json`;
  fs.writeFileSync(
    countryPreferencesFileName,
    stringify(preferencesCountry),
    "utf8",
  );
  console.log("Successfully added file ", countryPreferencesFileName);
  const sofiaPreferencesFileName = `${prefFolder}/sofia.json`;
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
  const regionsPreferencesFileName = `${prefFolder}/regions.json`;
  fs.writeFileSync(
    regionsPreferencesFileName,
    stringify(preferencesRegions),
    "utf8",
  );
  console.log("Successfully added file ", regionsPreferencesFileName);
  saveSplitObject(preferencesRegions, stringify, prefByRegionFolder);
  const prefByMuniFolder = `${prefFolder}/by_municipality`;
  if (!fs.existsSync(prefByMuniFolder)) {
    fs.mkdirSync(prefByMuniFolder);
  }
  saveSplitObject(preferencesMunicipalities, stringify, prefByMuniFolder);
  const prefBySettlementFolder = `${prefFolder}/by_settlement`;
  if (!fs.existsSync(prefBySettlementFolder)) {
    fs.mkdirSync(prefBySettlementFolder);
  }
  saveSplitObject(preferencesSettlements, stringify, prefBySettlementFolder);
};
