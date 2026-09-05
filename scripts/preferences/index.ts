import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { candidatesFileName, preferencesFileName } from "scripts/consts";
import { parsePreferences } from "scripts/preferences/parse_preferences";
import { CandidatesInfo, PreferencesInfo, SectionInfo } from "@/data/dataTypes";
import { savePreferences } from "./save_preferences";
import { parseCandidates } from "./parse_candidates";
import { addPreferences, assignPrevYearPreference } from "./pref_utils";
import { saveCandidateStats } from "./save_candidate_stats";
import { saveCandidateResolved } from "./save_candidate_resolved";
import { isParliamentaryFolder } from "scripts/lib/electionFolders";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

// Election folders moved out of /public/ during the GCS migration; they now
// live under /data/ and are served from the bucket in production. The dir
// scan that builds preferences still walks them locally.
const dataFolder = path.resolve(__dirname, `../../data/`);
const rawFolder = path.resolve(__dirname, `../../raw_data/`);

/**
 * The election folders preferences are built for, in ASCENDING date order.
 *
 * ⚠ PARLIAMENTARY ONLY, and the ORDER IS PART OF THE CONTRACT. Preferences
 * (предпочитания) are a proportional-list mechanic: a presidential ballot has no
 * candidate list to prefer within and a local cycle keeps its own tree, so neither
 * belongs here — a reader expecting `raw_data/<date>/preferences.txt` would be handed
 * a folder that has none.
 *
 * ⚠ AND NARROWING THIS LIST IS NOT A NO-OP, because the caller reads
 * `folders[index - 1]` as "the previous election". Before this was
 * parliamentary-only, the previous entry was whatever directory sorted just below —
 * in practice the nearest `_chmi` folder for 12 of the 13 elections — none of which
 * carries a `candidates.json`. So prev-year preference carry-over was reading a
 * folder that could not answer, and now resolves to the previous PARLIAMENTARY
 * election, which is what `assignPrevYearPreference` means by it. That is the
 * intended answer, and it is a CHANGE to generated output rather than a tightened
 * filter: the next `--candidates` run may write prev-year attribution that was never
 * there before.
 */
export const listPreferenceFolders = (): fs.Dirent[] =>
  fs
    .readdirSync(dataFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter((file) => isParliamentaryFolder(file.name))
    .sort((a, b) => a.name.localeCompare(b.name));

export const createPreferencesFiles = async (
  stringify: (o: object) => string,
  election?: string,
) => {
  const folders = listPreferenceFolders();

  await Promise.all(
    folders.map(async (e, index) => {
      if (election === e.name || election === undefined) {
        const preferencesSections: Record<string, PreferencesInfo[]> = {};
        const preferencesRegions: Record<string, PreferencesInfo[]> = {};
        const preferencesMunicipalities: Record<string, PreferencesInfo[]> = {};
        const preferencesSettlements: Record<string, PreferencesInfo[]> = {};

        const outFolder = `${dataFolder}/${e.name}`;
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
        // ⚠ `folders` is INDEX-ORDERED and this reads folders[index-1] as "the
        // PREVIOUS election" — so the list's membership, not just its length, is
        // load-bearing. See listPreferenceFolders' header.
        const ly = index > 0 ? folders[index - 1] : undefined;
        let lyCandidates: CandidatesInfo[] | undefined = undefined;

        if (candidates.length) {
          let lyPreferences: PreferencesInfo[] | undefined = undefined;
          if (ly) {
            // Guarded because an unguarded read here aborts the whole
            // `Promise.all` — which is what used to happen for 12 of 13
            // elections, since the previous entry was a `_chmi` folder with no
            // candidates.json. A missing prior year must degrade to "no
            // carry-over", not kill the run.
            const lyCandFile = `${dataFolder}/${ly.name}/candidates.json`;
            const lyPrefFile = `${rawFolder}/${ly.name}/preferences.json`;
            if (fs.existsSync(lyCandFile) && fs.existsSync(lyPrefFile)) {
              lyCandidates = JSON.parse(fs.readFileSync(lyCandFile, "utf-8"));
              lyPreferences = JSON.parse(fs.readFileSync(lyPrefFile, "utf-8"));
            } else {
              console.warn(
                `[preferences] ${e.name}: previous-year inputs missing at ${ly.name} — carry-over skipped`,
              );
            }
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
          // savePreferences's interface still calls the output folder
          // `publicFolder` for historical reasons; it now resolves to /data/.
          publicFolder: dataFolder,
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
        saveCandidateStats({
          stringify,
          prevYears: folders.slice(0, index).map((e) => e.name),
          year: e.name,
          publicFolder: dataFolder,
        });
        saveCandidateResolved({
          stringify,
          year: e.name,
          publicFolder: dataFolder,
        });
      }
    }),
  );
  console.log();

  //candidatesStats(stringify, election);
};
