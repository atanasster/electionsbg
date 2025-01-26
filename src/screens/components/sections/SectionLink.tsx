import { Link } from "@/ux/Link";
import { FC } from "react";

export const SectionLink: FC<{ section?: string }> = ({ section }) => {
  return section && <Link to={`/section/${section}`}>{section}</Link>;
};
