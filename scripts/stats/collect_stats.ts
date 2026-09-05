import fs from "fs";
import {
  ElectionInfo,
  ElectionMunicipality,
  ElectionRegions,
  ElectionSettlement,
  PartyInfo,
  SectionInfo,
  StatsVote,
  VoteResults,
} from "@/data/dataTypes";
import { addResults } from "@/data/utils";
import {
  cikPartiesFileName,
  municipalityVotesFileName,
  regionsVotesFileName,
  sectionVotesFileName,
  settlementsVotesFileName,
} from "../consts";
import path from "path";
import {
  describeSkippedElectionFolders,
  isParliamentaryFolder,
} from "../lib/electionFolders";
import { fileURLToPath } from "url";
import { saveSplitObject } from "../dataReaders";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const generateStats = <
  DType extends
    | ElectionMunicipality[]
    | ElectionRegions
    | ElectionSettlement[]
    | SectionInfo[],
>({
  elections,
  publicFolder,
  getDataFileName,
  key,
}: {
  elections: ElectionInfo[];
  publicFolder: string;
  getDataFileName: (year: string) => string;
  key: "key" | "obshtina" | "ekatte" | "section";
}) => {
  const collectedVotes: { [key: string]: ElectionInfo[] } = {};
  elections.forEach((e) => {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );
    const regionVotes: DType = JSON.parse(
      fs.readFileSync(getDataFileName(e.name), "utf-8"),
    );
    regionVotes.forEach((r) => {
      //@ts-expect-error multiple fields
      const k: string = r[key];
      if (collectedVotes[k] === undefined) {
        collectedVotes[k] = [];
      }
      const res: VoteResults = {
        votes: [],
      };
      const results = r.results || r;
      addResults(res, results.votes, results.protocol);
      collectedVotes[k].push({
        name: e.name,
        results: {
          ...res,
          protocol: res.protocol,
          votes: res.votes.map((v) => {
            const party = parties.find((p) => p.number === v.partyNum);
            const stat: StatsVote = {
              ...v,
              number: party?.number as number,
              nickName: party?.nickName as string,
            };
            if (party?.commonName) {
              stat.commonName = party?.commonName;
            }
            return stat;
          }),
        },
      });
    });
  });
  return collectedVotes;
};

