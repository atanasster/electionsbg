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

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const generateStats = <
  DType extends
    | ElectionMunicipality[]
    | ElectionRegions
    | ElectionSettlement[]
    | SectionInfo[],
>(
  elections: ElectionInfo[],
  publicFolder: string,
  fileName: string,
  key: "key" | "obshtina" | "ekatte" | "section",
) => {
  const collectedVotes: { [key: string]: ElectionInfo[] } = {};
  elections.forEach((e) => {
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );
    const regionVotes: DType = JSON.parse(
      fs.readFileSync(`${publicFolder}/${e.name}/${fileName}`, "utf-8"),
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

const collectStats = (elections: ElectionInfo[], publicFolder: string) => {
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

  const data = elections.map((e) => {
    const regionVotes: ElectionRegions = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${regionsVotesFileName}`,
        "utf-8",
      ),
    );

    const results = cumulateVotes(regionVotes.map((v) => v.results));
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );

    return {
      ...e,
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
  });
  return {
    country: data,
    byRegion: generateStats<ElectionRegions>(
      elections,
      publicFolder,
      regionsVotesFileName,
      "key",
    ),
    byMunicipality: generateStats<ElectionMunicipality[]>(
      elections,
      publicFolder,
      municipalityVotesFileName,
      "obshtina",
    ),
    bySettlement: generateStats<ElectionSettlement[]>(
      elections,
      publicFolder,
      settlementsVotesFileName,
      "ekatte",
    ),
    bySection: generateStats<SectionInfo[]>(
      elections,
      publicFolder,
      sectionVotesFileName,
      "section",
    ),
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
  const { country, byRegion, byMunicipality, bySettlement, bySection } =
    collectStats(updatedElections, publicFolder);
  const json = stringify(country);

  fs.writeFileSync(electionsFile, json, "utf8");
  console.log("Successfully added file ", electionsFile);
  Object.keys(byRegion).forEach((regionName) => {
    const data = stringify(byRegion[regionName]);
    fs.writeFileSync(
      `${publicFolder}/regions/${regionName}_stats.json`,
      data,
      "utf8",
    );
  });
  Object.keys(byMunicipality).forEach((muniName) => {
    const data = stringify(byMunicipality[muniName]);
    fs.writeFileSync(
      `${publicFolder}/municipalities/${muniName}_stats.json`,
      data,
      "utf8",
    );
  });
  Object.keys(bySettlement).forEach((ekatte) => {
    const data = stringify(bySettlement[ekatte]);
    fs.writeFileSync(
      `${publicFolder}/settlements/${ekatte}_stats.json`,
      data,
      "utf8",
    );
  });

  Object.keys(bySection).forEach((section) => {
    const data = stringify(bySection[section]);
    fs.writeFileSync(
      `${publicFolder}/sections/${section}_stats.json`,
      data,
      "utf8",
    );
  });
};
