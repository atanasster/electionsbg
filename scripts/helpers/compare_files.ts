import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SectionInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const sectionsFile = path.resolve(
  __dirname,
  "../../public/2024_10_27/section_votes.json",
);
const sections: SectionInfo[] = JSON.parse(
  fs.readFileSync(sectionsFile, "utf8"),
);

const sectionsFileNew = path.resolve(
  __dirname,
  "../../public/2024_10_27/section_votes_new.json",
);

const sectionsNew: SectionInfo[] = JSON.parse(
  fs.readFileSync(sectionsFileNew, "utf8"),
);

sections.forEach((s) => {
  const sNew = sectionsNew.find((sn) => sn.section === s.section);
  if (!sNew) {
    debugger;
  }
  const sNewStr = JSON.stringify(sNew, null, 2);
  const sStr = JSON.stringify(s, null, 2);
  if (sNewStr != sStr) {
    console.log(sNewStr);
    console.log(sStr);
    debugger;
  }
});
