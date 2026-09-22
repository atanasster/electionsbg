// T5.8 — comparison as an ACTION: the reader picks two or three source
// headlines and the page aligns them field by field. The selection is URL
// state (`?compare=<key>,<key>`), so a comparison is shareable and survives
// a reload; every helper here is pure so the rule can be tested without a
// render. A key is `domain/article_id` — a member with no article page has
// nothing to align (no analysis, no timestamps beyond the member's own) and
// is not selectable.

import type { StoryMember, StorySynthesis } from "./data";

export const COMPARE_PARAM = "compare";
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 3;

export const memberKey = (m: StoryMember): string | null =>
  m.article_id ? `${m.domain}/${m.article_id}` : null;

/** Keys from the URL that name a selectable member of THIS story, in URL order, deduped, capped. */
export const parseCompare = (
  raw: string | null,
  members: StoryMember[],
): string[] => {
  if (!raw) return [];
  const valid = new Set(
    members.map(memberKey).filter((k): k is string => Boolean(k)),
  );
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (!key || !valid.has(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length === COMPARE_MAX) break;
  }
  return out;
};

export const serializeCompare = (keys: string[]): string | null =>
  keys.length ? keys.join(",") : null;

/** Add or remove one key; a fourth pick is refused rather than evicting one. */
export const toggleCompare = (keys: string[], key: string): string[] => {
  if (keys.includes(key)) return keys.filter((k) => k !== key);
  if (keys.length >= COMPARE_MAX) return keys;
  return [...keys, key];
};

/** The verbatim spans the T5.1 synthesis cites from ONE article, deduped. */
export const citedQuotesFor = (
  synthesis: StorySynthesis | undefined,
  url: string | null,
): string[] => {
  const s = synthesis?.status === "ok" ? synthesis.synthesis : null;
  if (!s || !url) return [];
  const quotes: string[] = [];
  const push = (q: string) => {
    if (!quotes.includes(q)) quotes.push(q);
  };
  for (const item of s.common)
    for (const c of item.supports) if (c.url === url) push(c.quote);
  for (const item of s.disputed)
    for (const p of item.positions) if (p.url === url) push(p.quote);
  for (const e of s.emphasis) if (e.url === url) push(e.quote);
  return quotes;
};
