import { PartyInfo } from "@/data/dataTypes";
import { Link } from "@/ux/Link";
import { FC } from "react";
import { PartyLabel } from "./PartyLabel";
import { cn } from "@/lib/utils";

export const PartyLink: FC<{
  party?: PartyInfo;
  className?: string;
  width?: string;
  link?: boolean;
}> = ({ party, className, width = "w-8", link = true }) => {
  if (!party) {
    return null;
  }
  const content = (
    <div className="flex items-center border-2 border-primary">
      <div className={`${width} font-semibold text-center`}>
        {party?.number}
      </div>
      <PartyLabel className={cn("w-full pl-2", className)} party={party} />
    </div>
  );
  return party && link ? (
    <Link to={`/party/${party.nickName}`} underline={false}>
      {content}{" "}
    </Link>
  ) : (
    content
  );
};
