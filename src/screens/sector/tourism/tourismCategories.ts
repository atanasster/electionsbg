// CPV → campaign-category classifier for the Tourism sector (Министерство на
// туризма). Destination marketing is МТ's largest line, so — unlike the generic
// sector dashboard's single "all" bucket — the Tourism dashboard breaks the spend
// into what the money actually buys.
//
// ⚠️ THIS HEADER OWNS THE MEASURED SPLIT — the other tourism files reference it
// by name rather than restating it, since three full copies is how one came to be
// stale. Measured over the full 335-row / €28,780,437 corpus (2026-05-13):
// advertising 51.0% (€14,686,799), production 16.2%, other 11.8%, events 8.6%,
// digital 8.6%, research 3.8%.
//
// ⚠️ IT IS NOT „DOMINATED BY" MARKETING, and this header said so — against a
// stale 303-row / ~53% measurement — until the 2026-08-20 audit. That mattered
// because TourismSpendVsNightsTile's legend acted on it and labelled МТ's whole
// contract line „разход за реклама".
//
// ⚠️ TWO KNOWN LEAKS OUT OF `advertising`, and they are the reason any surface
// quoting this share must say „по CPV" rather than „about half" bare:
//   · CPV 39154100 → `production`: 44 contracts, €3,232,055 of trade-fair stands
//     („Intourmarket Москва, Русия" and siblings) — destination promotion by any
//     reader's definition;
//   · CPV 98000000 → `other`: 6 contracts, €693,802, titled „Заплащане на
//     наемната цена за атрактивни рекламни площи" — rented advertising space
//     landing in the sink because CPV 98 is unmapped. That is a fifth of the
//     `other` bucket, so „the remainder is purely operational" is not true either.
// Under the widest defensible reading (advertising ∪ events ∪ those two) the share
// is 73.3% against 51.0% here — 22 points apart. Do not remap either without
// reading all rows first; the cost of the current mapping is a declared basis, and
// the cost of a wrong remap is a share nobody can reconcile.
//
// `CampaignCategoriesTile` is the only place this share is DERIVED;
// TourismSpendVsNightsTile's caption restates it as prose, so a drift here
// silently falsifies that sentence too. sector_stats_tourism.data.test.ts pins
// the advertising share to a band for exactly that reason.
//
// Classification is by CPV ONLY (the same contract-shape the server group-model
// exposes), never by name/keyword.

import type { SectorClassifier } from "@/lib/awarderModel";
import type { ProcurementContract } from "@/data/dataTypes";

export type TourismCat =
  | "advertising"
  | "events"
  | "digital"
  | "research"
  | "production"
  | "other";

const digits = (s?: string): string => (s ?? "").replace(/[^0-9]/g, "");

export const tourismClassifier: SectorClassifier<TourismCat> = {
  categoryOf: (c: ProcurementContract): TourismCat => {
    const cpv = digits(c.cpv);
    if (!cpv) return "other";
    const d2 = cpv.slice(0, 2);
    const d4 = cpv.slice(0, 4);
    // Advertising & media: CPV 92 (broadcast / film / news agency) + 7934–7936
    // (advertising services). МТ's headline bucket.
    if (d2 === "92") return "advertising";
    if (d4 === "7934" || d4 === "7935" || d4 === "7936") return "advertising";
    // Events & promotion: 7995x (event / fair / congress organisation & services).
    if (d4 === "7995") return "events";
    // Research & consulting: 7930–7932 (market research), 7940–7942 (business
    // consulting), 71 (design / engineering).
    if (d4 === "7930" || d4 === "7931" || d4 === "7932") return "research";
    if (d4 === "7940" || d4 === "7941" || d4 === "7942") return "research";
    if (d2 === "71") return "research";
    // Digital & IT: IT services / software / telecom.
    if (d2 === "72" || d2 === "48" || d2 === "64") return "digital";
    // Production & materials: printing (7980), plus stands / furnishings /
    // equipment / printed matter.
    if (d4 === "7980") return "production";
    if (d2 === "39" || d2 === "30" || d2 === "22") return "production";
    return "other";
  },
  order: ["advertising", "events", "digital", "research", "production"],
  sink: "other",
};

export const TOURISM_CAT_LABELS: Record<
  TourismCat,
  { bg: string; en: string }
> = {
  advertising: { bg: "Реклама и медиа", en: "Advertising & media" },
  events: { bg: "Събития и промоция", en: "Events & promotion" },
  digital: { bg: "Дигитал и ИТ", en: "Digital & IT" },
  research: { bg: "Проучвания и консултации", en: "Research & consulting" },
  production: { bg: "Продукция и материали", en: "Production & materials" },
  other: { bg: "Оперативни и други", en: "Operational & other" },
};
