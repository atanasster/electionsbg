import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareRankedRows, compareStoryRows } from "./overlayMerge";

/**
 * The client's two orderings against the publisher's, on the REAL pages.
 *
 * ⚠️ A parity gate, not a unit test: `compareRankedRows` is a twin of the
 * three stable passes in `build_app_data.write_story_pages`, and a twin that
 * drifts on a tiebreak swaps two stories between the page a reader fetched
 * and the prefix the browse merged. Skips when the build is absent (a fresh
 * clone), and says so — an absent corpus is not a passing one.
 */
const STORIES = path.resolve(__dirname, "../../news/app-data/stories");

const flatten = (prefix: string): Array<Record<string, unknown>> => {
  const rows: Array<Record<string, unknown>> = [];
  for (let n = 1; ; n += 1) {
    const file = path.join(STORIES, `${prefix}-${n}.json`);
    if (!fs.existsSync(file)) break;
    const page = JSON.parse(fs.readFileSync(file, "utf8")) as {
      stories: Array<Record<string, unknown>>;
    };
    rows.push(...page.stories);
  }
  return rows;
};

const present = fs.existsSync(path.join(STORIES, "ranked-1.json"));

describe.skipIf(!present)("ordering parity with the published pages", () => {
  it.each([
    ["ranked", compareRankedRows],
    ["index", compareStoryRows],
  ] as const)("%s-N re-sorts to the publisher's own order", (prefix, cmp) => {
    const published = flatten(prefix);
    expect(published.length).toBeGreaterThan(0);
    const resorted = [...published].sort(cmp);
    const mismatches = published.filter((row, i) => row.id !== resorted[i].id);
    expect(mismatches.map((row) => row.id)).toEqual([]);
  });
});
