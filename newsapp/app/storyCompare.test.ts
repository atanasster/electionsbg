import { describe, expect, it } from "vitest";
import type { StoryMember, StorySynthesis } from "./data";
import {
  citedQuotesFor,
  memberKey,
  parseCompare,
  serializeCompare,
  toggleCompare,
} from "./storyCompare";

const member = (domain: string, article_id: string | null): StoryMember => ({
  domain,
  article_id,
  url: `https://${domain}/a`,
  title: null,
  published: null,
  leaning: null,
  russia_stance: null,
  first_seen: null,
  scoop_lag_hours: null,
  first_here: false,
  scoop_decidable: false,
});
const members = [
  member("a.bg", "1"),
  member("b.bg", "2"),
  member("c.bg", "3"),
  member("d.bg", null),
];

describe("storyCompare", () => {
  it("keys on domain/article_id and refuses a member with no article page", () => {
    expect(memberKey(members[0])).toBe("a.bg/1");
    expect(memberKey(members[3])).toBeNull();
  });

  it("reads only keys that name a selectable member of THIS story, deduped, in URL order, capped at three", () => {
    // ⚠️ THE MUTATION THIS CATCHES: rendering whatever the URL says — a key
    // from another story, a repeat, or a fourth source.
    expect(
      parseCompare("b.bg/2,zz.bg/9,a.bg/1,b.bg/2,d.bg/null", members),
    ).toEqual(["b.bg/2", "a.bg/1"]);
    expect(parseCompare("a.bg/1,b.bg/2,c.bg/3,a.bg/1", members)).toHaveLength(
      3,
    );
    expect(parseCompare(null, members)).toEqual([]);
    expect(parseCompare("a.bg/1", [])).toEqual([]);
  });

  it("toggles, and refuses a fourth pick rather than evicting one", () => {
    expect(toggleCompare([], "a.bg/1")).toEqual(["a.bg/1"]);
    expect(toggleCompare(["a.bg/1"], "a.bg/1")).toEqual([]);
    expect(toggleCompare(["a.bg/1", "b.bg/2", "c.bg/3"], "d.bg/4")).toEqual([
      "a.bg/1",
      "b.bg/2",
      "c.bg/3",
    ]);
    expect(serializeCompare([])).toBeNull();
    expect(serializeCompare(["a.bg/1", "b.bg/2"])).toBe("a.bg/1,b.bg/2");
  });

  it("collects the synthesis spans cited from ONE article and nothing from an unpublished synthesis", () => {
    const synthesis: StorySynthesis = {
      rubric_version: "v1",
      status: "ok",
      generated_at: "",
      outlets: [],
      synthesis: {
        common: [
          {
            claim: "x",
            supports: [
              { url: "https://a.bg/a", domain: "a.bg", quote: "едно" },
              { url: "https://b.bg/a", domain: "b.bg", quote: "две" },
            ],
          },
        ],
        disputed: [
          {
            claim: "y",
            positions: [
              {
                url: "https://a.bg/a",
                domain: "a.bg",
                attributed_to: "X",
                quote: "три",
              },
              {
                url: "https://b.bg/a",
                domain: "b.bg",
                attributed_to: "Y",
                quote: "четири",
              },
            ],
          },
        ],
        emphasis: [
          { url: "https://a.bg/a", domain: "a.bg", note: "n", quote: "едно" },
        ],
      },
      caveat_bg: null,
      caveat_en: null,
      dropped: 0,
    };
    expect(citedQuotesFor(synthesis, "https://a.bg/a")).toEqual([
      "едно",
      "три",
    ]);
    expect(citedQuotesFor(synthesis, "https://c.bg/a")).toEqual([]);
    expect(
      citedQuotesFor({ ...synthesis, status: "failed" }, "https://a.bg/a"),
    ).toEqual([]);
    expect(citedQuotesFor(undefined, "https://a.bg/a")).toEqual([]);
  });
});
