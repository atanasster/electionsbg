// Translate a raw Търговски регистър role code (manager, director, partner,
// procurator, sole_owner, actual_owner, representative, liquidator,
// branch_manager, …) to its localized label via the shared `tr_role_*` i18n
// keys. Falls back to the raw code when no translation exists.

export const trRoleLabel = (
  role: string | null | undefined,
  t: (k: string) => string,
): string => {
  if (!role) return "—";
  const key = `tr_role_${role}`;
  const translated = t(key);
  return translated && translated !== key ? translated : role;
};
