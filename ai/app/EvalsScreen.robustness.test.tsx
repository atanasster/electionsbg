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

const bg = (v: number | null | undefined) =>
  v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;

const section = () =>
  document.querySelector<HTMLElement>(
    'section[aria-labelledby="robust-title"]',
  )!;

describe("robustness section", { timeout: 30_000 }, () => {
  let committed: EvalsIndex;
  beforeAll(async () => {
    committed = await readEvalsIndex<EvalsIndex>();
  });

  it("shows all three tables, one row per kind of question", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const tables = section().querySelectorAll("table");
    expect(tables).toHaveLength(3);
    for (const t of tables)
      expect(t.querySelectorAll("tbody tr[data-variant]")).toHaveLength(4);
  });

  it("prints the committed figures, and no English figure for Latin script", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const s = committed.robustness!.summary;
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

  // The no-AI Jev lane (stage 3). Its column must read the stage-3 summary,
  // NOT `jevLane` — the older lane that fell back to the rules, which is still
  // in the manifest under a key that would read as the same thing.
  it("reads the „Jev без AI“ column from the stage-3 run, not the older lane", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const s = committed.robustness!.summary;
    const noAi = committed.robustness!.noAi!;
    const typo = section().querySelector('tr[data-variant="typo"]')!;
    const want = `${bg(noAi["all|en:typo"].right)} / ${bg(noAi["all|bg:typo"].right)}`;
    // Discriminating only while the two lanes really differ on this row.
    expect(want).not.toBe(
      `${bg(s["all|en:typo"].jevLane)} / ${bg(s["all|bg:typo"].jevLane)}`,
    );
    expect(typo.querySelectorAll("td")[2].textContent).toBe(want);
  });

  it("shows where the no-AI lane's questions go, and the rules beside it", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    const noAi = committed.robustness!.noAi!;
    const s = committed.robustness!.summary;
    const box = section().querySelector<HTMLElement>(
      '[data-testid="noai-outcomes"]',
    )!;
    const typo = box.querySelector('tr[data-variant="typo"]')!;
    const tds = [...typo.querySelectorAll("td")].map((td) => td.textContent);
    expect(tds).toEqual(
      (["right", "asked", "wrong", "none"] as const).map(
        (k) => `${bg(noAi["all|en:typo"][k])} / ${bg(noAi["all|bg:typo"][k])}`,
      ),
    );
    expect(box.textContent).toContain(
      `правилата сами: ${bg(s["all|en:typo"].rules)} / ${bg(s["all|bg:typo"].rules)}`,
    );
  });

  it("drops the no-AI column and table when the stage run is not published", async () => {
    setFetcher(
      serveEvals({
        manifest: {
          ...committed,
          robustness: { ...committed.robustness!, noAi: undefined },
        },
      }),
    );
    renderEvals("bg");
    await screen.findByRole("heading", { name: HEADING });
    expect(section().querySelectorAll("table")).toHaveLength(2);
    expect(section().textContent).not.toMatch(/Jev без AI/);
  });

  // The summary's no-AI block: rules vs Jev + rules, on the robustness
  // questions — never on the 474, which are mostly the rules' own examples.
  it("puts rules and Jev + rules side by side in the summary", async () => {
    setFetcher(serveEvals());
    renderEvals("bg");
    await screen.findByRole("heading", { name: "Накратко" });
    const s = committed.robustness!.summary;
    const noAi = committed.robustness!.noAi!;
    const box = document.querySelector<HTMLElement>(
      '[data-testid="noai-summary"]',
    )!;
    expect(
      box.closest('section[aria-labelledby="summary-title"]'),
    ).not.toBeNull();
    const tds = [
      ...box.querySelector('tr[data-variant="typo"]')!.querySelectorAll("td"),
    ].map((td) => td.textContent);
    expect(tds).toEqual([
      `${bg(s["all|en:typo"].rules)} / ${bg(s["all|bg:typo"].rules)}`,
      `${bg(noAi["all|en:typo"].right)} / ${bg(noAi["all|bg:typo"].right)}`,
      `${bg(noAi["all|en:typo"].asked)} / ${bg(noAi["all|bg:typo"].asked)}`,
    ]);
    // The head-to-head count is recomputed here, independently.
    const keys = Object.keys(noAi).filter((k) => k.startsWith("all|"));
    const wins = keys.filter(
      (k) => noAi[k].right >= (s[k]?.rules ?? Infinity),
    ).length;
    expect(box.textContent).toContain(`в ${wins} от ${keys.length} случая`);
    // …and says the chat's no-AI mode is still the rules.
    expect(box.textContent).toMatch(/остава на правилата/);
  });

  it("leaves the summary's no-AI block out without the stage run", async () => {
    setFetcher(
      serveEvals({
        manifest: {
          ...committed,
          robustness: { ...committed.robustness!, noAi: undefined },
        },
      }),
    );
    renderEvals("bg");
    await screen.findByRole("heading", { name: "Накратко" });
    expect(document.querySelector('[data-testid="noai-summary"]')).toBeNull();
  });

  it("is absent when the manifest carries no robustness run", async () => {
    setFetcher(serveEvals({ manifest: { ...committed, robustness: null } }));
    renderEvals("bg");
    await screen.findByRole("heading", { name: "Накратко" });
    expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
  });
});
