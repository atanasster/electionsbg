import { FC, HTMLProps, PropsWithChildren, ReactNode } from "react";
import { Tooltip } from "./Tooltip";

export const Hint: FC<
  PropsWithChildren<
    { text?: ReactNode; underline?: boolean } & HTMLProps<HTMLDivElement>
  >
> = ({ text, children, className, underline = true, ...props }) =>
  text ? (
    <Tooltip content={text} className={className}>
      <div
        className={`${underline ? "underline decoration-dashed" : ""}`}
        {...props}
      >
        {children}
      </div>
    </Tooltip>
  ) : (
    children
  );
