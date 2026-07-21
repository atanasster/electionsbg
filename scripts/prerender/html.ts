// Escape a string for safe interpolation into prerendered HTML (bodyHtml,
// attributes). Shared by the prerender route/body builders so there is one
// implementation of the primitive.
export const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
