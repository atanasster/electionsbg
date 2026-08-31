import type { HomeStory } from "./data";

export const HOME_TIMEFRAMES = [
  { days: 1, label: "24 часа" },
  { days: 7, label: "7 дни" },
  { days: 30, label: "30 дни" },
] as const;

export const HOME_MIN_DEFAULT_STORIES = 6;

export interface HomeFilterState {
  category: string;
  days: number;
  query: string;
  now?: number;
}

export const storyWithinDays = (
  iso: string | null | undefined,
  days: number,
  now = Date.now(),
): boolean => {
  if (!iso || days <= 0) return false;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      iso,
    )
  )
    return false;
  const published = Date.parse(iso);
  const age = now - published;
  return Number.isFinite(published) && age >= 0 && age <= days * 86_400_000;
};

/** Pick the narrowest briefing window that can stand on its own. */
export const defaultHomeDays = (
  stories: HomeStory[],
  now = Date.now(),
  minimum = HOME_MIN_DEFAULT_STORIES,
): number =>
  stories.filter((story) => storyWithinDays(story.last_published, 1, now))
    .length >= minimum
    ? 1
    : 7;

export const normalizeHomeSearch = (value: string): string =>
  value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("bg-BG");

const searchable = (story: HomeStory): string =>
  normalizeHomeSearch(
    `${story.title_bg ?? ""} ${story.title_en ?? ""} ${story.summary_bg ?? ""} ${story.summary_en ?? ""}`,
  );

export const filterHomeStories = (
  stories: HomeStory[],
  { category, days, query, now = Date.now() }: HomeFilterState,
): HomeStory[] => {
  const needle = normalizeHomeSearch(query);
  return stories.filter(
    (story) =>
      (category === "all" ||
        story.topics.some((topic) => topic.category === category)) &&
      storyWithinDays(story.last_published, days, now) &&
      (!needle || searchable(story).includes(needle)),
  );
};

export const homeCategoryCounts = (
  stories: HomeStory[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const story of stories) {
    for (const category of new Set(
      story.topics.map((topic) => topic.category),
    )) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return counts;
};
