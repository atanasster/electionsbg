// Sub-navigation pills for the procurement section — makes the flow explorer,
// money scanner, geographic view, red-flag feed and watchlist discoverable from
// the /procurement landing. Mirrors the DataNav pattern.

import { FC } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GitFork, Search, MapPin, Flag, Star } from "lucide-react";

const items = [
  { to: "/procurement/flows", icon: GitFork, key: "procurement_flows_title" },
  { to: "/procurement/people", icon: Search, key: "procurement_people_title" },
  {
    to: "/procurement/by-settlement",
    icon: MapPin,
    key: "procurement_by_settlement_nav",
  },
  { to: "/procurement/flags", icon: Flag, key: "flags_title" },
  { to: "/procurement/watchlist", icon: Star, key: "watchlist_title" },
] as const;

export const ProcurementNav: FC = () => {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-wrap gap-2 my-3">
      {items.map(({ to, icon: Icon, key }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent/40"
            }`
          }
        >
          <Icon className="h-3.5 w-3.5" />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );
};
