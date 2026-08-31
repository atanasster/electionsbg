import assert from "node:assert/strict";
import test from "node:test";

import { emulatorAdapters } from "../lib/emulator.js";

test("emulator adapters are absent unless explicitly enabled", () => {
  assert.equal(emulatorAdapters({}), null);
});

test("emulator adapters refuse production and non-demo projects", () => {
  for (const environment of [
    { NEWS_EVAL_EMULATOR_ADAPTERS: "true" },
    {
      NEWS_EVAL_EMULATOR_ADAPTERS: "true",
      FUNCTIONS_EMULATOR: "true",
      GCLOUD_PROJECT: "electionsbg-news",
    },
    {
      NEWS_EVAL_EMULATOR_ADAPTERS: "true",
      GCLOUD_PROJECT: "demo-news-evals",
    },
  ])
    assert.throws(() => emulatorAdapters(environment), /requires/);
});

test("demo emulator adapters provide deterministic clock, HMAC, and Turnstile", async () => {
  const adapters = emulatorAdapters({
    NEWS_EVAL_EMULATOR_ADAPTERS: "true",
    FUNCTIONS_EMULATOR: "true",
    GCLOUD_PROJECT: "demo-news-evals",
  });
  assert.ok(adapters);
  assert.equal(adapters.clock.now().toISOString(), "2026-08-31T10:15:00.000Z");
  assert.equal(adapters.hmacKeyring.activeVersion, "emulator-v1");
  assert.deepEqual(
    await adapters.turnstileVerifier.verify({
      token: "emulator-valid-one",
      remoteIp: null,
      now: adapters.clock.now(),
    }),
    { kind: "valid" },
  );
  assert.deepEqual(
    await adapters.turnstileVerifier.verify({
      token: "emulator-invalid",
      remoteIp: null,
      now: adapters.clock.now(),
    }),
    { kind: "invalid", reason: "provider_rejected" },
  );
});
