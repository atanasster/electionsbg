import * as cheerio from "cheerio";
import * as fs from "fs";
import regionsData from "../../../src/data/json/regions.json";
import { lookupSettlements } from "./lookup_settlements";
const regions = regionsData;

export const parseRegions = ({ inFolder }: { inFolder: string }) => {
  const sections: { section: string; oblast: string; settlement: string }[] =
    [];
  regions.forEach((region) => {
    const buffer = fs.readFileSync(
      `${inFolder}/sections/${region.oblast}.html`,
    );
    let hasItems = true;
    const $ = cheerio.loadBuffer(buffer);

    for (let i = 0; i < 10000; i++) {
      const anchor = $(
        `body > table > tbody > tr:nth-child(4) > td.bright > div:nth-child(${4 + i}) > font > a`,
      );
      if (!hasItems && anchor.length === 0) {
        hasItems = true;
        break;
      }
      hasItems = anchor.length === 1;
      if (hasItems) {
        const line = anchor.text().split(" ");
        if (line.length < 1) {
          throw new Error("Bad line");
        }
        const settlement = lookupSettlements(
          line.splice(1).join(" ").trim(),
          region.oblast,
        );
        sections.push({
          settlement,
          oblast: region.oblast,
          section: line[0],
        });
      }
    }
  });
  return sections;
};
