// The „В медиите" tile's data (news-person-sentiment-v1 §8): the tone summary
// the news pipeline stamps onto a person's mention shard
// (`news/scripts/build_mention_index.py`), bucket-served under the main data
// origin. ⚠️ ABSENT IS THE NORMAL CASE — a person with no news page, a shard
// with no `tone` block, or the aggregates switch being off all mean „no tile",
// never an empty one, so every failure here resolves to null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export const TONE_BUCKETS = [
  "strongly_unfavorable",
  "unfavorable",
  "neutral",
  "favorable",
  "strongly_favorable",
] as const;
export type ToneBucket = (typeof TONE_BUCKETS)[number];

export interface PersonMediaTone {
  basis: string;
  n: number;
  counts: Partial<Record<ToneBucket, number>>;
  outlet_count: number | null;
  outlets: { domain: string; outlet: string; n: number }[];
  last_published: string | null;
  generated_at: string | null;
  news_url: string;
  /** §8.2 — served from the last pre-window build during an election freeze. */
  frozen?: { id: string; as_of: string; until: string };
}

/** The shard filename rule, mirrored from `safe_id` in build_mention_index.py. */
export const mentionShardId = (slug: string): string => {
  const out =
    slug.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[._]+|[._]+$/g, "") || "_";
  return out.replace(/\.\./g, "_");
};

const isTone = (v: unknown): v is PersonMediaTone => {
  const t = v as PersonMediaTone | null;
  return (
    !!t &&
    typeof t.n === "number" &&
    t.n > 0 &&
    typeof t.counts === "object" &&
    typeof t.news_url === "string" &&
    t.news_url.startsWith("https://") &&
    Array.isArray(t.outlets)
  );
};

export const fetchPersonMediaTone = async (
  slug: string,
): Promise<PersonMediaTone | null> => {
  try {
    const res = await fetch(
      dataUrl(`/news/mentions/person/${mentionShardId(slug)}.json`),
    );
    if (!res.ok) return null;
    const doc = (await res.json()) as { tone?: unknown } | null;
    return isTone(doc?.tone) ? doc.tone : null;
  } catch {
    return null;
  }
};

export const usePersonMediaTone = (slug: string) =>
  useQuery({
    queryKey: ["person_media_tone", slug],
    queryFn: () => fetchPersonMediaTone(slug),
    enabled: !!slug,
  });
