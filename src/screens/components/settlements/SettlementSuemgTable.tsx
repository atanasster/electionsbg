import { FC } from "react";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { PartySuemgTable } from "../PartySuemgTable";

export const SettlementSuemgTable: FC<{
  municipality: string;
  title: string;
}> = ({ municipality, title }) => {
  const { municipality: municipalityVotes } =
    useMunicipalityVotes(municipality);

  return <PartySuemgTable title={title} results={municipalityVotes?.results} />;
};
