import { Link } from "@/ux/Link";
import { FC } from "react";

export const CandidateLink: FC<{ name: string }> = ({ name }) => (
  <Link to={`/candidate/${name}`}>{name}</Link>
);
