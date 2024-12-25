import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import fs from "fs";
import path from "path";
import { cikPartiesFileName } from "scripts/consts";
import { fileURLToPath } from "url";
import { parsePartyFinancing } from "./party_financials";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

export const parseCampaignFinancing = async ({
  dataFolder,
  publicFolder,
}: {
  dataFolder: string;
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const financialFolder = `${dataFolder}/smetna_palata`;
  if (!fs.existsSync(financialFolder)) {
    return;
  }
  const partiesFinancialFolder = `${financialFolder}/parties`;
  if (!fs.existsSync(partiesFinancialFolder)) {
    return;
  }

  const parties: PartyInfo[] = JSON.parse(
    fs.readFileSync(`${publicFolder}/${cikPartiesFileName}`, "utf-8"),
  );
  const dataFolders = fs.readdirSync(partiesFinancialFolder, {
    withFileTypes: true,
  });
  const folders = dataFolders
    .filter((file) => file.isDirectory())
    .map((f) => f.name);

  const data = await Promise.all(
    folders.map(async (f) => {
      const party = parties.find((p) => p.name.localeCompare(f, ["bg"]) === 0);
      if (!party) {
        throw new Error(`Could not find party ${f}`);
      }
      return {
        party: party.number,
        data: await parsePartyFinancing({
          dataFolder: `${partiesFinancialFolder}/${f}`,
          party,
        }),
      };
    }),
  );
  return data;
};

export const parseFinancing = async ({
  dataFolder,
  publicFolder,
  stringify,
}: {
  dataFolder: string;
  publicFolder: string;
  stringify: (o: object) => string;
}) => {
  const electionsFile = path.resolve(
    __dirname,
    "../../src/data/json/elections.json",
  );
  const elections: ElectionInfo[] = JSON.parse(
    fs.readFileSync(electionsFile, "utf-8"),
  );
  return await Promise.all(
    elections.map(async (e) => {
      const partiesFinancing = await parseCampaignFinancing({
        dataFolder: `${dataFolder}/${e.name}`,
        publicFolder: `${publicFolder}/${e.name}`,
        stringify,
      });
      if (partiesFinancing) {
        const partiesFolder = `${publicFolder}/${e.name}/parties`;
        if (!fs.existsSync(partiesFolder)) {
          fs.mkdirSync(partiesFolder);
        }
        const partiesFinancingFolder = `${partiesFolder}/financing`;
        if (!fs.existsSync(partiesFinancingFolder)) {
          fs.mkdirSync(partiesFinancingFolder);
        }

        const allParties = partiesFinancing.map((p) => {
          const partyFolder = `${partiesFinancingFolder}/${p.party}`;
          if (!fs.existsSync(partyFolder)) {
            fs.mkdirSync(partyFolder);
          }
          fs.writeFileSync(`${partyFolder}/filing.json`, stringify(p), "utf-8");
          return {
            party: p.party,
            filing: p.data?.filing,
          };
        });
        fs.writeFileSync(
          `${partiesFolder}/financing.json`,
          stringify(allParties),
          "utf-8",
        );
      }
    }),
  );
};
