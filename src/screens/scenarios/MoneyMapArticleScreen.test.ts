import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE_CHAPTERS } from "@/lib/flyover/programmes/tour";
import {
  MONEY_MAP_SLUG,
  MONEY_MAP_ELECTION_FROM,
  MONEY_MAP_ELECTION_TO,
  MONEY_MAP_STATES,
  moneyMapElectionTransitionAt,
  moneyMapStateAt,
  splitMoneyMapChapters,
} from "./moneyMapArticle";

const ROOT = process.cwd();

describe("the money-map article contract", () => {
  it.each(["bg", "en"] as const)(
    "has six ordered %s chapters, one poster and one owner link each",
    (lang) => {
      const body = fs.readFileSync(
        path.join(ROOT, `public/articles/${MONEY_MAP_SLUG}-${lang}.md`),
        "utf8",
      );
      const chapters = splitMoneyMapChapters(body);
      expect(chapters).toHaveLength(6);
      expect(
        chapters.map(
          (chapter) =>
            /\/articles\/money-map\/([a-z-]+)\.webp/.exec(
              chapter.markdown,
            )?.[1],
        ),
      ).toEqual(ARTICLE_CHAPTERS.map((chapter) => chapter.id));
      for (const chapter of chapters) {
        expect(chapter.markdown).toMatch(
          /\]\(\/(?:procurement|funds|subsidies|consumption|elections)/,
        );
      }
    },
  );

  it("accretes the five tour states and turns elections on only for chapter six", () => {
    expect(MONEY_MAP_STATES).toHaveLength(6);
    expect(
      MONEY_MAP_STATES.slice(0, 5).every((s) => s.weights.elections === 0),
    ).toBe(true);
    expect(MONEY_MAP_STATES[5].weights.elections).toBe(1);
    expect(MONEY_MAP_STATES[5].weights.prices).toBe(0);
  });

  it("maps intra-chapter scroll progress continuously toward the next state", () => {
    expect(moneyMapStateAt(0, 0)).toEqual(MONEY_MAP_STATES[0]);
    expect(moneyMapStateAt(0, 1)).toEqual(MONEY_MAP_STATES[1]);
    expect(moneyMapStateAt(5, 1)).toEqual(MONEY_MAP_STATES[5]);
  });

  it("cross-fades the two named election results continuously in chapter six", () => {
    const final = ARTICLE_CHAPTERS.length - 1;
    expect(moneyMapElectionTransitionAt(final - 2, 1)).toBeUndefined();
    expect(moneyMapElectionTransitionAt(final - 1, 1)).toEqual({
      from: MONEY_MAP_ELECTION_FROM,
      to: MONEY_MAP_ELECTION_TO,
      progress: 0,
    });
    expect(moneyMapElectionTransitionAt(final, 0.5)).toEqual({
      from: "2024_10_27",
      to: "2026_04_19",
      progress: 0.5,
    });
    expect(moneyMapElectionTransitionAt(final, 2)?.progress).toBe(1);
  });
});
