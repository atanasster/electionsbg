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

// The runs table is one row per manifest run under a header row, so a run's
// row is addressed by its FILE rather than by a fixed index — publishing a new
// artifact re-orders the table, and a hard-coded index would then silently make
// these assertions about a different run instead of failing.
const rowFor = (rows: HTMLElement[], file: string) => {
  const i = manifest.runs.findIndex((r) => r.file === file);
  if (i < 0) throw new Error(`no run "${file}" in the committed manifest`);
  return rows[i + 1];
};

describe("EvalsScreen published runs", { timeout: 30_000 }, () => {
  it("renders every run in the committed manifest, in manifest order", async () => {
    setup("bg");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Всички публикувани измервания",
        }),
      ).toBeInTheDocument(),
    );
    const section = sectionUnder("Всички публикувани измервания");
    // One row per run, plus the header row — no run may be dropped.
    const rows = within(section).getAllByRole("row");
    expect(rows).toHaveLength(manifest.runs.length + 1);
    expect(manifest.runs.map((r) => r.file)).toEqual([
      "current_jev.json",
      "current_starter.json",
      "current_production.json",
      "current_narrowed.json",
      "current_revised.json",
      "current_baseline.json",
      "current_baseline_rescored.json",
    ]);
    // The starter bank is the only single-group run, so its sub-label renders
    // too.
    const starter = rowFor(rows, "current_starter.json");
    expect(
      within(starter).getAllByText("Начални въпроси (чипове)"),
    ).toHaveLength(2);
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
          name: "Всички публикувани измервания",
        }),
      ).toBeInTheDocument();
      return sectionUnder("Всички публикувани измервания");
    });
    const rows = within(section).getAllByRole("row");
    const narrowed = rowFor(rows, "current_narrowed.json");
    expect(within(narrowed).getByText("20k")).toBeInTheDocument();
    expect(within(narrowed).getByText("средно 61.9")).toBeInTheDocument();
    expect(within(narrowed).getByText("принудително")).toBeInTheDocument();
    // Gold-in-candidates is the ceiling narrowing imposes: 941 of 948.
    expect(within(narrowed).getByText("99.3%")).toBeInTheDocument();
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
          name: "Детерминистичен маршрутизатор (без AI)",
        }),
      ).toBeInTheDocument();
      return sectionUnder("Детерминистичен маршрутизатор (без AI)");
    });
    const rows = within(section).getAllByRole("row");
    // Header + the two corpora: all 841 cases, and the 474 without starters,
    // because the published floors were registered on the latter.
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1]).getByText("Всички задачи (с началните въпроси)"),
    ).toBeInTheDocument();
    expect(within(rows[1]).getByText("841 / 841")).toBeInTheDocument();
    expect(
      within(rows[2]).getByText("Без началните въпроси"),
    ).toBeInTheDocument();
    expect(within(rows[2]).getByText("474 / 474")).toBeInTheDocument();
  });

  it("renders the sections in English on the /en path", async () => {
    setup("en");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "All published runs" }),
      ).toBeInTheDocument(),
    );
    const runs = sectionUnder("All published runs");
    expect(within(runs).getAllByRole("row")).toHaveLength(
      manifest.runs.length + 1,
    );
    expect(within(runs).getAllByText("Starter prompts (chips)")).toHaveLength(
      2,
    );
    expect(
      within(runs).getByText("Narrowed catalogue (forced budget)"),
    ).toBeInTheDocument();
    expect(within(runs).getByText("forced")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Deterministic router (no AI)",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the rest of the page when the manifest is missing", async () => {
    failPath = "/ai/evals/index.json";
    setup("bg");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Покритие и ограничения" }),
      ).toBeInTheDocument(),
    );
    // A missing manifest degrades to no manifest sections — it must not blank
    // the page or surface as a load error, because the run itself loaded.
    expect(
      screen.queryByRole("heading", { name: "Всички публикувани измервания" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Детерминистичен маршрутизатор (без AI)",
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
      screen.queryByRole("heading", { name: "Всички публикувани измервания" }),
    ).toBeNull();
  });
});
