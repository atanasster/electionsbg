// Sector-dashboard registry — the config that drives the generic
// SectorDashboardScreen (/sector/:id). Each entry gives a sector a proper
// dashboard-style landing page: a group KPI overview rolled up over the
// sector's awarder EIK-set (via useAwarderGroupModel → awarder_group_model)
// plus a SectorAwardersTile listing every member institution, each deep-linking
// to its own /awarder/:eik page.
//
// This graduates the sectors that previously deep-linked straight to a single
// awarder page (health, roads, revenue, customs, social, edu, agri, transport,
// administration). The already-bespoke dashboards (water/defense/culture/
// judiciary/pensions/education) keep their own richer screens and are NOT listed
// here — the sectors hub still links them to their vanity paths.
//
// Members carry an inline canonical name so the awarders tile needs no fetch to
// label its chips (mirrors DefenseAwardersTile / MO_ENTITIES). Single-member
// sectors render one chip; the awarder page behind it holds the full pack.

import { lazy, type ComponentType } from "react";
import { API_EIK } from "@/lib/roadAttributes";
import { NOI_EIK } from "@/lib/noiBenchmarks";
import { NZOK_EIK } from "@/lib/nzokBenchmarks";
import { MON_EIK } from "@/lib/monBenchmarks";
import { NAP_EIK } from "@/lib/napReferenceData";
import { CUSTOMS_EIK } from "@/lib/customsReferenceData";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";
import { BEH_EIK } from "@/lib/energyReferenceData";

export interface SectorMember {
  eik: string;
  name: { bg: string; en: string };
  /** Optional sub-group label key for the awarders tile (e.g. defense universes). */
  group?: { bg: string; en: string };
}

export interface SectorDashboardConfig {
  /** Matches the sectorRegistry id and (where present) the SECTOR_BROWSE_PACKS key. */
  id: string;
  /** i18n keys reused from the sector registry (short tile label + description). */
  titleKey: string;
  descKey: string;
  /** Cyrillic agency acronym — same in both languages. */
  agency: string;
  /** The lead/consolidated awarder EIK — the "whole group" link + hero. */
  leadEik: string;
  /** Every awarder in the sector (lead first). One chip each → /awarder/:eik. */
  members: SectorMember[];
  /** ?sector= browse-pack id for the "all sector contracts" footer link.
   *  Defaults to `id` when omitted. Only resolves if registered in
   *  SECTOR_BROWSE_PACKS (and allow-listed server-side). */
  browsePackId?: string;
  /** Optional bespoke thematic tiles rendered between the KPI row and the
   *  awarders tile (curated, sector-specific data). None of the graduating
   *  sectors ship one yet. */
  ThematicTiles?: ComponentType;
}

// Awarder EIKs given as literals where no reference-data export exists yet.
// Exported so sibling surfaces (sectorPacks browse-pack set) reuse them rather
// than re-hardcoding the same digits.
export const TRANSPORT_EIK = "000695388"; // Министерство на транспорта и съобщенията (МТС)
export const ADMIN_EIK = "180680495"; // Министерство на електронното управление (МЕУ)

// Energy is the first sector to ship bespoke ThematicTiles (the invisible-€14bn
// call-out, single-bid gauge, per-unit spend). Lazy so the config module — pulled
// in wherever sectorPacks is imported — doesn't eager-load react-query/lucide.
const EnergyThematicTiles = lazy(() =>
  import("./energy/EnergyThematicTiles").then((m) => ({
    default: m.EnergyThematicTiles,
  })),
);

