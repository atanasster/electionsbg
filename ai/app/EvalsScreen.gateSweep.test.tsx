// The gate sweep answers one question — would a lower confidence gate make the
// Jev lane better? — and the page must not answer it by prose written once and
// left to go stale. So the takeaway sentence is computed, and these tests hold
// it to the data: against the committed manifest, and against a fixture where
// the answer flips.
import { screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearDataCache, setFetcher } from "../tools/dataClient";
import {
  readEvalsIndex,
  renderEvals,
  serveEvals,
} from "./evalsHarness.test-utils";
import type { EvalsIndex } from "./EvalsScreen";
import type { GateSweep, GateSweepMetrics } from "../llm/evalsIndex";

const HEADING = /Праг на увереност за Jev/;

beforeEach(() => clearDataCache());
afterEach(() => clearDataCache());

const section = () =>
  screen.getByRole("heading", { name: HEADING }).closest("section")!;
const rowFor = (gate: number) =>
  section().querySelector(`tr[data-gate="${gate}"]`)!;
const cellsOf = (gate: number) =>
  [...rowFor(gate).querySelectorAll("td")].map((td) => td.textContent);

/** How many lower gates Jev loses the head-to-head at, straight from the data —
 *  the independent recount the rendered sentence is checked against. */
const worseCount = (sweep: GateSweep, lang: "en" | "bg") =>
  sweep.sweep.filter(
    (s) =>
      s.gate < sweep.publishedGate &&
      s.metrics[lang].movedJevToolAcc != null &&
      s.metrics[lang].movedRulesToolAcc != null &&
      s.metrics[lang].movedJevToolAcc! < s.metrics[lang].movedRulesToolAcc!,
  ).length;

describe(
  "gate sweep — against the committed manifest",
  { timeout: 30_000 },
  () => {
    let committed: EvalsIndex;
    beforeAll(async () => {
      committed = await readEvalsIndex<EvalsIndex>();
    });

    it("renders one row per swept gate", async () => {
      setFetcher(serveEvals());
      renderEvals("bg");
      await screen.findByRole("heading", { name: HEADING });
      const sweep = committed.gateSweep!;
      expect(section().querySelectorAll("tbody tr")).toHaveLength(
        sweep.sweep.length,
      );
    });

    it("states the head-to-head count the data actually supports", async () => {
      setFetcher(serveEvals());
      renderEvals("bg");
      await screen.findByRole("heading", { name: HEADING });
      const sweep = committed.gateSweep!;
      const lower = sweep.sweep.filter((s) => s.gate < sweep.publishedGate);
      expect(section().textContent).toContain(
        `при ${worseCount(sweep, "en")} от ${lower.length} по-ниски прага на английски и при ${worseCount(sweep, "bg")} от ${lower.length} на български`,
      );
    });

    it("marks the current gate and shows no head-to-head on it", async () => {
      // Rows "gained" at the published gate are not gained by any gate change —
      // they are Jev's confidence varying between calls. Printing a head-to-head
      // there would present that variance as a finding.
      setFetcher(serveEvals());
      renderEvals("bg");
      await screen.findByRole("heading", { name: HEADING });
      const sweep = committed.gateSweep!;
      expect(rowFor(sweep.publishedGate).textContent).toContain("текущ");
      const c = cellsOf(sweep.publishedGate);
      expect(c[5]).toBe("—");
      expect(c[6]).toBe("—");
      expect(c[7]).toBe("—");
      // …and the variance it hides there is stated instead.
      expect(section().textContent).toContain(
        `${sweep.crossedPublishedGate} от тези ходове се върнаха над текущия праг`,
      );
    });

    it("prints the head-to-head on a lower gate", async () => {
      setFetcher(serveEvals());
      renderEvals("bg");
      await screen.findByRole("heading", { name: HEADING });
      const low = committed.gateSweep!.sweep[0];
      const c = cellsOf(low.gate);
      expect(c[5]).toBe(`${low.metrics.en.moved} / ${low.metrics.bg.moved}`);
      expect(c[6]).toMatch(/%.*\/.*%/);
      expect(c[7]).toMatch(/%.*\/.*%/);
    });
  },
);

// Fixtures, so the computed sentence is shown to FOLLOW the data rather than
// match it by coincidence: flip who wins and the count must flip with it.
const m = (over: Partial<GateSweepMetrics> = {}): GateSweepMetrics => ({
  n: 841,
  toolAcc: 0.9,
  callAcc: 0.89,
  argAcc: 0.87,
  irrelevanceAcc: 0.8,
  jevRouted: 0.75,
  moved: 40,
  movedJevToolAcc: 0.8,
  movedRulesToolAcc: 0.9,
  movedJevCallAcc: 0.8,
  movedRulesCallAcc: 0.9,
  ...over,
});

const sweepWhere = (jevWins: boolean): GateSweep => ({
  generatedAt: "2026-09-18T00:00:00.000Z",
  publishedGate: 0.7,
  reasked: 321,
  outagesOnReask: 0,
  crossedPublishedGate: 23,
  meanConfidenceDrift: 0.038,
  sweep: [0.5, 0.6, 0.7].map((gate) => ({
    gate,
    metrics: {
      en: m(jevWins ? { movedJevToolAcc: 0.95 } : {}),
      bg: m(jevWins ? { movedJevToolAcc: 0.95 } : {}),
    },
  })),
});

describe(
  "gate sweep — the sentence follows the data",
  { timeout: 30_000 },
  () => {
    let base: EvalsIndex;
    beforeAll(async () => {
      base = await readEvalsIndex<EvalsIndex>();
    });

    it("reports Jev losing when it loses", async () => {
      setFetcher(
        serveEvals({ manifest: { ...base, gateSweep: sweepWhere(false) } }),
      );
      renderEvals("bg");
      await screen.findByRole("heading", { name: HEADING });
      expect(section().textContent).toContain(
        "при 2 от 2 по-ниски прага на английски и при 2 от 2 на български",
      );
    });

    it("reports zero when Jev wins every head-to-head", async () => {
      setFetcher(
        serveEvals({ manifest: { ...base, gateSweep: sweepWhere(true) } }),
      );
      renderEvals("bg");
      await screen.findByRole("heading", { name: HEADING });
      expect(section().textContent).toContain(
        "при 0 от 2 по-ниски прага на английски и при 0 от 2 на български",
      );
    });

    it("is absent when the manifest carries no sweep", async () => {
      setFetcher(serveEvals({ manifest: { ...base, gateSweep: null } }));
      renderEvals("bg");
      // The rest of the page still renders; the section simply absents itself.
      await screen.findByRole("heading", { name: /маршрутизатора/ });
      expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
    });
  },
);
