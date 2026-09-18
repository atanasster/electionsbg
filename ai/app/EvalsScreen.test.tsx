import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "../tools/dataClient";
import {
  readEvalsIndex,
  renderEvals,
  serveEvals,
} from "./evalsHarness.test-utils";

// The page reads its published-run manifest from the bucket at
// `/ai/evals/index.json`, so the test serves the SAME committed artifacts the
// deploy ships, through the real `fetchData` seam. That is deliberate: the point
// of these assertions is that the page still renders every published run, which
// is what the reader uses to see that a new measurement did not degrade an old
// one. A hand-written fixture would keep passing after an artifact was renamed.
type Manifest = {
  runs: {
    file: string;
    label: string;
    caseCount: number;
    routingBudget: number | null;
    forcedBudget: boolean;
  }[];
  deterministic: { caseCount: number } | null;
};

let failPath: string | null = null;
let manifest: Manifest;
beforeAll(async () => {
  manifest = await readEvalsIndex<Manifest>();
});

beforeEach(() => {
  failPath = null;
  clearDataCache();
  // Re-read per test: `failPath` is captured by the closure, so the fetcher has
  // to be rebuilt after it is reassigned.
  setFetcher((path) => serveEvals({ failPath })(path));
});
afterEach(() => clearDataCache());

const setup = (lang: "bg" | "en" = "bg") => renderEvals(lang);

// `section` carries no aria-label of its own, so the heading is the address.
const sectionUnder = (name: string | RegExp) => {
  const heading = screen.getByRole("heading", { name });
  const section = heading.closest("section");
  if (!section) throw new Error(`no <section> for "${String(name)}"`);
  return section;
};

// The runs table is one row per cloud-model run under a header row, so a run's
// row is addressed by its FILE rather than by a fixed index — publishing a new
// artifact re-orders the table, and a hard-coded index would then silently make
// these assertions about a different run instead of failing.
const cloudRuns = () => manifest.runs;
const rowFor = (rows: HTMLElement[], file: string) => {
  const i = cloudRuns().findIndex((r) => r.file === file);
  if (i < 0) throw new Error(`no run "${file}" in the committed manifest`);
  return rows[i + 1];
};

