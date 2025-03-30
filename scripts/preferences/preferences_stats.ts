import fs from "fs";
import path from "path";
import { CandidatesInfo, PreferencesInfo } from "@/data/dataTypes";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const publicFolder = path.resolve(__dirname, `../../public/`);

const assignPrevYearPreferences = ({
  tyCandidates,
  tyPreferences,
  lyCandidates,
  lyPreferences,
}: {
  tyPreferences: PreferencesInfo[];
  tyCandidates: CandidatesInfo[];
  lyPreferences?: PreferencesInfo[];
  lyCandidates?: CandidatesInfo[];
}) => {
  tyPreferences.forEach((preference) => {
    const candidate = tyCandidates.find(
      (c) =>
        c.pref === preference.pref &&
        c.partyNum === preference.partyNum &&
        c.oblast === preference.oblast,
    );

    const lyCandidate = lyCandidates?.find(
      (c) => c.name === candidate?.name && c.oblast === candidate.oblast,
    );
    if (lyCandidate) {
      const lyPreference = lyPreferences?.find(
        (c) =>
          c.pref === lyCandidate.pref &&
          c.partyNum === lyCandidate.partyNum &&
          c.oblast === lyCandidate.oblast,
      );
      if (lyPreference) {
        preference.lyTotalVotes = lyPreference.totalVotes;
      }
    }
  });
};

const folderPrevYearPreferences = ({
  stringify,
  year,
  folder,
  tyCandidates,
  lastYear,
  lyCandidates,
}: {
  stringify: (o: object) => string;
  folder: string;
  year: string;
  tyCandidates: CandidatesInfo[];
  lastYear?: string;
  lyCandidates?: CandidatesInfo[];
}) => {
  if (lyCandidates && lastYear) {
    const outFolder = `${publicFolder}/${year}/${folder}`;
    const lyFolder = `${publicFolder}/${lastYear}/${folder}`;
    const allFiles = fs.readdirSync(outFolder, { withFileTypes: true });
    allFiles
      .filter((f) => !f.name.startsWith("."))
      .forEach((f) => {
        const lyPreferencesFile = `${lyFolder}/${f.name}`;
        if (fs.existsSync(lyPreferencesFile)) {
          const preferencesFile = `${outFolder}/${f.name}`;
          const tyPreferences: PreferencesInfo[] = JSON.parse(
            fs.readFileSync(preferencesFile, "utf-8"),
          );
          const lyPreferences: PreferencesInfo[] = JSON.parse(
            fs.readFileSync(lyPreferencesFile, "utf-8"),
          );
          assignPrevYearPreferences({
            tyCandidates,
            tyPreferences,
            lyCandidates,
            lyPreferences,
          });
          fs.writeFileSync(preferencesFile, stringify(tyPreferences), "utf-8");
        }
      });
    console.log("Successfully added preferences stats ", outFolder);
  }
};

export const candidatesStats = (
  stringify: (o: object) => string,
  election?: string,
) => {
  const updatedElections = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter((file) => file.name.startsWith("20"))
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((f) => {
      const outFolder = `${publicFolder}/${f.name}`;
      const prefCountry: PreferencesInfo[] = JSON.parse(
        fs.readFileSync(`${outFolder}/preferences/country.json`, "utf-8"),
      );
      const prefSofia: PreferencesInfo[] = JSON.parse(
        fs.readFileSync(`${outFolder}/preferences/sofia.json`, "utf-8"),
      );
      const candidates: CandidatesInfo[] = JSON.parse(
        fs.readFileSync(`${outFolder}/candidates.json`, "utf-8"),
      );
      return {
        name: f.name,
        prefCountry,
        candidates,
        prefSofia,
      };
    });
  updatedElections
    .filter((e) => election === e.name || election === undefined)
    .forEach((e, index) => {
      const outFolder = `${publicFolder}/${e.name}`;
      const ty = e;
      const ly =
        index < updatedElections.length - 1
          ? updatedElections[index + 1]
          : undefined;
      assignPrevYearPreferences({
        tyPreferences: ty.prefCountry,
        tyCandidates: ty.candidates,
        lyPreferences: ly?.prefCountry,
        lyCandidates: ly?.candidates,
      });
      const countryFileName = `${outFolder}/preferences/country.json`;
      fs.writeFileSync(countryFileName, stringify(ty.prefCountry), "utf-8");
      console.log("Successfully added file ", countryFileName);
      assignPrevYearPreferences({
        tyPreferences: ty.prefSofia,
        tyCandidates: ty.candidates,
        lyPreferences: ly?.prefSofia,
        lyCandidates: ly?.candidates,
      });
      const sofiaFileName = `${outFolder}/preferences/sofia.json`;
      fs.writeFileSync(sofiaFileName, stringify(ty.prefSofia), "utf-8");
      console.log("Successfully added file ", sofiaFileName);

      folderPrevYearPreferences({
        stringify,
        year: e.name,
        lastYear: ly?.name,
        folder: "preferences/by_region",
        tyCandidates: ty.candidates,
        lyCandidates: ly?.candidates,
      });
      folderPrevYearPreferences({
        stringify,
        year: e.name,
        lastYear: ly?.name,
        folder: "preferences/by_municipality",
        tyCandidates: ty.candidates,
        lyCandidates: ly?.candidates,
      });
      folderPrevYearPreferences({
        stringify,
        year: e.name,
        lastYear: ly?.name,
        folder: "preferences/by_settlement",
        tyCandidates: ty.candidates,
        lyCandidates: ly?.candidates,
      });
      folderPrevYearPreferences({
        stringify,
        year: e.name,
        lastYear: ly?.name,
        folder: "preferences/by_section",
        tyCandidates: ty.candidates,
        lyCandidates: ly?.candidates,
      });
    });
};
