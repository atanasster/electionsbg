import { FC, PropsWithChildren } from "react";
import {
  Tooltip as TooltipShadcn,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Hint: FC<PropsWithChildren<{ text: string }>> = ({
  text,
  children,
}) => (
  <TooltipShadcn delayDuration={0}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="max-w-64 text-sm">
      <p>{text}</p>
    </TooltipContent>
  </TooltipShadcn>
);
