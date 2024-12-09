import fs from "fs";
import path from "path";
import municipalities from "../../public/municipalities.json";
import regions from "../../src/data/json/regions.json";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const muni = municipalities.map((s) => {
  const region = regions.find((r) => r.nuts3 === s.nuts3);
  if (!region) {
    throw new Error(`Count not find region ${s.nuts3}`);
  }
  return { ...s, oblast: region.oblast };
});
const json = JSON.stringify(muni);
const outFile = path.resolve(__dirname, "../../public/municipalities.json");
fs.writeFileSync(outFile, json, "utf8");
