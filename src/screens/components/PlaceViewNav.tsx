// Segmented switcher mounted at the top of a place's three "views" — the
// personal My-Area dashboard, the parliamentary-elections results, and the
// local-elections results. It lets a reader pivot between the three angles
// on the SAME place (e.g. район Средец) without going back through search.
//
// All three URLs are pure rewrites of the shared geographic identifiers —
// see placeViews.ts. The local pill self-hides when the place has no data
// in the active local cycle (the cycle index is the guard, same rule as
// CrossElectionLink's ToLocalLink). The whole control hides when fewer than
// two views are reachable (nothing to switch to).
//
// The active view always renders (highlighted, non-clickable) so the control
// reads as "you are here / here is where else you can go".

import { FC, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { MapPin, Landmark, Building2 } from "lucide-react";
import {
  PlaceLevel,
  PlaceView,
  myAreaUrl,
  parliamentaryUrl,
  localUrl,
} from "@/data/local/placeViews";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";

type Props = {
  active: PlaceView;
  level: PlaceLevel;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  className?: string;
};

type Item = {
  view: PlaceView;
  to: string | null;
  label: string;
  icon: ReactNode;
};

export const PlaceViewNav: FC<Props> = ({
  active,
  level,
  ekatte,
  obshtina,
  oblast,
  className,
}) => {
  const { t } = useTranslation();
  const { search } = useLocation();
  const cycle = useLatestLocalCycle();
  const { data: index } = useLocalElectionIndex(cycle);

  const place = { level, ekatte, obshtina, oblast };

  // Local availability: the place's município (or, for a region, any of its
  // municípios) must be present in the active cycle's index. Sofia районs are
  // their own município (S2xxx), so the obshtina guard covers them too.
  const localAvailable =
    !!index &&
    (level === "region"
      ? index.municipalities.some((m) => m.oblast === oblast)
      : index.municipalities.some((m) => m.obshtinaCode === obshtina));

  const items: Item[] = [
    {
      view: "myarea",
      to: myAreaUrl(place),
      label: t("my_area_dashboard"),
      icon: <MapPin className="h-3.5 w-3.5" aria-hidden />,
    },
    {
      view: "parliamentary",
      to: parliamentaryUrl(place),
      label: t("cross_to_parliamentary"),
      icon: <Landmark className="h-3.5 w-3.5" aria-hidden />,
    },
    {
      view: "local",
      to: localAvailable ? localUrl(place, cycle) : null,
      label: t("cross_to_local"),
      icon: <Building2 className="h-3.5 w-3.5" aria-hidden />,
    },
  ];

  // Keep the active view even if its URL didn't resolve (we're already on it);
  // drop any other view we can't link to.
  const shown = items.filter((it) => it.view === active || it.to);
  if (shown.length < 2) return null;

  return (
    <nav
      aria-label={t("place_view_nav_label")}
      className={`flex justify-center ${className ?? ""}`}
    >
      <div className="inline-flex items-center gap-1 rounded-full border bg-card p-1 shadow-sm">
        {shown.map((it) => {
          const isActive = it.view === active;
          const inner = (
            <>
              {it.icon}
              <span>{it.label}</span>
            </>
          );
          if (isActive || !it.to) {
            return (
              <span
                key={it.view}
                aria-current={isActive ? "page" : undefined}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
              >
                {inner}
              </span>
            );
          }
          return (
            <Link
              key={it.view}
              to={{ pathname: it.to, search }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              {inner}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
