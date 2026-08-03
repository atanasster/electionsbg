// Escaping and number formatting for the prerendered bodies.
//
// A leaf module with NO imports, and that is load-bearing: bodyBuilders.ts
// imports SITE_URL from routes.ts, so anything routes.ts needs at
// module-EVALUATION time cannot live in bodyBuilders — the cycle leaves the
// import half-initialised and the call fails with "not a function". The build's
// evaluation order hid exactly that; a test importing bodyBuilders first did not.

// Escape a string for safe interpolation into prerendered HTML (bodyHtml,
// attributes). Shared by the prerender route/body builders so there is one
// implementation of the primitive.
export const escapeHtml = (s: string): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const escapeAttr = escapeHtml;

/** Bulgarian thousands grouping, with the NBSP normalised to a plain space. */
export const fmtInt = (n: number): string =>
  Math.round(n)
    .toLocaleString("bg-BG")
    .replace(/\u00A0/g, " ");

export const fmtIntEn = (n: number): string =>
  Math.round(n).toLocaleString("en-US");
