import { expect, it } from "vitest";
import { semanticGrounded } from "./semanticGrounding";
import { numbersGrounded } from "./grounding";
const turnout = { turnout_2024: "40%", turnout_2025: "30%" };
it.each([
  "Turnout fell by ten percentage points.",
  "Активността спадна с десет процентни пункта.",
])("rejects unprovided arithmetic in words: %s", (q) => {
  expect(numbersGrounded(q, turnout)).toBe(true);
  expect(semanticGrounded(q, turnout)).toBe(false);
});
it.each([
  "Turnout fell from 40% to 30%, indicating declining public interest.",
  "Спадът показва намаляващ интерес към изборите.",
])("rejects unsupported motivation: %s", (q) =>
  expect(semanticGrounded(q, turnout)).toBe(false),
);
it.each([
  "Two screening signals indicate a minimal risk level.",
  "Два сигнала показват минимално ниво на риск.",
])("rejects a risk threshold without a benchmark: %s", (q) =>
  expect(semanticGrounded(q, { screening_signals: 2 })).toBe(false),
);
it("retains supported comparisons and supplied quantities", () => {
  expect(
    semanticGrounded("Turnout fell from 40% in 2024 to 30% in 2025.", turnout),
  ).toBe(true);
  expect(
    semanticGrounded(
      "There are two screening signals, not proven wrongdoing.",
      { screening_signals: 2, note: "Not proven wrongdoing" },
    ),
  ).toBe(true);
  expect(
    semanticGrounded("A ten percentage point decrease.", {
      decrease_points: 10,
    }),
  ).toBe(true);
  expect(
    semanticGrounded("The risk is classified as minimal.", {
      classification: "minimal risk",
    }),
  ).toBe(true);
});
it("retains the numeric fabrication guard", () =>
  expect(semanticGrounded("Turnout was 85%.", turnout)).toBe(false));

it("allows a supplied missing-data explanation without allowing invented causes", () => {
  const facts = { paid: "unknown", note: "Payment data is not available." };
  expect(
    semanticGrounded(
      "The paid amount is unknown because payment data is not available.",
      facts,
    ),
  ).toBe(true);
  expect(
    semanticGrounded(
      "Payment is delayed because the contractor failed.",
      facts,
    ),
  ).toBe(false);
});
it.each(["twenty-three", "twenty three", "двадесет и три"])(
  "rejects compound quantities assembled from separate facts: %s",
  (phrase) => {
    expect(semanticGrounded(phrase, { a: 20, b: 3 })).toBe(false);
  },
);
