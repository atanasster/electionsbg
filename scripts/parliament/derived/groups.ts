// One party-group identity, shared by every derived metric.
//
// The roll-call source spells one group several ways across days — sixteen of the 51st NS's
// days file „ГЕРБ-СДС"/„ПП-ДБ" and the rest „ГЕРБ - СДС"/„ПП - ДБ" — so a metric that
// buckets on the raw label files ONE group as TWO: two cohesion rows to average, two
// `A__B` keys in party_pair_breaks (which the /votes/between/:pair URL looks up by name,
// so the split half is unreachable), and an MP whose last sitting used the variant wearing
// a `partyShort` that matches no other artifact and no party-colour row.
//
// TWO HALVES, and they answer different questions.
//
// `canonGroupKey` decides what is ONE GROUP. It is imported from the frontend rather than
// restated here — partyPairs.ts folds the same artifact client-side, and a second copy of
// the rule is how the two come to disagree about what one group is. It is purely
// typographic (whitespace around a hyphen, repeated whitespace, case), which is what keeps
// it honest: it can never merge „ДПС" into „ДПС - НН", and the 51st really does seat those
// beside „ДПС - ДПС" and „АПС" as four groups.
//
// `groupLabels` decides what that group is CALLED — the raw spelling covering the most
// items, never the uppercased fold key. Every consumer joins on the label: the party-colour
// tables, `/votes/between/:pair`, party_pair_breaks' pair key, and the party_correlation
// row labels those two are built from. Emitting a key would rename every group at once.

import { canonGroupKey } from "../../../src/data/parliament/votes/partyPairs";
import type { SessionFile } from "./types";

export { canonGroupKey };

const EMPTY: Record<string, string> = {};

/** Memoised per `mpParty` object: the metrics below walk the same sessions several times
 *  each, and `majorityFor`-style helpers re-read the map once per (item, group). */
const cache = new WeakMap<Record<string, string>, Record<string, string>>();

/** The session's mpId → group map with every label folded to its canonical key. Hand this
 *  to any helper that compares an mpParty entry against a group — comparing a folded group
 *  against a raw map matches nothing at all, which is a silent whole-metric outage rather
 *  than a wrong number. */
export const foldedParties = (file: SessionFile): Record<string, string> => {
  const raw = file.mpParty;
  if (!raw) return EMPTY;
  const hit = cache.get(raw);
  if (hit) return hit;
  const out: Record<string, string> = {};
  for (const [mpId, label] of Object.entries(raw))
    out[mpId] = canonGroupKey(label);
  cache.set(raw, out);
  return out;
};

/** The group an MP sat in at time of vote, canonically keyed. Undefined when the session
 *  files no affiliation for them — same contract the per-metric `partyOf` helpers had. */
export const groupOf = (file: SessionFile, mpId: number): string | undefined =>
  foldedParties(file)[String(mpId)] || undefined;

/** Canonical key → the spelling to publish. Weighted by the items each spelling covers, so
 *  the dominant one wins; ties break on the spelling itself rather than on encounter order,
 *  so a rebuild over unchanged sessions is byte-stable. */
export const groupLabels = (sessions: SessionFile[]): Map<string, string> => {
  const items = new Map<string, Map<string, number>>();
  for (const file of sessions) {
    const weight = file.sessions.length;
    const seen = new Set<string>();
    for (const raw of Object.values(file.mpParty ?? {})) {
      if (!raw || seen.has(raw)) continue;
      seen.add(raw);
      const byRaw = items.get(canonGroupKey(raw)) ?? new Map<string, number>();
      byRaw.set(raw, (byRaw.get(raw) ?? 0) + weight);
      items.set(canonGroupKey(raw), byRaw);
    }
  }
  const out = new Map<string, string>();
  for (const [key, byRaw] of items) {
    const best = [...byRaw].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )[0];
    out.set(key, best[0]);
  }
  return out;
};

/** `groupLabels` as a total function — an unseen key falls back to itself rather than to
 *  undefined, so a metric can never publish an empty `partyShort`. */
export const groupLabeller = (
  sessions: SessionFile[],
): ((key: string) => string) => {
  const labels = groupLabels(sessions);
  return (key: string): string => labels.get(key) ?? key;
};
