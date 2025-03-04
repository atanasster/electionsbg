import { FC } from "react";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { PartyRecountTable } from "../PartyRecountTable";

export const SettlementRecountTable: FC<{
  municipality: string;
  title: string;
}> = ({ municipality, title }) => {
  const { municipality: municipalityVotes } =
    useMunicipalityVotes(municipality);

  return <PartyRecountTable title={title} votes={municipalityVotes} />;
};
