import { PartyInfo } from "@/data/dataTypes";
import { FC } from "react";
import { PartyCandidatesAllRegions } from "./PartyCandidatesAllRegions";

export const PartyCandidatesScreen: FC<{ party?: PartyInfo }> = ({ party }) => {
  return party ? <PartyCandidatesAllRegions party={party} /> : null;
};
