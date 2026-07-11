// A labeled band inside a sector pack. House style is stacked bands (never tabs);
// each band gets a thin top rule, an icon + title, and an optional framing line
// so a long tile scroll reads as a top-line → drill-down narrative instead of a
// flat wall. Extracted from the НЗОК pack's inline `SubSection` so every pack
// (НЗОК, МОН, …) composes its bands the same way and the styling can't drift.

import { FC, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export const PackSection: FC<{
  icon: LucideIcon;
  title: string;
  sub?: string;
  /** Optional header chip — used to flag bands whose data does NOT follow the
   *  host scope pill (a snapshot corpus with its own reporting cadence). Only
   *  passed when the user has actually narrowed the scope. */
  note?: ReactNode;
  children: ReactNode;
}> = ({ icon: Icon, title, sub, note, children }) => (
  <section className="space-y-4 border-t border-border/60 pt-5">
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">{title}</h3>
        {note}
      </div>
      {sub && (
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{sub}</p>
      )}
    </div>
    {children}
  </section>
);
