// The "Провери твърдение" fact-check on-ramp (§0g.4 / §4.3b). A citizen pastes a
// sentence from the news ("Видин–Ботевград взе 35% аванс и нищо не е построено");
// we extract the distinctive object and seed a project search, landing on the
// dossier whose honesty block answers the figure. v1 is pure keyword extraction —
// NO AI parse (the projectLifecycle tool, §6, takes over once ≥3 curated files
// exist). It deliberately does NOT write a claims[] entry: a DIY file must stay
// unbranded (a user claim mustn't read as a Наясно verdict — §11).
//
// The seed terms feed a prefix-AND full-text search over contract titles / tender
// subjects (functions/db_table.js — every token must be in the title), so the
// extractor must NOT over-capture: a sentence-initial common word ("Договорът",
// "Санирането") or a firm name (firms aren't in titles) would AND-narrow the
// search to zero. We therefore prefer the tightest single object phrase.

import type { ProjectFileSpec } from "./useProjectFile";

// Bulgarian connective/filler words — no procurement signal. Guards the
// content-word fallback only; the proper-noun pass does the heavy lifting.
const STOP = new Set([
  "и",
  "на",
  "за",
  "с",
  "със",
  "в",
  "във",
  "но",
  "че",
  "е",
  "са",
  "от",
  "до",
  "по",
  "който",
  "която",
  "което",
  "които",
  "нищо",
  "не",
  "се",
  "като",
  "или",
  "то",
  "той",
  "тя",
  "те",
  "този",
  "тази",
  "това",
  "тези",
  "още",
  "вече",
  "беше",
  "бяха",
  "има",
  "няма",
  "при",
  "след",
  "преди",
  "много",
  "как",
  "какво",
  "лева",
  "лв",
  "млн",
  "млрд",
  "евро",
]);

// Quote glyphs kept as named sets so the open/content/close lists can't silently
// drift (they must stay mutually consistent).
const OPEN_Q = `„"“«`;
const CLOSE_Q = `"“”»`;
const QUOTED_RE = new RegExp(
  `[${OPEN_Q}]([^${OPEN_Q}${CLOSE_Q}]{2,})[${CLOSE_Q}]`,
  "g",
);
// A proper noun: a Capitalized Cyrillic word, optionally joined by a hyphen or an
// en-/em-dash so "Видин–Ботевград" survives as ONE token. Space-separated names
// are NOT joined — that would fuse a firm onto an object and break the title
// AND-search.
const DASH = "–—-"; // en-dash, em-dash, hyphen
const PROPER_RE = new RegExp(
  `[А-ЯЁ][а-яёА-ЯЁ]*(?:[${DASH}][А-ЯЁ][а-яёА-ЯЁ]*)+|[А-ЯЁ][а-яёА-ЯЁ]{2,}`,
  "g",
);
const DASH_RE = new RegExp(`[${DASH}]`);

/** Drop any entry that is a substring of a longer retained entry (so a phrase and
 *  one of its own words don't both survive — FINDING-003). */
const dedupeSubstrings = (arr: string[]): string[] => {
  const uniq = [...new Set(arr)];
  return uniq.filter((s) => !uniq.some((o) => o !== s && o.includes(s)));
};

/**
 * Pull the distinctive object out of a free-text claim, in order of signal:
 * (1) quoted phrase(s) — the object is usually what's in quotes, and its words
 * co-occur in a title so the AND holds; (2) the strongest proper noun — a
 * hyphen-joined name wins, and a LONE sentence-initial capitalized word is dropped
 * (in real prose the first word is always capitalized and is usually a common
 * noun); (3) the two longest content words. Returns "" when nothing distinctive
 * is found, so the caller can keep the action disabled.
 */
export function extractClaimTerms(sentence: string): string {
  const text = (sentence ?? "").trim();
  if (!text) return "";

  // 1. Quoted phrases win.
  const quoted = [...text.matchAll(QUOTED_RE)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (quoted.length > 0) return dedupeSubstrings(quoted).slice(0, 2).join(" ");

  // 2. Proper nouns. Drop a lone (non-hyphenated) sentence-initial word, then keep
  //    the single most distinctive (longest) — ANDing two separate proper nouns
  //    risks pairing an object with a firm, which zeroes the title search.
  const proper: string[] = [];
  for (const m of text.matchAll(PROPER_RE)) {
    const word = m[0];
    const start = m.index ?? 0;
    const atSentenceStart =
      text.slice(0, start).replace(/[^\p{L}\p{N}]+/gu, "") === "";
    const hyphenated = DASH_RE.test(word);
    if (atSentenceStart && !hyphenated) continue;
    proper.push(word);
  }
  if (proper.length > 0) {
    return [...proper].sort((a, b) => b.length - a.length)[0];
  }

  // 3. Content-word fallback: the two longest non-stopword tokens.
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ].sort((a, b) => b.length - a.length);
  return words.slice(0, 2).join(" ");
}

/** Build the seed spec for a pasted claim, or null when nothing distinctive can
 *  be extracted (the caller keeps the "Провери" action disabled). */
export const projectFromClaim = (sentence: string): ProjectFileSpec | null => {
  const terms = extractClaimTerms(sentence);
  if (!terms) return null;
  return { title: { bg: terms }, search: [{ terms }] };
};
