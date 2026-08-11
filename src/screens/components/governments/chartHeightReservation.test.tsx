import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Every chart here renders its "no macro yet" branch first: a page body unblocks
// on governments.json, but the plots need macro.json, and on a phone those land
// far enough apart to be a whole render pass. When that branch collapsed to a
// line of text, all seven charts on /indicators/economy then expanded to their
// real height at once and pushed the page from 2280px to 5268px — that page's
// entire measured CLS (0.1536, one event, Pixel 5 / 150ms RTT / 1.6Mbps / 4x
// CPU). Reserving `height` while the query is unsettled took it to 0.
//
// Two properties are load-bearing and each fails a different way:
//   - reserve WHILE PENDING, or the shift comes back;
//   - reserve ONLY while pending, or a failed macro.json (which react-query
//     records as success, since the fetcher returns undefined on !res.ok)
//     leaves ~2,160px of empty boxes on the page for ever.
const CHARTS = [
  {
    file: "GovernmentTimeline.tsx",
    guard: "if (!macro || chartData.length === 0)",
  },
  {
    file: "InflationBreakdownChart.tsx",
    guard: "if (!macro || rows.length === 0)",
  },
] as const;

// The branch body, delimited by its own closing brace rather than a character
// count — a fixed window silently stops covering the branch as comments grow.
const loadingBranchOf = (src: string, guard: string): string => {
  const at = src.indexOf(guard);
  expect(
    at,
    `loading guard ${guard} not found — did it change shape?`,
  ).toBeGreaterThan(-1);
  const end = src.indexOf("\n  }", at);
  expect(end, "could not delimit the loading branch").toBeGreaterThan(at);
  return src.slice(at, end);
};

const sourceOf = (file: string) =>
  fs.readFileSync(path.join(DIR, file), "utf-8");

describe("chart loading placeholders reserve the plot height", () => {
  it.each(CHARTS)(
    "$file reserves `height` while the query is pending",
    ({ file, guard }) => {
      const branch = loadingBranchOf(sourceOf(file), guard);
      expect(
        branch.includes("style={macroPending ? { height } : undefined}"),
        `${file}: the loading placeholder must reserve \`height\` while pending, ` +
          `or every chart on the page grows at once when macro.json lands`,
      ).toBe(true);
    },
  );

  it.each(CHARTS)(
    "$file collapses once the query has settled",
    ({ file, guard }) => {
      const branch = loadingBranchOf(sourceOf(file), guard);
      // An unconditional reservation is the regression this guards: it would
      // hold empty boxes for ever when macro.json fails.
      expect(
        branch.includes("style={{ height }}"),
        `${file}: reservation must be conditional on macroPending`,
      ).toBe(false);
      expect(branch).toContain("macroPending");
    },
  );

  it.each(CHARTS)(
    "$file defaults macroPending to false, so an unwired caller collapses",
    ({ file }) => {
      expect(sourceOf(file)).toContain("macroPending = false");
    },
  );

  it.each(CHARTS)("$file declares a positive default height", ({ file }) => {
    const m = sourceOf(file).match(/height\s*=\s*(\d+)/);
    expect(m, `${file}: \`height\` needs a numeric default`).toBeTruthy();
    // `height = 0` would satisfy "has a default" and reserve nothing.
    expect(Number(m![1])).toBeGreaterThan(0);
  });

  it.each(CHARTS)(
    "$file reserves the same `height` binding the loaded plot uses",
    ({ file }) => {
      const src = sourceOf(file);
      // The loaded plot container sizes itself from the bare binding; a literal
      // in either place is the drift this guards.
      expect(
        src.includes('<div className="w-full" style={{ height }}>'),
        `${file}: loaded plot should size from the \`height\` binding`,
      ).toBe(true);
    },
  );
});

describe("chart callers pass the real query state", () => {
  const CALLERS = [
    "../../GovernmentDetailScreen.tsx",
    "../../GovernmentsScreen.tsx",
    "../../indicators/IndicatorsEconomyScreen.tsx",
    "../../indicators/IndicatorsFiscalScreen.tsx",
    "../../indicators/IndicatorsGovernanceScreen.tsx",
    "../../indicators/IndicatorsSocietyScreen.tsx",
    "../../dashboard/GovernmentsTile.tsx",
  ] as const;

  // The prop defaults to false, so a caller that forgets it silently keeps the
  // old collapsing behaviour — no error, no failing render, just the shift back.
  it.each(CALLERS)("%s wires macroPending into every chart", (rel) => {
    const src = fs.readFileSync(path.resolve(DIR, rel), "utf-8");
    expect(src).toContain("isPending: macroPending");
    const charts = (
      src.match(/<(?:GovernmentTimeline|InflationBreakdownChart)\b/g) ?? []
    ).length;
    const wired = (src.match(/macroPending=\{macroPending\}/g) ?? []).length;
    expect(charts, `${rel}: expected at least one chart`).toBeGreaterThan(0);
    expect(wired, `${rel}: ${charts} chart(s) but ${wired} wired`).toBe(charts);
  });
});
