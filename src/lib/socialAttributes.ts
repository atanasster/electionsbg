// Социално подпомагане (МТСП/АСП) procurement classification — the buyer-specific
// bit of the social sector pack. Like the МВР/МО packs the social group has no
// bespoke geometry: the model IS the generic per-category / per-supplier / per-year
// awarder model, so this file is a classifier (CPV division → what the social
// agencies buy) plus a thin wrapper over buildAwarderModel. Mirrors
// securityAttributes.ts / transportAttributes.ts.
//
// What the group buys, grounded in the corpus: материална помощ (the largest line by
// far — FEAD/ОПХ food parcels), административни и стопански услуги, АСП's
// eligibility/IT systems and the telecoms that carry them (Сиенсис, ТехноЛогика,
// БТК), office supplies, building works on social-service premises, and социални
// услуги (топъл обяд catering, патронажна грижа). Contracts with no CPV, or with one
// outside these divisions, fall to the "other" sink.
//
// ⚠ DIVISION 79 IS NOT "CONSULTANCY", and this file used to say it was. CPV 79 is
// *business services incl. printing and security*, and measured over this group's
// €78.5M in it, the consultancy proper (7940/7941/7931) is ~€7.1M: the rest is a
// €33.0M financial-instrument transfer (7942), €10.1M of невъоръжена физическа
// охрана (7971), €6.0M of recruitment (7960), €6.0M of managed print (7982) and
// €5.3M of events (7995). Labelled „Консултантски и проекти" it rendered as
// „a quarter of the social agencies' procurement goes to consultants" — arithmetically
// exact and false as a sentence. The name is borrowed from regionalAttributes.ts,
// which labels division 79 the same way (its category is wider — 79/75/90/98/85 —
// so the two are not the same rule, only the same wording); environmentAttributes.ts
// calls its equivalent „услуги".
//
// ⚠ DIVISION 15 IS NOT "OFFICE SUPPLIES" EITHER, and that was the bigger half of the
// same defect. €59.0M of division 15 — 62% of what „Офис, печат и материали" used to
// hold, and the single largest line in this group — is АСП buying FOOD under the
// FEAD/ОПХ „процедура за директно предоставяне на безвъзмездна финансова помощ":
// стерилизирани месни консерви, леща, захар, грах, фасул, delivered as parcels to
// households. Filed under stationery it both mislabelled €59M and made „Социални
// услуги" read €5.0M / 1.5%, understating the group's social-mission procurement by
// an order of magnitude. It now has its own `material_aid` category.
//
// Division 15 only, deliberately: the same programme also buys hygiene items under
// division 33 (паста за зъби €5.6M, ориз €2.1M, пелени, дамски превръзки — ~€8.1M of
// the division's €13.2M), but 33 also carries a €5.0M control system and vision aids,
// and this classifier keys on the two-digit division. Sweeping all of 33 in would
// relabel €5.1M of equipment as material aid to gain €8.1M — so the hygiene residue
// stays in the "other" sink, which the tile's footnote declares as "no CPV code or
// outside these categories" rather than pretending to be exhaustive.
// Audit 2026-08-15, docs/plans/social-sector-audit-v1.md §2.

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
  | "material_aid" // 15 — храна по FEAD/ОПХ, раздавана на домакинства
  | "it_systems" // 72/48/32/64 — ИТ, софтуер, комуникационно оборудване И телеком услуги
  | "social_services" // 85/55/98 — социални услуги, топъл обяд, патронажна грижа
  | "construction" // 45 — строителство/ремонт на социална инфраструктура
  | "admin_services" // 79/73/71 — административни, стопански, охрана, печат, инженеринг
  | "supplies" // 30/22/18/39 — офис, печат, облекло, обзавеждане
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
  // Food (15) — the FEAD/ОПХ parcels. FIRST, because it is the biggest line and the
  // one a reader is most likely to mistake for procurement of the agency's own
  // supplies. See the header.
  if (div === "15") return "material_aid";
  // IT, software, telecom EQUIPMENT (32) and telecom SERVICES (64) — the АСП
  // eligibility/payment systems and the network they run on. 64 belongs beside 32
  // rather than in the sink: БТК is the group's #3 supplier at ~€20M and 71 of its
  // 81 contracts are division 64, so splitting equipment from service put one
  // vendor's own spend on two sides of the chart and made "Друго" the category it
  // led.
  if (startsWithAny(div, ["72", "48", "32", "64"])) return "it_systems";
  // Social & health-adjacent services: social work (85), catering / топъл обяд (55),
  // other community/social services (98).
  if (startsWithAny(div, ["85", "55", "98"])) return "social_services";
  // Construction & building works (45).
  if (div === "45") return "construction";
  // Business & administrative services (79 — incl. security, print, recruitment and
  // events, NOT just consultancy: see the header), R&D (73), architecture &
  // engineering (71).
  if (startsWithAny(div, ["79", "73", "71"])) return "admin_services";
  // Office machines/supplies (30), print (22), clothing (18), furniture (39). Food
  // (15) is NOT here — it is material aid, handled above.
  if (startsWithAny(div, ["30", "22", "18", "39"])) return "supplies";
  return "other";
};

const CATEGORY_LABEL: Record<SocialCategory, { bg: string; en: string }> = {
  material_aid: {
    bg: "Материална помощ (храна по ОПХ)",
    en: "Material aid (FEAD food)",
  },
  it_systems: { bg: "ИТ и системи", en: "IT & systems" },
  social_services: {
    bg: "Социални услуги (топъл обяд, грижа)",
    en: "Social services (meals, care)",
  },
  construction: { bg: "Строителство и ремонт", en: "Construction & repair" },
  admin_services: {
    bg: "Административни и стопански услуги",
    en: "Administrative & business services",
  },
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
  material_aid: ["15"],
  it_systems: ["72", "48", "32", "64"],
  social_services: ["85", "55", "98"],
  construction: ["45"],
  admin_services: ["79", "73", "71"],
  supplies: ["30", "22", "18", "39"],
  other: [],
};

export const categoryCpvDivs = (id: SocialCategory): string[] =>
  CATEGORY_CPV_DIVS[id] ?? [];

const socialClassifier: SectorClassifier<SocialCategory> = {
  categoryOf: (c: ProcurementContract) => categoryOfCpv(c.cpv),
  order: [
    "material_aid",
    "admin_services",
    "it_systems",
    "supplies",
    "construction",
    "social_services",
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
