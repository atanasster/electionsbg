// Recognises "show me ALL the data on X" / "where is X mentioned" — the request
// for every record that names X (the entityMentions tool), as opposed to a
// profile or a single metric about X.
//
// Deliberately narrow: it needs an explicit "all/every" or "mentioned" cue.
// "данни за безработицата" is a metric question and „всичко за Пловдив" is the
// place dashboard (router step 1e) — neither carries the cue, so neither lands
// here.

const CUE_BG =
  /^(?:моля[,\s]+)?(?:(?:покажи|дай|намери|потърси|търси|изведи|кажи|събери)(?:\s+ми)?\s+)?(?:всички(?:те)?|цялата|всичката|всякакви)\s+(?:налични\s+)?(?:данни|данните|информация|информацията|сведения|записи|споменавания|резултати)(?:,?\s+(?:които\s+)?(?:имате|има|имаш|знаеш))?\s+(?:за|относно|около|свързани\s+с|по)\s+(.+)$/iu;
const WHERE_BG =
  /^(?:къде|в\s+кои\s+данни)\s+(?:се\s+)?(?:споменава(?:т)?|се\s+среща|фигурира(?:т)?|присъства)\s+(.+)$/iu;
const CUE_EN =
  /^(?:please\s+)?(?:(?:show|give|find|list|get)(?:\s+me)?\s+)?(?:all(?:\s+the)?|every|any)\s+(?:available\s+)?(?:data|information|info|records|mentions|results)(?:\s+(?:you|we)\s+have)?\s+(?:on|about|for|regarding|mentioning)\s+(.+)$/iu;
const EVERYTHING_EN =
  /^(?:(?:show|give|find|tell)(?:\s+me)?\s+)?everything\s+(?:you\s+have\s+|we\s+have\s+)?(?:on|about|regarding|mentioning)\s+(.+)$/iu;
const WHERE_EN = /^where\s+(?:is|are|does)\s+(.+?)\s+(?:mentioned|appear)$/iu;

/** The name the question asks about, or null when it is not a mentions request. */
export const mentionsQuery = (question: string): string | null => {
  const q = question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.]+$/u, "");
  for (const re of [CUE_BG, WHERE_BG, CUE_EN, EVERYTHING_EN, WHERE_EN]) {
    const m = q.match(re)?.[1]?.trim();
    if (!m) continue;
    // A deictic placeholder („едно лице", "a person") names nobody.
    if (
      /^(?:едно?|една|даден[аио]?|някой|някоя|a|an|some|this|that)\s/iu.test(m)
    )
      return null;
    if ([...m].length < 3) return null;
    return m;
  }
  return null;
};

/** A bare name typed on its own — "INSAIT", "ИНСАИТ" — that nothing else routed:
 *  at most three words, one of them an all-caps token of ≥3 letters (an acronym
 *  or a brand). Ordinary words never qualify, so small talk stays unrouted. */
export const bareAcronym = (question: string): string | null => {
  const q = question.trim().replace(/[?!.]+$/u, "");
  const tokens = q.split(/[\s,]+/).filter(Boolean);
  if (!tokens.length || tokens.length > 3) return null;
  return tokens.some((t) => /^[\p{Lu}][\p{Lu}\p{N}-]{2,}$/u.test(t)) ? q : null;
};
