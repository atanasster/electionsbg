import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { candidatesFileName, preferencesFileName } from "scripts/consts";
import { parsePreferences } from "scripts/preferences/parse_preferences";
import { PreferencesInfo, SectionInfo, SOFIA_REGIONS } from "@/data/dataTypes";
import { addPreferences, totalAllVotes } from "@/data/utils";
import { savePreferences } from "./save_preferences";
import { parseCandidates } from "./parse_candidates";
import { candidatesStats } from "./preferences_stats";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const publicFolder = path.resolve(__dirname, `../../public/`);
const rawFolder = path.resolve(__dirname, `../../raw_data/`);

export const createPreferencesFiles = async (
  stringify: (o: object) => string,
  election?: string,
) => {
  const folders = fs
    .readdirSync(publicFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter((file) => file.name.startsWith("20"));
  await Promise.all(
    folders
      .filter((e) => election === e.name || election === undefined)
      .map(async (e) => {
        const preferencesCountry: PreferencesInfo[] = [];
        const preferencesSofia: PreferencesInfo[] = [];
        const preferencesSections: Record<string, PreferencesInfo[]> = {};
        const preferencesRegions: Record<string, PreferencesInfo[]> = {};
        const preferencesMunicipalities: Record<string, PreferencesInfo[]> = {};
        const preferencesSettlements: Record<string, PreferencesInfo[]> = {};

        const outFolder = `${publicFolder}/${e.name}`;
        const inFolder = `${rawFolder}/${e.name}`;
        const candidates = await parseCandidates(inFolder, e.name);
        fs.writeFileSync(
          `${outFolder}/${candidatesFileName}`,
          stringify(candidates),
          "utf-8",
        );
        const preferences = await parsePreferences(inFolder, e.name);
        fs.writeFileSync(
          `${inFolder}/${preferencesFileName}`,
          stringify(preferences),
          "utf-8",
        );
        if (candidates.length) {
          const sections: SectionInfo[] = JSON.parse(
            fs.readFileSync(`${inFolder}/section_votes.json`, "utf-8"),
          );
          sections.forEach((section) => {
            const pref = preferences.filter(
              (p) => p.section === section.section,
            );
            if (pref.length) {
              const allVotes = totalAllVotes(section.results.votes);
              pref.forEach((p) => {
                p.oblast = section.oblast;
                p.obshtina = section.obshtina;
                p.ekatte = section.ekatte;
                p.partyVotes = section.results.votes.find(
                  (v) => v.partyNum === p.partyNum,
                )?.totalVotes;
                p.allVotes = allVotes;
              });
              preferencesSections[section.section] = pref.map((p) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { section, ...rest } = p;
                return rest;
              });

              if (preferencesRegions[section.oblast] === undefined) {
                process.stdout.write(
                  ("\rSaving preferences for region " + section.oblast).padEnd(
                    80,
                    " ",
                  ),
                );
                preferencesRegions[section.oblast] = [];
              }
              const defaultPrefs: Partial<PreferencesInfo> = {
                oblast: section.oblast,
              };
              addPreferences(
                preferencesRegions[section.oblast],
                pref,
                defaultPrefs,
              );
              if (section.obshtina) {
                if (preferencesMunicipalities[section.obshtina] === undefined) {
                  preferencesMunicipalities[section.obshtina] = [];
                }

                addPreferences(
                  preferencesMunicipalities[section.obshtina],
                  pref,
                  {
                    ...defaultPrefs,
                    obshtina: section.obshtina,
                  },
                );
              }
              if (section.ekatte) {
                if (preferencesSettlements[section.ekatte] === undefined) {
                  preferencesSettlements[section.ekatte] = [];
                }

                addPreferences(preferencesSettlements[section.ekatte], pref, {
                  ...defaultPrefs,
                  obshtina: section.obshtina,
                  ekatte: section.ekatte,
                });
              }
              addPreferences(preferencesCountry, pref, defaultPrefs);
              if (SOFIA_REGIONS.includes(section.oblast)) {
                addPreferences(preferencesSofia, pref, defaultPrefs);
              }
            }
          });
        }
        savePreferences({
          outFolder,
          preferences,
          preferencesCountry,
          preferencesMunicipalities,
          preferencesRegions,
          preferencesSettlements,
          preferencesSofia,
          preferencesSections,
          stringify,
          candidates,
        });
      }),
  );
  console.log();
  candidatesStats(stringify);
};
