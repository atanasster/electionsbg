// Region (oblast) labels — the one place that knows a region's name may ALREADY
// carry its tier word, so a caller adding its own does not double it.
//
// `regions.json` holds three kinds of region name:
//
//   1. plain          — "Благоевград" / "Blagoevgrad": the caller supplies the
//                       tier word ("обл. Благоевград", "област Благоевград").
//   2. prefixed       — "обл. Пловдив" / "prov. Plovdiv": PDV is the only one.
//                       The prefix exists to tell the PROVINCE apart from the
//                       Пловдив city МИР (PDV-00, plain "Пловдив"), so it is a
//                       tier word already — a caller that adds its own emits
//                       "обл. обл. Пловдив".
//   3. self-typed     — "София област" (SFO), "София 23 МИР" (S23–S25),
//                       "Извън страната" (32) and their EN forms. These read as
//                       their own tier in prose; prepending one gives
//                       "Област София област" / "обл. Извън страната".
//
// Measured on the 2026-08-08 build, ~1.2k prerendered pages carried one of those
// doubled labels in a <title>, meta description, H1 or breadcrumb — six of the
// 32 rows in regions.json are kind 2 or 3 (28 области + 3 Sofia МИР + the
// PDV/PDV-00 pair + abroad), and every place page names its region.
const PREFIX_RE = /^(обл\.|prov\.)\s*/i;

/** Region name with any compact tier prefix ("обл." / "prov.") removed — the
 *  form to compose your own tier word around. */
export const bareOblastName = (name: string): string =>
  name.replace(PREFIX_RE, "");

/** Region name with a tier word removed from EITHER end — for a standalone
 *  segment in a place path ("гр. Карлово · общ. Карлово · Пловдив"), where the
 *  tier is already implied by position and repeating it reads as noise. Use
 *  `bareOblastName` instead when you are about to add a tier word of your own:
 *  this one also shortens "София област" to "София", which is right for a
 *  segment and wrong for a label that then prepends "област". */
export const shortOblastName = (name: string): string =>
  bareOblastName(name)
    .replace(/\s+(област|region)$/iu, "")
    .trim();

/** True when the name already reads as its own tier and must be used verbatim:
 *  "София област", "София 23 МИР", "Извън страната", "Sofia region",
 *  "Sofia 23 MMR", "Abroad". Checked on the BARE name, so kind 2 ("обл.
 *  Пловдив") is NOT self-typed — stripping its prefix leaves a plain name.
 *
 *  Whole-token match: an unanchored `МИР` would treat a future "Мирково"-style
 *  name as self-typed and silently drop its tier word — a MISSING word, which no
 *  doubling gate can see. (The `MunicipalitiesScreen` code this replaced used
 *  `\b(region|MMR|abroad)\b`; the boundaries were lost in the consolidation.) */
export const oblastNameIsSelfTyped = (name: string): boolean =>
  /(^|\s)(област|МИР|страна(та)?|region|MMR|abroad)(\s|$)/iu.test(
    bareOblastName(name),
  );

/** The pair a place BREADCRUMB needs, where the template writes the tier word
 *  itself ("…, област {name}"): the name with any tier word of its own removed,
 *  plus whether what remains still reads as one and must be rendered verbatim.
 *
 *  Both `PlaceHeader` and `settlementHero` feed `PlaceNarrativeContext` from
 *  this, so the two cannot drift. They each carried their own trailing-only
 *  strip, which shortened SFO's "София област" correctly and left PDV's "обл."
 *  PREFIX untouched — so every breadcrumb in Пловдив province read "област обл.
 *  Пловдив". Shortening (rather than only baring) is what keeps SFO's existing
 *  "област София" wording; the flag covers "София 24 МИР" and "Извън страната",
 *  which no strip can shorten. */
export const oblastNarrativeName = (
  raw: string | null | undefined,
): { name: string | null; isSelfTyped: boolean } => {
  if (!raw) return { name: null, isSelfTyped: false };
  const name = shortOblastName(raw);
  return {
    name: name || null,
    isSelfTyped: !!name && oblastNameIsSelfTyped(name),
  };
};

/** Where the label sits, which decides the tier word's form in Bulgarian:
 *  - `compact` — inside a place path: "гр. Карлово, обл. Пловдив"
 *  - `prose`   — mid-sentence: "резултати в област Пловдив"
 *  - `leading` — breadcrumb crumb or sentence start: "Област Пловдив"
 *
 *  BULGARIAN ONLY. English has one form for all three ("Plovdiv province"): the
 *  tier word trails a proper noun, so it needs no case change at a sentence
 *  start and `oblastLabel` ignores `form` when `lang === "en"`. A caller passing
 *  "leading" for English gets the same string back — that is intended, not a
 *  silent fallthrough. Adding a distinct EN form means changing the helper. */
export type OblastLabelForm = "compact" | "prose" | "leading";

/** A "градски" МИР carved out of its parent province: its code is the parent's
 *  with a numeric suffix (`PDV-00` inside `PDV`) and its name is the CITY's
 *  ("Пловдив"), so its tier is МИР, not област. Sofia's three carry "МИР" in the
 *  name already; this is the one that does not.
 *
 *  It matters on the PAGES ABOUT a region: PDV's own name is "обл. Пловдив" and
 *  PDV-00's is "Пловдив", so once the prefix is stripped both label as "област
 *  Пловдив" and /municipality/PDV and /municipality/PDV-00 share one <title>.
 *  Pass `code` there. A PLACE inside the city keeps the province wording — гр.
 *  Пловдив sits in обл. Пловдив — so the place builders pass no code. */
const isCityMir = (code?: string): boolean => !!code && /-\d+$/.test(code);

/** The region's label with its tier word in the right position for `lang` —
 *  and with no tier word at all when the name already carries one. Pass `code`
 *  when labelling the region's OWN page, so a градски МИР is named as one. */
export const oblastLabel = (
  name: string,
  lang: "bg" | "en",
  form: OblastLabelForm,
  code?: string,
): string => {
  const bare = bareOblastName(name);
  if (!bare) return "";
  if (oblastNameIsSelfTyped(bare)) return bare;
  if (isCityMir(code)) return lang === "en" ? `${bare} MMR` : `МИР ${bare}`;
  // `form` is deliberately unread here — see OblastLabelForm.
  if (lang === "en") return `${bare} province`;
  return form === "compact"
    ? `обл. ${bare}`
    : form === "leading"
      ? `Област ${bare}`
      : `област ${bare}`;
};
