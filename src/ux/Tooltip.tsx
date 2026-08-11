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
  PropsWithChildren<{
    content: ReactNode;
    className?: string;
    /** Extra classes for the TOUCH-ONLY trigger wrapper. The touch path adds a
     *  `<span>` between the caller and its child (see below); the desktop path
     *  does not. That extra box silently breaks any child sized RELATIVE to its
     *  parent — a flex item with a percentage width resolves against the span's
     *  content width instead of the row's, collapsing to its text. Pass
     *  e.g. "block h-full" so the wrapper fills its parent and the child's
     *  percentage still means what the caller intended. */
    triggerClassName?: string;
  }>
> = ({ content, children, className, triggerClassName }) => {
  const isTouch = useTouch();
  if (isTouch) {
    // Wrap in a span with role="button" so Radix's injected `aria-expanded`
    // / `aria-haspopup` are valid (they're only allowed on button-role
    // elements). Avoids switching to a real <button>, which would create
    // invalid nested-interactive HTML when callers wrap inside an <a>.
    return (
      <Popover>
        <PopoverTrigger asChild>
          {/* min-w-0 so a tooltip-wrapped flex child (e.g. the header area /
              cabinet pills) can still shrink-and-truncate instead of forcing
              an overflow; no-op for non-flex usages. */}
          <span
            role="button"
            tabIndex={0}
            className={cn("cursor-pointer min-w-0", triggerClassName)}
          >
            {children}
          </span>
        </PopoverTrigger>
        <PopoverContent className={cn("max-w-72 text-sm", className)}>
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
