import fs from "fs";
import { FullSectionProtocol } from "./protocols";
import settlementsData from "../../public/settlements.json";
const settlements = settlementsData;
import regionsData from "../../src/data/json/regions.json";
const regions = regionsData;
import municipalitiesData from "../../public/municipalities.json";
import {
  ElectionMunicipality,
  ElectionRegions,
  ElectionSettlement,
  ElectionVotes,
  PreferencesInfo,
  SectionInfo,
  SOFIA_REGIONS,
} from "@/data/dataTypes";
import { addPreferences, addResults } from "@/data/utils";
import { lookupCountryNumbers } from "./country_codes";
import { regionsVotesFileName } from "../consts";
import { splitSettlements } from "./split_settlements";
import { splitMunicipalities } from "./split_municipalities";
import { findSectionInOtherElections } from "./findSection";
import { regionCodes } from "./region_codes";
import { savePreferences } from "./save_preferences";
const municipalities = municipalitiesData;

export const generateVotes = ({
  outFolder,
  protocols,
  sections,
  preferences,
  stringify,
  votes,
  monthYear,
  inFolder,
}: {
  outFolder: string;
  sections: SectionInfo[];
  preferences: PreferencesInfo[];
  votes: ElectionVotes[];
  protocols: FullSectionProtocol[];
  stringify: (o: object) => string;
  monthYear: string;
  inFolder: string;
}) => {
  const electionRegions: ElectionRegions = [];
  const electionMunicipalities: ElectionMunicipality[] = [];
  const electionSettlements: ElectionSettlement[] = [];
  const preferencesCountry: PreferencesInfo[] = [];
  const preferencesSofia: PreferencesInfo[] = [];
  const preferencesRegions: Record<string, PreferencesInfo[]> = {};
  const preferencesMunicipalities: Record<string, PreferencesInfo[]> = {};
  const preferencesSettlements: Record<string, PreferencesInfo[]> = {};

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
    const regionCode = vote.section.substring(0, 2);
    let region = electionRegions.find((r) => {
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
    let section = sections.find((s) => s.section === vote.section);
    if (!section) {
      section = findSectionInOtherElections(vote.section, monthYear);
      if (section) {
        sections.push(section);
      } else {
        throw new Error(`Could not find section for votes ${vote.section}`);
      }
    }
    let muniCode =
      regionCode === "32"
        ? lookupCountryNumbers(vote.section, monthYear)
        : vote.section.substring(2, 4);
    if (muniCode === "46") {
      muniCode = vote.section.substring(4, 6);
    }
    const municipality: ElectionMunicipality | undefined =
      regionCode === "32"
        ? electionMunicipalities.find(
            (m) =>
              electionSettlements.find((s) => {
                return s.oblast === regionCode && s.kmetstvo === muniCode;
              })?.obshtina === m.obshtina,
          )
        : electionMunicipalities.find((m) => {
            if (m.oblast === region.key) {
              return m.key === muniCode;
            }
            return false;
          });
    if (!municipality) {
      throw new Error(
        `Can not find municipality for section: 
      ${JSON.stringify(section, null, 2)}`,
      );
    }
    let settlement: ElectionSettlement | undefined = undefined;
    if (regionCode === "32") {
      settlement = electionSettlements.find(
        (s) => s.oblast === regionCode && s.kmetstvo === muniCode,
      );
    } else {
      const settlementCode = vote.section.substring(4, 6);
      const municipalitySettlements = electionSettlements.filter(
        (s) => s.obshtina === municipality.obshtina,
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
          settlementName === sectionSettlementName || s.key === settlementCode
        );
      });

      if (!settlement) {
        settlement = municipalitySettlements.find(
          (s) => s.key === settlementCode,
        );
        if (!settlement) {
          settlement = municipalitySettlements.find((s) => {
            const kmetstvoNum = s.kmetstvo.split("-");
            return kmetstvoNum.length > 1 && kmetstvoNum[1] === settlementCode;
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
      const pref = preferences.filter((p) => p.section === section.section);
      if (pref.length) {
        section.preferences = pref.map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { section, ...rest } = p;
          return rest;
        });
        if (preferencesRegions[section.oblast] === undefined) {
          preferencesRegions[section.oblast] = [];
        }
        addPreferences(preferencesRegions[section.oblast], pref);
        if (preferencesMunicipalities[section.obshtina] === undefined) {
          preferencesMunicipalities[section.obshtina] = [];
        }
        addPreferences(preferencesMunicipalities[section.obshtina], pref);
        if (preferencesSettlements[section.ekatte] === undefined) {
          preferencesSettlements[section.ekatte] = [];
        }
        addPreferences(preferencesSettlements[section.ekatte], pref);
        addPreferences(preferencesCountry, pref, section.oblast);
        if (SOFIA_REGIONS.includes(section.oblast)) {
          addPreferences(preferencesSofia, pref, section.oblast);
        }
      }
    }
    addResults(settlement.results, vote.votes, protocol);
    addResults(municipality.results, vote.votes, protocol);

    addResults(region.results, vote.votes, protocol);
  });
  const regFileName = `${outFolder}/${regionsVotesFileName}`;
  fs.writeFileSync(regFileName, stringify(electionRegions), "utf8");
  console.log("Successfully added file ", regFileName);

  savePreferences({
    outFolder,
    preferencesCountry,
    preferencesMunicipalities,
    preferencesRegions,
    preferencesSettlements,
    preferencesSofia,
    stringify,
  });
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
