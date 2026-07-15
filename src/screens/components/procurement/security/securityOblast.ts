// Shared oblast-parse helper for the МВР per-oblast tiles (map + crime scatter),
// in its own module so the tiles can import it without tripping react-refresh's
// "components-only export" rule.

import { provinceToCanon } from "@/data/procurement/useProcurementByOblast";

/** Parse the oblast a regional МВР unit sits in, as a canonical oblast code.
 *  "ОДМВР — Пловдив" / "РДПБЗН — Пловдив" → the province after the dash;
 *  "Столична …" (СДВР / СДПБЗН) → Sofia city; national units → undefined. */
export const unitOblastCanon = (name: string): string | undefined => {
  if (/Столична/.test(name)) return provinceToCanon("София (столица)");
  const m = name.match(/—\s*(.+?)\s*$/);
  if (!m) return undefined;
  return provinceToCanon(m[1].trim());
};
