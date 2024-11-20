import { FC, HTMLProps } from "react";
import { Link as RouterLink, LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";
export const Link: FC<LinkProps & HTMLProps<HTMLAnchorElement>> = ({
  className,
  ...props
}) => (
  <RouterLink
    className={cn("link hover:underline hover:cursor-pointer", className)}
    {...props}
  />
);