export const SECTOR_DASHBOARDS: Record<string, SectorDashboardConfig> = {
  health: {
    id: "health",
    titleKey: "sector_health_title",
    descKey: "sector_health_desc",
    agency: "НЗОК",
    leadEik: NZOK_EIK,
    browsePackId: "nzok",
    members: [
      {
        eik: NZOK_EIK,
        name: {
          bg: "Национална здравноосигурителна каса",
          en: "National Health Insurance Fund",
        },
      },
    ],
  },
  roads: {
    id: "roads",
    titleKey: "sector_roads_title",
    descKey: "sector_roads_desc",
    agency: "АПИ",
    leadEik: API_EIK,
    browsePackId: "roads",
    members: [
      {
        eik: API_EIK,
        name: {
          bg: "Агенция „Пътна инфраструктура“",
          en: "Road Infrastructure Agency",
        },
      },
    ],
  },
  transport: {
    id: "transport",
    titleKey: "sector_transport_title",
    descKey: "sector_transport_desc",
    agency: "МТС",
    leadEik: TRANSPORT_EIK,
    browsePackId: "transport",
    members: [
      {
        eik: TRANSPORT_EIK,
        name: {
          bg: "Министерство на транспорта и съобщенията",
          en: "Ministry of Transport and Communications",
        },
      },
    ],
  },
  social: {
    id: "social",
    titleKey: "sector_social_title",
    descKey: "sector_social_desc",
    agency: "НОИ",
    leadEik: NOI_EIK,
    browsePackId: "noi",
    members: [
      {
        eik: NOI_EIK,
        name: {
          bg: "Национален осигурителен институт",
          en: "National Social Security Institute",
        },
      },
    ],
  },
  revenue: {
    id: "revenue",
    titleKey: "sector_revenue_title",
    descKey: "sector_revenue_desc",
    agency: "НАП",
    leadEik: NAP_EIK,
    browsePackId: "revenue",
    members: [
      {
        eik: NAP_EIK,
        name: {
          bg: "Национална агенция за приходите",
          en: "National Revenue Agency",
        },
      },
    ],
  },
  customs: {
    id: "customs",
    titleKey: "sector_customs_title",
    descKey: "sector_customs_desc",
    agency: "АМ",
    leadEik: CUSTOMS_EIK,
    browsePackId: "customs",
    members: [
      {
        eik: CUSTOMS_EIK,
        name: { bg: "Агенция „Митници“", en: "Customs Agency" },
      },
    ],
  },
  administration: {
    id: "administration",
    titleKey: "sector_admin_title",
    descKey: "sector_admin_desc",
    agency: "МЕУ",
    leadEik: ADMIN_EIK,
    browsePackId: "administration",
    members: [
      {
        eik: ADMIN_EIK,
        name: {
          bg: "Министерство на електронното управление",
          en: "Ministry of e-Government",
        },
      },
    ],
  },
  edu: {
    id: "edu",
    titleKey: "sector_edu_title",
    descKey: "sector_edu_desc",
    agency: "МОН",
    leadEik: MON_EIK,
    browsePackId: "edu",
    members: [
      {
        eik: MON_EIK,
        name: {
          bg: "Министерство на образованието и науката",
          en: "Ministry of Education and Science",
        },
      },
    ],
  },
  agri: {
    id: "agri",
    titleKey: "sector_agri_title",
    descKey: "sector_agri_desc",
    agency: "ДФЗ",
    leadEik: AGRI_PAYER_EIK,
    browsePackId: "agri",
    members: [
      {
        eik: AGRI_PAYER_EIK,
        name: {
          bg: "Държавен фонд „Земеделие“",
          en: "State Fund Agriculture",
        },
      },
    ],
  },
  // Енергетика — the БЕХ state-energy group. Unlike the single-institution
  // sectors above, `members` IS the whole group (9 EIKs) so the KPI rollup folds
  // every subsidiary; БЕХ leads (its /awarder page suppresses the pack and links
  // here, and it awards €0 — the KPIs are the folded group, not the lead).
  // EIKs measured from the corpus (energyReferenceData.ts, 2026-07-12); the ЕСО
  // branch 1752013040 (~€64K) is folded server-side, not a member chip.
  energy: {
    id: "energy",
    titleKey: "sector_energy_title",
    descKey: "sector_energy_desc",
    agency: "БЕХ",
    leadEik: BEH_EIK,
    browsePackId: "energy",
    ThematicTiles: EnergyThematicTiles,
    members: [
      {
        eik: BEH_EIK,
        name: {
          bg: "Български енергиен холдинг",
          en: "Bulgarian Energy Holding",
        },
        group: { bg: "Холдинг", en: "Holding" },
      },
      {
        eik: "106513772",
        name: { bg: "АЕЦ Козлодуй", en: "Kozloduy NPP" },
        group: { bg: "Ядрена енергия", en: "Nuclear" },
      },
      {
        eik: "123531939",
        name: { bg: "ТЕЦ Марица изток 2", en: "Maritsa East 2 TPP" },
        group: { bg: "Въглища", en: "Coal" },
      },
      {
        eik: "833017552",
        name: { bg: "Мини Марица-изток", en: "Mini Maritsa Iztok" },
        group: { bg: "Въглища", en: "Coal" },
      },
      {
        eik: "000649348",
        name: {
          bg: "Национална електрическа компания (НЕК)",
          en: "National Electric Company (NEK)",
        },
        group: { bg: "ВЕЦ и търговия", en: "Hydro & trading" },
      },
      {
        eik: "106588180",
        name: { bg: "ВЕЦ Козлодуй", en: "Kozloduy HPP" },
        group: { bg: "ВЕЦ и търговия", en: "Hydro & trading" },
      },
      {
        eik: "175201304",
        name: {
          bg: "Електроенергиен системен оператор (ЕСО)",
          en: "Electricity System Operator (ESO)",
        },
        group: { bg: "Електропренос", en: "Power grid" },
      },
      {
        eik: "175203478",
        name: { bg: "Булгартрансгаз", en: "Bulgartransgaz" },
        group: { bg: "Природен газ", en: "Natural gas" },
      },
      {
        eik: "175203485",
        name: { bg: "Булгаргаз", en: "Bulgargaz" },
        group: { bg: "Природен газ", en: "Natural gas" },
      },
    ],
  },
};

export const getSectorDashboard = (
  id: string | null | undefined,
): SectorDashboardConfig | null =>
  id ? (SECTOR_DASHBOARDS[id] ?? null) : null;

// Reverse lookup: the sector dashboard an awarder EIK leads. Used by the awarder
// page to (a) suppress the domain pack — its disbursement content now lives on
// the sector dashboard, leaving the awarder page as the institution's own ЗОП
// financials — and (b) link across to that dashboard.
const DASHBOARD_BY_LEAD_EIK: Record<string, SectorDashboardConfig> =
  Object.fromEntries(
    Object.values(SECTOR_DASHBOARDS).map((c) => [c.leadEik, c]),
  );

export const sectorDashboardForLeadEik = (
  eik: string | null | undefined,
): SectorDashboardConfig | null =>
  eik ? (DASHBOARD_BY_LEAD_EIK[eik] ?? null) : null;

/** Every EIK in a sector — the input to useAwarderGroupModel + the ?sector= set. */
export const sectorMemberEiks = (c: SectorDashboardConfig): string[] =>
  c.members.map((m) => m.eik);

export const SECTOR_DASHBOARD_IDS = Object.keys(SECTOR_DASHBOARDS);
