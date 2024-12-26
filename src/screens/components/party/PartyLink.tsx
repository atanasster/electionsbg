import { PartyInfo } from "@/data/dataTypes";
import { Link } from "@/ux/Link";
import { FC } from "react";
import { PartyLabel } from "./PartyLabel";

export const PartyLink: FC<{ party: PartyInfo }> = ({ party }) => (
  <Link to={`/party/${party.nickName}`} underline={false}>
    <div className="flex items-center border-2 border-primary">
      <div className="w-8 font-semibold text-center">{party.number}</div>
      <PartyLabel className="w-full pl-2" party={party} />
    </div>
  </Link>
);
