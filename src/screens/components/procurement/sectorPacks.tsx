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
import { VSS_EIK, VSS_ALIAS_EIKS, JUDICIAL_EIKS } from "@/lib/vssReferenceData";
import { MON_EIK } from "@/lib/monBenchmarks";
import { KULTURA_EIK } from "@/lib/kulturaReferenceData";
import { VIK_HOLDING_EIK, WATER_SECTOR_EIKS } from "@/lib/vikReferenceData";
import { MOD_EIK, DEFENSE_SECTOR_EIKS } from "@/lib/defenseReferenceData";
import { NAP_EIK, NAP_AWARDER_PATH } from "@/lib/napReferenceData";
import { CUSTOMS_EIK, CUSTOMS_AWARDER_PATH } from "@/lib/customsReferenceData";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";
import { ENERGY_SECTOR_EIKS } from "@/lib/energyReferenceData";
import { TRANSPORT_EIK, ADMIN_EIK } from "@/screens/sector/sectorDashboards";
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
// Revenue-agency packs (НАП / Митници) — collectors, not spenders. Pack-only
// (no standalone view yet), so the nav points straight at the awarder page.
export { NAP_AWARDER_PATH, CUSTOMS_AWARDER_PATH };

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
// No KULTURA_AWARDER_PATH export (deliberately, like ВСС): the culture view's
// home is the /culture dashboard, which the nav points at; the МК awarder page
// is reached from there. The pack still registers by EIK below.
const KulturaPack = lazy(() =>
  import("./kultura/KulturaPack").then((m) => ({ default: m.KulturaPack })),
);
// No VIK_AWARDER_PATH export (deliberately, like ВСС/culture): the water view's
// home will be the /water dashboard (plan §0b.4); the ВиК-холдинг awarder page is
// reached from there. The Phase-1 pack still registers by EIK below and renders
// off the existing corpus (consolidated group + by-function) with no new ingest.
const VikPack = lazy(() =>
  import("./vik/VikPack").then((m) => ({ default: m.VikPack })),
);
// No DEFENSE_AWARDER_PATH export (deliberately, like ВСС/culture/water): the
// defense view's home will be the /defense dashboard (plan Phase 2); the МО
// awarder page is reached from there. The pack registers by EIK below and renders
// off the existing corpus (25-unit group roll-up) with no new ingest.
const DefensePack = lazy(() =>
  import("./defense/DefensePack").then((m) => ({ default: m.DefensePack })),
);
const NapPack = lazy(() =>
  import("./nap/NapPack").then((m) => ({ default: m.NapPack })),
);
const CustomsPack = lazy(() =>
  import("./customs/CustomsPack").then((m) => ({ default: m.CustomsPack })),
);

const PACKS: Record<string, ComponentType<SectorPackProps>> = {
  [API_EIK]: RoadsPack,
  [NOI_EIK]: NoiPack,
  [NZOK_EIK]: NzokPack,
  [VSS_EIK]: VssPack,
  [MON_EIK]: MonPack,
  [KULTURA_EIK]: KulturaPack,
  [VIK_HOLDING_EIK]: VikPack,
  [MOD_EIK]: DefensePack,
  [NAP_EIK]: NapPack,
  [CUSTOMS_EIK]: CustomsPack,
};

export const getSectorPack = (
  eik: string,
): ComponentType<SectorPackProps> | null => PACKS[eik] ?? null;

// --- Sector browse packs ----------------------------------------------------
// The awarder sector-pack generalized to the corpus-wide browse pages
// (/procurement/contracts, /procurement/tenders): keyed on a sector id → an
// EIK-set, so a multi-entity sector (the ~26 ВиК operators, the 58 judicial
// bodies) can restrict + enrich the shared table via ?sector=. This is the
// shared seam docs/plans/water-view-v1.md §4.3 designs; the judiciary plan is
// blocked on it too. Requires contracts.awarder_eik to be filter:"in" (done in
// functions/db_table.js) so the EIK-set can be an IN fixedFilter.

