// NewsCard — one dated item in a news rail. Generic: no module knows about it and it knows
// about no module. The nineteen other hubs that will grow a rail get this component, so the
// rail's behaviour is decided once.
//
// EVERY CARD CARRIES ITS OWN DATE, unconditionally. That is a rule taken from the layout
// audit (docs/plans/parliament-hub-v1.md §4.1) rather than a default: a relative kicker
// ("преди 2 дни") on a page that is prerendered and cached is wrong by however long the
// cache lived, and a date that appears only during a recess is a conditional state — which
// is where that page's audit found most of its defects. So: an absolute date, always.

import { FC, ReactNode } from "react";
import { Link } from "@/ux/Link";
import { useDayLabel } from "./useDayLabel";

export interface NewsCardProps {
  to: string;
  /** ISO calendar day of the EVENT — never the build or the render. */
  at: string;
  /** Short category label above the title. Already localized. */
  kicker?: string;
  title: string;
  /** Composed by the caller from numbers + i18n, so this kit ships no prose. */
  subtitle?: ReactNode;
  /** Source text — a party short name, a court, a supplier. Not a status label. */
  badge?: string;
}

export const NewsCard: FC<NewsCardProps> = ({
  to,
  at,
  kicker,
  title,
  subtitle,
  badge,
}) => {
  const day = useDayLabel();
  return (
    <Link
      to={to}
      underline={false}
      className="group flex h-full flex-col rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-foreground/25"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {kicker}
        </span>
        {/* <time dateTime> keeps the machine-readable day intact — the visible text is a
            localized rendering and cannot be parsed back reliably. */}
        <time
          dateTime={at}
          className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
        >
          {day(at)}
        </time>
      </div>
      {/* line-clamp, not truncate: Bulgarian bill titles routinely run past 130 characters
          and a one-line clamp cuts most of them at „Закон за изменение и допълнение на…". */}
      <p className="mt-1 line-clamp-3 text-sm font-medium leading-snug group-hover:underline">
        {title}
      </p>
      {subtitle ? (
        <p className="mt-auto pt-1.5 text-xs text-muted-foreground">
          {subtitle}
        </p>
      ) : null}
      {badge ? (
        <span className="mt-1.5 self-start rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  );
};
