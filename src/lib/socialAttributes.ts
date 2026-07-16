// Социално подпомагане (МТСП/АСП) procurement classification — the buyer-specific
// bit of the social sector pack. Like the МВР/МО packs the social group has no
// bespoke geometry: the model IS the generic per-category / per-supplier / per-year
// awarder model, so this file is a classifier (CPV division → what the social
// agencies buy) plus a thin wrapper over buildAwarderModel. Mirrors
// securityAttributes.ts / transportAttributes.ts.
//
// What the group buys, grounded in the corpus: АСП's eligibility/IT systems (the
// biggest line — Сиенсис, ТехноЛогика), социални услуги (топъл обяд catering,
// патронажна грижа, личен асистент logistics), building works on social-service
// premises, EU-project consultancy/TA, and office supplies. Contracts with no CPV
// fall to the "other" sink.

import type { ProcurementContract } from "@/data/dataTypes";
import {
  buildAwarderModel,
  buildAwarderModelFromAggregates,
  isSpendRow,
  type AwarderModel,
  type AwarderCategoryAgg,
  type GroupModelPayload,
  type SectorClassifier,
} from "./awarderModel";

export type SocialCategory =
  | "it_systems" // 72/48/32 — ИТ, софтуер, комуникации (АСП eligibility systems)
  | "social_services" // 85/55/98 — социални услуги, топъл обяд, патронажна грижа
  | "construction" // 45 — строителство/ремонт на социална инфраструктура
  | "consulting" // 79/73/71 — консултантски, TA по проекти, инженеринг
  | "supplies" // 30/22/15/18/39 — офис, печат, храна, облекло, обзавеждане
  | "other";

export type SocialCategoryAgg = AwarderCategoryAgg<SocialCategory>;
export type SocialModel = AwarderModel<SocialCategory>;

const startsWithAny = (s: string, prefixes: string[]) =>
  prefixes.some((p) => s.startsWith(p));

/** CPV division → what the social agencies buy, on the two-digit division only. */
export const categoryOfCpv = (cpv: string | undefined): SocialCategory => {
  const c = String(cpv ?? "").replace(/\s/g, "");
  if (!c) return "other";
  const div = c.slice(0, 2);
  // IT, software, telecoms (the АСП eligibility/payment systems — the biggest line).
  if (startsWithAny(div, ["72", "48", "32"])) return "it_systems";
  // Social & health-adjacent services: social work (85), catering / топъл обяд (55),
  // other community/social services (98).
  if (startsWithAny(div, ["85", "55", "98"])) return "social_services";
  // Construction & building works (45).
  if (div === "45") return "construction";
  // Consultancy / EU-project TA (79), R&D (73), architecture & engineering (71).
  if (startsWithAny(div, ["79", "73", "71"])) return "consulting";
  // Office machines/supplies (30), print (22), food (15), clothing (18), furniture (39).
  if (startsWithAny(div, ["30", "22", "15", "18", "39"])) return "supplies";
  return "other";
};

const CATEGORY_LABEL: Record<SocialCategory, { bg: string; en: string }> = {
  it_systems: { bg: "ИТ и системи", en: "IT & systems" },
  social_services: {
    bg: "Социални услуги (топъл обяд, грижа)",
    en: "Social services (meals, care)",
  },
  construction: { bg: "Строителство и ремонт", en: "Construction & repair" },
  consulting: { bg: "Консултантски и проекти", en: "Consultancy & projects" },
  supplies: { bg: "Офис, печат и материали", en: "Office, print & supplies" },
  other: { bg: "Друго", en: "Other" },
};

export const categoryLabel = (id: SocialCategory, lang: string): string =>
  (lang === "bg" ? CATEGORY_LABEL[id]?.bg : CATEGORY_LABEL[id]?.en) ?? id;

/** The CPV divisions each category is built from — for deep-linking a category to
 *  `/procurement/contracts?cpv=<divs>` (the browse ORs the prefixes), reproducing
 *  the tile's split EXACTLY. Must mirror `categoryOfCpv` above. `other` (the no-CPV
 *  sink) has no divisions, so it isn't deep-linkable. */
const CATEGORY_CPV_DIVS: Record<SocialCategory, string[]> = {
  it_systems: ["72", "48", "32"],
  social_services: ["85", "55", "98"],
  construction: ["45"],
  consulting: ["79", "73", "71"],
  supplies: ["30", "22", "15", "18", "39"],
  other: [],
};

export const categoryCpvDivs = (id: SocialCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const socialClassifier: SectorClassifier<SocialCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "it_systems",
    "social_services",
    "construction",
    "consulting",
    "supplies",
  ],
  sink: "other",
};

/** Build the social model from raw rows. Only tag='contract' rows carry money
 *  (awards/amendments would double-count), matching the awarder rollup the host shows. */
export const buildSocialModel = (rows: ProcurementContract[]): SocialModel =>
  buildAwarderModel(
    rows.filter((c) => isSpendRow(c, true)),
    socialClassifier,
  );

/** Same model, folded from the server's group aggregates (awarder-group-model)
 *  instead of raw rows — the tag='contract' filter lives in SQL there. */
export const buildSocialModelFromAggregates = (
  p: GroupModelPayload,
): SocialModel => buildAwarderModelFromAggregates(p, socialClassifier);
