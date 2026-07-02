// Decode the handful of HTML entities that leak into TR names from the source
// register (e.g. `НАЦИОНАЛНА КОМПАНИЯ &quot;ЖЕЛЕЗОПЪТНА ИНФРАСТРУКТУРА&quot;`).
// Display-side safety net; the underlying data still carries the entities.

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&amp;": "&",
  "&#039;": "'",
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

export const decodeEntities = (s: string | null | undefined): string => {
  if (!s) return s ?? "";
  return s
    .replace(
      /&quot;|&amp;|&#0?39;|&apos;|&lt;|&gt;|&nbsp;/g,
      (m) => ENTITIES[m] ?? m,
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
};
