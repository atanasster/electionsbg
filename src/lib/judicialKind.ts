// What KIND of judicial body /court/:bodyCode is showing.
//
// The route name is narrower than its contents on purpose — it covers all 279
// bodies (182 courts + 69 prosecution offices + 28 investigation services),
// because "съд" is the word a reader types, so the page itself has to carry the
// real kind instead.
//
// Two forms of one vocabulary, kept in one file so they cannot drift apart: the
// screen renders the CARD label, the prerender builder writes the sentence
// PHRASE into the static HTML a crawler reads. Adding a fifth `kind` to
// migration 116 means adding it here once, not in two places that disagree.

// The closed vocabulary, mirroring migration 116's CHECK constraint. Defined
// HERE and imported by the loader that derives it
// (scripts/judiciary/judicialBodies.ts), so there is one definition rather than
// two that can drift.
export type JudicialKind =
  | "court"
  | "prosecution"
  | "investigation"
  | "council";

// Typed by the union, so adding a fifth `kind` to 116 fails to COMPILE here
// instead of silently rendering the "court" fallback on every page of it.
const KIND_LABEL: Record<JudicialKind, { bg: string; en: string }> = {
  court: { bg: "Съд", en: "Court" },
  prosecution: { bg: "Прокуратура", en: "Prosecution office" },
  investigation: { bg: "Следствен отдел", en: "Investigation service" },
  council: { bg: "Съвет", en: "Council" },
};

/** Display label for a body's kind. Falls back to "court" — the modal value and
 *  the one the URL already promises — rather than rendering a raw enum. */
export const judicialKindLabel = (
  kind: string | null | undefined,
): { bg: string; en: string } =>
  KIND_LABEL[kind as JudicialKind] ?? KIND_LABEL.court;

/** Lower-case form for mid-sentence prose ("… е районен съд със седалище в …").
 *  Bulgarian sentence case differs from the card label, and English needs the
 *  article, so this is not just `.toLowerCase()` on the label above. */
const KIND_PHRASE: Record<JudicialKind, { bg: string; en: string }> = {
  court: { bg: "съд", en: "court" },
  prosecution: { bg: "прокуратура", en: "prosecution office" },
  investigation: { bg: "следствен отдел", en: "investigation service" },
  council: { bg: "съвет", en: "council" },
};

export const judicialKindPhrase = (
  kind: string | null | undefined,
): { bg: string; en: string } =>
  KIND_PHRASE[kind as JudicialKind] ?? KIND_PHRASE.court;

// `judicial_body.tier` is stored in the MASCULINE ("апелативен"), which agrees
// with съд and следствен отдел but not with прокуратура — so composing the two
// naively writes "апелативен прокуратура" onto 70 static pages. The set is
// closed (9 tiers across the three kinds, verified against the dimension), so a
// lookup is exact rather than a suffix rule that would mangle "върховен".
const TIER_FEMININE: Record<string, string> = {
  районен: "районна",
  окръжен: "окръжна",
  градски: "градска",
  апелативен: "апелативна",
  административен: "административна",
  върховен: "върховна",
  военен: "военна",
  специализиран: "специализирана",
  национален: "национална",
};

/** The tier adjective agreeing with the kind noun it qualifies — feminine for
 *  прокуратура, masculine for съд / следствен отдел / съвет. Returns the tier
 *  unchanged when it is not one of the known forms, so a new tier reads
 *  slightly off rather than disappearing. */
export const judicialTierAdjective = (
  tier: string | null | undefined,
  kind: string | null | undefined,
): string => {
  if (!tier) return "";
  return kind === "prosecution" ? (TIER_FEMININE[tier] ?? tier) : tier;
};

/** `в` → `във` before a В-/Ф-initial word. 11 of the 279 bodies start with В
 *  (both Supreme Courts among them), so "магистратите в Върховен касационен съд"
 *  is not a rare edge — it is the highest-traffic page in the family. */
export const bgIn = (name: string): string =>
  /^[ВвФф]/.test(name.trim()) ? "във" : "в";

/**
 * A workload figure, formatted the SAME way in the prerendered HTML a crawler
 * indexes and on the page a reader sees after hydration.
 *
 * They used to disagree: the builder called `toFixed()` (13.85) while the screen
 * called `toLocaleString("bg")` (13,85), so the static and hydrated text carried
 * different numbers for one figure. Same argument as the kind vocabulary above,
 * applied to numbers.
 */
export const judicialNum = (
  v: number | null | undefined,
  lang: string,
  digits = 2,
): string =>
  v == null
    ? "—"
    : v.toLocaleString(lang, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
