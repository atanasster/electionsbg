import { ARTICLE_CHAPTERS } from "@/lib/flyover/programmes/tour";
import { articlePresentationState } from "@/lib/flyover/articlePresentation";
import { smoothstep } from "@/lib/flyover/math";
import {
  applyPartial,
  blend,
  STATE_ZERO,
  type FlyoverState,
} from "@/lib/flyover/state";

export const MONEY_MAP_SLUG = "2026-09-07-money-map";
export const MONEY_MAP_ELECTION_FROM = "2024_10_27";
export const MONEY_MAP_ELECTION_TO = "2026_04_19";

export interface MoneyMapChapterBody {
  title: string;
  markdown: string;
}

/** Split the committed article at level-two headings; the H1 remains ArticleLayout's job. */
export const splitMoneyMapChapters = (body: string): MoneyMapChapterBody[] => {
  const chapters: MoneyMapChapterBody[] = [];
  let current: MoneyMapChapterBody | null = null;
  for (const line of body.replace(/^\s*#\s+.+\r?\n+/, "").split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      if (current) chapters.push(current);
      current = { title: heading[1].trim(), markdown: "" };
      continue;
    }
    if (current) current.markdown += `${line}\n`;
  }
  if (current) chapters.push(current);
  return chapters.map((chapter) => ({
    ...chapter,
    markdown: chapter.markdown.trim(),
  }));
};

/** Resolve the accreting partials once; omitted fields inherit the preceding chapter. */
export const MONEY_MAP_STATES: readonly FlyoverState[] = (() => {
  const states: FlyoverState[] = [];
  let running = STATE_ZERO;
  for (const chapter of ARTICLE_CHAPTERS) {
    running = applyPartial(running, chapter.state);
    states.push(articlePresentationState(running));
  }
  return states;
})();

export const moneyMapStateAt = (
  chapter: number,
  progress: number,
): FlyoverState => {
  const index = Math.max(0, Math.min(MONEY_MAP_STATES.length - 1, chapter));
  const here = MONEY_MAP_STATES[index];
  const next = MONEY_MAP_STATES[index + 1] ?? here;
  // Hold the chapter's own picture while its prose is being read. Blending throughout
  // the whole section washed out the current layer and introduced the next one too early.
  return blend(
    here,
    next,
    smoothstep(Math.max(0, Math.min(1, (progress - 0.75) / 0.25))),
  );
};

/** Explicit election endpoints; artifact ordering must not silently change the story. */
export const moneyMapElectionTransitionAt = (
  chapter: number,
  progress: number,
): { from: string; to: string; progress: number } | undefined => {
  const finalChapter = ARTICLE_CHAPTERS.length - 1;
  if (chapter < finalChapter - 1) return undefined;
  return {
    from: MONEY_MAP_ELECTION_FROM,
    to: MONEY_MAP_ELECTION_TO,
    progress: chapter === finalChapter ? Math.max(0, Math.min(1, progress)) : 0,
  };
};