export interface SectorBrowseSectionProps {
  /** [from, to) window inherited from the browse page's scope control. */
  scope: ScopeWindow;
  /** The sector's awarder EIK-set (== the table's filter) — so the enrichment
   *  strip rolls up exactly the operators the browse page is showing. */
  eiks: readonly string[];
}

export interface SectorBrowsePack {
  id: string;
  label: { bg: string; en: string };
  /** The awarder EIKs whose contracts the browse table is restricted to. */
  eiks: readonly string[];
  /** Optional enrichment strip rendered above the table. Only water ships one
   *  in v1; the other sectors are filter-only until their Section is built. */
  Section?: ComponentType<SectorBrowseSectionProps>;
}

const VikBrowseSection = lazy(() =>
  import("./vik/VikBrowseSection").then((m) => ({
    default: m.VikBrowseSection,
  })),
);
const DefenseBrowseSection = lazy(() =>
  import("./defense/DefenseBrowseSection").then((m) => ({
    default: m.DefenseBrowseSection,
  })),
);

export const SECTOR_BROWSE_PACKS: Record<string, SectorBrowsePack> = {
  water: {
    id: "water",
    label: { bg: "Води (ВиК)", en: "Water (ВиК)" },
    eiks: WATER_SECTOR_EIKS,
    Section: VikBrowseSection,
  },
  roads: {
    id: "roads",
    label: { bg: "Пътища (АПИ)", en: "Roads (АПИ)" },
    eiks: [API_EIK],
  },
  noi: {
    id: "noi",
    label: { bg: "Осигуряване (НОИ)", en: "Social security (НОИ)" },
    eiks: [NOI_EIK],
  },
  nzok: {
    id: "nzok",
    label: { bg: "Здравна каса (НЗОК)", en: "Health fund (НЗОК)" },
    eiks: [NZOK_EIK],
  },
  agri: {
    id: "agri",
    label: { bg: "Земеделие (ДФЗ)", en: "Agriculture (ДФЗ)" },
    eiks: [AGRI_PAYER_EIK],
  },
  judiciary: {
    id: "judiciary",
    label: { bg: "Съдебна власт (ВСС)", en: "Judiciary (ВСС)" },
    eiks: [VSS_EIK, ...VSS_ALIAS_EIKS, ...JUDICIAL_EIKS],
  },
  defense: {
    id: "defense",
    label: { bg: "Отбрана (МО)", en: "Defense (МО)" },
    eiks: DEFENSE_SECTOR_EIKS,
    Section: DefenseBrowseSection,
  },
  // Single-EIK sectors graduated to the generic /sector/:id dashboard — their
  // ?sector= filter narrows the browse table to the one awarder seat. Widen the
  // EIK-set here (and the server allow-list) when a multi-entity roster lands.
  revenue: {
    id: "revenue",
    label: { bg: "Приходи (НАП)", en: "Revenue (НАП)" },
    eiks: [NAP_EIK],
  },
  customs: {
    id: "customs",
    label: { bg: "Митници (АМ)", en: "Customs (АМ)" },
    eiks: [CUSTOMS_EIK],
  },
  edu: {
    id: "edu",
    label: { bg: "Образование (МОН)", en: "Education (МОН)" },
    eiks: [MON_EIK],
  },
  transport: {
    id: "transport",
    label: { bg: "Транспорт (МТС)", en: "Transport (МТС)" },
    eiks: [TRANSPORT_EIK],
  },
  administration: {
    id: "administration",
    label: { bg: "Администрация (МЕУ)", en: "Administration (МЕУ)" },
    eiks: [ADMIN_EIK],
  },
  energy: {
    id: "energy",
    label: { bg: "Енергетика (БЕХ)", en: "Energy (БЕХ)" },
    eiks: ENERGY_SECTOR_EIKS,
  },
};

export const getSectorBrowsePack = (
  id: string | null | undefined,
): SectorBrowsePack | null => (id ? (SECTOR_BROWSE_PACKS[id] ?? null) : null);
