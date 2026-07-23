// Presentation for the officials category buckets — icon, chip colour, label
// key — in ONE place.
//
// These lived as three parallel `Record<OfficialCategoryKind, …>` literals in
// OfficialProfileScreen and OfficialsAssetsScreen plus a switch for the labels.
// That was tolerable at four buckets. At 24 it is three chances to forget one,
// and the compiler only catches the omission, never the mismatch — two screens
// can disagree about what colour a regulator is and nothing complains.

import {
  Anchor,
  Banknote,
  Briefcase,
  Building2,
  Coins,
  Flag,
  Gavel,
  GraduationCap,
  HeartHandshake,
  Landmark,
  MapPin,
  Newspaper,
  Radio,
  Scale,
  Shield,
  ShieldCheck,
  Stethoscope,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { OfficialCategoryKind } from "@/data/dataTypes";
import {
  OFFICIAL_CATEGORY_LABELS,
  OFFICIAL_CATEGORY_ORDER,
} from "./officialCategoryLabels";

// Palette families, so related buckets read as related: amber = political
// executive, violet = independent bodies, slate = administration, red =
// security/defence, emerald = money/health, sky = external-facing.
const CHIP = {
  amber:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  amberSoft:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-100",
  orange:
    "border-orange-300 bg-orange-100 text-orange-900 dark:border-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
  violet:
    "border-violet-300 bg-violet-100 text-violet-900 dark:border-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  slate:
    "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100",
  red: "border-red-300 bg-red-100 text-red-900 dark:border-red-900 dark:bg-red-900/40 dark:text-red-100",
  emerald:
    "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  sky: "border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
} as const;

export type OfficialCategoryMeta = {
  icon: LucideIcon;
  chipClass: string;
  /** i18n key; the fallback is the English label. */
  labelKey: string;
  labelEn: string;
};

const PRESENTATION: Record<
  OfficialCategoryKind,
  { icon: LucideIcon; chipClass: string }
> = {
  cabinet: { icon: Landmark, chipClass: CHIP.amber },
  deputy_minister: { icon: Landmark, chipClass: CHIP.amberSoft },
  regional_governor: { icon: MapPin, chipClass: CHIP.orange },
  political_cabinet: { icon: Users, chipClass: CHIP.amberSoft },
  president: { icon: Flag, chipClass: CHIP.amber },
  mep: { icon: Flag, chipClass: CHIP.sky },
  party_leader: { icon: Users, chipClass: CHIP.amberSoft },
  regulator: { icon: Scale, chipClass: CHIP.violet },
  central_bank: { icon: Banknote, chipClass: CHIP.violet },
  audit_court: { icon: Scale, chipClass: CHIP.violet },
  secretary_general: { icon: Briefcase, chipClass: CHIP.slate },
  inspectorate: { icon: ShieldCheck, chipClass: CHIP.slate },
  agency_head: { icon: Briefcase, chipClass: CHIP.slate },
  regional_director: { icon: MapPin, chipClass: CHIP.slate },
  procurement_officer: { icon: Gavel, chipClass: CHIP.slate },
  eu_funds_controller: { icon: Coins, chipClass: CHIP.slate },
  revenue_agency: { icon: Banknote, chipClass: CHIP.emerald },
  security_service: { icon: Shield, chipClass: CHIP.red },
  military_command: { icon: Shield, chipClass: CHIP.red },
  social_fund: { icon: Coins, chipClass: CHIP.emerald },
  hospital_head: { icon: Stethoscope, chipClass: CHIP.emerald },
  state_enterprise: { icon: Building2, chipClass: CHIP.slate },
  diplomat: { icon: Anchor, chipClass: CHIP.sky },
  academic: { icon: GraduationCap, chipClass: CHIP.sky },
  media_head: { icon: Radio, chipClass: CHIP.sky },
  civil_society: { icon: HeartHandshake, chipClass: CHIP.sky },
  international: { icon: Newspaper, chipClass: CHIP.sky },
};

// Labels come from ./officialCategoryLabels (React-free, so the AI tools and
// the prerenderer share the same vocabulary); this module only adds the visual
// layer on top.
export const OFFICIAL_CATEGORY_META = Object.fromEntries(
  OFFICIAL_CATEGORY_ORDER.map((k) => [
    k,
    {
      ...PRESENTATION[k],
      labelKey: OFFICIAL_CATEGORY_LABELS[k].key,
      labelEn: OFFICIAL_CATEGORY_LABELS[k].en,
    },
  ]),
) as Record<OfficialCategoryKind, OfficialCategoryMeta>;

export { OFFICIAL_CATEGORY_ORDER };
