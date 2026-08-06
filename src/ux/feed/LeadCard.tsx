// LeadCard — the one item a hub leads with: a larger NewsCard with room for a small figure
// block beside the title. Generic, like the rail.
//
// The `stats` block is label + value PAIRS, never a bare number. Every audit of the
// parliament hub found the same defect class — a figure whose basis was undeclared and
// whose most plausible reading was the wrong one — so this component cannot render a figure
// without its label. That is a shape constraint, not a convention someone has to remember.

import { FC, ReactNode } from "react";
import { Link } from "@/ux/Link";
import { useDayLabel } from "./useDayLabel";

export interface LeadStat {
  label: string;
  value: string;
  /** Tints the value. `muted` is for a figure present for completeness (absentees) rather
   *  than for comparison. */
  tone?: "default" | "positive" | "negative" | "muted";
}

export interface LeadCardProps {
  to: string;
  at: string;
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  stats?: LeadStat[];
  className?: string;
}

const TONE: Record<NonNullable<LeadStat["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-rose-600 dark:text-rose-400",
  muted: "text-muted-foreground",
};

export const LeadCard: FC<LeadCardProps> = ({
  to,
  at,
  kicker,
  title,
  subtitle,
  stats,
  className,
}) => {
  const day = useDayLabel("long");
  return (
    <Link
      to={to}
      underline={false}
      className={`group flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:border-foreground/25 sm:flex-row sm:items-center sm:gap-6 sm:px-5 ${className ?? ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {kicker ? (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {kicker}
            </span>
          ) : null}
          <time
            dateTime={at}
            className="text-[11px] tabular-nums text-muted-foreground"
          >
            {day(at)}
          </time>
        </div>
        <p className="mt-1 text-base font-semibold leading-snug group-hover:underline sm:text-lg">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      {stats && stats.length > 0 ? (
        <dl className="flex shrink-0 gap-4 sm:gap-5">
          {stats.map((s) => (
            <div key={s.label} className="text-center">
              <dd
                className={`text-lg font-bold tabular-nums sm:text-xl ${TONE[s.tone ?? "default"]}`}
              >
                {s.value}
              </dd>
              <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
            </div>
          ))}
        </dl>
      ) : null}
    </Link>
  );
};
