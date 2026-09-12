import { it, expect } from "vitest";
import { capabilityGate } from "./rollcallBenchmarkGate";
it("a fast empty capability response fails the benchmark", () => {
  expect(
    capabilityGate(
      Array(7).fill({
        version: "rollcall-records-v1",
        revision: "r",
        corpora: {},
      }),
      Array(7).fill(1),
    ),
  ).toBe(false);
});
it("capability gate requires ready revisions, six warm samples and the latency target", () => {
  const c = {
    version: "rollcall-records-v1",
    revision: "r",
    corpora: Object.fromEntries(
      [
        "parliamentSessions",
        "parliamentVotes",
        "parliamentCasts",
        "councilSessions",
        "councilResolutions",
        "councilCasts",
      ].map((n) => [n, { ready: true, revision: "r" }]),
    ),
  };
  expect(capabilityGate(Array(7).fill(c), [800, 20, 21, 22, 23, 24, 25])).toBe(
    true,
  );
  expect(capabilityGate(Array(7).fill(c), [1, 1, 1, 1, 1, 1, 600])).toBe(false);
  expect(capabilityGate(Array(6).fill(c), Array(6).fill(1))).toBe(false);
  expect(
    capabilityGate(
      Array(7).fill({ ...c, revision: undefined }),
      Array(7).fill(1),
    ),
  ).toBe(false);
});
