import type { HomeStory } from "./data";
import type { HomeHierarchy, HomeStoryItem } from "./homeHierarchy";

export const NEWS_BRIEFING_STORAGE_KEY = "naiasno-news-briefing-v1";
export const MAX_FOLLOWED_TOPICS = 8;
export const MAX_COMPLETED_STORY_IDS = 32;

export type BriefingCadence = "daily" | "weekly";
export type BriefingDensity = "compact" | "detailed";

export interface BriefingPreferences {
  version: 1;
  cadence: BriefingCadence;
  density: BriefingDensity;
  followedTopics: string[];
  lastCompletedAt: string | null;
  completedStoryIds: string[];
}

export const DEFAULT_BRIEFING_PREFERENCES: BriefingPreferences = {
  version: 1,
  cadence: "daily",
  density: "detailed",
  followedTopics: [],
  lastCompletedAt: null,
  completedStoryIds: [],
};

const validTopicId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
const validStoryId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

export const sanitizeBriefingPreferences = (
  value: unknown,
): BriefingPreferences => {
  if (!value || typeof value !== "object") return DEFAULT_BRIEFING_PREFERENCES;
  const raw = value as Record<string, unknown>;
  const followedTopics = Array.isArray(raw.followedTopics)
    ? [...new Set(raw.followedTopics.filter(validTopicId))].slice(
        0,
        MAX_FOLLOWED_TOPICS,
      )
    : [];
  const lastCompletedAt =
    typeof raw.lastCompletedAt === "string" &&
    Number.isFinite(Date.parse(raw.lastCompletedAt))
      ? raw.lastCompletedAt
      : null;
  const completedStoryIds = Array.isArray(raw.completedStoryIds)
    ? [...new Set(raw.completedStoryIds.filter(validStoryId))].slice(
        0,
        MAX_COMPLETED_STORY_IDS,
      )
    : [];
  return {
    version: 1,
    cadence: raw.cadence === "weekly" ? "weekly" : "daily",
    density: raw.density === "compact" ? "compact" : "detailed",
    followedTopics,
    lastCompletedAt,
    completedStoryIds,
  };
};

export const readBriefingPreferences = (): BriefingPreferences => {
  if (typeof window === "undefined") return DEFAULT_BRIEFING_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(NEWS_BRIEFING_STORAGE_KEY);
    return stored
      ? sanitizeBriefingPreferences(JSON.parse(stored))
      : DEFAULT_BRIEFING_PREFERENCES;
  } catch {
    return DEFAULT_BRIEFING_PREFERENCES;
  }
};

export const writeBriefingPreferences = (
  preferences: BriefingPreferences,
): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      NEWS_BRIEFING_STORAGE_KEY,
      JSON.stringify(sanitizeBriefingPreferences(preferences)),
    );
  } catch {
    // The briefing still works for this tab when storage is unavailable.
  }
};

const storyMatchesTopics = (
  item: HomeStoryItem,
  followed: Set<string>,
): boolean => item.story.topics.some((topic) => followed.has(topic.category));

export interface BriefingSections {
  update: HomeStoryItem[];
  moreAnalyzed: HomeStoryItem[];
  perspectives: HomeStoryItem[];
  outsideInterests: HomeStoryItem[];
  currentStoryIds: string[];
  visibleCount: number;
}

/** Preserve the hierarchy's recency order while grouping one finite page. */
export const buildBriefingSections = (
  hierarchy: HomeHierarchy,
  followedTopics: string[],
  completedStoryIds: string[] = [],
): BriefingSections => {
  const all = [
    ...(hierarchy.lead ? [hierarchy.lead] : []),
    ...hierarchy.supporting,
  ];
  const followed = new Set(followedTopics);
  const relevant = followed.size
    ? all.filter((item) => storyMatchesTopics(item, followed))
    : all;
  const outsideInterests = followed.size
    ? all.filter((item) => !storyMatchesTopics(item, followed)).slice(0, 3)
    : [];
  const completed = new Set(completedStoryIds);

  // “Update me” contains only stories absent at the last local completion.
  // Already completed items remain available below and never disappear.
  const update = relevant
    .filter((item) => !completed.has(item.story.id))
    .slice(0, 3);
  const updateIds = new Set(update.map((item) => item.story.id));
  const remaining = relevant.filter((item) => !updateIds.has(item.story.id));
  const perspectives = remaining.filter((item) => item.kind === "comparison");
  const moreAnalyzed = remaining.filter((item) => item.kind !== "comparison");
  return {
    update,
    moreAnalyzed,
    perspectives,
    outsideInterests,
    currentStoryIds: [...relevant, ...outsideInterests].map(
      (item) => item.story.id,
    ),
    visibleCount:
      update.length +
      moreAnalyzed.length +
      perspectives.length +
      outsideInterests.length,
  };
};

export const storiesSinceBriefing = (
  stories: readonly Pick<HomeStory, "id">[],
  completedStoryIds: string[],
): number | null => {
  if (!completedStoryIds.length) return null;
  const completed = new Set(completedStoryIds);
  return stories.filter((story) => !completed.has(story.id)).length;
};
