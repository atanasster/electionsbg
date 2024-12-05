import { FC, PropsWithChildren } from "react";
import { Tooltip } from "./Tooltip";

export const Hint: FC<PropsWithChildren<{ text: string }>> = ({
  text,
  children,
}) => <Tooltip content={<p>{text}</p>}>{children}</Tooltip>;
