// The "Тематични анализи" (sector-specific analyses) pill strip — the second,
// lighter nav row that jumps between the per-sector "where the state money goes"
// dashboards (АПИ roads, НОИ, НЗОК, МОН, съдебна власт, култура, земеделски
// субсидии). Extracted from ProcurementNav so the SAME strip can render on every
// linked dashboard — the packed awarder pages (/awarder/:eik) and the standalone
// sector dashboards (/judiciary, /culture, /subsidies) — not just the /procurement
// section pages. That way, wherever you land in the thematic set, you can hop to a
// sibling analysis in one click (and the active pill shows "you are here").

import { FC } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Route,
  PiggyBank,
  HeartPulse,
  Scale,
  Palette,
  Sprout,
  GraduationCap,
  Droplets,
  Shield,
} from "lucide-react";
import {
  ROADS_AWARDER_PATH,
  NOI_AWARDER_PATH,
  NZOK_AWARDER_PATH,
  MON_AWARDER_PATH,
} from "./sectorPacks";
import { useProcurementHref } from "@/data/procurement/useProcurementScope";

// Sector-specific "where the state money goes" deep dives. Mostly per-entity
// procurement packs (АПИ roads, ДОО, НЗОК, МОН), plus the two standalone sector
// dashboards (съдебна власт, култура) and the farm-subsidy dataset (grants, not
// procurement, but the same follow-the-money lens and cross-linked by EIK).
// One entry per page. Pages with no ?pscope dimension carry `unscoped`.
const thematicItems = [
  { to: ROADS_AWARDER_PATH, icon: Route, key: "procurement_roads_nav" },
  { to: NOI_AWARDER_PATH, icon: PiggyBank, key: "procurement_noi_nav" },
  { to: NZOK_AWARDER_PATH, icon: HeartPulse, key: "procurement_nzok_nav" },
  { to: MON_AWARDER_PATH, icon: GraduationCap, key: "procurement_mon_nav" },
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
    // Култура's home is the /culture dashboard (film subsidies, concentration);
    // the МК awarder page is the procurement half. `unscoped` — no ?pscope.
    to: "/culture",
    icon: Palette,
    key: "culture_nav",
    unscoped: true,
  },
  {
    // Води's home is the /water dashboard (ВиК-холдинг group + riverbed-cleaning);
    // scoped — /water reads ?pscope via useVik/useProcurementWindow.
    to: "/water",
    icon: Droplets,
    key: "procurement_water_nav",
  },
  {
    // Отбрана — the /defense dashboard (%GDP path, programs, exports, readiness);
    // the МО group procurement pack is reached from its awarders tile. `unscoped`
    // because /defense has no ?pscope dimension.
    to: "/defense",
    icon: Shield,
    key: "procurement_defense_nav",
    unscoped: true,
  },
  { to: "/subsidies", icon: Sprout, key: "agri_subsidies_nav" },
] as const;

const pillClass = ({ isActive }: { isActive: boolean }) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
    isActive
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent/40"
  }`;

export const ProcurementThematicNav: FC = () => {
  const { t } = useTranslation();
  const href = useProcurementHref();
  return (
    <nav
      aria-label={t("procurement_thematic_nav") || "Sector-specific analyses"}
      className="flex flex-wrap items-center gap-2 my-3"
    >
      <span className="text-[11px] text-muted-foreground">
        {t("procurement_thematic_nav") || "Sector-specific analyses"}:
      </span>
      {thematicItems.map((item) => {
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
                {isActive ? <span className="sr-only"> (current)</span> : null}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
};
