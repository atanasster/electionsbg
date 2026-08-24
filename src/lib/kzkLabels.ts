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
  отказана: "refused — no proceedings",
};

// BG overrides. Normally the BG label IS the source term, so this map is empty
// of everything the register itself prints. `отказана` is the exception: it is
// not a register term at all but a CODE derived from `status = 'отказано
// производство'` by kzk_effective_outcome() (042), so showing it raw would put a
// word the register never used in front of a Bulgarian reader. The refusal is of
// the PROCEEDINGS, not of the complaint, and the register's own phrase says so.
const OUTCOME_BG: Record<string, string> = {
  отказана: "отказано производство",
};

const lookup = (
  raw: string | null | undefined,
  lang: string,
  map: Record<string, string>,
  bgMap: Record<string, string> = {},
): string => {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  // BG (incl. "bg-BG") shows the source term; EN and every other locale get the
  // translation. Matches the codebase's `startsWith("bg")` convention — the old
  // `!== "en"` wrongly showed raw Bulgarian to "en-US".
  if (lang.startsWith("bg")) return bgMap[key] ?? raw;
  return map[key] ?? raw;
};

/** КЗК proceeding status ("приключено производство" → "concluded" in EN). */
export const kzkStatusLabel = (
  raw: string | null | undefined,
  lang: string,
): string => lookup(raw, lang, STATUS_EN);

/** КЗК merits verdict ("уважена" → "upheld" in EN).
 *
 *  ⚠️ Not every value here is a MERITS verdict. `отказана` is derived from the
 *  proceeding status by kzk_effective_outcome() (042) and means КЗК refused to
 *  open proceedings at all — the complaint was never heard. It is a terminal
 *  state, which is why it is published as an outcome rather than left blank on
 *  1,661 appeals; it is not a ruling on the substance, which is why
 *  isUpheldOutcome() and upheld_ocids ignore it. */
export const kzkOutcomeLabel = (
  raw: string | null | undefined,
  lang: string,
): string => lookup(raw, lang, OUTCOME_EN, OUTCOME_BG);

/** Whether a КЗК merits outcome counts as "upheld" for risk purposes. Only a
 *  FULL uphold ("уважена") fires — "частично" (partial) is intentionally
 *  EXCLUDED, matching the SQL upheld_ocids / buyer_appeal_stats definitions.
 *  Trim + lowercase so a stray-cased value from any surface still matches. */
export const isUpheldOutcome = (raw: string | null | undefined): boolean =>
  (raw ?? "").trim().toLowerCase() === "уважена";
