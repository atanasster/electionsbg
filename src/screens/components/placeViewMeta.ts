// Per-view identity shared by PlaceViewNav (the switcher) and PlaceHeader
// (the unified header). One accent hue per dashboard, so the active switcher
// pill, the header's left border, and the header eyebrow all read as the same
// colour — the "which dashboard am I on" cue. Kept in its own module (no
// component export) so both consumers can import it without tripping the
// react-refresh only-export-components rule.
//
// Class strings are full literals so Tailwind's content scan keeps them.

import {
  Scale,
  Landmark,
  Building2,
  ShoppingBasket,
  LucideIcon,
} from "lucide-react";
import type { PlaceView } from "@/data/local/placeViews";

export const PLACE_VIEW_META: Record<
  PlaceView,
  {
    icon: LucideIcon;
    labelKey: string;
    border: string;
    text: string;
    activePill: string;
  }
> = {
  governance: {
    icon: Scale,
    labelKey: "cross_to_governance",
    border: "border-l-primary",
    text: "text-primary",
    activePill: "bg-primary text-primary-foreground",
  },
  parliamentary: {
    icon: Landmark,
    labelKey: "cross_to_parliamentary",
    border: "border-l-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    activePill: "bg-sky-600 text-white",
  },
  local: {
    icon: Building2,
    labelKey: "cross_to_local",
    border: "border-l-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    activePill: "bg-emerald-600 text-white",
  },
  consumption: {
    icon: ShoppingBasket,
    labelKey: "cross_to_consumption",
    border: "border-l-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    activePill: "bg-amber-600 text-white",
  },
};
