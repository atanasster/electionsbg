// Label resolution for the EU-funds political-economy join — officials side.
// Mirrors `relationLabel.ts` (the MP side) but resolves the category + role
// vocabulary used by the officials data (cabinet / agency_head / governor /
// mayor / deputy_mayor / council_chair / councillor / chief_architect).

import type { TFunction } from "i18next";

const CATEGORY: Record<string, { en: string; bgKey: string }> = {
  cabinet: { en: "Cabinet", bgKey: "officials_cat_cabinet" },
  deputy_minister: {
    en: "Deputy minister",
    bgKey: "officials_cat_deputy_minister",
  },
  agency_head: { en: "Agency head", bgKey: "officials_cat_agency_head" },
  regional_governor: {
    en: "Regional governor",
    bgKey: "officials_cat_regional_governor",
  },
  mayor: { en: "Mayor", bgKey: "officials_cat_mayor" },
  deputy_mayor: { en: "Deputy mayor", bgKey: "officials_cat_deputy_mayor" },
  council_chair: {
    en: "Council chair",
    bgKey: "officials_cat_council_chair",
  },
  councillor: { en: "Councillor", bgKey: "officials_cat_councillor" },
  chief_architect: {
    en: "Chief architect",
    bgKey: "officials_cat_chief_architect",
  },
};

export const officialCategoryLabel = (
  t: TFunction,
  category: string,
): string => {
  const k = CATEGORY[category];
  if (!k) return category;
  return t(k.bgKey) || k.en;
};

const TR_ROLE: Record<string, { en: string; bgKey: string }> = {
  manager: { en: "manager", bgKey: "procurement_rel_manager" },
  branch_manager: {
    en: "branch manager",
    bgKey: "procurement_rel_branch_manager",
  },
  director: { en: "director", bgKey: "procurement_rel_director" },
  partner: { en: "partner", bgKey: "procurement_rel_partner" },
  representative: {
    en: "representative",
    bgKey: "procurement_rel_representative",
  },
  liquidator: { en: "liquidator", bgKey: "procurement_rel_liquidator" },
  procurator: { en: "procurator", bgKey: "procurement_rel_procurator" },
};

export const officialRoleLabel = (
  t: TFunction,
  role: { source: string; trRole?: string | null; shareSize?: string | null },
): string => {
  if (role.source === "declaration") {
    const base = t("officials_role_declared_stake") || "declared stake";
    if (role.shareSize) return `${base} ${role.shareSize}`;
    return base;
  }
  if (role.trRole) {
    const k = TR_ROLE[role.trRole];
    return k ? t(k.bgKey) || k.en : role.trRole;
  }
  return role.source;
};

// Combine an official's multiple roles (e.g. partner + manager) into one
// dedup'd label list.
export const summarizeOfficialRoles = (
  t: TFunction,
  roles: Array<{
    source: string;
    trRole?: string | null;
    shareSize?: string | null;
  }>,
): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of roles) {
    const lab = officialRoleLabel(t, r);
    if (seen.has(lab)) continue;
    seen.add(lab);
    out.push(lab);
  }
  return out.join(", ");
};
