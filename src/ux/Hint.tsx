import { FC, PropsWithChildren } from "react";
import { Tooltip } from "./Tooltip";

export const Hint: FC<
  PropsWithChildren<{ text: string; underline?: boolean }>
> = ({ text, children, underline = true }) => (
  <Tooltip content={<p>{text}</p>}>
    <div className={`${underline ? "underline decoration-dashed" : ""}`}>
      {children}
    </div>
  </Tooltip>
);
