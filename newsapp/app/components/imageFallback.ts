// The image fallback ladder's pure logic, split out from ArticleImage.
//
// Separate file because both are exported for testing, and a module that
// exports non-components alongside a component breaks Fast Refresh — but the
// real reason is that these two are the decisions worth reading on their own:
// which rung to start on, and what to show when there is no picture at all.

export type ImageStage = "photo" | "logo" | "monogram";

/**
 * Two letters from the outlet name — the last rung of the ladder.
 *
 * Uppercased: a monogram with a lowercase second letter ("Пв") reads as a
 * truncated word rather than a mark.
 */
export const monogramOf = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "??";
  const raw =
    words.length === 1
      ? words[0].slice(0, 2)
      : (words[0][0] ?? "") + (words[1][0] ?? "");
  return raw.toLocaleUpperCase("bg-BG");
};

/**
 * Which rung to start on.
 *
 * `hotlinkOk === false` skips the photo entirely: the outlet has told us it
 * will not serve us, and re-asking on every card is both pointless and rude.
 *
 * ⚠️ `undefined`/`null` (never probed) still tries. A wrong `false` would
 * permanently suppress images an outlet is happy to serve, while a wrong
 * `true` costs one request that the component's onError already handles — so
 * the two are not symmetric and must not be collapsed into a boolean.
 */
export const initialStage = (
  image: string | null | undefined,
  hotlinkOk: boolean | null | undefined,
  logo: string | null | undefined,
): ImageStage => {
  if (image && hotlinkOk !== false) return "photo";
  if (logo) return "logo";
  return "monogram";
};
