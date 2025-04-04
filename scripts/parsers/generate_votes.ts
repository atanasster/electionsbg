import fs from "fs";
import { FullSectionProtocol } from "./protocols";
import settlementsData from "../../public/settlements.json";
const settlements = settlementsData;
import regionsData from "../../src/data/json/regions.json";
const regions = regionsData;
import municipalitiesData from "../../public/municipalities.json";
import {
  ElectionMunicipality,
  ElectionRegion,
  ElectionRegions,
  ElectionSettlement,
  ElectionVotes,
  SectionInfo,
  SOFIA_REGIONS,
} from "@/data/dataTypes";
import { addResults, addRecountOriginal } from "@/data/utils";
import { regionsVotesFileName, sectionVotesFileName } from "../consts";
import { splitSettlements } from "./split_settlements";
import { splitMunicipalities } from "./split_municipalities";
import { findSectionInOtherElections } from "./findSection";
import { regionCodes } from "./region_codes";
import { findSofiaSettlements_2005 } from "./2005_sofia_settlements";
import { parseSettlement2005 } from "scripts/helpers/2005/settlement_name_2005";
import { lookup_international_sections } from "scripts/helpers/lookup_international_sections";
import { backupFileName } from "scripts/recount/backup_file";
import { recountSection } from "scripts/recount/recount_sections";

const municipalities = municipalitiesData;

