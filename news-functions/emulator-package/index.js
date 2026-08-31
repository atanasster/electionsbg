import { onRequest } from "firebase-functions/v2/https";

import { emulatorAdapters } from "../lib/emulator.js";
import { handleNewsEvalsRequest } from "../lib/http.js";
import {
  NEWS_EVALS_HTTPS_OPTIONS,
  runtimeHttpConfig,
} from "../lib/runtime.js";

let httpConfig;

function guardedHttpConfig() {
  if (httpConfig) return httpConfig;
  const adapters = emulatorAdapters();
  if (!adapters)
    throw new Error("the emulator wrapper requires guarded fake adapters");
  httpConfig = runtimeHttpConfig({
    clock: adapters.clock,
    security: () => ({
      turnstileVerifier: adapters.turnstileVerifier,
      hmacKeyring: adapters.hmacKeyring,
    }),
  });
  return httpConfig;
}

export const newsEvals = onRequest(
  NEWS_EVALS_HTTPS_OPTIONS,
  (request, response) =>
    handleNewsEvalsRequest(request, response, guardedHttpConfig()),
);