const cumulateVotes = (votes: VoteResults[]) => {
  const acc: VoteResults = {
    votes: [],
  };
  if (votes) {
    votes.map((r) => {
      addResults(acc, r.votes, r.protocol);
    });
  }

  return acc;
};
const cumulatePartyVotes = (
  votes: VoteResults[],
  year: string,
  publicFolder: string,
) => {
  const parties: PartyInfo[] = JSON.parse(
    fs.readFileSync(`${publicFolder}/${year}/${cikPartiesFileName}`, "utf-8"),
  );
  const results = cumulateVotes(votes);
  return {
    results: {
      protocol: results.protocol,
      votes: results.votes.map((v) => {
        const party = parties.find((p) => p.number === v.partyNum);
        const stat: StatsVote = {
          ...v,
          nickName: party?.nickName as string,
          number: party?.number as number,
        };
        if (party?.commonName) {
          stat.commonName = party?.commonName;
        }
        return stat;
      }),
    },
  };
};
const collectStats = ({
  elections,
  publicFolder,
  rawDataFolder,
  getDataFileName,
}: {
  elections: ElectionInfo[];
  publicFolder: string;
  rawDataFolder: string;
  getDataFileName: (year: string) => string;
}) => {
  const country = elections.map((e) => {
    const regionVotes: ElectionRegions = JSON.parse(
      fs.readFileSync(getDataFileName(e.name), "utf-8"),
    );

    const results = cumulatePartyVotes(
      regionVotes.map((v) => v.results),
      e.name,
      publicFolder,
    );
    const regions: ElectionRegions = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${regionsVotesFileName}`,
        "utf-8",
      ),
    );
    const hasRecount = regions.length && !!regions[0].original;
    const preferenceFile = `${publicFolder}/${e.name}/preferences/country.json`;
    let hasPreferences = false;
    if (fs.existsSync(preferenceFile)) {
      hasPreferences =
        JSON.parse(fs.readFileSync(preferenceFile, "utf-8")).length > 0;
    }

    const financialsFile = `${publicFolder}/${e.name}/parties/financing.json`;
    const hasFinancials = fs.existsSync(financialsFile);
    const suemgFile = `${rawDataFolder}/${e.name}/suemg.json`;
    const hasSuemg = fs.existsSync(suemgFile);
    return {
      name: e.name,
      ...results,
      hasRecount,
      hasPreferences,
      hasFinancials,
      hasSuemg,
    };
  });
  const sofia = elections.map((e) => {
    const regionVotes: ElectionRegions = JSON.parse(
      fs.readFileSync(getDataFileName(e.name), "utf-8"),
    );

    const results = cumulatePartyVotes(
      regionVotes
        .filter((v) => ["S23", "S24", "S25"].includes(v.key))
        .map((v) => v.results),
      e.name,
      publicFolder,
    );
    return {
      name: e.name,
      ...results,
    };
  });
  return {
    country,
    sofia,
    byRegion: generateStats<ElectionRegions>({
      elections,
      publicFolder,
      key: "key",
      getDataFileName: (year) =>
        `${publicFolder}/${year}/${regionsVotesFileName}`,
    }),
    byMunicipality: generateStats<ElectionMunicipality[]>({
      elections,
      publicFolder,
      key: "obshtina",
      getDataFileName: (year) =>
        `${rawDataFolder}/${year}/${municipalityVotesFileName}`,
    }),
    bySettlement: generateStats<ElectionSettlement[]>({
      elections,
      publicFolder,
      key: "ekatte",
      getDataFileName: (year) =>
        `${rawDataFolder}/${year}/${settlementsVotesFileName}`,
    }),
    bySection: generateStats<SectionInfo[]>({
      elections,
      publicFolder,
      key: "section",
      getDataFileName: (year) =>
        `${rawDataFolder}/${year}/${sectionVotesFileName}`,
    }),
  };
};

export const runStats = (stringify: (o: object) => string) => {
  // Election folders moved to /data/ during the GCS migration.
  const outFolder = path.resolve(__dirname, `../../data/`);

  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );

  // ⚠ PARLIAMENTARY ONLY, and by the shared predicate rather than a prefix test.
  // This rewrites `src/data/json/elections.json` — the catalogue the selector, the
  // hub and every `?elections=` consumer read — from whatever directories it finds.
  // `startsWith("20")` accepted every kind; the local trees stayed out only because
  // they carry no `region_votes.json`, an accident that a `data/<date>_pvr/` tree
  // (which DOES carry one) would end. See scripts/lib/electionFolders.ts.
  const allFolders = fs
    .readdirSync(outFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory());
  const parliamentaryFolders = allFolders.filter((file) =>
    isParliamentaryFolder(file.name),
  );
  // ⚠ Counts OTHER ELECTION KINDS, not every skipped directory — 53 of the 120
  // non-parliamentary folders under `data/` are unrelated datasets.
  const skipped = describeSkippedElectionFolders(allFolders.map((f) => f.name));
  if (skipped) {
    console.log(
      `[collect_stats] ${parliamentaryFolders.length} parliamentary folder(s); skipped ${skipped}`,
    );
  }
  const updatedElections: ElectionInfo[] = parliamentaryFolders
    .map((f) => ({
      name: f.name,
      ...elections.find((p) => p.name === f.name),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
  // ⚠ THIS IS THE DATA ROOT, NOT `public/` — and it was `public/` until now, which
  // made every path below dead. The GCS migration moved the election tree to
  // `data/` and updated the folder LIST (`outFolder`, above) without updating the
  // reads and writes, so `--stats` threw ENOENT on the first election: `public/`
  // holds no election directory, no `regions/`, no `municipalities/`. Every target
  // named below exists under `data/` and was last written by that migration commit.
  // The variable keeps its historical name because `collectStats` takes a
  // `publicFolder` argument that means "the data output root" throughout this
  // pipeline (see the note in scripts/main.ts).
  const publicFolder = outFolder;
  const rawDataFolder = path.resolve(__dirname, `../../raw_data`);
  const { country, byRegion, byMunicipality, bySettlement, bySection, sofia } =
    collectStats({
      elections: updatedElections,
      publicFolder,
      rawDataFolder,
      getDataFileName: (year) =>
        `${publicFolder}/${year}/${regionsVotesFileName}`,
    });
  fs.writeFileSync(electionsFile, stringify(country), "utf8");
  console.log("Successfully added file ", electionsFile);
  const sofiaStatsFileName = `${publicFolder}/sofia_stats.json`;
  fs.writeFileSync(sofiaStatsFileName, stringify(sofia), "utf8");
  console.log("Successfully added file ", sofiaStatsFileName);
  Object.keys(byRegion).forEach((regionName) => {
    const data = stringify(byRegion[regionName]);
    fs.writeFileSync(
      `${publicFolder}/regions/${regionName}_stats.json`,
      data,
      "utf8",
    );
  });
  saveSplitObject(
    byMunicipality,
    stringify,
    `${publicFolder}/municipalities`,
    "stats",
  );

  saveSplitObject(
    bySettlement,
    stringify,
    `${publicFolder}/settlements`,
    "stats",
  );
  saveSplitObject(bySection, stringify, `${publicFolder}/sections`, "stats");
};
