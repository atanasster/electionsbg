import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { candidatesFileName, preferencesFileName } from "scripts/consts";
import { parsePreferences } from "scripts/preferences/parse_preferences";
import { CandidatesInfo, PreferencesInfo, SectionInfo } from "@/data/dataTypes";
import { savePreferences } from "./save_preferences";
import { parseCandidates } from "./parse_candidates";
import { addPreferences, assignPrevYearPreference } from "./pref_utils";

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
    .filter((file) => file.name.startsWith("20"))
    .sort((a, b) => a.name.localeCompare(b.name));

  await Promise.all(
    folders.map(async (e, index) => {
      if (election === e.name || election === undefined) {
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
        const ly = index > 0 ? folders[index - 1] : undefined;
        let lyCandidates: CandidatesInfo[] | undefined = undefined;

        if (candidates.length) {
          let lyPreferences: PreferencesInfo[] | undefined = undefined;
          if (ly) {
            lyCandidates = JSON.parse(
              fs.readFileSync(
                `${publicFolder}/${ly.name}/candidates.json`,
                "utf-8",
              ),
            );
            lyPreferences = JSON.parse(
              fs.readFileSync(
                `${rawFolder}/${ly.name}/preferences.json`,
                "utf-8",
              ),
            );
          }
          const sections: SectionInfo[] = JSON.parse(
            fs.readFileSync(`${inFolder}/section_votes.json`, "utf-8"),
          );

          sections.forEach((section) => {
            const pref = preferences.filter(
              (p) => p.section === section.section,
            );
            if (pref.length) {
              assignPrevYearPreference({
                section,
                tyPreferences: pref,
                tyCandidates: candidates,
                lyCandidates,
                lyPreferences,
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
            }
          });
        }
        process.stdout.write("\n");
        savePreferences({
          publicFolder,
          dataFolder: rawFolder,
          year: e.name,
          prevYears: folders.slice(0, index).map((e) => e.name),
          preferences,
          preferencesMunicipalities,
          preferencesRegions,
          preferencesSettlements,
          preferencesSections,
          stringify,
          candidates,
        });
      }
    }),
  );
  console.log();
  //candidatesStats(stringify, election);
};
