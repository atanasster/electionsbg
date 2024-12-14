import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse";
import { MunicipalityInfo, RegionInfo, SettlementInfo } from "@/data/dataTypes";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const raw_folder = path.resolve(__dirname, "../../raw_data");
const settlementsFileName = path.resolve(
  __dirname,
  "../../public/settlements.json",
);
const settlements: SettlementInfo[] = JSON.parse(
  fs.readFileSync(settlementsFileName, "utf8"),
);

const muniFileName = path.resolve(
  __dirname,
  "../../public/municipalities.json",
);

const municipalities: MunicipalityInfo[] = JSON.parse(
  fs.readFileSync(muniFileName, "utf8"),
);

const regionsFileName = path.resolve(
  __dirname,
  "../../src/data/json//regions.json",
);

const regions: RegionInfo[] = JSON.parse(
  fs.readFileSync(regionsFileName, "utf8"),
);
const result: string[][] = [];
fs.createReadStream(`${raw_folder}/settlements_loc.csv`)
  .pipe(
    parse({
      delimiter: ",",
      relax_column_count: true,
      relax_quotes: true,
    }),
  )
  .on("data", (data) => {
    result.push(data);
  })
  .on("end", () => {
    for (let i = 0; i < result.length; i++) {
      const row = result[i];
      //"village","name","ekatte","province","municipality","postal code","municipality code","geo"

      const ekatte = row[2];
      const loc = row[7];
      const settlement: SettlementInfo | undefined = settlements.find(
        (s) => s.ekatte === ekatte,
      );
      if (settlement) {
        settlement.loc = loc;
      } else {
        console.log(row);
      }
    }
    fs.writeFileSync(settlementsFileName, JSON.stringify(settlements), "utf8");
    console.log("Successfully added file ", settlementsFileName);

    municipalities.forEach((m) => {
      const set = settlements.find((s) => s.ekatte === m.ekatte);
      if (set) {
        m.loc = set.loc;
      }
    });
    fs.writeFileSync(muniFileName, JSON.stringify(municipalities), "utf8");
    console.log("Successfully added file ", muniFileName);

    regions.forEach((r) => {
      const munis = municipalities.filter((m) => m.oblast === r.oblast);
      const muni = munis.find((m) => m.name === r.name);
      if (muni) {
        r.loc = muni.loc;
      }
    });
    fs.writeFileSync(regionsFileName, JSON.stringify(regions), "utf8");
    console.log("Successfully added file ", regionsFileName);
  });

const countries: string[][] = [];
fs.createReadStream(`${raw_folder}/country-capital-lat-long-population.csv`)
  .pipe(
    parse({
      delimiter: ",",
      relax_column_count: true,
      relax_quotes: true,
    }),
  )
  .on("data", (data) => {
    countries.push(data);
  })
  .on("end", () => {
    for (let i = 0; i < countries.length; i++) {
      const row = countries[i];
      //Country,Capital City,Latitude,Longitude,Population,Capital Type
      const country = row[0];
      const lat = row[2];
      const long = row[3];
      const set = settlements.find((s) => s.name_en === country);
      if (set) {
        set.loc = `${long},${lat}`;
      }
    }
    fs.writeFileSync(settlementsFileName, JSON.stringify(settlements), "utf8");
    console.log("Successfully added file ", settlementsFileName);
  });
