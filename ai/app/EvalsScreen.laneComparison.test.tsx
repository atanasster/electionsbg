// The two comparison tables must not let a reader draw a conclusion the data
// does not support. Four specific ways they could, each with a test below:
//   1. by comparing lanes measured on DIFFERENT questions — the headline table
//      is only honest because all three lanes share the same 474;
//   2. by picking the cloud lane as "whichever ran last" rather than the
//      production run (that once inverted the published ranking);
//   3. by ranking on accuracy alone, when only Jev can decline;
//   4. by putting a decline rate beside an accuracy measured over a DIFFERENT
//      denominator.
//
// ⚠️ The fixtures are typed against the page's own exported types. Untyped, a
// renamed metric key leaves them compiling and the tests asserting against a
// shape the page no longer reads.
import { screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "../tools/dataClient";
import {
  readEvalsIndex,
  renderEvals,
  serveEvals,
} from "./evalsHarness.test-utils";
import type { EvalsIndex, RunSummary, SummarisedMetrics } from "./EvalsScreen";

const GROUPS = [
  "registry",
  "challenge",
  "holdout",
  "unsupported",
  "realistic",
  "clarification",
  "conversation",
];

const metrics = (over: Partial<SummarisedMetrics> = {}): SummarisedMetrics => ({
  n: 474,
  toolAcc: 0.9,
  callAcc: 0.85,
  argN: 53,
  argAcc: 0.8,
  jsonValid: null,
  ...over,
});

const run = (
  file: string,
  model: string,
  over: Partial<RunSummary> = {},
): RunSummary => ({
  file,
  label: file.replace(/^current_|\.json$/g, ""),
  artifactLabel: null,
  model,
  finishedAt: "2026-09-18T00:00:00.000Z",
  caseCount: 474,
  caseGroups: GROUPS,
  routingBudget: null,
  forcedBudget: false,
  metrics: { en: metrics(), bg: metrics() },
  groups: {},
  goldInCandidates: null,
  meanCandidatesKept: null,
  ...over,
});

// Jev's headline figures (841, with starters) deliberately DIFFER from its
// 474-question ones, so a table reading the wrong bank shows the wrong number.
const JEV_RUN = run("current_jev.json", "jev (TypeSafe System One)", {
  caseCount: 841,
  caseGroups: [...GROUPS, "starter"],
  metrics: {
    en: metrics({
      n: 841,
      toolAcc: 0.91,
      jevRouted: 0.71,
      jevDeclined: 0.07,
      toolAccWhenRouted: 0.96,
    }),
    bg: metrics({
      n: 841,
      toolAcc: 0.9,
      jevRouted: 0.7,
      jevDeclined: 0.08,
      toolAccWhenRouted: 0.95,
    }),
  },
  legacyMetrics: {
    en: metrics({ toolAcc: 0.84, jevRouted: 0.73, toolAccWhenRouted: 0.99 }),
    bg: metrics({ toolAcc: 0.86, jevRouted: 0.72, toolAccWhenRouted: 0.98 }),
  },
});
const CLOUD_RUN = run(
  "current_production.json",
  "google/gemini-3.5-flash-lite",
  {
    metrics: {
      en: metrics({ toolAcc: 0.96 }),
      bg: metrics({ toolAcc: 0.96 }),
    },
  },
);

const baseIndex: EvalsIndex = {
  generatedAt: "2026-09-18T00:00:00.000Z",
  deterministic: {
    generatedAt: "2026-09-18T00:00:00.000Z",
    caseCount: 841,
    caseGroups: [...GROUPS, "starter"],
    metrics: {
      en: metrics({ n: 841, toolAcc: 0.87 }),
      bg: metrics({ n: 841, toolAcc: 0.9 }),
    },
    legacyMetrics: {
      en: metrics({ toolAcc: 0.77 }),
      bg: metrics({ toolAcc: 0.83 }),
    },
  },
  // In the manifest's real order — newest first, so Jev leads. A fixture that
  // put the production run first would make the lane picker right by
  // construction, which is how the "newest non-Jev run" defect stayed green.
  runs: [JEV_RUN, CLOUD_RUN],
};

beforeEach(() => clearDataCache());
afterEach(() => clearDataCache());

const show = (manifest: unknown) => {
  setFetcher(serveEvals({ manifest }));
  return renderEvals("bg");
};

const summary = () =>
  document.querySelector<HTMLElement>(
    'section[aria-labelledby="summary-title"]',
  )!;
const closeUp = () =>
  document.querySelector<HTMLElement>('section[aria-labelledby="jev-title"]')!;
const cells = (scope: HTMLElement, lane: string) =>
  [
    ...scope.querySelector(`tr[data-lane="${lane}"]`)!.querySelectorAll("td"),
  ].map((td) => td.textContent);
const summaryShown = () => screen.findByRole("heading", { name: "Накратко" });
const closeUpShown = () =>
  screen.findByRole("heading", { name: "Jev отблизо" });

describe(
  "headline — three methods on the same questions",
  { timeout: 30_000 },
  () => {
    it("shows all three, each named by its own row header", async () => {
      show(baseIndex);
      await summaryShown();
      for (const [lane, name] of [
        ["deterministic", "Правила (без AI)"],
        ["cloud", "Gemini 3.5 Flash-Lite"],
        ["jev", "Jev (TypeSafe)"],
      ]) {
        const row = summary().querySelector<HTMLElement>(
          `tr[data-lane="${lane}"]`,
        )!;
        expect(within(row).getByRole("rowheader").textContent).toContain(name);
      }
    });

    it("reads the 474-question figures for the rules and Jev, not the 841", async () => {
      // The starters are easy for both cheap lanes and the cloud model never
      // ran them — the 841 figures would flatter exactly the two lanes that
      // benefit. This is the like-for-like table, so it must read the shared bank.
      show(baseIndex);
      await summaryShown();
      expect(cells(summary(), "deterministic")[0]).toBe("474");
      expect(cells(summary(), "deterministic")[1]).toBe("77,0% / 83,0%");
      expect(cells(summary(), "jev")[0]).toBe("474");
      expect(cells(summary(), "jev")[1]).toBe("84,0% / 86,0%");
      expect(cells(summary(), "cloud")[1]).toBe("96,0% / 96,0%");
    });

    it("claims 'the same questions' only when they are the same", async () => {
      show(baseIndex);
      await summaryShown();
      expect(summary().textContent).toMatch(/едни и същи 474 въпроса/);
      expect(summary().textContent).not.toMatch(/Внимание/);
    });

    it("warns, and drops the claim, when a lane covers different questions", async () => {
      show({
        ...baseIndex,
        runs: [JEV_RUN, { ...CLOUD_RUN, caseCount: 367 }],
      });
      await summaryShown();
      expect(summary().textContent).toMatch(/различен брой въпроси/);
      expect(summary().textContent).not.toMatch(/едни и същи/);
    });

    it("warns when equal counts cover DIFFERENT question sets", async () => {
      // The one mismatch a reader cannot see: the count column agrees.
      show({
        ...baseIndex,
        runs: [JEV_RUN, { ...CLOUD_RUN, caseGroups: ["starter"] }],
      });
      await summaryShown();
      expect(summary().textContent).toMatch(/наборите са различни/);
    });

    it("names the most accurate method from the data, not from the page", async () => {
      show(baseIndex);
      await summaryShown();
      expect(summary().textContent).toMatch(
        /Gemini 3.5 Flash-Lite най-често избира правилния инструмент/,
      );
    });

    it("names a different method when the data says so", async () => {
      // Flip the data and the sentence must follow — a sentence written into
      // the page would still name the cloud model here.
      show({
        ...baseIndex,
        runs: [
          {
            ...JEV_RUN,
            legacyMetrics: {
              en: metrics({ toolAcc: 0.99 }),
              bg: metrics({ toolAcc: 0.99 }),
            },
          },
          CLOUD_RUN,
        ],
      });
      await summaryShown();
      expect(summary().textContent).toMatch(
        /Jev \(TypeSafe\) най-често избира правилния инструмент/,
      );
    });

    it("is absent rather than two-rowed when a lane is missing", async () => {
      show({ ...baseIndex, runs: [JEV_RUN] });
      await closeUpShown();
      expect(screen.queryByRole("heading", { name: "Накратко" })).toBeNull();
    });

    it("is absent when Jev carries no figures for the shared questions", async () => {
      show({
        ...baseIndex,
        runs: [{ ...JEV_RUN, legacyMetrics: undefined }, CLOUD_RUN],
      });
      await closeUpShown();
      expect(screen.queryByRole("heading", { name: "Накратко" })).toBeNull();
    });
  },
);

describe("Jev up close — all 841 questions", { timeout: 30_000 }, () => {
  it("shows how much Jev takes, beside its accuracy on what it takes", async () => {
    show(baseIndex);
    await closeUpShown();
    const c = cells(closeUp(), "jev");
    // The accuracy alone would read as over the whole bank; the share it is
    // measured on is the column that stops that.
    expect(c[3]).toBe("71,0% / 70,0%");
    expect(c[4]).toBe("7,0% / 8,0%");
    expect(c[5]).toBe("96,0% / 95,0%");
    expect(closeUp().textContent).toMatch(/се смята само върху поетите/);
  });

  it("prints an em dash for the rules even when their artifact carries a real 0", async () => {
    // ⚠️ THE MUTATION-RESISTANT HALF. With empty rule metrics, `pct(undefined)`
    // already returns "—", so deleting the `declines` guard would still pass.
    // A real 0 is the only fixture a guard-free implementation cannot satisfy:
    // it would print "0.0%", claiming a decline rate for rules that cannot
    // decline.
    show({
      ...baseIndex,
      deterministic: {
        ...baseIndex.deterministic!,
        metrics: {
          en: metrics({ n: 841, jevRouted: 0, jevDeclined: 0 }),
          bg: metrics({ n: 841, jevRouted: 0, jevDeclined: 0 }),
        },
      },
    });
    await closeUpShown();
    const c = cells(closeUp(), "deterministic");
    for (const cell of [c[3], c[4], c[5]]) expect(cell).toBe("—");
    // …and the branch discriminates: Jev prints a rate in the same column.
    expect(cells(closeUp(), "jev")[4]).toMatch(/%/);
  });

  it("says 'not measured' for Jev when its artifact predates the figures", async () => {
    show({
      ...baseIndex,
      runs: [
        {
          ...JEV_RUN,
          metrics: {
            en: metrics({ n: 841 }),
            bg: metrics({ n: 841 }),
          },
        },
        CLOUD_RUN,
      ],
    });
    await closeUpShown();
    const c = cells(closeUp(), "jev");
    expect(c[3]).toBe("не е измерено");
    expect(c[4]).toBe("не е измерено");
  });

  it("warns when the two lanes cover different questions", async () => {
    show({ ...baseIndex, runs: [{ ...JEV_RUN, caseCount: 12 }, CLOUD_RUN] });
    await closeUpShown();
    expect(closeUp().textContent).toMatch(/различен брой въпроси/);
  });

  it("is absent when Jev has not been run", async () => {
    show({ ...baseIndex, runs: [CLOUD_RUN] });
    await screen.findByRole("heading", { name: "Правилата без AI" });
    expect(screen.queryByRole("heading", { name: "Jev отблизо" })).toBeNull();
  });
});

// ⚠️ THE TEST THAT WOULD HAVE CAUGHT THE REAL DEFECT. The cloud lane once
// resolved to "the newest non-Jev run" — the 367-question starter bank — and
// the page published the cloud model 28 points below its production figure.
describe("against the committed manifest", { timeout: 30_000 }, () => {
  let committed: EvalsIndex;
  beforeAll(async () => {
    committed = await readEvalsIndex<EvalsIndex>();
  });

  it("compares the PRODUCTION cloud run, not whichever ran last", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await summaryShown();
    const production = committed.runs.find(
      (r) => r.file === "current_production.json",
    )!;
    const newestOther = committed.runs.find(
      (r) => r.file !== "current_jev.json",
    )!;
    // Read the PARAMETER column: it is where the runs actually differ. (The
    // question count cannot tell them apart — several cloud runs cover the
    // same 474 questions.)
    const bg = (v: number | null | undefined) =>
      v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
    const params = (r: typeof production) =>
      `${bg(r.metrics.en.argAcc)} / ${bg(r.metrics.bg.argAcc)}`;
    // Discriminating only while the newest other run really differs.
    expect(newestOther.file).not.toBe(production.file);
    expect(params(newestOther)).not.toBe(params(production));
    const c = cells(summary(), "cloud");
    expect(c[3]).toBe(params(production));
  });

  it("compares all three on genuinely the same questions", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await summaryShown();
    const counts = ["deterministic", "cloud", "jev"].map(
      (l) => cells(summary(), l)[0],
    );
    expect(new Set(counts).size).toBe(1);
    expect(summary().textContent).not.toMatch(/Внимание/);
  });
});
