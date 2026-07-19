// A colored party pill (acronym on the party's brand colour). Shared so the person header,
// the electoral heading, and the header search render one consistent badge — and so the
// readable-text contrast fix lives in one place.

import { FC } from "react";
import { cn } from "@/lib/utils";
import { readableText } from "@/lib/readableText";

export const PartyBadge: FC<{
  label: string;
  color?: string | null;
  className?: string;
}> = ({ label, color, className }) => (
  <span
    className={cn(
      "inline-block rounded px-2 py-0.5 text-sm font-semibold leading-none",
      className,
    )}
    style={{
      backgroundColor: color ?? "hsl(var(--muted-foreground))",
      color: readableText(color),
    }}
  >
    {label}
  </span>
);
