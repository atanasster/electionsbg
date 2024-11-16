import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseParties } from "./parsers/parties";
import { parseSections } from "./parsers/sections";
import { parseVotes } from "./parsers/votes";
import { FullSectionProtocol, parseProtocols } from "./parsers/protocols";
import settlementsData from "../public/settlements.json";
const settlements = settlementsData;
import regionsData from "../public/regions.json";
const regions = regionsData;
import municipalitiesData from "../public/municipalities.json";
import {
  ElectionMunicipality,
  ElectionRegions,
  ElectionSettlement,
  ElectionVotes,
  SectionInfo,
} from "@/data/dataTypes";
import { addVotes } from "@/data/utils";

const municipalities = municipalitiesData;

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const regionCodes: { key: string; nuts3: string }[] = [
  // Blagoevgrad
  { key: "01", nuts3: "BG413" },
  // Burgas
  { key: "02", nuts3: "BG341" },
  // Varna
  { key: "03", nuts3: "BG331" },
  // Veliko Tarnovo
  { key: "04", nuts3: "BG321" },
  // Vidin
  { key: "05", nuts3: "BG311" },
  // Vratsa
  { key: "06", nuts3: "BG313" },
  // Gabrovo
  { key: "07", nuts3: "BG322" },
  // Dobrich
  { key: "08", nuts3: "BG332" },
  // Kardjhali
  { key: "09", nuts3: "BG425" },
  // Kyustendil
  { key: "10", nuts3: "BG415" },
  // Lovech
  { key: "11", nuts3: "BG315" },
  // Montana
  { key: "12", nuts3: "BG312" },
  // Pazardzhik
  { key: "13", nuts3: "BG423" },
  // Pernik
  { key: "14", nuts3: "BG414" },
  // Pleven
  { key: "15", nuts3: "BG314" },
  // Plovdiv grad
  { key: "16", nuts3: "BG421" },
  // Plovdiv oblast
  { key: "17", nuts3: "BG421" },
  // Razgrad
  { key: "18", nuts3: "BG324" },
  // Ruse
  { key: "19", nuts3: "BG323" },
  // Silistra
  { key: "20", nuts3: "BG325" },
  // Sliven
  { key: "21", nuts3: "BG342" },
  // Smolyan
  { key: "22", nuts3: "BG424" },
  // Sofia 23 MIR
  { key: "23", nuts3: "BG411" },
  // Sofia 24 MIR
  { key: "24", nuts3: "BG411" },
  // Sofia 25 MIR
  { key: "25", nuts3: "BG411" },
  // Sofia oblast
  { key: "26", nuts3: "BG412" },
  // Stara Zagora
  { key: "27", nuts3: "BG344" },
  // Targovishte
  { key: "28", nuts3: "BG334" },
  // Haskovo
  { key: "29", nuts3: "BG422" },
  // Shumen
  { key: "30", nuts3: "BG333" },
  // Yambol
  { key: "31", nuts3: "BG343" },
];

