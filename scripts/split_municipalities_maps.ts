import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import municipalitiesMap from "../src/data/backup/municipalities_map.json";
type Map = typeof municipalitiesMap;
type Features = Map["features"];
type Feature = Features[0];
const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const splitted = municipalitiesMap.features.reduce(
  (acc: { [key: string]: Feature[] }, curr) => {
    if (!acc[curr.properties.nuts3]) {
      acc[curr.properties.nuts3] = [];
    }
    acc[curr.properties.nuts3].push(curr);
    return acc;
  },
  {} as { [key: string]: Feature[] },
);

Object.keys(splitted).forEach((key) => {
  const json = JSON.stringify({
    type: "FeatureCollection",
    features: splitted[key],
  });
  const outFolder = path.resolve(__dirname, `../public/maps/regions`);
  const outFile = `${outFolder}/${key}.json`;
  fs.writeFileSync(outFile, json, "utf8");
});
