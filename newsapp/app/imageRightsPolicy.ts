const HOME_IMAGE_PERMITTED_STATUSES = new Set([
  "publisher_permission",
  "licensed",
  "cc",
  "public_domain",
  "official_reuse_policy",
]);

/** Runtime allowlist for untyped bundle data and every home image renderer. */
export const isPermittedHomeImageStatus = (status: unknown): boolean =>
  typeof status === "string" && HOME_IMAGE_PERMITTED_STATUSES.has(status);
