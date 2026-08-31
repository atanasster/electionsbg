import { onRequest } from "firebase-functions/v2/https";
import { info } from "firebase-functions/logger";
import { defineJsonSecret, defineSecret } from "firebase-functions/params";

import { FixedWindowAttemptLimiter, parseHmacKeyring } from "./abuse.js";
import { PUBLIC_ABUSE_POLICY } from "./contract.js";
import { allowedOrigins, handleNewsEvalsRequest } from "./http.js";
import type { SecurityEvent, SecurityMetrics } from "./security.js";
import { CloudflareTurnstileVerifier } from "./turnstile.js";

export const TURNSTILE_SECRET_NAME = "NEWS_EVAL_TURNSTILE_SECRET";
export const HMAC_KEYRING_SECRET_NAME = "NEWS_EVAL_HMAC_KEYRING";

const turnstileSecret = defineSecret(TURNSTILE_SECRET_NAME);
const hmacKeyringSecret = defineJsonSecret(HMAC_KEYRING_SECRET_NAME);
const attemptLimiter = new FixedWindowAttemptLimiter(
  PUBLIC_ABUSE_POLICY.siteverifyAttemptsPerInstanceMinute,
);
const securityMetrics: SecurityMetrics = Object.freeze({
  record(event: SecurityEvent, latencyMilliseconds?: number) {
    info("news_eval_security", {
      event,
      ...(latencyMilliseconds === undefined
        ? {}
        : { latency_ms: latencyMilliseconds }),
    });
  },
});

/**
 * Isolated public boundary for the no-login news evaluator.
 *
 * Public routes stay storage-closed until the abuse and transaction steps.
 */
export const newsEvals = onRequest(
  {
    region: "europe-west3",
    memory: "256MiB",
    timeoutSeconds: 15,
    maxInstances: 10,
    secrets: [turnstileSecret, hmacKeyringSecret],
  },
  (request, response) =>
    handleNewsEvalsRequest(request, response, {
      allowedOrigins: allowedOrigins(),
      attemptLimiter,
      metrics: securityMetrics,
      security: () => ({
        turnstileVerifier: new CloudflareTurnstileVerifier(
          turnstileSecret.value(),
        ),
        hmacKeyring: parseHmacKeyring(hmacKeyringSecret.value()),
      }),
    }),
);
