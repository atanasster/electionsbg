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
import { cn } from "@/lib/utils";

export const Tooltip: FC<
  PropsWithChildren<{ content: ReactNode; className?: string }>
> = ({ content, children, className }) => {
  const isTouch = useTouch();
  if (isTouch) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          className={cn(
            "max-w-72 text-sm bg-primary text-primary-foreground",
            className,
          )}
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  } else {
    return (
      <ShadcnTooltip delayDuration={0}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className={cn("max-w-72 text-sm", className)}>
          {content}
        </TooltipContent>
      </ShadcnTooltip>
    );
  }
};
