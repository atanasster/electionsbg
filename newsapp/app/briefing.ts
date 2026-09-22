import type { HomeHierarchy, HomeStoryItem } from "./homeHierarchy";

export const NEWS_BRIEFING_STORAGE_KEY = "naiasno-news-briefing-v1";
export const MAX_FOLLOWED_TOPICS = 8;

export type BriefingCadence = "daily" | "weekly";
export type BriefingDensity = "compact" | "detailed";

export interface BriefingPreferences {
  version: 1;
  cadence: BriefingCadence;
  density: BriefingDensity;
  followedTopics: string[];
}

export const DEFAULT_BRIEFING_PREFERENCES: BriefingPreferences = {
  version: 1,
  cadence: "daily",
  density: "detailed",
  followedTopics: [],
};

const validTopicId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
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
  return {
    version: 1,
    cadence: raw.cadence === "weekly" ? "weekly" : "daily",
    density: raw.density === "compact" ? "compact" : "detailed",
    followedTopics,
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
  // “Update me” is the top of the same finite list; nothing it holds is
  // removed from the sections below.
  const update = relevant.slice(0, 3);
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
