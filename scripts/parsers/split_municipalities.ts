import fs from "fs";
import { ElectionMunicipality } from "@/data/dataTypes";
import { municipalityVotesFileName } from "scripts/consts";
import { saveSplitObject } from "scripts/dataReaders";

export const splitMunicipalities = ({
  inFolder,
  outFolder,
  electionMunicipalities,
  stringify,
}: {
  inFolder: string;
  outFolder: string;
  electionMunicipalities: ElectionMunicipality[];
  stringify: (o: object) => string;
}) => {
  const backupFileName = `${inFolder}/${municipalityVotesFileName}`;
  fs.writeFileSync(backupFileName, stringify(electionMunicipalities), "utf8");
  console.log("Successfully added file ", backupFileName);
  const outDataFolder = `${outFolder}/municipalities`;
  if (!fs.existsSync(outDataFolder)) {
    fs.mkdirSync(outDataFolder);
  }
  const outByFolder = `${outDataFolder}/by`;
  if (!fs.existsSync(outByFolder)) {
    fs.mkdirSync(outByFolder);
  }
  const byData = electionMunicipalities.reduce(
    (acc: { [key: string]: ElectionMunicipality[] }, m) => {
      if (acc[m.oblast] === undefined) {
        acc[m.oblast] = [];
      }
      acc[m.oblast].push(m);
      return acc;
    },
    {},
  );
  saveSplitObject(byData, stringify, outByFolder);

  const byKey = electionMunicipalities.reduce((acc, m) => {
    return { ...acc, [m.obshtina]: m };
  }, {});
  saveSplitObject(byKey, stringify, outDataFolder);
};
