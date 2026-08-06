import { FC, HTMLProps } from "react";
import { Link as RouterLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePreserveParams } from "./usePreserveParams";
export const Link: FC<
  {
    to:
      | string
      | {
          pathname: string;
          search?: { [key: string]: string };
        };
    underline?: boolean;
  } & HTMLProps<HTMLAnchorElement>
> = ({ className, to, underline = true, ...props }) => {
  const searchParams = usePreserveParams();
  const params = typeof to === "object" ? to.search : undefined;
  // THE FRAGMENT IS SPLIT OFF AND RE-ATTACHED LAST. This used to be a bare
  // `pathname + "?" + params`, which is correct until a caller passes a `to` carrying a
  // `#section` — and then the preserved query lands INSIDE the fragment
  // (`/votes/2026-07-31#absent?elections=2026_04_19`), so `?elections=` stops being a query
  // parameter at all and the destination silently loses the selected election. Found the
  // first time a link in this app pointed at a section rather than a page.
  const raw = typeof to === "string" ? to : to.pathname;
  const hashAt = raw.indexOf("#");
  const path = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  const query = searchParams(params).toString();
  return (
    <RouterLink
      to={path + (query ? `?${query}` : "") + hash}
      className={cn(
        `link text-foreground ${underline ? "hover:underline" : ""} hover:cursor-pointer`,
        className,
      )}
      {...props}
    />
  );
};
