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
// API_EIK from the dependency-free engine (not useRoads, which pulls react-query)
// so nav surfaces importing ROADS_AWARDER_PATH don't eager-load the roads corpus
// hook — the RoadsPack itself stays a lazy() dynamic import.
import { API_EIK } from "@/lib/roadAttributes";
import { NOI_EIK } from "@/lib/noiBenchmarks";
import { NZOK_EIK } from "@/lib/nzokBenchmarks";
import { VSS_EIK } from "@/lib/vssReferenceData";
import { MON_EIK } from "@/lib/monBenchmarks";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";
import type { ScopeWindow } from "@/data/procurement/useAwarderContracts";

export interface SectorPackProps {
  eik: string;
  /** [from, to) window inherited from the host's scope control. Named
   *  `scopeWindow` (not `window`) so it can't shadow the global `window`. */
  scopeWindow: ScopeWindow;
}

// Canonical paths to the packed awarder dashboards. Single source for the nav
// surfaces (route redirect, procurement pill, report menu) so re-keying a pack —
// or giving a pack a pill — can't drift the hardcoded EIK.
export const ROADS_AWARDER_PATH = `/awarder/${API_EIK}`;
export const NOI_AWARDER_PATH = `/awarder/${NOI_EIK}`;
export const NZOK_AWARDER_PATH = `/awarder/${NZOK_EIK}`;
export const MON_AWARDER_PATH = `/awarder/${MON_EIK}`;
// NOTE: there is deliberately no VSS_AWARDER_PATH export. Its siblings
// (ROADS_/NOI_/NZOK_AWARDER_PATH) are consumed by reportMenus.ts and
// ProcurementNav.tsx, but both nav surfaces point at the /judiciary dashboard
// instead — the ВСС buyer page is reached from there. Don't "fix" the omission.
// ДФ „Земеделие" has no bespoke SectorPack — its awarder page is the generic
// awarder dashboard plus the administering-agency subsidies card (gated on
// AGRI_PAYER_EIK in CompanyDbScreen), the entry point into the /subsidies pack.
export const DFZ_AWARDER_PATH = `/awarder/${AGRI_PAYER_EIK}`;

const RoadsPack = lazy(() =>
  import("./roads/RoadsPack").then((m) => ({ default: m.RoadsPack })),
);
const NoiPack = lazy(() =>
  import("./noi/NoiPack").then((m) => ({ default: m.NoiPack })),
);
const NzokPack = lazy(() =>
  import("./nzok/NzokPack").then((m) => ({ default: m.NzokPack })),
);
const VssPack = lazy(() =>
  import("./vss/VssPack").then((m) => ({ default: m.VssPack })),
);
const MonPack = lazy(() =>
  import("./mon/MonPack").then((m) => ({ default: m.MonPack })),
);

const PACKS: Record<string, ComponentType<SectorPackProps>> = {
  [API_EIK]: RoadsPack,
  [NOI_EIK]: NoiPack,
  [NZOK_EIK]: NzokPack,
  [VSS_EIK]: VssPack,
  [MON_EIK]: MonPack,
};

export const getSectorPack = (
  eik: string,
): ComponentType<SectorPackProps> | null => PACKS[eik] ?? null;
