import fs from "fs";
import { ElectionSettlement } from "@/data/dataTypes";
import { settlementsVotesFileName } from "scripts/consts";
import { saveSplitObject } from "scripts/dataReaders";

export const splitSettlements = ({
  inFolder,
  outFolder,
  electionSettlements,
  stringify,
}: {
  inFolder: string;
  outFolder: string;
  electionSettlements: ElectionSettlement[];
  stringify: (o: object) => string;
}) => {
  const backupFileName = `${inFolder}/${settlementsVotesFileName}`;
  fs.writeFileSync(backupFileName, stringify(electionSettlements), "utf8");
  console.log("Successfully added file ", backupFileName);
  const outDataFolder = `${outFolder}/settlements`;
  if (!fs.existsSync(outDataFolder)) {
    fs.mkdirSync(outDataFolder);
  }
  const outByFolder = `${outDataFolder}/by`;
  if (!fs.existsSync(outByFolder)) {
    fs.mkdirSync(outByFolder);
  }

  const byData = electionSettlements.reduce(
    (acc: { [key: string]: ElectionSettlement[] }, m) => {
      if (acc[m.obshtina] === undefined) {
        acc[m.obshtina] = [];
      }
      const reduced = {
        ...m,
        sections: [],
      };
      acc[m.obshtina].push(reduced);
      return acc;
    },
    {},
  );
  saveSplitObject(byData, stringify, outByFolder);

  const byKey = electionSettlements.reduce((acc, m) => {
    return { ...acc, [m.ekatte]: m };
  }, {});
  saveSplitObject(byKey, stringify, outDataFolder);
};
