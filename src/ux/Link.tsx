import { FC, HTMLProps } from "react";

export const Link: FC<HTMLProps<HTMLAnchorElement>> = ({
  className,
  ...props
}) => (
  <a
    className={`link text-accent-foreground hover:underline hover:cursor-pointer ${className || ""}`}
    {...props}
  />
);
