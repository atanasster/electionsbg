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
  } & HTMLProps<HTMLAnchorElement>
> = ({ className, to, ...props }) => {
  const searchParams = usePreserveParams();
  const params = typeof to === "object" ? to.search : undefined;
  return (
    <RouterLink
      to={
        (typeof to === "string" ? to : to.pathname) +
        "?" +
        searchParams(params).toString()
      }
      className={cn("link hover:underline hover:cursor-pointer", className)}
      {...props}
    />
  );
};
