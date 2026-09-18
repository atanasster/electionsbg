// The robustness section is where the methods separate — the main test is
// mostly the rules' own examples. Its takeaway is computed, so these tests hold
// it to an independent recount over the committed manifest.
import { screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "../tools/dataClient";
import {
  readEvalsIndex,
  renderEvals,
  serveEvals,
} from "./evalsHarness.test-utils";
import type { EvalsIndex } from "./EvalsScreen";

const HEADING = "Когато въпросът е написан по-различно";

beforeEach(() => clearDataCache());
afterEach(() => clearDataCache());

const section = () =>
  document.querySelector<HTMLElement>(
    'section[aria-labelledby="robust-title"]',
  )!;

describe("robustness section", { timeout: 30_000 }, () => {
  let committed: EvalsIndex;
  beforeAll(async () => {
    committed = await readEvalsIndex<EvalsIndex>();
  });

  it("shows both tables, one row per kind of question", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const tables = section().querySelectorAll("table");
    expect(tables).toHaveLength(2);
    for (const t of tables)
      expect(t.querySelectorAll("tbody tr[data-variant]")).toHaveLength(4);
  });

  it("prints the committed figures, and no English figure for Latin script", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const s = committed.robustness!.summary;
    const bg = (v: number | null) =>
      v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
    const typo = section().querySelector('tr[data-variant="typo"]')!;
    // Column 5 of the td cells is Jev + Gemini.
    expect(typo.querySelectorAll("td")[4].textContent).toBe(
      `${bg(s["all|en:typo"].jevGemini)} / ${bg(s["all|bg:typo"].jevGemini)}`,
    );
    // Latin script is a Bulgarian-only variant: the EN half is a dash.
    const latin = section().querySelector('tr[data-variant="latin"]')!;
    expect(latin.querySelectorAll("td")[0].textContent).toMatch(/^— \//);
  });

  it("states the head-to-head count the data supports", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const all = Object.entries(committed.robustness!.summary).filter(([k]) =>
      k.startsWith("all|"),
    );
    const wins = all.filter(
      ([, c]) => (c.jevGemini ?? 0) >= (c.gemini ?? 0),
    ).length;
    expect(section().textContent).toContain(
      `в ${wins} от ${all.length} случая`,
    );
  });

  it("is absent when the manifest carries no robustness run", async () => {
    setFetcher(serveEvals({ manifest: { ...committed, robustness: null } }));
    renderEvals("bg");
    await screen.findByRole("heading", { name: "Накратко" });
    expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
  });
});
