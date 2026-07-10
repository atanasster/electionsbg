// Sub-navigation pills for the procurement section. The first pill ("Overview")
// links back to the /procurement landing — so every sub-page has a one-click
// way home and we don't need a bespoke back-link per page. The rest make the
// contracts/tenders tables, geographic view, red-flag feed (which also carries
// the single-supplier concentration table) and watchlist discoverable. Mirrors
// the DataNav pattern (active pill + aria-current). Links carry the current
// search params forward (scope + election) so a non-default selection
// survives the click.

import { FC } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ROADS_AWARDER_PATH,
  NOI_AWARDER_PATH,
  NZOK_AWARDER_PATH,
} from "./sectorPacks";
import {
  LayoutGrid,
  MapPin,
  Flag,
  Star,
  Table2,
  ClipboardList,
  Gavel,
  Route,
  PiggyBank,
  HeartPulse,
  HeartHandshake,
  Scale,
  Sprout,
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
  {
    to: "/procurement/tenders",
    icon: ClipboardList,
    key: "procurement_tenders_nav",
  },
  {
    to: "/procurement/appeals",
    icon: Gavel,
    key: "procurement_appeals_nav",
  },
  {
    to: "/procurement/ngos",
    icon: HeartHandshake,
    key: "procurement_ngos_nav",
  },
  {
    to: "/procurement/by-settlement",
    icon: MapPin,
    key: "procurement_by_settlement_nav",
  },
  { to: "/procurement/flags", icon: Flag, key: "flags_nav" },
  { to: "/procurement/watchlist", icon: Star, key: "watchlist_nav" },
] as const;

// Sector-specific "where the state money goes" deep dives — a second, lighter
// row below the main section pills so the list can grow without crowding primary
// navigation. Mostly per-entity procurement packs (АПИ roads, ДОО, НЗОК), plus
// the farm-subsidy dataset (grants, not procurement, but the same follow-the-
// money lens and cross-linked by EIK). One entry per page.
const secondaryItems = [
  {
    to: ROADS_AWARDER_PATH,
    icon: Route,
    key: "procurement_roads_nav",
  },
  {
    to: NOI_AWARDER_PATH,
    icon: PiggyBank,
    key: "procurement_noi_nav",
  },
  {
    to: NZOK_AWARDER_PATH,
    icon: HeartPulse,
    key: "procurement_nzok_nav",
  },
  {
    // The judiciary's home is the /judiciary dashboard — it lists every judicial
    // body's awarder page, so the pill points there rather than at the ВСС buyer
    // page alone. `unscoped` because /judiciary has no ?pscope dimension.
    to: "/judiciary",
    icon: Scale,
    key: "judiciary_nav",
    unscoped: true,
  },
  {
    to: "/subsidies",
    icon: Sprout,
    key: "agri_subsidies_nav",
  },
] as const;

const pillClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    isActive
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent/40"
  }`;

export const ProcurementNav: FC = () => {
  const { t } = useTranslation();
  const href = useProcurementHref();
  // Unread badge on the watchlist pill — count of followed entities with new
  // activity since the user last looked. Reads a cached value (no fetches); the
  // watchlist page keeps it fresh.
  const newCount = useCachedNewCount();
  const visibleSecondary = secondaryItems;
  return (
    <>
      <nav
        aria-label={t("procurement_index_title") || "Public procurement"}
        className="flex flex-wrap gap-2 my-3"
      >
        {items.map(({ to, icon: Icon, key, ...rest }) => (
          <NavLink
            key={to}
            to={href(to)}
            end={"end" in rest ? rest.end : false}
            className={pillClass}
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
      {visibleSecondary.length > 0 ? (
        <nav
          aria-label={
            t("procurement_thematic_nav") || "Sector-specific analyses"
          }
          className="flex flex-wrap items-center gap-2 -mt-1 mb-3"
        >
          <span className="text-[11px] text-muted-foreground">
            {t("procurement_thematic_nav") || "Sector-specific analyses"}:
          </span>
          {visibleSecondary.map((item) => {
            const { to, icon: Icon, key } = item;
            // Carry the procurement scope forward, except to pages that have no
            // scope dimension (a stray ?pscope there is dead query string).
            const target = "unscoped" in item && item.unscoped ? to : href(to);
            return (
              <NavLink key={to} to={target} className={pillClass}>
                {({ isActive }) => (
                  <>
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {t(key)}
                    {isActive ? (
                      <span className="sr-only"> (current)</span>
                    ) : null}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      ) : null}
    </>
  );
};
