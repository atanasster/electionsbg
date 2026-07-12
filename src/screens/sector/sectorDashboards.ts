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

import type { ComponentType } from "react";
import { API_EIK } from "@/lib/roadAttributes";
import { NOI_EIK } from "@/lib/noiBenchmarks";
import { NZOK_EIK } from "@/lib/nzokBenchmarks";
import { MON_EIK } from "@/lib/monBenchmarks";
import { NAP_EIK } from "@/lib/napReferenceData";
import { CUSTOMS_EIK } from "@/lib/customsReferenceData";
import { AGRI_PAYER_EIK } from "@/data/agri/constants";

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
