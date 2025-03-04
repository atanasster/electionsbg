import {
  ElectionMunicipality,
  ElectionRegion,
  ElectionSettlement,
  SectionInfo,
} from "@/data/dataTypes";
import { recountRegions } from "./recount_regions";
import { recountMunicipalities } from "./recount_municipalities";
import { recountSettlements } from "./recount_settlements";
import { recountSections } from "./recount_sections";

export const createRecountFiles = ({
  inFolder,
  electionRegions,
  electionMunicipalities,
  electionSettlements,
  electionSections,
}: {
  inFolder: string;
  electionRegions: ElectionRegion[];
  electionMunicipalities: ElectionMunicipality[];
  electionSettlements: ElectionSettlement[];
  electionSections: SectionInfo[];
}) => {
  if (!recountRegions({ inFolder, electionRegions })) {
    return false;
  }
  recountMunicipalities({ inFolder, electionMunicipalities });
  recountSettlements({ inFolder, electionSettlements });
  recountSections({ inFolder, electionSections });
  return true;
};
