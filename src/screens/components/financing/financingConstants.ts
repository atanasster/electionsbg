import { useTranslation } from "react-i18next";

// The four campaign-income sources, in a fixed order with fixed colours so the
// funding-mix bars, legend and tiles agree everywhere. These are source colours
// (not party colours) — deliberately distinct from any party palette.
export type SourceKey = "parties" | "donors" | "candidates" | "media";

export const SOURCE_KEYS: SourceKey[] = [
  "parties",
  "donors",
  "candidates",
  "media",
];

export const SOURCE_COLOR: Record<SourceKey, string> = {
  parties: "#3b82f6", // blue — self-funding (party / coalition members)
  donors: "#22c55e", // green — private donations
  candidates: "#f59e0b", // amber — candidate contributions
  media: "#a855f7", // purple — state media package
};

// i18n keys already present in the translation files (see FinancingTable).
export const SOURCE_LABEL_KEY: Record<SourceKey, string> = {
  parties: "parties",
  donors: "donors",
  candidates: "candidates",
  media: "media",
};

// Map the three ЕРИК agency-type strings to a short localised label.
export const useAgencyTypeLabel = () => {
  const { t } = useTranslation();
  return (type?: string): string => {
    if (!type) return "";
    if (type === "Рекламна") return t("agency_type_advertising");
    if (type === "Социологическа") return t("agency_type_polling");
    if (type.startsWith("За осъществяване")) return t("agency_type_pr");
    return type;
  };
};
