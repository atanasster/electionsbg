// The three-lane comparison must not let a reader draw a conclusion the data
// does not support. Three specific ways it could, each with a test below:
//   1. by tabulating lanes measured on DIFFERENT banks as if they were
//      comparable;
//   2. by ranking on accuracy alone, when only one lane can decline — a router
//      answering 70% of turns at 99% is a different product from one answering
//      all of them at 91%;
//   3. by putting the decline rate beside an accuracy measured over a DIFFERENT
//      denominator, which publishes the "99%" of (2) with the "70% of turns"
//      taken out.
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

const metrics = (over: Partial<SummarisedMetrics> = {}): SummarisedMetrics => ({
  n: 841,
  toolAcc: 0.9,
  callAcc: 0.85,
  argN: 120,
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
  caseCount: 841,
  caseGroups: ["registry"],
  routingBudget: null,
  forcedBudget: false,
  metrics: { en: metrics(), bg: metrics() },
  groups: {},
  goldInCandidates: null,
  meanCandidatesKept: null,
  ...over,
});

const JEV_RUN = run("current_jev.json", "jev (TypeSafe System One)", {
  metrics: {
    en: metrics({
      toolAcc: 0.91,
      jevRouted: 0.71,
      jevDeclined: 0.07,
      toolAccWhenRouted: 0.96,
    }),
    bg: metrics({
      toolAcc: 0.9,
      jevRouted: 0.7,
      jevDeclined: 0.08,
      toolAccWhenRouted: 0.95,
    }),
  },
});
const CLOUD_RUN = run(
  "current_production.json",
  "google/gemini-3.5-flash-lite",
);

const baseIndex: EvalsIndex = {
  generatedAt: "2026-09-18T00:00:00.000Z",
  deterministic: {
    generatedAt: "2026-09-18T00:00:00.000Z",
    caseCount: 841,
    caseGroups: ["registry"],
    metrics: { en: metrics({ toolAcc: 0.62 }), bg: metrics({ toolAcc: 0.6 }) },
    legacyMetrics: null,
  },
  // Deliberately in the manifest's real order — newest first, so the Jev run
  // leads. A fixture that put the production run first would make the lane
  // picker right by construction, which is how the "newest non-Jev run" defect
  // stayed green through twelve passing tests.
  runs: [JEV_RUN, CLOUD_RUN],
};

beforeEach(() => clearDataCache());
afterEach(() => clearDataCache());

const show = (manifest: unknown) => {
  setFetcher(serveEvals({ manifest }));
  return renderEvals("bg");
};

const heading = () => screen.findByRole("heading", { name: /маршрутизатора/ });
const comparison = () =>
  screen.getByRole("heading", { name: /маршрутизатора/ }).closest("section")!;
/** Columns after the row header: cases, selection, usable call, routes,
 *  declines, accuracy-over-routed, correctly-silent. */
const cellsOf = (lane: string) =>
  [
    ...comparison()
      .querySelector(`tr[data-lane="${lane}"]`)!
      .querySelectorAll("td"),
  ].map((td) => td.textContent);

