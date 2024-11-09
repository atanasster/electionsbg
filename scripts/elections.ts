import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse";
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

type ElectionVotes = {
  document: number;
  section: string;
  [key: number]: {
    totalVotes: number;
    paperVotes: number;
    machineVotes: number;
  };
};
const allVotes: ElectionVotes[] = [];

type SectionInfo = {
  section: string;
  region: number;
  region_name: string;
  zip_code: number;
  settlement: string;
  address: string;
  m_1: number;
  m_2: number;
  m_3: number;
};
const allSections: SectionInfo[] = [];

type PartyInfo = {
  number: number;
  party: string;
};
const allParties: PartyInfo[] = [];

const parseVotes = (inFolder: string, outFolder: string) => {
  const result: string[][] = [];

  const data = fs
    .createReadStream(`${inFolder}/votes.txt`)
    .pipe(parse({ delimiter: ";", relax_column_count: true }))
    .on("data", (data) => {
      result.push(data);
    })
    .on("end", () => {
      for (let i = 0; i < result.length; i++) {
        const row = result[i];
        let j = 3;
        const votes: ElectionVotes = {
          document: parseInt(row[0]),
          section: row[1],
        };
        while (j < row.length) {
          const partyNum = parseInt(row[j]);
          const totalVotes = parseInt(row[j + 1]);
          const paperVotes = parseInt(row[j + 2]);
          const machineVotes = parseInt(row[j + 3]);
          votes[partyNum] = {
            totalVotes,
            paperVotes,
            machineVotes,
          };
          j += 4;
        }
        allVotes.push(votes);
      }
      const json = JSON.stringify(allVotes, null, 2);
      const outFile = `${outFolder}/votes.json`;
      fs.writeFileSync(outFile, json, "utf8");
      console.log("Successfully added file ", outFile);
      return allVotes;
    });
  return data;
};

const parseSections = (inFolder: string, outFolder: string) => {
  const result: string[][] = [];

  const data = fs
    .createReadStream(`${inFolder}/sections.txt`)
    .pipe(parse({ delimiter: ";", relax_column_count: true }))
    .on("data", (data) => {
      result.push(data);
    })
    .on("end", () => {
      for (let i = 0; i < result.length; i++) {
        const row = result[i];

        const section: SectionInfo = {
          section: row[0],
          region: parseInt(row[1]),
          region_name: row[2],
          zip_code: parseInt(row[3]),
          settlement: row[4],
          address: row[5],
          m_1: parseInt(row[6]),
          m_2: parseInt(row[7]),
          m_3: parseInt(row[8]),
        };

        allSections.push(section);
      }
      const json = JSON.stringify(allSections, null, 2);
      const outFile = `${outFolder}/sections.json`;
      fs.writeFileSync(outFile, json, "utf8");
      console.log("Successfully added file ", outFile);
      return allSections;
    });
  return data;
};

const parseParties = (inFolder: string, outFolder: string) => {
  const result: string[][] = [];

  const data = fs
    .createReadStream(`${inFolder}/cik_parties.txt`)
    .pipe(parse({ delimiter: ";", relax_column_count: true }))
    .on("data", (data) => {
      result.push(data);
    })
    .on("end", () => {
      for (let i = 0; i < result.length; i++) {
        const row = result[i];

        const party: PartyInfo = {
          number: parseInt(row[0]),
          party: row[1],
        };

        allParties.push(party);
      }
      const json = JSON.stringify(allParties, null, 2);
      const outFile = `${outFolder}/cik_parties.json`;
      fs.writeFileSync(outFile, json, "utf8");
      console.log("Successfully added file ", outFile);
      return allParties;
    });
  return data;
};
const parseElections = (monthYear: string) => {
  const inFolder = path.resolve(__dirname, `../raw_data/${monthYear}`);
  const outFolder = path.resolve(__dirname, `../public/${monthYear}`);
  if (!fs.existsSync(outFolder)) {
    fs.mkdirSync(outFolder);
  }
  parseParties(inFolder, outFolder);
  parseSections(inFolder, outFolder);
  parseVotes(inFolder, outFolder);
};

parseElections("2024_10");
