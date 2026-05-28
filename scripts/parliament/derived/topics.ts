// Coarse topic classifier for plenary vote items. Pure keyword heuristics
// over the normalized title (re-vote suffix already stripped upstream).
//
// Eight tags + an explicit "other" sink. Ordering matters — earlier rules
// win, so "вот на доверие" matches before the generic "ЗИД" catch-all.
// Keep this file dependency-free so both the ingest writer and a future
// frontend reuse can call it.
//
// Word-boundary note: JavaScript's `\b` is ASCII-only. Between two Cyrillic
// characters it does NOT assert a boundary, so /\bзид\b/i never matches a
// pure-Cyrillic title like "ЗИД на Закона за …". Where we need a boundary
// around a Cyrillic token we use an explicit non-Cyrillic-letter lookaround
// instead: `(?:^|[^а-яё])зид(?:$|[^а-яё])`.

export type VoteTopic =
  | "confidence_vote"
  | "ratification"
  | "constitution"
  | "personnel"
  | "budget"
  | "zkpo"
  | "tax"
  | "zid"
  | "other";

// "избор на|избира|избиране на" all surface in cabinet / committee titles.
// `избира` matches the bare verb stem and any Cyrillic suffix — JavaScript's
// \b can't see Cyrillic word chars, so we anchor on a non-Cyrillic-letter
// trailing char (or end-of-string) instead. That keeps "избирателен" (the
// adjective for "electoral") out of the personnel bucket.
const PERSONNEL_PATTERNS = [
  /избор на/i,
  /избира(?:не|т|те|ме)?(?:$|[^а-яё])/i,
  /освобождава/i,
  /назначава/i,
  /отстранява/i,
  /комисия за избиране/i,
  /временна комисия/i,
];

const TAX_PATTERNS = [
  /здфл/i,
  /зддс/i,
  /закон за корпоративно/i,
  /данък/i,
  /акциз/i,
];

// Cyrillic-aware boundary for the 3-letter token "ЗИД". Matches start/end of
// string or any non-Cyrillic-letter character. Without this guard, the bare
// /\bзид\b/i never fires on Bulgarian input — JS `\b` doesn't see Cyrillic
// chars as "word" chars, so it can't assert a boundary between Cyrillic
// neighbours.
const ZID_TOKEN = /(?:^|[^а-яёa-z])зид(?:$|[^а-яёa-z])/i;

// Returns the most specific tag that fires. Untitled / empty inputs return
// "other" — that's the conservative default that won't poison facet counts.
export const classifyTitle = (title: string | undefined | null): VoteTopic => {
  if (!title) return "other";
  const t = title.trim();
  if (!t) return "other";
  const lower = t.toLowerCase();

  if (/вот на (не)?доверие/i.test(lower)) return "confidence_vote";
  // Bulgarian uses "ратифиц" (ратифицира / ратифициране) AND "ратифик"
  // (ратификация) — catch both stems with `ратифи[кц]`.
  if (/ратифи[кц]/i.test(lower)) return "ratification";
  if (/конституц/i.test(lower)) return "constitution";

  if (PERSONNEL_PATTERNS.some((re) => re.test(lower))) return "personnel";

  if (/бюджет/i.test(lower)) return "budget";

  // Tax laws first — ZKPO is a tax law, but the dedicated tag is more useful
  // for filtering than the generic "tax" bucket.
  if (/зкпо/i.test(lower)) return "zkpo";
  if (TAX_PATTERNS.some((re) => re.test(lower))) return "tax";

  if (ZID_TOKEN.test(lower) || /закон за изменение и допълнение/i.test(lower)) {
    return "zid";
  }

  return "other";
};

// Convenience: classify every entry of an itemTitles map. Returns the
// itemTopics record to be persisted in the session JSON.
export const classifyItemTitles = (
  itemTitles: Record<string, string> | undefined,
): Record<string, VoteTopic> => {
  const out: Record<string, VoteTopic> = {};
  if (!itemTitles) return out;
  for (const [item, title] of Object.entries(itemTitles)) {
    out[item] = classifyTitle(title);
  }
  return out;
};
