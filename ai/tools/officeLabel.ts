// How an office is NAMED to a reader, shared by every tool that renders one.
//
// The person layer gives a role two pieces: `person_source.label_bg` (what KIND of register
// the post comes from) and `person_role.role` (the post itself). For most sources the source
// label is the better sentence — "Народни представители", "Магистрати" — and the role is an
// internal code. For `local` it is the other way round: that source is labelled „Местни
// кандидати и съветници", which lumps a sitting mayor in with someone who merely ran, so the
// role has to win or 25,319 local roles narrate as a candidacy.
//
// This lives in its own module rather than in one of the tools because two of them need it —
// `personProfile` (ai/tools/person.ts) and `companyConnections` (ai/tools/people.ts) — and a
// reader who reaches the same official through a person question and through a company
// question must not be told two different job titles.
//
// ⚠️ ONLY `local` ROLES ARE OVERRIDDEN, and the map must stay exhaustive over that source.
// `officeLabel.test.ts` reads the live `person_role` corpus and fails on a `local` role with
// no entry here — village_mayor (8,301 roles) and rayon_mayor (46) were both narrating as the
// generic source label until this module existed.

export const LOCAL_ROLE_LABEL: Record<string, { bg: string; en: string }> = {
  mayor: { bg: "Кмет", en: "Mayor" },
  // Кмет на кметство — the mayor of a village/settlement inside a municipality, an elected
  // office in its own right and by far the most common `local` role after councillor.
  village_mayor: { bg: "Кмет на кметство", en: "Village mayor" },
  rayon_mayor: { bg: "Районен кмет", en: "District mayor" },
  councillor: { bg: "Общински съветник", en: "Municipal councillor" },
};

/** The office to show for one resolved role. `sourceLabel` is `person_source.label_bg`; it is
 *  Bulgarian in both languages, which is the established behaviour of every person surface. */
export const officeLabel = (
  source: string,
  role: string,
  sourceLabel: string,
  bg: boolean,
): string => {
  const rl = source === "local" ? LOCAL_ROLE_LABEL[role] : undefined;
  return rl ? (bg ? rl.bg : rl.en) : sourceLabel;
};
