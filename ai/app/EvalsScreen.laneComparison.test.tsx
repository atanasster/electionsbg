// The headline table must not let a reader draw a conclusion the data does not
// support. The ways it could, each with a test below:
//   1. comparing methods measured on DIFFERENT questions — the table is only
//      honest because every row shares the same 474;
//   2. picking the Gemini row as "whichever ran last" instead of by name (that
//      once inverted the published ranking);
//   3. writing a conclusion into the page that the data no longer supports;
//   4. bringing back the no-AI Jev lane, which was measured on a bank made
//      mostly of the rules' own examples (ai/evals-internal/README.md).
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

const GEMINI = "google/gemini-3.5-flash-lite";
const PRODUCTION = run("current_production.json", GEMINI, {
  metrics: {
    en: metrics({ toolAcc: 0.96, argAcc: 0.81 }),
    bg: metrics({ toolAcc: 0.96, argAcc: 0.75 }),
  },
});
const CONTROL = run("current_control.json", GEMINI, {
  metrics: {
    en: metrics({ toolAcc: 0.95, argAcc: 0.83 }),
    bg: metrics({ toolAcc: 0.95, argAcc: 0.77 }),
  },
  meanPromptTokens: 16150,
});
const JEV_GEMINI = run("current_jev_gemini.json", GEMINI, {
  metrics: {
    en: metrics({ toolAcc: 0.975, argAcc: 0.94 }),
    bg: metrics({ toolAcc: 0.964, argAcc: 0.9 }),
  },
  meanPromptTokens: 3697,
});

const deterministic: EvalsIndex["deterministic"] = {
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
};

// In the manifest's real order — newest first. A fixture that put the
// production run first would make the row picker right by construction.
const index = (runs: RunSummary[]): EvalsIndex => ({
  generatedAt: "2026-09-18T00:00:00.000Z",
  deterministic,
  runs,
});
const FULL = index([CONTROL, JEV_GEMINI, PRODUCTION]);

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
const cells = (lane: string) =>
  [
    ...summary()
      .querySelector(`tr[data-lane="${lane}"]`)!
      .querySelectorAll("td"),
  ].map((td) => td.textContent);
const shown = () => screen.findByRole("heading", { name: "Накратко" });

