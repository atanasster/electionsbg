// Within a single plenary day the same motion is often put to the floor more
// than once — most commonly an item immediately followed by its explicit
// "прегласуване" (re-vote), or the identical motion voted verbatim twice.
// Each cast is stored as a separate item, so every derived metric (party
// correlation, MP similarity, cohesion, embedding, loyalty) would count that
// one decision as multiple independent dimensions and over-weight it.
//
// Conservative collapse: group a session's items by title with any trailing
// "- прегласуване" marker stripped; when a group has more than one item, keep
// only the last cast (the final, authoritative result) and drop the rest.
//
// Deliberately narrow — it never merges across distinct titles, so an
// amendment and its base decision (different titles) both survive, and a
// procedural motion proposed by two different MPs (different titles) stays
// as two items. Untitled items always pass through untouched.

import type { SessionFile } from "./types";

const REVOTE_SUFFIX = /\s*[-–—]\s*прегласуване\s*$/iu;

const normalizeTitle = (title: string): string => {
  let t = title.trim();
  // Strip one or more trailing re-vote markers (a re-vote can itself be
  // re-voted), so the whole chain collapses to one normalized key.
  while (REVOTE_SUFFIX.test(t)) t = t.replace(REVOTE_SUFFIX, "").trim();
  return t;
};

export const dedupeRevotes = (sessions: SessionFile[]): SessionFile[] =>
  sessions.map((file) => {
    const titles = file.itemTitles;
    if (!titles) return file;
    // Highest item number per normalized title, titled items only.
    const lastByKey = new Map<string, number>();
    for (const item of file.sessions) {
      const title = titles[String(item.item)];
      if (!title) continue;
      const key = normalizeTitle(title);
      const prev = lastByKey.get(key);
      if (prev === undefined || item.item > prev) lastByKey.set(key, item.item);
    }
    // Drop a titled item only when a later item shares its normalized title.
    const kept = file.sessions.filter((item) => {
      const title = titles[String(item.item)];
      if (!title) return true;
      return lastByKey.get(normalizeTitle(title)) === item.item;
    });
    return kept.length === file.sessions.length
      ? file
      : { ...file, sessions: kept };
  });
