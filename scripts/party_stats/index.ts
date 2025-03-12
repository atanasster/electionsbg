import fs from "fs";
import {
  ElectionInfo,
  ElectionMunicipality,
  ElectionRegion,
  ElectionSettlement,
  PartyInfo,
  PartyResultsRow,
  SectionInfo,
  StatsVote,
} from "@/data/dataTypes";
import {
  findPrevVotes,
  partyVotesPosition,
  totalActualVoters,
} from "@/data/utils";
import {
  cikPartiesFileName,
  municipalityVotesFileName,
  regionsVotesFileName,
  sectionVotesFileName,
  settlementsVotesFileName,
} from "../consts";
import path from "path";
import { fileURLToPath } from "url";
import { saveSplitObject } from "../dataReaders";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const generateStats = <
  DType extends
    | ElectionMunicipality
    | ElectionRegion
    | ElectionSettlement
    | SectionInfo,
>({
  elections,
  publicFolder,
  getDataFileName,
  by,
  regionFields,
  stringify,
}: {
  elections: ElectionInfo[];
  publicFolder: string;
  getDataFileName: (year: string) => string;
  regionFields: (
    row: DType,
  ) => Pick<PartyResultsRow, "oblast" | "obshtina" | "ekatte" | "section">;
  by: "region" | "municipality" | "settlement" | "section";
  stringify: (o: object) => string;
}) => {
  elections.forEach((e, idx) => {
    const collectedVotes: { [key: string]: PartyResultsRow[] } = {};
    const parties: PartyInfo[] = JSON.parse(
      fs.readFileSync(
        `${publicFolder}/${e.name}/${cikPartiesFileName}`,
        "utf-8",
      ),
    );
    const regionVotes: DType[] = JSON.parse(
      fs.readFileSync(getDataFileName(e.name), "utf-8"),
    );
    const lastYearRegionVotes: DType[] | undefined =
      idx < elections.length - 1
        ? JSON.parse(
            fs.readFileSync(getDataFileName(elections[idx + 1].name), "utf-8"),
          )
        : undefined;
    const lastYearParties: PartyInfo[] | undefined =
      idx < elections.length - 1
        ? JSON.parse(
            fs.readFileSync(
              `${publicFolder}/${elections[idx + 1].name}/${cikPartiesFileName}`,
              "utf-8",
            ),
          )
        : undefined;

    regionVotes.forEach((r) => {
      const key = {
        region: "key",
        municipality: "obshtina",
        settlement: "ekatte",
        section: "section",
      }[by];
      const lastYearVotes = lastYearRegionVotes
        ? //@ts-expect-error multiple fields
          lastYearRegionVotes.find((l) => l[key] === r[key])
        : undefined;
      const lastYearStatsVotes: StatsVote[] | undefined = lastYearVotes
        ? lastYearVotes.results.votes
            .map((l) => {
              const lyParty = lastYearParties?.find(
                (lp) => lp.number === l.partyNum,
              );
              if (lyParty) {
                return {
                  ...l,
                  ...lyParty,
                };
              }
              return undefined;
            })
            .filter((l) => !!l)
        : undefined;
      parties.forEach((party) => {
        const pos = partyVotesPosition(party?.number, r.results.votes);
        if (pos) {
          const prevVotesConsolidated = findPrevVotes(
            party,
            lastYearStatsVotes,
            true,
          );
          const prevVotes = findPrevVotes(party, lastYearStatsVotes, false);
          const { position, votes } = pos;
          const allVotes = totalActualVoters(r.results.votes) as number;
          const res: PartyResultsRow = {
            ...regionFields(r),
            position,
            totalVotes: votes.totalVotes,
            machineVotes: votes.machineVotes,
            paperVotes: votes.paperVotes,
            allVotes,
            prevYearVotes: prevVotes.prevTotalVotes,
            prevYearVotesConsolidated: prevVotesConsolidated.prevTotalVotes,
          };
          if (r.original) {
            const stats = r.original.votes.find(
              (v) => v.partyNum === party.number,
            );

            if (stats) {
              if (stats.addedVotes || stats.removedVotes) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { partyNum, ...rest } = stats;
                res.recount = rest;
              }
            }
          }
          if (collectedVotes[party.number] === undefined) {
            collectedVotes[party.number] = [];
          }
          collectedVotes[party.number].push(res);
        }
      });
    });
    const partiesFolder = `${publicFolder}/${e.name}/parties`;
    if (!fs.existsSync(partiesFolder)) {
      fs.mkdirSync(partiesFolder);
    }
    const dataFolder = `${partiesFolder}/by_${by}`;
    if (!fs.existsSync(dataFolder)) {
      fs.mkdirSync(dataFolder);
    }
    fs.readdirSync(dataFolder).forEach((f) => fs.rmSync(`${dataFolder}/${f}`));
    saveSplitObject(collectedVotes, stringify, dataFolder);
  });
};

export const runPartyStats = (stringify: (o: object) => string) => {
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );

  const updatedElections = elections.sort((a, b) =>
    b.name.localeCompare(a.name),
  );
  const publicFolder = path.resolve(__dirname, `../../public`);
  const rawDataFolder = path.resolve(__dirname, `../../raw_data`);
  generateStats<ElectionRegion>({
    elections: updatedElections,
    stringify,
    publicFolder,
    by: "region",
    regionFields: (row) => ({
      oblast: row.key,
    }),
    getDataFileName: (year) =>
      `${publicFolder}/${year}/${regionsVotesFileName}`,
  });
  generateStats<ElectionMunicipality>({
    elections: updatedElections,
    stringify,
    publicFolder,
    by: "municipality",
    regionFields: (row) => ({
      oblast: row.oblast,
      obshtina: row.obshtina,
    }),
    getDataFileName: (year) =>
      `${rawDataFolder}/${year}/${municipalityVotesFileName}`,
  });
  generateStats<ElectionSettlement>({
    elections: updatedElections,
    stringify,
    publicFolder,
    by: "settlement",
    regionFields: (row) => ({
      oblast: row.oblast,
      obshtina: row.obshtina,
      ekatte: row.ekatte,
    }),
    getDataFileName: (year) =>
      `${rawDataFolder}/${year}/${settlementsVotesFileName}`,
  });
  generateStats<SectionInfo>({
    elections: updatedElections,
    stringify,
    publicFolder,
    by: "section",
    regionFields: (row) => ({
      oblast: row.oblast,
      obshtina: row.obshtina,
      ekatte: row.ekatte,
      section: row.section,
    }),
    getDataFileName: (year) =>
      `${rawDataFolder}/${year}/${sectionVotesFileName}`,
  });
};
