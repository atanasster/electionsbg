import { FC, PropsWithChildren, ReactNode } from "react";
import {
  Tooltip as ShadcnTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTouch } from "./TouchProvider";

export const Tooltip: FC<PropsWithChildren<{ content: ReactNode }>> = ({
  content,
  children,
}) => {
  const isTouch = useTouch();
  if (isTouch) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent className="max-w-72 text-sm bg-primary text-primary-foreground">
          {content}
        </PopoverContent>
      </Popover>
    );
  } else {
    return (
      <ShadcnTooltip delayDuration={0}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="max-w-72 text-sm">{content}</TooltipContent>
      </ShadcnTooltip>
    );
  }
};
