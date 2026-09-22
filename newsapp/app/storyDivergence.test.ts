import { describe, expect, it } from "vitest";
import type { StoryMember } from "./data";
import {
  aggregateDivergence,
  axisDivergence,
  divergenceState,
} from "./storyDivergence";

const member = (
  domain: string,
  leaning: StoryMember["leaning"],
): StoryMember => ({
  domain,
  article_id: null,
  url: null,
  title: null,
  published: null,
  leaning,
  russia_stance: null,
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
});

describe("divergenceState", () => {
  it("is the explicit table from the plan", () => {
    expect(divergenceState({ labels: 0, outlets: 0 })).toBe("none");
    expect(divergenceState({ labels: 1, outlets: 1 })).toBe("single_source");
    expect(divergenceState({ labels: 2, outlets: 1 })).toBe("single_source");
    expect(divergenceState({ labels: 1, outlets: 2 })).toBe("uniform");
    expect(divergenceState({ labels: 2, outlets: 2 })).toBe("distribution");
    expect(divergenceState({ labels: 3, outlets: 5 })).toBe("distribution");
  });
});

describe("axisDivergence", () => {
  const lean = (m: StoryMember) => m.leaning;

  it("counts OUTLETS, not labels — one outlet with two labels is single-source", () => {
    // ⚠️ THE MUTATION THIS CATCHES: the old StoryCard rule, which read two
    // labels as two publications disagreeing.
    const one = axisDivergence(
      [member("a.bg", "neutral"), member("a.bg", "progressive")],
      lean,
    );
    expect(one).toEqual({
      state: "single_source",
      positionedOutlets: 1,
      labels: 2,
      articles: 2,
    });
    const two = axisDivergence(
      [member("a.bg", "neutral"), member("b.bg", "progressive")],
      lean,
    );
    expect(two.state).toBe("distribution");
    expect(two.positionedOutlets).toBe(2);
  });

  it("two outlets on the same label is matching framing, not a distribution", () => {
    const d = axisDivergence(
      [
        member("a.bg", "neutral"),
        member("b.bg", "neutral"),
        member("b.bg", "neutral"),
      ],
      lean,
    );
    expect(d).toEqual({
      state: "uniform",
      positionedOutlets: 2,
      labels: 1,
      articles: 3,
    });
  });

  it("not_applicable is not a position and an unassessed member counts nowhere", () => {
    const d = axisDivergence(
      [
        member("a.bg", "not_applicable"),
        member("b.bg", "not_applicable"),
        member("c.bg", null),
      ],
      lean,
    );
    expect(d).toEqual({
      state: "none",
      positionedOutlets: 0,
      labels: 0,
      articles: 0,
    });
    // A mixed outlet beside a positioned one still spreads across outlets.
    const mixed = axisDivergence(
      [
        member("a.bg", "not_applicable"),
        member("a.bg", "neutral"),
        member("b.bg", "conservative"),
      ],
      lean,
    );
    expect(mixed.state).toBe("distribution");
    expect(mixed.articles).toBe(2);
  });

  it("fails closed on no members", () => {
    expect(axisDivergence([], lean).state).toBe("none");
  });
});

describe("aggregateDivergence", () => {
  it("uses the build's distinct-outlet count and never the label count", () => {
    expect(aggregateDivergence({ neutral: 1, progressive: 1 }, 1).state).toBe(
      "single_source",
    );
    expect(aggregateDivergence({ neutral: 1, progressive: 1 }, 2).state).toBe(
      "distribution",
    );
    expect(aggregateDivergence({ neutral: 3 }, 2).state).toBe("uniform");
    expect(
      aggregateDivergence({ not_applicable: 4, neutral: 2 }, 2).articles,
    ).toBe(2);
  });

  it("without the outlet count it says LESS, never more", () => {
    // ⚠️ THE MUTATION THIS CATCHES: falling back to the label rule for a
    // bundle built before `leaning_outlets` existed.
    expect(
      aggregateDivergence({ neutral: 1, progressive: 1 }, undefined).state,
    ).toBe("single_source");
    expect(aggregateDivergence({}, undefined).state).toBe("none");
    expect(aggregateDivergence({ not_applicable: 3 }, undefined).state).toBe(
      "none",
    );
  });
});
