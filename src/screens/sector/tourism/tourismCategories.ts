// CPV → campaign-category classifier for the Tourism sector (Министерство на
// туризма). МТ's ~€27M procurement is dominated by destination marketing, so —
// unlike the generic sector dashboard's single "all" bucket — the Tourism
// dashboard breaks the spend into what the money actually buys.
//
// Buckets validated against the real 303-row corpus
// (data/procurement/awarder_contracts/176789478.json): advertising ~53%,
// production ~11%, events ~9%, digital ~9%, research ~4%, other ~15% (the last a
// legitimate operational remainder — translation, security, insurance,
// utilities — not a misclassification). Classification is by CPV ONLY (the same
// contract-shape the server group-model exposes), never by name/keyword.

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
