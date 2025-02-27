import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { fileURLToPath } from "url";
import { parseRegions } from "./parse_regions";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
const inFolder = path.resolve(__dirname, `../../../raw_data/2005_06_25`);
export const parse2005 = async () => {
  const result: string[][] = [];
  const rgSections = parseRegions({ inFolder });
  return new Promise((resolve) =>
    fs
      .createReadStream(`${inFolder}/pe_export.csv`)
      .pipe(
        parse({ delimiter: ";", relax_column_count: true, relax_quotes: true }),
      )
      .on("data", (data) => {
        result.push(data);
      })
      .on("end", () => {
        const sections: string[][] = [];
        const protocols: string[][] = [];
        const votes: string[][] = [];
        for (let i = 1; i < result.length; i++) {
          const row = result[i];
          const section = row[0];
          const rgSection = rgSections.find((r) => r.section === section);
          if (!rgSection) throw new Error("Could not find section " + section);
          sections.push([section, rgSection.settlement, rgSection.oblast]);
          protocols.push([section, ...row.slice(2, 15)]);
          votes.push([section, ...row.slice(15)]);
        }
        const sectionsFileName = `${inFolder}/sections.txt`;
        const sectionsStream = fs.createWriteStream(sectionsFileName);
        sectionsStream.write(sections.map((s) => s.join(";")).join("\n"));
        const protocolsFileName = `${inFolder}/protocols.txt`;
        const protocolsStream = fs.createWriteStream(protocolsFileName);
        protocolsStream.write(protocols.map((s) => s.join(";")).join("\n"));
        const votesFileName = `${inFolder}/votes.txt`;
        const votesStream = fs.createWriteStream(votesFileName);
        votesStream.write(votes.map((s) => s.join(";")).join("\n"));
        resolve(undefined);
      }),
  );
};

await parse2005();
