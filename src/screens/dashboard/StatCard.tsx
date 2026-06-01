import { FC, PropsWithChildren, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "@/ux/Hint";

type Props = {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  // When set, the whole card becomes a link to this route (drill-down to a
  // standalone detail page) with a hover affordance + a corner chevron.
  to?: string;
  // Cap the body to this CSS height with internal vertical scroll, so a long
  // list tile doesn't tower over its grid-row neighbour. e.g. "22rem".
  bodyMaxHeight?: string;
};

// Tile titles are sentence case (not an ALL-CAPS eyebrow): forced uppercase
// hurts scannability, especially for long Cyrillic labels. ALL-CAPS is reserved
// for the section kickers (DashboardSection) and party acronyms.
export const StatCard: FC<PropsWithChildren<Props>> = ({
  label,
  hint,
  className,
  to,
  bodyMaxHeight,
  children,
}) => {
  const labelEl = (
    <div className="text-sm font-medium text-muted-foreground">{label}</div>
  );
  const inner = (
    <>
      {hint ? (
        <Hint text={hint} underline={false}>
          {labelEl}
        </Hint>
      ) : (
        labelEl
      )}
      <div
        className={cn(
          "flex flex-col gap-1",
          bodyMaxHeight && "overflow-y-auto",
        )}
        style={bodyMaxHeight ? { maxHeight: bodyMaxHeight } : undefined}
      >
        {children}
      </div>
    </>
  );
  const shell =
    "flex h-full flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm";
  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          shell,
          "relative transition-colors hover:bg-accent/40 hover:border-primary/40",
          className,
        )}
      >
        <ChevronRight
          className="absolute right-3 top-4 h-4 w-4 text-muted-foreground opacity-50"
          aria-hidden
        />
        {inner}
      </Link>
    );
  }
  return <div className={cn(shell, className)}>{inner}</div>;
};
