// Tier 2 — parliamentary vs presidential classification (decision 11,
// §6.2's "the `race` the classifier chose"). Title-first: every real title
// measured 2026-09-09 states the race plainly ("...парламентарни избори"
// for Trend, "...президентските избори..." for Global Metrics' July poll),
// so the title alone resolves the overwhelming majority of publications
// with no ambiguity at all.
//
// ⚠️ The body-text fallback matches a PHRASE (adjective stem immediately
// followed by "избор..."), never a bare "президентск"/"парламентарни"
// stem — measured live, Alpha Research's own February 2026 PARLIAMENTARY
// poll (raw_data/polls/alpha_research/1043) discusses Румен Радев
// "напусне президентския пост" (leaving the PRESIDENCY to run in the
// parliamentary race) in passing, which a bare-stem match would have
// misclassified as presidential despite the poll's own repeated, explicit
// "предсрочните парламентарни избори" framing.

export type Race = "parliamentary" | "presidential";

// ⚠️ `\w` is ASCII-only in JS RegExp — it never matches a Cyrillic letter,
// even under the `u` flag (the same trap this repo's own `\b` note warns
// about, one level up). `[\p{L}\p{N}]` is the Unicode-aware equivalent
// used everywhere else in this codebase for exactly this reason.
const PRESIDENTIAL_RE =
  /президентск[\p{L}\p{N}]*\s+избор|избор[\p{L}\p{N}]*\s+за\s+президент|кандидат[\p{L}\p{N}]*\s+за\s+президент|кандидат\s+президент/u;
// The same open letter-run wildcard PRESIDENTIAL_RE uses on its adjective
// suffix — a literal "парламентарни?" misses the definite plural
// "парламентарните избори" ("THE parliamentary elections"), an ordinary,
// common phrasing that isn't merely the indefinite form plus one letter.
const PARLIAMENTARY_RE =
  /парламентарн[\p{L}\p{N}]*\s+избор|народн[\p{L}\p{N}]*\s+събрани/u;

/**
 * `title` is checked alone first — the reliable, always-available signal.
 * `bodyText` (the article's own narrative, or a PDF/OCR transcription) is
 * consulted only when the title itself states neither race, and only for
 * the SAME phrase patterns, for the reason in the header above.
 *
 * Defaults to `"parliamentary"` when NEITHER signal fires anywhere — the
 * corpus today is overwhelmingly parliamentary, and a silent title/body
 * (e.g. a bare "Политически нагласи в България") is far more likely to be
 * one of Trend's or Sova Harris's routine monthly trackers than a
 * presidential-specific release, which always names the race explicitly
 * in BG polling convention.
 */
export const classifyRace = (title: string, bodyText = ""): Race => {
  const t = title.toLowerCase();
  if (PRESIDENTIAL_RE.test(t)) return "presidential";
  if (PARLIAMENTARY_RE.test(t)) return "parliamentary";
  const b = bodyText.toLowerCase();
  if (PRESIDENTIAL_RE.test(b)) return "presidential";
  if (PARLIAMENTARY_RE.test(b)) return "parliamentary";
  return "parliamentary";
};