describe("headline table", { timeout: 30_000 }, () => {
  it("names each method by its own row header", async () => {
    show(FULL);
    await shown();
    for (const [lane, name] of [
      ["deterministic", "Правила (без AI)"],
      ["cloud", "Gemini 3.5 Flash-Lite"],
      ["jev_gemini", "Jev + Gemini 3.5 Flash-Lite"],
    ]) {
      const row = summary().querySelector<HTMLElement>(
        `tr[data-lane="${lane}"]`,
      )!;
      expect(within(row).getByRole("rowheader").textContent).toContain(name);
    }
  });

  it("never shows the no-AI Jev lane, even when its run is in the manifest", async () => {
    // It was measured on the rules' own examples — no basis for comparing it
    // with them — so the table must not resurrect it from a stray artifact.
    show(
      index([
        CONTROL,
        JEV_GEMINI,
        run("current_jev.json", "jev (TypeSafe System One)"),
        PRODUCTION,
      ]),
    );
    await shown();
    expect(summary().querySelector('tr[data-lane="jev"]')).toBeNull();
    expect(summary().querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("reads the rules on the 474 shared questions, not the 841", async () => {
    show(FULL);
    await shown();
    expect(cells("deterministic")[0]).toBe("474");
    expect(cells("deterministic")[1]).toBe("77,0% / 83,0%");
  });

  it("prefers the same-day control over the older production run", async () => {
    show(FULL);
    await shown();
    expect(cells("cloud")[3]).toBe("83,0% / 77,0%");
  });

  it("falls back to the production run when there is no control", async () => {
    show(index([JEV_GEMINI, PRODUCTION]));
    await shown();
    expect(cells("cloud")[3]).toBe("81,0% / 75,0%");
  });

  it("is a two-way table without the Jev + Gemini run", async () => {
    show(index([CONTROL, PRODUCTION]));
    await shown();
    expect(summary().querySelector('tr[data-lane="jev_gemini"]')).toBeNull();
    expect(summary().textContent).toMatch(/Сравняваме двата начина/);
    expect(summary().textContent).not.toMatch(/в изпитание/);
  });

  it("is a three-way table, marked as under test, with it", async () => {
    show(FULL);
    await shown();
    expect(summary().textContent).toMatch(
      /Сравняваме трите начина.*\(Jev \+ Gemini е още в изпитание\)/,
    );
  });

  it("is absent rather than half-built without a Gemini run", async () => {
    show(index([JEV_GEMINI]));
    await screen.findByRole("heading", { name: "Правилата без AI" });
    expect(screen.queryByRole("heading", { name: "Накратко" })).toBeNull();
  });
});

describe("headline — comparability", { timeout: 30_000 }, () => {
  it("claims 'the same questions' only when they are the same", async () => {
    show(FULL);
    await shown();
    expect(summary().textContent).toMatch(/едни и същи 474 въпроса/);
    expect(summary().textContent).not.toMatch(/Внимание/);
  });

  it("warns, and drops the claim, when a row covers different questions", async () => {
    show(index([{ ...CONTROL, caseCount: 367 }, JEV_GEMINI, PRODUCTION]));
    await shown();
    expect(summary().textContent).toMatch(/различен брой въпроси/);
    expect(summary().textContent).not.toMatch(/едни и същи/);
  });

  it("warns when equal counts cover DIFFERENT question sets", async () => {
    // The one mismatch a reader cannot see: the count column agrees.
    show(
      index([{ ...CONTROL, caseGroups: ["starter"] }, JEV_GEMINI, PRODUCTION]),
    );
    await shown();
    expect(summary().textContent).toMatch(/наборите са различни/);
  });
});

describe("headline — conclusions follow the data", { timeout: 30_000 }, () => {
  it("names the most accurate method from the data", async () => {
    show(FULL);
    await shown();
    expect(summary().textContent).toMatch(
      /Jev \+ Gemini 3.5 Flash-Lite най-често избира правилния инструмент/,
    );
  });

  it("names a different method when the data says so", async () => {
    show(
      index([
        CONTROL,
        {
          ...JEV_GEMINI,
          metrics: {
            en: metrics({ toolAcc: 0.5 }),
            bg: metrics({ toolAcc: 0.5 }),
          },
        },
        PRODUCTION,
      ]),
    );
    await shown();
    const text = summary().textContent ?? "";
    expect(text).not.toMatch(/Jev \+ Gemini 3.5 Flash-Lite най-често/);
    expect(text).toMatch(/Gemini 3.5 Flash-Lite най-често избира/);
  });

  it("states the parameter gain and the token saving", async () => {
    show(FULL);
    await shown();
    expect(summary().textContent).toContain(
      "те са верни в 94,0% / 90,0% срещу 83,0% / 77,0% при само Gemini",
    );
    expect(summary().textContent).toMatch(
      /средно 3\s?697 токена вместо 16\s?150/,
    );
    expect(summary().textContent).toMatch(
      /попълва по-точно, щом вижда един инструмент/,
    );
  });

  it("drops the explanation when the data no longer supports it", async () => {
    show(
      index([
        CONTROL,
        {
          ...JEV_GEMINI,
          metrics: {
            en: metrics({ argAcc: 0.7 }),
            bg: metrics({ argAcc: 0.7 }),
          },
        },
        PRODUCTION,
      ]),
    );
    await shown();
    expect(summary().textContent).not.toMatch(/попълва по-точно/);
  });
});

describe(
  "headline — against the committed manifest",
  { timeout: 30_000 },
  () => {
    let committed: EvalsIndex;
    beforeAll(async () => {
      committed = await readEvalsIndex<EvalsIndex>();
    });

    it("reads Gemini alone from the same-day control, named by file", async () => {
      setFetcher(serveEvals());
      renderEvals("bg");
      await shown();
      const byFile = (f: string) => committed.runs.find((r) => r.file === f)!;
      const control = byFile("current_control.json");
      const production = byFile("current_production.json");
      const bg = (v: number | null | undefined) =>
        v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
      const params = (r: RunSummary) =>
        `${bg(r.metrics.en.argAcc)} / ${bg(r.metrics.bg.argAcc)}`;
      // Discriminating only while the two runs really differ on this column.
      expect(params(control)).not.toBe(params(production));
      expect(cells("cloud")[3]).toBe(params(control));
      expect(control.caseCount).toBe(
        byFile("current_jev_gemini.json").caseCount,
      );
    });

    it("compares every row on genuinely the same questions", async () => {
      setFetcher(serveEvals());
      renderEvals("bg");
      await shown();
      const counts = ["deterministic", "cloud", "jev_gemini"].map(
        (l) => cells(l)[0],
      );
      expect(new Set(counts).size).toBe(1);
      expect(summary().textContent).not.toMatch(/Внимание/);
    });
  },
);