describe("EvalsScreen published runs", { timeout: 30_000 }, () => {
  it("renders every cloud-model run in the committed manifest, in order", async () => {
    setup("bg");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Всички измервания на облачния модел",
        }),
      ).toBeInTheDocument(),
    );
    const section = sectionUnder("Всички измервания на облачния модел");
    // One row per cloud run, plus the header row — no run may be dropped.
    const rows = within(section).getAllByRole("row");
    expect(rows).toHaveLength(cloudRuns().length + 1);
    expect(manifest.runs.map((r) => r.file)).toEqual([
      "current_control.json",
      "current_jev_gemini.json",
      "current_starter.json",
      "current_production.json",
      "current_narrowed.json",
      "current_revised.json",
      "current_baseline.json",
      "current_baseline_rescored.json",
    ]);
    // The starter bank is the only single-group run; its group line would only
    // repeat its name, so the name appears once.
    const starter = rowFor(rows, "current_starter.json");
    expect(within(starter).getAllByText("Предложени въпроси")).toHaveLength(1);
    expect(within(starter).getByText("367")).toBeInTheDocument();
    // Every run states how many cases it covers per language.
    expect(
      within(rowFor(rows, "current_production.json")).getByText("474"),
    ).toBeInTheDocument();
  });

  it("shows the narrowing budget, the forced badge and the gold ceiling", async () => {
    setup("bg");
    const section = await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Всички измервания на облачния модел",
        }),
      ).toBeInTheDocument();
      return sectionUnder("Всички измервания на облачния модел");
    });
    const rows = within(section).getAllByRole("row");
    const narrowed = rowFor(rows, "current_narrowed.json");
    expect(within(narrowed).getByText("20k")).toBeInTheDocument();
    expect(within(narrowed).getByText("средно 61,9")).toBeInTheDocument();
    expect(within(narrowed).getByText("принудително")).toBeInTheDocument();
    // Gold-in-candidates is the ceiling narrowing imposes: 941 of 948.
    expect(within(narrowed).getByText("99,3%")).toBeInTheDocument();
    // A run measured before the budget existed must say so rather than show 0.
    const revised = rowFor(rows, "current_revised.json");
    expect(within(revised).getAllByText("—")).toHaveLength(2);
    // The row this test read really is the narrowed run, not merely whichever
    // run happens to sit at that position after a new artifact is published.
    expect(
      manifest.runs.findIndex(
        (r) => r.routingBudget === 20_000 && r.forcedBudget,
      ),
    ).toBe(manifest.runs.findIndex((r) => r.file === "current_narrowed.json"));
  });

  it("renders the free no-AI lane for both corpora", async () => {
    setup("bg");
    expect(manifest.deterministic?.caseCount).toBe(841);
    const section = await waitFor(() => {
      expect(
        screen.getByRole("heading", {
          name: "Правилата без AI",
        }),
      ).toBeInTheDocument();
      return sectionUnder("Правилата без AI");
    });
    const rows = within(section).getAllByRole("row");
    // Header + the two corpora: all 841 cases, and the 474 without starters,
    // because the published floors were registered on the latter.
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1]).getByText("Всички, с предложените въпроси"),
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText("841 / 841")).toBeInTheDocument();
    expect(
      within(rows[2]).getByText("Без предложените въпроси"),
    ).toBeInTheDocument();
    expect(within(rows[2]).getByText("474 / 474")).toBeInTheDocument();
  });

  it("renders the sections in English on the /en path", async () => {
    setup("en");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "All cloud-model runs" }),
      ).toBeInTheDocument(),
    );
    const runs = sectionUnder("All cloud-model runs");
    expect(within(runs).getAllByRole("row")).toHaveLength(
      cloudRuns().length + 1,
    );
    expect(within(runs).getAllByText("Suggested questions")).toHaveLength(1);
    expect(within(runs).getByText("Narrowed catalogue")).toBeInTheDocument();
    expect(within(runs).getByText("forced")).toBeInTheDocument();
    // English keeps the decimal POINT; the Bulgarian view uses a comma (the
    // "99,3%" assertion above) — one formatter, switched by language.
    expect(within(runs).getByText("99.3%")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Rules without AI",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the rest of the page when the manifest is missing", async () => {
    failPath = "/ai/evals/index.json";
    setup("bg");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "По групи въпроси" }),
      ).toBeInTheDocument(),
    );
    // A missing manifest degrades to no manifest sections — it must not blank
    // the page or surface as a load error, because the run itself loaded.
    expect(
      screen.queryByRole("heading", {
        name: "Всички измервания на облачния модел",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Правилата без AI",
      }),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hides the manifest sections when the current run cannot load", async () => {
    // The sections live inside the `run &&` branch, so this pins the coupling:
    // the manifest is never rendered without the run it annotates.
    failPath = "/ai/evals/current_production.json";
    setup("bg");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.queryByRole("heading", {
        name: "Всички измервания на облачния модел",
      }),
    ).toBeNull();
  });
});

describe("EvalsScreen layout", { timeout: 30_000 }, () => {
  it("tells the history in order, each step with its decision", async () => {
    setup("bg");
    const section = await waitFor(() => sectionUnder("Как стигнахме дотук"));
    const steps = within(section).getAllByRole("listitem");
    expect(steps.length).toBeGreaterThanOrEqual(8);
    // Every step says what was decided, or the timeline is a list of attempts
    // with no explanation of why the chat is built the way it is.
    for (const step of steps) expect(step.textContent).toContain("Решение:");
    // Oldest first: the rules come before the cloud model, Jev last.
    const titles = steps.map((s) => s.textContent ?? "");
    expect(titles.findIndex((x) => x.includes("Правила без AI"))).toBe(0);
    expect(titles[titles.length - 1]).toContain("Jev");
  });

  it("never lets a header or a figure wrap onto a second line", async () => {
    // A figure split across two lines ("90.6% /" then "91.4%") reads as two
    // numbers, and a wrapped header doubles every table's height. Every column
    // header and every numeric cell must carry `whitespace-nowrap`; the only
    // cells allowed to wrap are the free-text question cells.
    setup("bg");
    await waitFor(() => sectionUnder("Всички измервания на облачния модел"));
    const headers = [...document.querySelectorAll('th[scope="col"]')];
    expect(headers.length).toBeGreaterThan(30);
    const wrapping = headers.filter(
      (h) => !h.className.includes("whitespace-nowrap"),
    );
    expect(wrapping.map((h) => h.textContent)).toEqual([]);
    const figures = [...document.querySelectorAll("td")].filter((td) =>
      /^\s*[\d.,]+%/.test(td.textContent ?? ""),
    );
    expect(figures.length).toBeGreaterThan(30);
    expect(
      figures
        .filter((td) => !td.className.includes("whitespace-nowrap"))
        .map((td) => td.textContent),
    ).toEqual([]);
  });
});
