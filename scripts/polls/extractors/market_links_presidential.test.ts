import fs from "node:fs";
import { expect, it } from "vitest";
import { extractMarketLinksPresidential } from "./market_links_presidential";
// pdftotext -layout excerpt of the captured ML92 report, checked against
// the original chart. No values have been repaired or normalized.
const text = fs.readFileSync(
  new URL("./fixtures/market_links_2021_11_presidential.txt", import.meta.url),
  "utf8",
);
it("retains both published bases and all six candidate pairs in the real chart", () => {
  const questions = extractMarketLinksPresidential(text)!;
  expect(questions.map((q) => q.base.respondents)).toEqual([1112, 643]);
  expect(questions.map((q) => q.claims.map((c) => c.value))).toEqual([
    [39.9, 20.9, 6.4, 5.3, 2.6, 1.5],
    [46.7, 25.6, 10.3, 7.7, 2.6, 1.3],
  ]);
  expect(questions.map((q) => q.residual.undecided)).toEqual([13.7, 4.9]);
  expect(questions.map((q) => q.residual.otherNamedMinor)).toEqual([0.7, 0.9]);
});
it("refuses a missing chart row or changed legend order", () => {
  expect(
    extractMarketLinksPresidential(
      text.replace(/Румен Радев[^\n]*\n[^\n]*\n/, ""),
    ),
  ).toBeNull();
  expect(
    extractMarketLinksPresidential(
      text
        .replace("Всички", "TEMP")
        .replace("Гласуващи", "Всички")
        .replace("TEMP", "Гласуващи"),
    ),
  ).toBeNull();
});
