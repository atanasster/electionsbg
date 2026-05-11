import { FC, ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Persistent banner for screens that carry interpretation risk — Benford,
// risk-score, anything where readers might over-read the numbers. The
// `disputed` variant uses the warning palette + a stronger icon, and is
// the right choice for "this is not evidence of fraud" framing per the
// UX research (Reuters/FT 2020 fact-check consensus, Mebane methodology
// papers).

type Variant = "info" | "warning" | "disputed";

export const MethodologyCallout: FC<{
  variant?: Variant;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}> = ({ variant = "info", title, children, className }) => {
  const Icon = variant === "info" ? Info : AlertTriangle;
  const palette =
    variant === "disputed"
      ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200"
      : variant === "warning"
        ? "border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20 text-foreground"
        : "border-border bg-muted/30 text-foreground";
  const iconColor =
    variant === "disputed"
      ? "text-amber-600 dark:text-amber-400"
      : variant === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div
      role="note"
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5 text-xs",
        palette,
        className,
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconColor)} />
      <div className="leading-relaxed">
        {title && <div className="font-semibold mb-1">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
};
