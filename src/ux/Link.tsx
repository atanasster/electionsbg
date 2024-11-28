import { FC, HTMLProps } from "react";
import { Link as RouterLink, LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePreserveParams } from "./usePreserveParams";
export const Link: FC<LinkProps & HTMLProps<HTMLAnchorElement>> = ({
  className,
  to,
  ...props
}) => {
  const searchParams = usePreserveParams();
  return (
    <RouterLink
      to={to + "?" + searchParams().toString()}
      className={cn("link hover:underline hover:cursor-pointer", className)}
      {...props}
    />
  );
};
