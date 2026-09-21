import type { HomeStory } from "./data";
import { normalizeQuery, withinWindow } from "./storyQuery";

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

/**
 * ⚠️ ONE PREDICATE, NOT A COPY. The briefing's reading of a zero window is
 * „nothing qualifies" — `days` here is a window the reader picked, so a zero
 * is an absent choice. `storyQuery.withinDays` reads the same zero as „no
 * restriction". See `withinWindow` for why that difference is an argument.
 */
export const storyWithinDays = (
  iso: string | null | undefined,
  days: number,
  now = Date.now(),
): boolean => withinWindow(iso, days, now, "none");

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

/**
 * ⚠️ RE-EXPORTED, NOT RE-IMPLEMENTED. Two copies of a FOLD is the shape that
 * goes wrong quietly: the day one gains a `ё`/`й` rule, the briefing search
 * and the corpus search disagree about what a term is and both look like
 * they work.
 */
export const normalizeHomeSearch = normalizeQuery;

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
