// The client's per-question call budget must equal the proxy's reservation.
// If the client believed it had more calls than the proxy grants, the lane
// would plan a narration call the proxy then rejects with 429 `call_limit`;
// fewer, and it would word answers from templates for no reason. They live in
// different packages, so this is a gate rather than a shared constant.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { CALLS_PER_QUESTION } from "./jevAiLane";

const require = createRequire(import.meta.url);
const { POLICY } = require("../../functions/llm_security.js") as {
  POLICY: { calls: number };
};

describe("per-question call budget", () => {
  it("matches the proxy's reservation", () => {
    expect(CALLS_PER_QUESTION).toBe(POLICY.calls);
  });
});
