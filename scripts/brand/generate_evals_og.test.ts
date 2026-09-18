// The evals OG card must say what the page says. It went stale once by reading
// a different artifact than the page (the retired fc_eval.json comparison), so
// it now reads the page's own manifest — and must refuse, not fall back, when
// the figures are missing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readBars } from "./generate_evals_og";

const manifest = JSON.parse(readFileSync("data/ai/evals/index.json", "utf8"));

describe("evals OG card", () => {
  it("draws the page's own typo figures, Jev + Gemini as the hero", () => {
    const s = manifest.robustness.summary["all|bg:typo"];
    const noAi = manifest.robustness.noAi["all|bg:typo"];
    const pct = (v: number) => Math.round(v * 100);
    expect(readBars(manifest)).toEqual([
      { label: "Правила", pct: pct(s.rules) },
      { label: "Jev + правила", pct: pct(noAi.right) },
      { label: "Само Gemini", pct: pct(s.gemini) },
      { label: "Jev + Gemini", pct: pct(s.jevGemini), hero: true },
    ]);
  });

  it("refuses rather than drawing a card without the figures", () => {
    expect(() => readBars({ robustness: null })).toThrow(/robustness/);
    expect(() =>
      readBars({
        robustness: { ...manifest.robustness, noAi: undefined },
      }),
    ).toThrow(/robustness/);
  });
});
