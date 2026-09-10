import { BRAND_TITLE_SUFFIX, BRAND_TITLE_SUFFIX_EN } from "@/lib/brand";
// Rich, descriptive document <title> for a parliamentary place page. Mirrors
// the prerendered crawler HTML so the browser tab — and the title Googlebot
// indexes after it renders the SPA — match the static-HTML style instead of the
// terse "Избори | {name}" wrapper:
//
//   "Резултати в кв. Лозенец, обл. София — Парламентарни избори | Наясно"
//
// `placeLabel` is the language-appropriate place label, already carrying its
// (lowercase) tier word in the right position for the language — "област
// Плевен" / "Pleven region", "община Долна Митрополия" / "Dolna Mitropolia
// municipality", "кв. Лозенец, обл. София" — and any oblast context. The screens
// build it from the same tier-label logic that drives the short og:title.
export const placeResultsTitle = (
  placeLabel: string,
  lang: "bg" | "en",
): string =>
  lang === "bg"
    ? `Резултати в ${placeLabel} — Парламентарни избори${BRAND_TITLE_SUFFIX}`
    : `Results in ${placeLabel} — Parliamentary elections${BRAND_TITLE_SUFFIX_EN}`;
