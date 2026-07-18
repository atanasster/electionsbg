// Label resolution for MP↔beneficiary relations on the EU-funds views.
// Reuses the shared `procurement_rel_*` i18n keys (the relation vocabulary —
// manager, director, declared stake … — is the same set, sourced from the
// Commerce Registry + Court-of-Audit declarations).

import type { TFunction } from "i18next";
import type { FundsMpRelation } from "./types";

const KEY: Record<string, { en: string; bgKey: string }> = {
  partner: { en: "partner", bgKey: "procurement_rel_partner" },
  manager: { en: "manager", bgKey: "procurement_rel_manager" },
  branch_manager: {
    en: "branch manager",
    bgKey: "procurement_rel_branch_manager",
  },
  director: { en: "director", bgKey: "procurement_rel_director" },
  actual_owner: { en: "actual owner", bgKey: "procurement_rel_actual_owner" },
  representative: {
    en: "representative",
    bgKey: "procurement_rel_representative",
  },
  liquidator: { en: "liquidator", bgKey: "procurement_rel_liquidator" },
  procurator: { en: "procurator", bgKey: "procurement_rel_procurator" },
  stake: { en: "declared stake", bgKey: "procurement_rel_stake" },
  sole_owner: { en: "sole owner", bgKey: "procurement_rel_sole_owner" },
  trustee: { en: "trustee", bgKey: "procurement_rel_trustee" },
  verifier: { en: "audit commission", bgKey: "procurement_rel_verifier" },
  ngo_board: { en: "NGO board member", bgKey: "procurement_rel_ngo_board" },
  ngo_representative: {
    en: "NGO representative",
    bgKey: "procurement_rel_ngo_representative",
  },
};

const relationLabel = (t: TFunction, rel: FundsMpRelation): string => {
  const k = KEY[rel.kind];
  const base = k ? t(k.bgKey) || k.en : rel.kind;
  if (rel.kind === "stake" && rel.shareSize) return `${base} ${rel.shareSize}`;
  if (rel.isCurrent === false) {
    return `${base} (${t("procurement_rel_former") || "former"})`;
  }
  return base;
};

// Dedupe + collapse a beneficiary's relation list into one readable string.
export const summarizeFundsRelations = (
  t: TFunction,
  relations: FundsMpRelation[],
): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of relations) {
    const lab = relationLabel(t, r);
    if (seen.has(lab)) continue;
    seen.add(lab);
    out.push(lab);
  }
  return out.join(", ");
};
