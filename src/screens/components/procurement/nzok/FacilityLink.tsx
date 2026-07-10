// Shared facility cell for the НЗОК tiles: a hospital name linked to its own
// /company/:eik page when the EIK crosswalk matched, else plain decoded text
// (private / unmatched facilities carry a null eik). Extracted from the three
// tiles that repeated this exact eik?-link:-text pattern.

import { FC } from "react";
import { Link } from "react-router-dom";
import { decodeEntities } from "@/lib/decodeEntities";

export const FacilityLink: FC<{ eik?: string | null; name: string }> = ({
  eik,
  name,
}) =>
  eik ? (
    <Link to={`/company/${eik}`} className="text-accent hover:underline">
      {decodeEntities(name)}
    </Link>
  ) : (
    <>{decodeEntities(name)}</>
  );
