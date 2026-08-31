import { onRequest } from "firebase-functions/v2/https";
import { defineJsonSecret, defineSecret } from "firebase-functions/params";

import { parseHmacKeyring } from "./abuse.js";
import { handleNewsEvalsRequest } from "./http.js";
import { NEWS_EVALS_HTTPS_OPTIONS, runtimeHttpConfig } from "./runtime.js";
import { CloudflareTurnstileVerifier } from "./turnstile.js";

export const TURNSTILE_SECRET_NAME = "NEWS_EVAL_TURNSTILE_SECRET";
export const HMAC_KEYRING_SECRET_NAME = "NEWS_EVAL_HMAC_KEYRING";

const turnstileSecret = defineSecret(TURNSTILE_SECRET_NAME);
const hmacKeyringSecret = defineJsonSecret(HMAC_KEYRING_SECRET_NAME);
const httpConfig = runtimeHttpConfig({
  security: () => ({
    turnstileVerifier: new CloudflareTurnstileVerifier(turnstileSecret.value()),
    hmacKeyring: parseHmacKeyring(hmacKeyringSecret.value()),
  }),
});

/**
 * Isolated public boundary for the no-login news evaluator.
 */
export const newsEvals = onRequest(
  {
    ...NEWS_EVALS_HTTPS_OPTIONS,
    secrets: [turnstileSecret, hmacKeyringSecret],
  },
  (request, response) => handleNewsEvalsRequest(request, response, httpConfig),
);
