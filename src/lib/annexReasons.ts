// Pure (no imports) so the roads hub generator can use it under tsx.

/** ЗОП чл. 116 modification grounds, as `procurement_annexes.change_reason`
 *  carries them (seven register strings). Coded so the blob carries no prose;
 *  the page labels them. `option` is ал. 1 т. 1 — a change the contract itself
 *  provided for — and is the one the ×1.5 cluster is made of (plan R9). */
export type AnnexReasonCode =
  | "option"
  | "unforeseen"
  | "additional"
  | "non_substantial"
  | "replacement"
  | "de_minimis"
  | "other";

export const annexReasonCode = (reason: string | null): AnnexReasonCode => {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("клаузи за преразглеждане") || r.includes("опции"))
    return "option";
  if (r.includes("не би могъл да предвиди")) return "unforeseen";
  if (r.includes("допълнителни работи")) return "additional";
  if (r.includes("несъществени")) return "non_substantial";
  if (r.includes("нов изпълнител")) return "replacement";
  if (r.includes("de minimis") || r.includes("минимална стойност"))
    return "de_minimis";
  return "other";
};