describe("three-lane comparison", { timeout: 30_000 }, () => {
  it("shows all three routers on one table", async () => {
    show(baseIndex);
    await heading();
    const section = comparison();
    expect(section.textContent).toContain("Jev (TypeSafe)");
    expect(section.textContent).toContain("google/gemini-3.5-flash-lite");
    expect(section.textContent).toContain("Без AI (правила)");
    // Each row is addressed by a stable id rather than by its rendered name —
    // the cloud lane's name is arbitrary artifact data and could collide.
    for (const id of ["deterministic", "cloud", "jev"])
      expect(
        comparison().querySelector(`tr[data-lane="${id}"]`),
      ).not.toBeNull();
  });

  it("names the lane by its own row header, not just by a cell", async () => {
    show(baseIndex);
    await heading();
    // A screen reader announcing "96.0% / 95.0%" must be told which router it
    // belongs to, on the table whose whole purpose is attributing numbers.
    const row = comparison().querySelector('tr[data-lane="jev"]')!;
    const rowHeader = within(row as HTMLElement).getByRole("rowheader");
    expect(rowHeader.textContent).toContain("Jev (TypeSafe)");
  });

  it("shows how much of the bank Jev routed, beside the accuracy over it", async () => {
    show(baseIndex);
    await heading();
    const c = cellsOf("jev");
    // The decline rate alone would let a reader read 96% as an accuracy over
    // the whole bank. 71% is the denominator that number is measured on, and
    // omitting it is the defect this column exists to close.
    expect(c[3]).toBe("71.0% / 70.0%");
    expect(c[4]).toBe("7.0% / 8.0%");
    expect(c[5]).toBe("96.0% / 95.0%");
  });

  it("names the denominator in the prose, so the two cannot be read as one", async () => {
    show(baseIndex);
    await heading();
    expect(comparison().textContent).toMatch(/Точност върху поетите/);
    expect(comparison().textContent).toMatch(/друг знаменател/);
  });

  it("warns when the lanes were measured on different case counts", async () => {
    // A 12-case smoke run beside two full lanes is the exact way this page
    // could publish a flattering number that means nothing.
    show({
      ...baseIndex,
      runs: [{ ...JEV_RUN, caseCount: 12 }, CLOUD_RUN],
    });
    await heading();
    expect(comparison().textContent).toMatch(/различен брой задачи/);
  });

  it("warns when equal case counts cover DIFFERENT banks", async () => {
    // The one mismatch a reader cannot see for themselves: the visible "Cases"
    // column agrees, and the rows still are not comparable.
    show({
      ...baseIndex,
      runs: [{ ...JEV_RUN, caseGroups: ["starter"] }, CLOUD_RUN],
    });
    await heading();
    expect(comparison().textContent).toMatch(/различни набори/);
    expect(comparison().textContent).not.toMatch(/различен брой задачи/);
  });

  it("does not warn when every lane covers the same cases", async () => {
    show(baseIndex);
    await heading();
    expect(comparison().textContent).not.toMatch(/различен брой задачи/);
    expect(comparison().textContent).not.toMatch(/различни набори/);
  });

  it("prints an em dash for a lane that cannot decline, even when its artifact carries the field", async () => {
    // ⚠️ THE MUTATION-RESISTANT HALF. With the fixture's deterministic metrics
    // left empty, `pct(undefined)` already returns "—", so deleting the
    // `declines` guard outright would still pass — the assertion would be
    // testing `pct()`'s null handling rather than the rule it names. Carrying a
    // REAL 0 in the fixture is the only shape a guard-free implementation
    // cannot satisfy: it would print "0.0% / 0.0%", i.e. claim we measured a
    // decline rate for a router with no decline mechanism.
    show({
      ...baseIndex,
      deterministic: {
        ...baseIndex.deterministic!,
        metrics: {
          en: metrics({ toolAcc: 0.62, jevRouted: 0, jevDeclined: 0 }),
          bg: metrics({ toolAcc: 0.6, jevRouted: 0, jevDeclined: 0 }),
        },
      },
    });
    await heading();
    const c = cellsOf("deterministic");
    expect(c[3]).toBe("—");
    expect(c[4]).toBe("—");
    expect(c[5]).toBe("—");
    for (const cell of [c[3], c[4], c[5]]) expect(cell).not.toMatch(/%/);
    // …and the branch really does discriminate: the lane that CAN decline
    // prints a rate in the very same columns.
    expect(cellsOf("jev")[4]).toMatch(/%/);
  });

  it("says 'not measured' rather than '—' for a declining lane with no figures", async () => {
    // "Has no decline mechanism" and "we did not measure its decline rate" are
    // different claims, and only the first is a fact about the product. An
    // older Jev artifact must not read as a router that never abstains.
    show({
      ...baseIndex,
      runs: [
        { ...JEV_RUN, metrics: { en: metrics(), bg: metrics() } },
        CLOUD_RUN,
      ],
    });
    await heading();
    const c = cellsOf("jev");
    expect(c[3]).toBe("не е измерено");
    expect(c[4]).toBe("не е измерено");
  });

  it("renders nothing at all when the Jev lane has not been run", async () => {
    show({ ...baseIndex, runs: [CLOUD_RUN] });
    // The rest of the page must still render — the section simply absents
    // itself rather than showing a two-lane table under a three-lane heading.
    await screen.findByRole("heading", { name: /Детерминистичен/ });
    expect(
      screen.queryByRole("heading", { name: /маршрутизатора/ }),
    ).toBeNull();
  });

  it("does not publish a three-router heading over two rows", async () => {
    // The cloud lane used to be optional, so a manifest without the production
    // run rendered two rows under a heading that says three.
    show({ ...baseIndex, runs: [JEV_RUN] });
    await screen.findByRole("heading", { name: /Детерминистичен/ });
    expect(
      screen.queryByRole("heading", { name: /маршрутизатора/ }),
    ).toBeNull();
  });
});

// ⚠️ THE TEST THAT WOULD HAVE CAUGHT THE REAL DEFECT. Everything above runs on
// fixtures, and the defect WAS the committed manifest's ordering: the cloud
// lane resolved to "the newest non-Jev run", which is the 367-case
// starter-prompts bank, so the page published the cloud model 28 points below
// its production figure and inverted its ranking against Jev.
describe("against the committed manifest", { timeout: 30_000 }, () => {
  let committed: EvalsIndex;
  beforeAll(async () => {
    committed = await readEvalsIndex<EvalsIndex>();
  });

  it("compares the PRODUCTION cloud run, not whichever ran last", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await heading();
    const production = committed.runs.find(
      (r) => r.file === "current_production.json",
    )!;
    const newestOther = committed.runs.find(
      (r) => r.file !== "current_jev.json",
    )!;
    const c = cellsOf("cloud");
    expect(c[0]).toBe(String(production.caseCount));
    // Discriminating only while the two really are different runs — both carry
    // the same model name, so the case count is what tells them apart.
    expect(newestOther.file).not.toBe(production.file);
    expect(String(newestOther.caseCount)).not.toBe(
      String(production.caseCount),
    );
    expect(c[0]).not.toBe(String(newestOther.caseCount));
  });

  it("says which run the cloud row is, since two artifacts share the model", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await heading();
    const row = comparison().querySelector('tr[data-lane="cloud"]')!;
    expect(row.textContent).toContain("production");
    expect(
      committed.runs.filter((r) => r.model?.includes("gemini")).length,
    ).toBeGreaterThan(1);
  });
});
