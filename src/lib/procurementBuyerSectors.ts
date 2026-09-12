// Audited buyer rosters shared by analytics and browse screens; current membership.
import { WATER_SECTOR_EIKS } from "./vikReferenceData";
import { API_EIK } from "./roadsAwarder";
import { NOI_EIK } from "./noiBenchmarks";
import { HEALTH_SECTOR_EIKS } from "./healthReferenceData";
import { AGRI_SECTOR_EIKS } from "./agriReferenceData";
import { JUDICIAL_EIKS } from "./vssReferenceData";
import { DEFENSE_SECTOR_EIKS } from "./defenseReferenceData";
import { SECURITY_SECTOR_EIKS } from "./securityReferenceData";
import { NAP_EIK } from "./napReferenceData";
import { CUSTOMS_EIK } from "./customsReferenceData";
import { EDU_SECTOR_EIKS } from "./educationReferenceData";
import { TRANSPORT_SECTOR_EIKS } from "./transportReferenceData";
import { SOCIAL_SECTOR_EIKS } from "./socialReferenceData";
import { ENV_SECTOR_EIKS } from "./environmentReferenceData";
import { REGIONAL_SECTOR_EIKS } from "./regionalReferenceData";
import { ADMIN_SECTOR_EIKS } from "./administrationReferenceData";
import { ENERGY_SECTOR_EIKS } from "./energyReferenceData";
import { TOURISM_SECTOR_EIKS } from "./tourismReferenceData";
import { CULTURE_GROUP_EIKS } from "./kulturaReferenceData";
export interface ProcurementBuyerSector {
  id: string;
  label: { bg: string; en: string };
  eiks: readonly string[];
}
export const PROCUREMENT_BUYER_SECTORS: Record<string, ProcurementBuyerSector> =
  {
    water: {
      id: "water",
      label: { bg: "Води (ВиК)", en: "Water (ВиК)" },
      eiks: WATER_SECTOR_EIKS,
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
      label: {
        bg: "Здравеопазване (МЗ + НЗОК)",
        en: "Health (МЗ + НЗОК)",
      },
      eiks: [...HEALTH_SECTOR_EIKS],
    },
    agri: {
      id: "agri",
      label: { bg: "Земеделие (МЗХ)", en: "Agriculture (МЗХ)" },
      eiks: AGRI_SECTOR_EIKS,
    },
    judiciary: {
      id: "judiciary",
      label: { bg: "Съдебна власт (ВСС)", en: "Judiciary (ВСС)" },
      eiks: JUDICIAL_EIKS,
    },
    defense: {
      id: "defense",
      label: { bg: "Отбрана (МО)", en: "Defense (МО)" },
      eiks: DEFENSE_SECTOR_EIKS,
    },
    security: {
      id: "security",
      label: { bg: "Сигурност (МВР)", en: "Security (МВР)" },
      eiks: SECURITY_SECTOR_EIKS,
    },
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
      label: { bg: "Образование и наука", en: "Education & science" },
      eiks: EDU_SECTOR_EIKS,
    },
    transport: {
      id: "transport",
      label: { bg: "Транспорт (МТС)", en: "Transport (МТС)" },
      eiks: TRANSPORT_SECTOR_EIKS,
    },
    social: {
      id: "social",
      label: {
        bg: "Социално подпомагане (МТСП)",
        en: "Social assistance (МТСП)",
      },
      eiks: SOCIAL_SECTOR_EIKS,
    },
    environment: {
      id: "environment",
      label: { bg: "Околна среда (МОСВ)", en: "Environment (МОСВ)" },
      eiks: ENV_SECTOR_EIKS,
    },
    regional: {
      id: "regional",
      label: {
        bg: "Регионално развитие (МРРБ)",
        en: "Regional development (МРРБ)",
      },
      eiks: REGIONAL_SECTOR_EIKS,
    },
    administration: {
      id: "administration",
      label: {
        bg: "Администрация (е-управление)",
        en: "Administration (e-gov)",
      },
      eiks: [...ADMIN_SECTOR_EIKS],
    },
    energy: {
      id: "energy",
      label: { bg: "Енергетика (МЕ)", en: "Energy (МЕ)" },
      eiks: ENERGY_SECTOR_EIKS,
    },
    tourism: {
      id: "tourism",
      label: { bg: "Туризъм (МТ)", en: "Tourism (МТ)" },
      eiks: TOURISM_SECTOR_EIKS,
    },
    culture: {
      id: "culture",
      label: { bg: "Култура (МК)", en: "Culture (МК)" },
      eiks: CULTURE_GROUP_EIKS,
    },
  };
