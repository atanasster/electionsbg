// How each outlet in ONE story frames one person (news-person-sentiment-v1
// §7) — the story comparison's per-person view, over the same member rows.
//
// ⚠️ THE UNIT IS THE OUTLET, as in `storyDivergence`: „outlets frame this
// person differently" is a claim about publications, and one outlet's two
// articles cannot make it. Every tone is a position here, `neutral` included.

import type { StoryMember, ToneBucket } from "./data";
import { divergenceState, type DivergenceState } from "./storyDivergence";
import { TONE_BUCKET_ORDER } from "./sentimentScale";

export interface StoryPerson {
  id: string;
  name: string;
  outlets: number;
  articles: number;
}

/** The people assessed in this story, most-covered first. */
export const storyPeople = (members: StoryMember[]): StoryPerson[] => {
  const by = new Map<
    string,
    { name: string; outlets: Set<string>; articles: number }
  >();
  for (const m of members)
    for (const p of m.persons ?? []) {
      const slot = by.get(p.id) ?? {
        name: p.name ?? p.id,
        outlets: new Set(),
        articles: 0,
      };
      slot.outlets.add(m.domain);
      slot.articles += 1;
      by.set(p.id, slot);
    }
  return [...by.entries()]
    .map(([id, s]) => ({
      id,
      name: s.name,
      outlets: s.outlets.size,
      articles: s.articles,
    }))
    .sort(
      (a, b) =>
        b.outlets - a.outlets ||
        b.articles - a.articles ||
        a.id.localeCompare(b.id),
    );
};

export interface OutletReading {
  domain: string;
  rows: { member: StoryMember; bucket: ToneBucket }[];
}

/** One person's readings, grouped by outlet, and the story-level state. */
export const personReadings = (
  members: StoryMember[],
  id: string,
): { outlets: OutletReading[]; state: DivergenceState } => {
  const by = new Map<string, OutletReading>();
  const buckets = new Set<string>();
  for (const m of members) {
    const hit = (m.persons ?? []).find((p) => p.id === id);
    const bucket = hit ? TONE_BUCKET_ORDER[hit.bucket_index] : undefined;
    if (!bucket) continue;
    buckets.add(bucket);
    const slot = by.get(m.domain) ?? { domain: m.domain, rows: [] };
    slot.rows.push({ member: m, bucket: bucket as ToneBucket });
    by.set(m.domain, slot);
  }
  return {
    outlets: [...by.values()].sort(
      (a, b) =>
        b.rows.length - a.rows.length || a.domain.localeCompare(b.domain),
    ),
    state: divergenceState({ labels: buckets.size, outlets: by.size }),
  };
};