const aggregateSettlements = (
  outFolder: string,
  sections: SectionInfo[],
  votes: ElectionVotes[],
  protocols: FullSectionProtocol[],
) => {
  const elections: ElectionRegions = [];
  regions.forEach((region) => {
    elections.push({
      key: region.oblast as string,
      nuts3: region.nuts3 as string,
      municipalities: [],
      results: {
        actualTotal: 0,
        actualMachineVotes: 0,
        actualPaperVotes: 0,
        votes: [],
      },
    });
  });
  municipalities.forEach((muni) => {
    const region = elections.find((region) => region.nuts3 === muni.nuts3);
    if (!region) {
      throw new Error(
        `Can not find region in elections: 
        ${JSON.stringify(muni, null, 2)}`,
      );
    }
    const m: ElectionMunicipality = {
      key: muni.obshtina?.substring(3) as string,
      obshtina: muni.obshtina as string,
      settlements: [],
      results: {
        actualTotal: 0,
        actualMachineVotes: 0,
        actualPaperVotes: 0,
        votes: [],
      },
    };
    region.municipalities.push(m);
  });
  settlements.forEach((set) => {
    const muni = elections
      .find((r) => r.nuts3 === set.nuts3)
      ?.municipalities.find((m) => m.obshtina === set.obshtina);
    if (!muni) {
      throw new Error(
        `Can not find municipality in elections: 
        ${JSON.stringify(set, null, 2)}`,
      );
    }
    const s: ElectionSettlement = {
      key: set.nuts3 as string,
      ekatte: set.ekatte as string,
      name: set.name,
      t_v_m: set.t_v_m,
      sections: [],
      results: {
        actualTotal: 0,
        actualMachineVotes: 0,
        actualPaperVotes: 0,
        votes: [],
      },
    };
    muni.settlements.push(s);
  });
  votes.forEach((vote) => {
    const regionCode = vote.section.substring(0, 2);
    let region = elections.find((r) => {
      const rc = regionCodes.find((c) => c.key === regionCode);
      return rc?.nuts3 === r.nuts3;
    });
    if (!region) {
      region = {
        key: regionCode,
        nuts3: vote.section,
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
        municipalities: [],
      };
      elections.push(region);
    }
    const muniCode = vote.section.substring(2, 4);
    let municipality = region.municipalities.find((m) => m.key === muniCode);
    if (!municipality) {
      municipality = {
        key: muniCode,
        settlements: [],
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
      };
    }
    const settlementCode = vote.section.substring(4, 6);
    let settlement = municipality.settlements.find((s) => {
      const section = sections.find((s) => s.section === vote.section);
      if (!section) {
        throw new Error(`Could not find voting section ${vote.section}`);
      }
      if (settlementCode === "00") {
        return s.t_v_m && s.name && section.settlement === s.t_v_m + s.name;
      } else {
        return s.key === settlementCode;
      }
    });
    if (!settlement) {
      settlement = municipality.settlements.find(
        (s) => s.key === settlementCode,
      );
    }
    const protocol = protocols.find((s) => s.section === vote.section);
    const section = sections.find((s) => s.section === vote.section);
    if (!settlement) {
      settlement = {
        key: settlementCode,
        name: section?.settlement,
        sections: [],
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
      };
      //municipality.obshtina = section?.settlement;
      //region.nuts3 = section?.settlement;
      municipality.settlements.push(settlement);
    }

    settlement.sections.push(vote.section);
    if (section && protocol) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { document, section: ss, rik, pages, ...nprotocol } = protocol;
      section.protocol = { ...nprotocol };
    }
    addVotes(settlement.results, vote.votes, protocol);
    addVotes(municipality.results, vote.votes, protocol);
    addVotes(region.results, vote.votes, protocol);
  });
  const json = JSON.stringify(elections, null, 2);
  const outFile = `${outFolder}/aggregated_votes.json`;
  fs.writeFileSync(outFile, json, "utf8");
  console.log("Successfully added file ", outFile);
  return elections;
};

const parseElections = (monthYear: string) => {
  const inFolder = path.resolve(__dirname, `../raw_data/${monthYear}`);
  const outFolder = path.resolve(__dirname, `../public/${monthYear}`);
  if (!fs.existsSync(outFolder)) {
    fs.mkdirSync(outFolder);
  }
  parseParties(inFolder, outFolder).then(() =>
    parseSections(inFolder).then((sections) =>
      parseVotes(inFolder, outFolder).then((votes) =>
        parseProtocols(inFolder, outFolder).then((protocols) => {
          aggregateSettlements(outFolder, sections, votes, protocols);
          const json = JSON.stringify(sections, null, 2);
          const outFile = `${outFolder}/sections.json`;
          fs.writeFileSync(outFile, json, "utf8");
          console.log("Successfully added file ", outFile);
        }),
      ),
    ),
  );
};
parseElections("2024_10");
