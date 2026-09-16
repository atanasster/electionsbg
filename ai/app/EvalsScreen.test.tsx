import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "../tools/dataClient";
import { ChatNavigationContext } from "./navigation";
import { EvalsScreen } from "./EvalsScreen";

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

// Paths the page fetches. `index.json` is the one under test; the other four are
// rendered above it and must resolve or the whole body (including the new
// sections) stays unmounted.
let failPath: string | null = null;
const serveFromDisk = async (path: string) => {
  if (failPath && path.endsWith(failPath)) throw new Error(`no ${path}`);
  const rel = path.startsWith("/") ? path.slice(1) : path;
  return JSON.parse(await readFile(join(process.cwd(), "data", rel), "utf8"));
};

let manifest: Manifest;
beforeAll(async () => {
  manifest = JSON.parse(
    await readFile(join(process.cwd(), "data/ai/evals/index.json"), "utf8"),
  ) as Manifest;
});

beforeEach(() => {
  failPath = null;
  clearDataCache();
  setFetcher(serveFromDisk);
});
afterEach(() => clearDataCache());

const setup = (lang: "bg" | "en" = "bg") => {
  const prefix = lang === "en" ? "/en" : "";
  return render(
    <ChatNavigationContext.Provider
      value={{
        pathname: `${prefix}/chat/evals`,
        search: "",
        lang,
        navigate: () => {},
      }}
    >
      <EvalsScreen integrated />
    </ChatNavigationContext.Provider>,
  );
};

// `section` carries no aria-label of its own, so the heading is the address.
const sectionUnder = (name: string | RegExp) => {
  const heading = screen.getByRole("heading", { name });
  const section = heading.closest("section");
  if (!section) throw new Error(`no <section> for "${String(name)}"`);
  return section;
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
      "current_starter.json",
      "current_production.json",
      "current_narrowed.json",
      "current_revised.json",
      "current_baseline.json",
      "current_baseline_rescored.json",
    ]);
    // The starter bank is the newest run and the only single-group one, so its
    // sub-label renders too.
    expect(
      within(rows[1]).getAllByText("Начални въпроси (чипове)"),
    ).toHaveLength(2);
    expect(within(rows[1]).getByText("367")).toBeInTheDocument();
    // Every run states how many cases it covers per language.
    expect(within(rows[2]).getByText("474")).toBeInTheDocument();
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
    const narrowed = rows[3];
    expect(within(narrowed).getByText("20k")).toBeInTheDocument();
    expect(within(narrowed).getByText("средно 61.9")).toBeInTheDocument();
    expect(within(narrowed).getByText("принудително")).toBeInTheDocument();
    // Gold-in-candidates is the ceiling narrowing imposes: 941 of 948.
    expect(within(narrowed).getByText("99.3%")).toBeInTheDocument();
    // A run measured before the budget existed must say so rather than show 0.
    const revised = rows[4];
    expect(within(revised).getAllByText("—")).toHaveLength(2);
    const narrowedIdx = manifest.runs.findIndex(
      (r) => r.routingBudget === 20_000 && r.forcedBudget,
    );
    expect(narrowedIdx).toBe(2);
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
