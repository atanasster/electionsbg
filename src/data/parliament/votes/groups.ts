// One party-group identity for everything computed from a session's own `mpParty` map —
// the per-day roll-call file behind /votes/<date>, and the per-NS roster snapshot in
// index.json.
//
// The scripts-side twin is scripts/parliament/derived/groups.ts. Both fold with
// `canonGroupKey` from partyPairs.ts, which is the one definition; what they cannot share
// is a module across the Vite/script boundary, the same reason majority.ts exists twice.
//
// THIS SIDE IS DAY-SCOPED, and that changes what a label can mean. The derived metrics pick
// the spelling covering the most items across a whole parliament; here the file in hand IS
// the corpus, so the label is the spelling most of the group's own members carry in that
// same map. Within a day that is unanimous — no day in the corpus spells one group two ways
// — so this is what the page already shows.
//
// The roster snapshot is NOT unanimous, which is why the label vote is here rather than
// assumed away: `index.json`'s 51st NS files 78 members as „ГЕРБ - СДС" and one as
// „ГЕРБ-СДС" — `buildMpProfileByNs` unions the days newest-last, so a member whose final
// sitting fell on a variant day keeps that spelling. Ungrouped, they are their own
// parliamentary group of one wherever the roster is bucketed or compared.
//
// OPEN: the four roster consumers (ParliamentAttendanceScreen, ParliamentEmbeddingScreen,
// EmbeddingMiniTile, MpTwinsTile) do NOT use this module yet. They read the snapshot as a
// FALLBACK behind `currentPartyGroupShort`, i.e. they compare across two party sources with
// different spelling conventions, so folding one of them alone would not make the two
// agree. The fix belongs in `buildMpProfileByNs`, where one fold serves all four.

import { canonGroupKey } from "./partyPairs";

export { canonGroupKey };

const EMPTY: Record<string, string> = {};

// Both caches are keyed on the mpParty OBJECT, which React hands back unchanged between
// renders — these run inside useMemo bodies over every vote of every item.
const foldCache = new WeakMap<Record<string, string>, Record<string, string>>();
const labelCache = new WeakMap<
  Record<string, string>,
  (key: string) => string
>();

/** The map with every label folded to its canonical key. Hand this to anything that
 *  COMPARES an entry against a group — majorityFor is the one that matters. Comparing a
 *  folded group against a raw map matches nobody, which is not a wrong number but a
 *  vanished one: no majority, therefore no dissenters and no highlight. */
export const foldedParties = (
  mpParty?: Record<string, string>,
): Record<string, string> => {
  if (!mpParty) return EMPTY;
  const hit = foldCache.get(mpParty);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const [mpId, label] of Object.entries(mpParty))
    out[mpId] = canonGroupKey(label);
  foldCache.set(mpParty, out);
  return out;
};

/** The group a member sits in, canonically keyed; undefined when the map has no entry. */
export const groupOf = (
  mpParty: Record<string, string> | undefined,
  mpId: number,
): string | undefined => foldedParties(mpParty)[String(mpId)] || undefined;

/** Canonical key → the spelling to DISPLAY: the one most of that group's members carry in
 *  this map, ties broken on the spelling itself so a re-render cannot reorder it. An unseen
 *  key falls back to itself, which is what keeps a caller's own placeholder („—", "") from
 *  being swallowed. */
export const groupLabeller = (
  mpParty?: Record<string, string>,
): ((key: string) => string) => {
  if (!mpParty) return (key) => key;
  const hit = labelCache.get(mpParty);
  if (hit) return hit;
  const counts = new Map<string, Map<string, number>>();
  for (const raw of Object.values(mpParty)) {
    if (!raw) continue;
    const key = canonGroupKey(raw);
    const byRaw = counts.get(key) ?? new Map<string, number>();
    byRaw.set(raw, (byRaw.get(raw) ?? 0) + 1);
    counts.set(key, byRaw);
  }
  const labels = new Map<string, string>();
  for (const [key, byRaw] of counts) {
    labels.set(
      key,
      [...byRaw].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      )[0][0],
    );
  }
  const fn = (key: string): string => labels.get(key) ?? key;
  labelCache.set(mpParty, fn);
  return fn;
};
