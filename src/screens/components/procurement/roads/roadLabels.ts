// Shared bilingual labels for the road work-component taxonomy. Kept in its own
// (component-free) module so the tiles that render it stay fast-refresh-clean.

import type { WorkComponent } from "@/lib/roadAttributes";

export const COMPONENT_LABEL: Record<
  WorkComponent,
  { bg: string; en: string }
> = {
  tunnel: { bg: "Тунели", en: "Tunnels" },
  bridge: { bg: "Мостове и съоръжения", en: "Bridges & structures" },
  tolling_its: { bg: "Тол и ИТС", en: "Tolling & ITS" },
  markings_signs: { bg: "Маркировка и знаци", en: "Markings & signs" },
  safety_barriers: { bg: "Ограничителни системи", en: "Safety barriers" },
  lighting: { bg: "Осветление", en: "Lighting" },
  drainage: { bg: "Отводняване", en: "Drainage" },
  retaining: { bg: "Подпорни стени", en: "Retaining walls" },
  winter_maint: { bg: "Зимно поддържане", en: "Winter maintenance" },
  roadway: { bg: "Пътно платно (строеж/ремонт)", en: "Roadway (build/repair)" },
  design_supervision: {
    bg: "Проектиране и надзор",
    en: "Design & supervision",
  },
  other: { bg: "Друго", en: "Other" },
};
