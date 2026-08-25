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

/** Several roles at one company, localized and joined.
 *
 *  Postgres hands this shape back two ways and BOTH reach the UI. `tr_officers.roles`
 *  (via `place_companies`, 133) and `connection_between`'s `a_roles`/`b_roles` (008) are
 *  comma-separated STRINGS; `person_by_slug` (082) and `place_mp_companies` (151)
 *  `jsonb_agg` theirs into ARRAYS. Accepting either is what lets one definition serve
 *  every call site rather than each splitting for itself — which is how `/person/:name`'s
 *  connection check came to render a bare `partner,actual_owner` to a Bulgarian reader
 *  while sibling surfaces translated the identical value.
 *
 *  Every call site in the repo reads it: `PlaceCompaniesTile` and `PersonScreen`'s
 *  connection check on the string side, `PersonCompanies` and `PersonNgoSeats` on the
 *  array side, plus `CompanyConnectionCheck` — which had its own copy that mapped BEFORE
 *  filtering, so `trRoleLabel("")` returned `"—"`, survived `.filter(Boolean)`, and would
 *  have rendered an em dash as a role. (Note `person_roles` / `company_officers` in 008
 *  return a SCALAR `role text` despite the plural names; they are not array sources.)
 *
 *  Empty input returns "" rather than `trRoleLabel`'s "—": a caller with no roles at all
 *  is choosing whether to render the field, and an em dash inside a joined list would
 *  read as a role. */
export const trRoleList = (
  roles: string | string[] | null | undefined,
  t: (k: string) => string,
): string => {
  if (!roles) return "";
  const parts = (Array.isArray(roles) ? roles : roles.split(","))
    .map((r) => r.trim())
    .filter(Boolean);
  return parts.map((r) => trRoleLabel(r, t)).join(", ");
};
