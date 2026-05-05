import { Link } from "@/ux/Link";
import { FC, ReactNode } from "react";
import { candidateUrlFor } from "@/data/candidates/candidateSlug";

type Props = {
  name: string;
  /** parliament.bg id when the caller knows the candidate is a (former or
   * sitting) MP. Always preferred — produces an unambiguous URL. */
  mpId?: number | null;
  /** CIK partyNum, used as a fallback disambiguator when no mpId is
   * available. */
  partyNum?: number | null;
  children?: ReactNode;
};

export const CandidateLink: FC<Props> = ({
  name,
  mpId,
  partyNum,
  children,
}) => (
  <Link to={candidateUrlFor({ mpId, partyNum, name })}>{children ?? name}</Link>
);
