import type { Story } from "../data";

export const RELATED_STORY_LIMIT = 4;

/**
 * Relatedness is symmetric in the reader-facing UI. Explicit outbound links
 * keep their editorial order; reciprocal inbound links follow, newest first.
 * No topical or behavioural recommendation is inferred.
 */
export const resolveRelatedStories = (
  story: Story,
  allStories: Story[],
): Story[] => {
  const byId = new Map(
    allStories.map((candidate) => [candidate.id, candidate]),
  );
  const seen = new Set<string>([story.id]);
  const result: Story[] = [];
  for (const relatedId of story.related_story_ids) {
    if (seen.has(relatedId)) continue;
    seen.add(relatedId);
    const candidate = byId.get(relatedId);
    if (!candidate) continue;
    result.push(candidate);
    if (result.length >= RELATED_STORY_LIMIT) return result;
  }

  const inbound = allStories
    .filter(
      (candidate) =>
        !seen.has(candidate.id) &&
        candidate.related_story_ids.includes(story.id),
    )
    .sort(
      (a, b) =>
        (b.first_published ?? "").localeCompare(a.first_published ?? "") ||
        a.id.localeCompare(b.id),
    );
  for (const candidate of inbound) {
    result.push(candidate);
    if (result.length >= RELATED_STORY_LIMIT) break;
  }
  return result;
};
