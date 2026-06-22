import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// A native <select> styled to match the app. The browser's default dropdown
// arrow sits glued to the right border (and ignores padding), so we suppress it
// with `appearance-none` and overlay a single lucide ChevronDown with
// consistent spacing — the same chevron the Radix SelectTrigger renders.
//
// `className` styles the <select> itself (bg / border / text / height), exactly
// as a bare <select> would. `wrapperClassName` styles the positioning wrapper —
// use it for layout utilities that previously lived on the <select> (e.g.
// `ml-auto`). The chevron-clearance right padding is appended last so twMerge
// lets it win over any `px-*` / `pr-*` in `className`.
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & {
    wrapperClassName?: string;
  }
>(({ className, wrapperClassName, children, ...props }, ref) => (
  <div className={cn("relative inline-flex items-center", wrapperClassName)}>
    <select
      ref={ref}
      className={cn(className, "appearance-none pr-7")}
      {...props}
    >
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
  </div>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
