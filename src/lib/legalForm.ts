// Translate a raw Търговски регистър legal-form code (EOOD, AD, TPPD, ASSOC, …)
// to a Bulgarian label. The TR field is stored inconsistently — some rows carry
// Latin codes, some already carry the Bulgarian text — so unknown / already-
// Bulgarian values pass through unchanged.

const LEGAL_FORM_LABELS: Record<string, string> = {
  EOOD: "ЕООД",
  OOD: "ООД",
  AD: "АД",
  EAD: "ЕАД",
  ET: "ЕТ",
  SD: "СД",
  KD: "КД",
  KDA: "КДА",
  K: "Кооперация",
  ASSOC: "Сдружение",
  FOUND: "Фондация",
  KCHT: "Клон на чуждестранен търговец",
  EDPK: "ЕДПК", // еднолично дружество с променлив капитал
  DPK: "ДПК", // дружество с променлив капитал
  // TPPD = the TR code for state enterprises (държавни предприятия): АПИ-style
  // bodies, НКЖИ, ПУДООС, държавни предприятия по чл. 62 ал. 3 ТЗ.
  TPPD: "Държавно предприятие",
};

export const legalFormLabel = (
  form: string | null | undefined,
): string | null => {
  if (!form) return null;
  const key = form.trim().toUpperCase();
  return LEGAL_FORM_LABELS[key] ?? form;
};
