// Sector-pack registry — the seam that lets the generic awarder dashboard
// (/awarder/:eik) grow domain-specific analytics for a handful of high-profile
// buyers without special-casing the screen. A pack is a lazily-loaded component
// keyed by awarder EIK; when one is registered, the awarder page renders it as
// a hero section (below the generic KPIs) and downloads the buyer's contract
// corpus for the client-side classification the pack needs.
//
// The generic path stays cheap: awarders with no pack render purely from the
// server-aggregated jsonb (no row download). Only packed buyers pay for the
// corpus fetch — see RoadsPack / useRoads.
//
// To add a pack (e.g. НОИ/ДОО): write a <Pack eik window /> component with its
// own classifier + tiles and register its EIK below.

import { lazy, type ComponentType } from "react";
import { API_EIK } from "@/data/procurement/useRoads";
import type { RoadsWindow } from "@/data/procurement/useRoads";

export interface SectorPackProps {
  eik: string;
  /** [from, to) window inherited from the host's scope control. */
  window: RoadsWindow;
}

const RoadsPack = lazy(() =>
  import("./roads/RoadsPack").then((m) => ({ default: m.RoadsPack })),
);

const PACKS: Record<string, ComponentType<SectorPackProps>> = {
  [API_EIK]: RoadsPack,
};

export const getSectorPack = (
  eik: string,
): ComponentType<SectorPackProps> | null => PACKS[eik] ?? null;
