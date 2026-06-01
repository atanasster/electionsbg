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
// reads as "you are here / here is where else you can go". Each view owns one
// accent hue (see PLACE_VIEW_META) so the active pill, plus PlaceHeader's
// eyebrow + left border, all read as the same colour — the "which dashboard
// am I on" cue. The inactive pills tint just their icon in the target view's
// hue so the colour↔view mapping is learnable.

import { FC } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  PlaceLevel,
  PlaceView,
  myAreaUrl,
  parliamentaryUrl,
  localUrl,
  isSofiaCityObshtina,
} from "@/data/local/placeViews";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { useLocalElectionIndex } from "@/data/local/useLocalElectionIndex";
import { PLACE_VIEW_META } from "./placeViewMeta";

// Stable left-to-right order of the three views.
const ORDER: PlaceView[] = ["myarea", "parliamentary", "local"];

type Props = {
  active: PlaceView;
  level: PlaceLevel;
  ekatte?: string;
  obshtina?: string;
  oblast?: string;
  align?: "start" | "center";
  className?: string;
};

export const PlaceViewNav: FC<Props> = ({
  active,
  level,
  ekatte,
  obshtina,
  oblast,
  align = "center",
  className,
}) => {
  const { t } = useTranslation();
  const { search } = useLocation();
  const cycle = useLatestLocalCycle();
  const { data: index } = useLocalElectionIndex(cycle);

  const place = { level, ekatte, obshtina, oblast };

  // Local availability: the place's município (or, for a region, any of its
  // municípios) must be present in the active cycle's index. Sofia районs are
  // their own município (S2xxx), so the obshtina guard covers them too. The
  // Sofia city aggregate is keyed SOF00 in the parliamentary/my-area trees but
  // lives under the synthetic SOF bundle in the local index — check that.
  const localAvailable =
    !!index &&
    (level === "region"
      ? index.municipalities.some((m) => m.oblast === oblast)
      : isSofiaCityObshtina(obshtina)
        ? index.municipalities.some((m) => m.obshtinaCode === "SOF")
        : index.municipalities.some((m) => m.obshtinaCode === obshtina));

  const urlFor = (view: PlaceView): string | null => {
    if (view === "myarea") return myAreaUrl(place);
    if (view === "parliamentary") return parliamentaryUrl(place);
    return localAvailable ? localUrl(place, cycle) : null;
  };

  const items = ORDER.map((view) => ({ view, to: urlFor(view) }));

  // Keep the active view even if its URL didn't resolve (we're already on it);
  // drop any other view we can't link to.
  const shown = items.filter((it) => it.view === active || it.to);
  if (shown.length < 2) return null;

  return (
    <nav
      aria-label={t("place_view_nav_label")}
      className={`flex ${align === "center" ? "justify-center" : "justify-start"} ${className ?? ""}`}
    >
      <div className="inline-flex items-center gap-1 rounded-full border bg-card p-1 shadow-sm">
        {shown.map((it) => {
          const meta = PLACE_VIEW_META[it.view];
          const Icon = meta.icon;
          const isActive = it.view === active;
          if (isActive || !it.to) {
            return (
              <span
                key={it.view}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${meta.activePill}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span>{t(meta.labelKey)}</span>
              </span>
            );
          }
          return (
            <Link
              key={it.view}
              to={{ pathname: it.to, search }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            >
              <Icon className={`h-3.5 w-3.5 ${meta.text}`} aria-hidden />
              <span>{t(meta.labelKey)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
