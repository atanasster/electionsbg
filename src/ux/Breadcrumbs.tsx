// Breadcrumbs — a generic hierarchy link control. Ancestors are links; the last
// item is the current page (rendered as text with aria-current="page"). Keep it
// to one line — the current crumb truncates on narrow screens rather than
// wrapping the whole trail. Used by SectorBreadcrumb and reusable anywhere a page
// wants to show "where am I + go up" instead of enumerating siblings.

import { FC } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** Ancestor link target. Omit for the current (last) crumb. */
  to?: string;
}

export const Breadcrumbs: FC<{ items: Crumb[]; className?: string }> = ({
  items,
  className,
}) => {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("breadcrumb") || "Breadcrumb"} className={className}>
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li
              key={`${crumb.label}-${i}`}
              className="inline-flex min-w-0 items-center gap-1.5"
            >
              {crumb.to && !last ? (
                <Link
                  to={crumb.to}
                  className="shrink-0 transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn(
                    "truncate",
                    last && "font-medium text-foreground",
                  )}
                >
                  {crumb.label}
                </span>
              )}
              {!last ? (
                <ChevronRight
                  className="h-3 w-3 shrink-0 opacity-60"
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
