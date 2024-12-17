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
} from "./consts";
import path from "path";
import { fileURLToPath } from "url";
import { saveSplitObject } from "./dataReaders";

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
        ...e,
        results: {
          ...res,
          protocol: res.protocol,
          votes: res.votes.map((v) => {
            const party = parties.find((p) => p.number === v.partyNum);
            const stat: StatsVote = {
              ...v,
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
    return {
      ...e,
      ...results,
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
      ...e,
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
  const outFolder = path.resolve(__dirname, `../public/`);

  const electionsFile = path.resolve(
    __dirname,
    "../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );

  const updatedElections: ElectionInfo[] = fs
    .readdirSync(outFolder, { withFileTypes: true })
    .filter((file) => file.isDirectory())
    .filter((file) => file.name.startsWith("20"))
    .map((f) => ({
      name: f.name,
      ...elections.find((p) => p.name === f.name),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
  const publicFolder = path.resolve(__dirname, `../public`);
  const rawDataFolder = path.resolve(__dirname, `../raw_data`);
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
