// The pack tiles' inline picker (universe / metric filters on the sector packs).
//
// ⚠ WHY THIS EXISTS — do not "simplify" it back to the shared Radix `Select`.
// Radix's Select ALWAYS locks body scroll while open and compensates for the removed
// scrollbar, which flashes a ghost scrollbar and shifts the page (the operator hit this
// on /sector/regional). `Select.Root` exposes no `modal` prop (@radix-ui/react-select
// 2.x), so the lock cannot be disabled — the only fix is a `DropdownMenu modal={false}`,
// exactly what the site header already does (src/layout/header/ElectionsSelect.tsx +
// Header.tsx `RenderTopMenu`). This component is that fix, factored out so every pack
// shares one implementation instead of re-deriving the trigger + check-mark markup.
//
// Still Radix, still themed — the "never a native <select>" rule is unaffected.

import { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface PackSelectOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function PackSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  contentClassName,
  align = "end",
  id,
}: {
  value: T;
  options: readonly PackSelectOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  /** Extra classes for the trigger (e.g. `ml-auto`, a height/width override). */
  className?: string;
  /** Extra classes for the menu (e.g. a max-height for long option lists). */
  contentClassName?: string;
  align?: "start" | "end";
  id?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          id={id}
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-7 w-auto min-w-[150px] items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-2 text-xs text-secondary-foreground shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring [&[data-state=open]>svg]:rotate-180",
            className,
          )}
        >
          <span className="line-clamp-1">{current?.label ?? value}</span>
          <ChevronDown className="size-4 shrink-0 opacity-50 transition-transform duration-200" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn(
          "min-w-[200px] max-h-80 overflow-y-auto",
          contentClassName,
        )}
      >
        {options.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onChange(o.value)}
            className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-3 pr-9 text-xs"
          >
            <span className="absolute right-3 flex size-4 items-center justify-center">
              {o.value === value && <Check className="size-4" />}
            </span>
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
