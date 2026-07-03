// Shared label resolution for MP↔contractor relations. Used by both the
// dashboard tile and the standalone procurement screen — keep one source of
// truth for the i18n keys so a relabel only happens in one place.

import type { TFunction } from "i18next";
import type {
  ProcurementRelation,
  ProcurementRelationKind,
} from "@/data/dataTypes";

const KEY: Record<ProcurementRelationKind, { en: string; bgKey: string }> = {
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
  ngo_board: { en: "NGO board member", bgKey: "procurement_rel_ngo_board" },
  ngo_representative: {
    en: "NGO representative",
    bgKey: "procurement_rel_ngo_representative",
  },
  trustee: { en: "trustee", bgKey: "procurement_rel_trustee" },
  verifier: { en: "audit commission", bgKey: "procurement_rel_verifier" },
};

export const relationLabel = (
  t: TFunction,
  rel: ProcurementRelation,
): string => {
  const k = KEY[rel.kind];
  if (!k) return rel.kind;
  const base = t(k.bgKey) || k.en;
  if (rel.kind === "stake" && rel.shareSize) {
    return `${base} ${rel.shareSize}`;
  }
  if (rel.isCurrent === false) {
    return `${base} (${t("procurement_rel_former") || "former"})`;
  }
  return base;
};

// Dedupe + collapse: if a (kind) appears multiple times, keep one. Used
// when an MP has e.g. (manager, partner, stake) — surface "manager,
// partner, declared stake" not "manager, manager, partner".
export const summarizeRelations = (
  t: TFunction,
  relations: ProcurementRelation[],
): string => {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const r of relations) {
    const lab = relationLabel(t, r);
    if (seen.has(lab)) continue;
    seen.add(lab);
    labels.push(lab);
  }
  return labels.join(", ");
};
