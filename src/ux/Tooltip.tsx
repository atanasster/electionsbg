import { FC, PropsWithChildren, ReactNode } from "react";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Tooltip: FC<PropsWithChildren<{ content: ReactNode }>> = ({
  content,
  children,
}) => (
  <ShadcnTooltip delayDuration={0}>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="max-w-72 text-sm">{content}</TooltipContent>
  </ShadcnTooltip>
);
