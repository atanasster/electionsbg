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
  const electionRegions: ElectionRegions = [];
  const electionMunicipalities: ElectionMunicipality[] = [];
  const electionSettlements: ElectionSettlement[] = [];
  regions.forEach((region) => {
    if (region.oblast && region.nuts3) {
      electionRegions.push({
        key: region.oblast,
        nuts3: region.nuts3,
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
      });
    }
  });

  municipalities.forEach((muni) => {
    if (muni.nuts3) {
      const region = electionRegions.find(
        (region) => region.nuts3 === muni.nuts3,
      );
      if (!region) {
        throw new Error(
          `Can not find region in elections: 
        ${JSON.stringify(muni, null, 2)}`,
        );
      }
      const m: ElectionMunicipality = {
        key: muni.obshtina?.substring(3) as string,
        obshtina: muni.obshtina as string,
        oblast: region.key,
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
      };
      electionMunicipalities.push(m);
    }
  });
  settlements.forEach((set) => {
    if (set.obshtina) {
      const muni = electionMunicipalities.find(
        (m) => m.obshtina === set.obshtina,
      );
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
        oblast: muni.oblast,
        obshtina: muni.obshtina,
        t_v_m: set.t_v_m,
        sections: [],
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
      };
      electionSettlements.push(s);
    }
  });
  votes.forEach((vote) => {
    const regionCode = vote.section.substring(0, 2);
    let region = electionRegions.find((r) => {
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
      };
      electionRegions.push(region);
    }
    const muniCode = vote.section.substring(2, 4);
    let municipality = electionMunicipalities.find(
      (m) => m.key === muniCode && m.oblast === region.key,
    );
    if (!municipality) {
      municipality = {
        key: muniCode,
        oblast: region.key,
        results: {
          actualTotal: 0,
          actualMachineVotes: 0,
          actualPaperVotes: 0,
          votes: [],
        },
      };
    }
    const settlementCode = vote.section.substring(4, 6);
    const municipalitySettlements = electionSettlements.filter(
      (s) => s.obshtina === municipality.obshtina,
    );
    let settlement = municipalitySettlements.find((s) => {
      const section = sections.find((s) => s.section === vote.section);
      if (!section) {
        throw new Error(`Could not find voting section ${vote.section}`);
      }
      if (settlementCode === "00") {
        const settlementName = section.settlement
          .replace(/\s+/g, "")
          .toLowerCase();
        const sectionSettlementName = `${s.t_v_m || ""}${s.name || ""}`
          .replace(/\s+/g, "")
          .toLowerCase();
        return settlementName === sectionSettlementName;
      } else {
        return s.key === settlementCode;
      }
    });
    if (!settlement) {
      settlement = municipalitySettlements.find(
        (s) => s.key === settlementCode,
      );
    }
    const protocol = protocols.find((s) => s.section === vote.section);
    const section = sections.find((s) => s.section === vote.section);
    if (!settlement) {
      settlement = {
        oblast: region.key,
        obshtina: municipality.obshtina,
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
      electionSettlements.push(settlement);
    }

    settlement.sections.push(vote.section);
    if (section && protocol) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { document, section: ss, rik, pages, ...nprotocol } = protocol;
      const { votes } = vote;
      section.protocol = { ...nprotocol };
      section.votes = votes;
      section.oblast = region.key;
      section.obshtina = municipality.obshtina;
      section.ekatte = settlement.ekatte;
    }
    addVotes(settlement.results, vote.votes, protocol);
    addVotes(municipality.results, vote.votes, protocol);
    addVotes(region.results, vote.votes, protocol);
  });
  let json = JSON.stringify(electionRegions, null, 2);
  let outFile = `${outFolder}/region_votes.json`;
  fs.writeFileSync(outFile, json, "utf8");
  console.log("Successfully added file ", outFile);
  json = JSON.stringify(electionMunicipalities, null, 2);
  outFile = `${outFolder}/municipality_votes.json`;
  fs.writeFileSync(outFile, json, "utf8");
  console.log("Successfully added file ", outFile);

  json = JSON.stringify(electionSettlements, null, 2);
  outFile = `${outFolder}/settlement_votes.json`;
  fs.writeFileSync(outFile, json, "utf8");
  console.log("Successfully added file ", outFile);

  return { electionRegions, electionMunicipalities, electionSettlements };
};

const parseElections = (monthYear: string) => {
  const inFolder = path.resolve(__dirname, `../raw_data/${monthYear}`);
  const outFolder = path.resolve(__dirname, `../public/${monthYear}`);
  if (!fs.existsSync(outFolder)) {
    fs.mkdirSync(outFolder);
  }
  parseParties(inFolder, outFolder).then(() =>
    parseSections(inFolder).then((sections) =>
      parseVotes(inFolder).then((votes) =>
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
