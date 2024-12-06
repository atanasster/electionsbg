import { FC, HTMLProps, PropsWithChildren } from "react";
import { Tooltip } from "./Tooltip";
import { cn } from "@/lib/utils";

export const Hint: FC<
  PropsWithChildren<
    { text: string; underline?: boolean } & HTMLProps<HTMLDivElement>
  >
> = ({ text, children, className, underline = true }) => (
  <Tooltip content={<p>{text}</p>}>
    <div
      className={cn(
        `${underline ? "underline decoration-dashed" : ""}`,
        className,
      )}
    >
      {children}
    </div>
  </Tooltip>
);