export const generateVotes = ({
  outFolder,
  protocols,
  sections,
  stringify,
  votes,
  monthYear,
  inFolder,
}: {
  outFolder: string;
  sections: SectionInfo[];
  votes: ElectionVotes[];
  protocols: FullSectionProtocol[];
  stringify: (o: object) => string;
  monthYear: string;
  inFolder: string;
}) => {
  const electionRegions: ElectionRegions = [];
  const electionMunicipalities: ElectionMunicipality[] = [];
  const electionSettlements: ElectionSettlement[] = [];
  let sectionsOriginal: SectionInfo[] | undefined = undefined;
  const sectionsBackUpFile = `${inFolder}/${backupFileName(sectionVotesFileName)}`;
  if (fs.existsSync(sectionsBackUpFile)) {
    const data = fs.readFileSync(sectionsBackUpFile, "utf-8");
    sectionsOriginal = JSON.parse(data);
  }
  regions.forEach((region) => {
    if (region.oblast && region.nuts3) {
      electionRegions.push({
        key: region.oblast,
        nuts3: region.nuts3,
        results: {
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
        key: muni.obshtina?.split("-")[0].substring(3) as string,
        obshtina: muni.obshtina as string,
        oblast: region.key,
        results: {
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
        kmetstvo: set.kmetstvo,
        t_v_m: set.t_v_m,
        sections: [],
        results: {
          votes: [],
        },
      };
      electionSettlements.push(s);
    }
  });
  votes.forEach((vote) => {
    let section = sections.find((s) => s.section === vote.section);
    let region: ElectionRegion | undefined = undefined;
    let municipality: ElectionMunicipality | undefined = undefined;
    let settlement: ElectionSettlement | undefined = undefined;
    const regionCode = vote.section.substring(0, 2);
    if (monthYear <= "2009_07_05") {
      if (!section) {
        section = findSectionInOtherElections(vote.section, monthYear);
        if (section) {
          sections.push(section);
        } else {
          throw new Error(`Could not find section for votes ${vote.section}`);
        }
      }
    }
    if (monthYear <= "2005_06_25") {
      if (!section) {
        throw new Error(`Could not find section for votes ${vote.section}`);
      }
      if (SOFIA_REGIONS.includes("S" + regionCode)) {
        settlement = findSofiaSettlements_2005(
          vote.section,
          electionSettlements,
        );
      } else {
        settlement =
          section.oblast === "32"
            ? lookup_international_sections(
                section.settlement,
                section.region_name,
                electionSettlements,
              )
            : parseSettlement2005(
                section.settlement,
                section.oblast,
                electionSettlements,
              );
      }

      if (settlement) {
        municipality = electionMunicipalities.find(
          (m) => m.obshtina === settlement?.obshtina,
        );
        region = electionRegions.find((r) => r.key === settlement?.oblast);
      }
    } else {
      if (!section) {
        throw new Error(`Could not find section for votes ${vote.section}`);
      }
      region = electionRegions.find((r) => {
        const rc = regionCodes.find((c) => c.key === regionCode);
        return rc?.nuts3 === r.nuts3;
      });
      if (!region) {
        region = {
          key: vote.section,
          nuts3: regionCode,
          results: {
            votes: [],
          },
        };
        electionRegions.push(region);
      }

      let muniCode =
        regionCode === "32"
          ? lookup_international_sections(
              section.settlement,
              section.region_name,
              electionSettlements,
            )?.kmetstvo
          : vote.section.substring(2, 4);
      if (!regionCode) {
        throw new Error("Could not find settlement: " + section.settlement);
      }
      if (muniCode === "46") {
        muniCode = vote.section.substring(4, 6);
      }
      municipality =
        regionCode === "32"
          ? electionMunicipalities.find(
              (m) =>
                electionSettlements.find((s) => {
                  return s.oblast === regionCode && s.kmetstvo === muniCode;
                })?.obshtina === m.obshtina,
            )
          : electionMunicipalities.find((m) => {
              if (m.oblast === region?.key) {
                return m.key === muniCode;
              }
              return false;
            });

      if (regionCode === "32") {
        settlement = electionSettlements.find(
          (s) => s.oblast === regionCode && s.kmetstvo === muniCode,
        );
      } else {
        const settlementCode = vote.section.substring(4, 6);
        if (municipality) {
          const municipalitySettlements = electionSettlements.filter(
            (s) => s.obshtina === municipality?.obshtina,
          );
          settlement = municipalitySettlements.find((s) => {
            const section = sections.find((s) => s.section === vote.section);
            if (!section) {
              throw new Error(`Could not find voting section ${vote.section}`);
            }
            const settlementName = section.settlement
              .replace(/\s+/g, "")
              .toLowerCase()
              .split(",")[0];
            const sectionSettlementName = `${s.t_v_m || ""}${s.name || ""}`
              .replace(/\s+/g, "")
              .toLowerCase();
            return (
              settlementName === sectionSettlementName ||
              s.key === settlementCode
            );
          });

          if (!settlement) {
            settlement = municipalitySettlements.find(
              (s) => s.key === settlementCode,
            );
            if (!settlement) {
              settlement = municipalitySettlements.find((s) => {
                const kmetstvoNum = s.kmetstvo.split("-");
                return (
                  kmetstvoNum.length > 1 && kmetstvoNum[1] === settlementCode
                );
              });
            }
          }
          if (!settlement) {
            settlement = municipalitySettlements.find((s) => {
              const km = s.kmetstvo.split("-");
              return km.length > 1 && km[1] === "00";
            });
          }
        }
      }
    }
    if (!region) {
      throw new Error(
        `Can not find region for section: 
    ${JSON.stringify(section, null, 2)}`,
      );
    }
    if (!municipality) {
      throw new Error(
        `Can not find municipality for section: 
    ${JSON.stringify(section, null, 2)}`,
      );
    }
    if (!settlement) {
      throw new Error(
        `Could not find a settlement ${vote.section} ${section?.address || ""}`,
      );
    }
    const protocol = protocols.find((s) => s.section === vote.section);
    settlement.sections.push(section);
    if (section && protocol) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { section: ss, rik, ...nprotocol } = protocol;
      const { votes } = vote;
      section.results = {
        protocol: { ...nprotocol },
        votes: votes,
      };
      section.oblast = region.key;
      section.obshtina = municipality.obshtina;
      section.ekatte = settlement.ekatte;
      if (sectionsOriginal) {
        recountSection({ section, sectionsOriginal });
      }
    }
    addResults(settlement.results, vote.votes, protocol);
    addResults(municipality.results, vote.votes, protocol);
    addResults(region.results, vote.votes, protocol);
    if (
      section.original &&
      (section.original.addedVotes || section.original.removedVotes)
    ) {
      addRecountOriginal({ dest: settlement, src: section.original });
      addRecountOriginal({ dest: municipality, src: section.original });
      addRecountOriginal({ dest: region, src: section.original });
    }
  });

  const regFileName = `${outFolder}/${regionsVotesFileName}`;
  fs.writeFileSync(regFileName, stringify(electionRegions), "utf8");
  console.log("Successfully added file ", regFileName);

  const regionBackupFileName = `${inFolder}/${regionsVotesFileName}`;
  fs.writeFileSync(regionBackupFileName, stringify(electionRegions), "utf8");
  console.log("Successfully added file ", regionBackupFileName);

  splitMunicipalities({
    electionMunicipalities,
    inFolder,
    outFolder,
    stringify,
  });
  splitSettlements({
    electionSettlements,
    inFolder,
    outFolder,
    stringify,
  });

  return { electionRegions, electionMunicipalities, electionSettlements };
};
