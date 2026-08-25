// The ONE icon/label mapping for a declared-asset category (090's `asset_category_*` i18n
// keys, MpAssetCategory in dataTypes.ts). Extracted from MpAssetsSummary, which used to keep
// its own private copy — a second map for the same nine categories is exactly the drift this
// module exists to end when a category is added or an icon changes.

import {
  AlertCircle,
  Banknote,
  Car,
  CreditCard,
  FileText,
  HandCoins,
  Home as HomeIcon,
  Landmark,
  TrendingUp,
} from "lucide-react";
import type { MpAssetCategory } from "@/data/dataTypes";

export const CATEGORY_ICONS: Record<
  MpAssetCategory,
  React.ComponentType<{ className?: string }>
> = {
  real_estate: HomeIcon,
  vehicle: Car,
  cash: Banknote,
  bank: Landmark,
  receivable: HandCoins,
  debt: AlertCircle,
  credit_limit: CreditCard,
  investment: TrendingUp,
  security: FileText,
};

export const CATEGORY_KEYS: Record<MpAssetCategory, string> = {
  real_estate: "asset_category_real_estate",
  vehicle: "asset_category_vehicle",
  cash: "asset_category_cash",
  bank: "asset_category_bank",
  receivable: "asset_category_receivable",
  debt: "asset_category_debt",
  credit_limit: "asset_category_credit_limit",
  investment: "asset_category_investment",
  security: "asset_category_security",
};

export const CATEGORY_FALLBACKS: Record<MpAssetCategory, string> = {
  real_estate: "Real estate",
  vehicle: "Vehicles",
  cash: "Cash",
  bank: "Bank accounts",
  receivable: "Receivables",
  debt: "Debts",
  credit_limit: "Credit limits",
  investment: "Investments",
  security: "Securities & shares",
};

/** Display order for a category-breakdown grid — real estate and liquid money first,
 *  liabilities last. */
export const CATEGORY_ORDER: MpAssetCategory[] = [
  "real_estate",
  "bank",
  "cash",
  "security",
  "investment",
  "vehicle",
  "receivable",
  "debt",
];
