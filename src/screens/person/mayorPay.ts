import type { ProfileRole } from "./usePersonProfile";

/**
 * The local-election and municipal-officials sources both describe a
 * municipality mayor. Keep the selection semantic rather than source-bound;
 * the rendered card separately verifies that its current API mayor is the
 * profile being viewed.
 */
export const mayorPayObshtinaForRoles = (
  roles: readonly ProfileRole[],
): string | null =>
  roles.find(
    (role) =>
      role.role === "mayor" &&
      role.placeKind === "obshtina" &&
      role.placeCode,
  )?.placeCode ?? null;
