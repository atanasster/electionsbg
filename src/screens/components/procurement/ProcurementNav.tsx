// Sub-navigation pills for the procurement section. The first pill ("Overview")
// links back to the /procurement landing — so every sub-page has a one-click
// way home and we don't need a bespoke back-link per page. The rest make the
// flow explorer, money scanner, geographic view, concentration table, red-flag
// feed and watchlist discoverable. Mirrors the DataNav pattern (active pill +
// aria-current). Links carry the current search params forward (scope +
// election) so a non-default selection survives the click.

import { FC } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LayoutGrid,
  GitFork,
  Search,
  MapPin,
  PieChart,
  Flag,
  Star,
  Table2,
} from "lucide-react";
import { useProcurementHref } from "@/data/procurement/useProcurementScope";
import { useCachedNewCount } from "@/data/procurement/useWatchlist";

const items = [
  {
    to: "/procurement",
    icon: LayoutGrid,
    key: "procurement_overview_nav",
    end: true,
  },
  {
    to: "/procurement/contracts",
    icon: Table2,
    key: "procurement_index_contracts",
  },
  { to: "/procurement/flows", icon: GitFork, key: "procurement_flows_title" },
  { to: "/procurement/people", icon: Search, key: "procurement_people_title" },
  {
    to: "/procurement/by-settlement",
    icon: MapPin,
    key: "procurement_by_settlement_nav",
  },
  {
    to: "/procurement/concentration",
    icon: PieChart,
    key: "procurement_concentration_nav",
  },
  { to: "/procurement/flags", icon: Flag, key: "flags_title" },
  { to: "/procurement/watchlist", icon: Star, key: "watchlist_title" },
] as const;

export const ProcurementNav: FC = () => {
  const { t } = useTranslation();
  const href = useProcurementHref();
  // Unread badge on the watchlist pill — count of followed entities with new
  // activity since the user last looked. Reads a cached value (no fetches); the
  // watchlist page keeps it fresh.
  const newCount = useCachedNewCount();
  return (
    <nav
      aria-label={t("procurement_index_title") || "Public procurement"}
      className="flex flex-wrap gap-2 my-3"
    >
      {items.map(({ to, icon: Icon, key, ...rest }) => (
        <NavLink
          key={to}
          to={href(to)}
          end={"end" in rest ? rest.end : false}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t(key)}
              {to === "/procurement/watchlist" && newCount > 0 ? (
                <span
                  className="ml-0.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-white tabular-nums"
                  aria-label={`${newCount} new`}
                >
                  {newCount}
                </span>
              ) : null}
              {isActive ? <span className="sr-only"> (current)</span> : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
};
