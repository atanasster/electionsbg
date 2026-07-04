// Bilingual display labels for КЗК (Комисия за защита на конкуренцията) appeal
// statuses + merits outcomes. The register publishes these in Bulgarian only;
// BG keeps the source term, EN gets a translation (falls back to the raw term
// for any value not in the map). Pure — used by the tender detail appeals tile.

const STATUS_EN: Record<string, string> = {
  "иницииран процес": "initiated",
  "открито производство": "proceedings opened",
  "приключено производство": "concluded",
  "отказано производство": "no proceedings (refused)",
  "прекратено производство": "terminated",
  "спряно производство": "suspended",
  обединено: "joined",
  "оставено без движение": "left without action",
};

const OUTCOME_EN: Record<string, string> = {
  уважена: "upheld",
  отхвърлена: "rejected",
  прекратена: "terminated",
  "без разглеждане": "dismissed",
  частично: "partially upheld",
};

const lookup = (
  raw: string | null | undefined,
  lang: string,
  map: Record<string, string>,
): string => {
  if (!raw) return "";
  // BG (incl. "bg-BG") shows the source term; EN and every other locale get the
  // translation. Matches the codebase's `startsWith("bg")` convention — the old
  // `!== "en"` wrongly showed raw Bulgarian to "en-US".
  if (lang.startsWith("bg")) return raw;
  return map[raw.trim().toLowerCase()] ?? raw;
};

/** КЗК proceeding status ("приключено производство" → "concluded" in EN). */
export const kzkStatusLabel = (
  raw: string | null | undefined,
  lang: string,
): string => lookup(raw, lang, STATUS_EN);

/** КЗК merits verdict ("уважена" → "upheld" in EN). */
export const kzkOutcomeLabel = (
  raw: string | null | undefined,
  lang: string,
): string => lookup(raw, lang, OUTCOME_EN);

/** Whether a КЗК merits outcome counts as "upheld" for risk purposes. Only a
 *  FULL uphold ("уважена") fires — "частично" (partial) is intentionally
 *  EXCLUDED, matching the SQL upheld_ocids / buyer_appeal_stats definitions.
 *  Trim + lowercase so a stray-cased value from any surface still matches. */
export const isUpheldOutcome = (raw: string | null | undefined): boolean =>
  (raw ?? "").trim().toLowerCase() === "уважена";
