// The ONE rule for linking a candidate name to a parliament.bg MP, shared by the
// local-election decorator (decorate_local_mp_links.ts) and the officials candidate-link
// join (scripts/officials/candidate_link_join.ts) so the two cannot drift.
//
// The rule is EXACT FULL NAME, UNIQUE IN THE INDEX, AT LEAST TWO TOKENS — nothing fuzzier.
// The decorators used to fall back to first+last, which in a Bulgarian name drops the
// patronymic, i.e. the father: „Валери Димов Вълков" got MP „Валери Стефанов Вълков"'s
// photo. Measured 2026-10-21 over all 68 local cycles, that fallback produced 4,419 of the
// 5,262 distinct (name, mpId) pairs (84%) — and not one miss was a source dropping a middle
// name, which was the fallback's stated reason. Even a 1–2-edit middle-name tolerance is
// unsafe against the NATIONAL index (Петров/Петков, Янков/Цеков are different people), so
// do not add a fuzzy tier here. See docs/plans/local-mp-photo-links-v1.md.
//
// A key held by two MPs is DROPPED rather than resolved by "photo wins": that heuristic
// would quietly attach one namesake's face to the other's candidacy.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const PARLIAMENT_INDEX = path.join(
  ROOT,
  "data",
  "parliament",
  "index.json",
);

/** Case, diacritics, whitespace and hyphen spacing only — „Милева-Георгиева" and
 *  „Милева Георгиева" are one key. Never folds tokens. */
export const normaliseMpName = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[-\s]+/g, " ")
    .trim();

export type MpIndexEntry = {
  id: number;
  normalizedName?: string;
  photoUrl?: string;
};

export type MpMatch = { id: number; normalizedName: string; photoUrl?: string };

export type MpNameIndex = {
  /** Keys held by exactly one MP. */
  byFull: Map<string, MpMatch>;
  /** Keys held by two or more MPs — never matched. */
  ambiguous: Set<string>;
};

const tokenCount = (key: string): number => (key ? key.split(" ").length : 0);

export const buildMpNameIndex = (
  mps: ReadonlyArray<MpIndexEntry>,
): MpNameIndex => {
  const byFull = new Map<string, MpMatch>();
  const ambiguous = new Set<string>();
  for (const m of mps) {
    if (!m.normalizedName) continue;
    const key = normaliseMpName(m.normalizedName);
    if (tokenCount(key) < 2 || ambiguous.has(key)) continue;
    const prev = byFull.get(key);
    // The same MP listed twice is not a collision.
    if (prev && prev.id !== m.id) {
      byFull.delete(key);
      ambiguous.add(key);
      continue;
    }
    byFull.set(key, {
      id: m.id,
      normalizedName: m.normalizedName,
      photoUrl: m.photoUrl,
    });
  }
  return { byFull, ambiguous };
};

export const loadMpNameIndex = (file = PARLIAMENT_INDEX): MpNameIndex => {
  const idx = JSON.parse(fs.readFileSync(file, "utf8")) as {
    mps: MpIndexEntry[];
  };
  return buildMpNameIndex(idx.mps);
};

/** The MP whose full name equals `name`, or undefined. */
export const matchMp = (
  name: string | undefined,
  idx: MpNameIndex,
): MpMatch | undefined => {
  if (!name) return undefined;
  const key = normaliseMpName(name);
  if (tokenCount(key) < 2) return undefined;
  return idx.byFull.get(key);
};

/** True when `name`'s full-name key is held by 2+ MPs — the case `matchMp` refuses. */
export const isAmbiguousMpName = (
  name: string | undefined,
  idx: MpNameIndex,
): boolean => !!name && idx.ambiguous.has(normaliseMpName(name));
