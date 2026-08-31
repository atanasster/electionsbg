import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { info } from "firebase-functions/logger";

import {
  FixedWindowAttemptLimiter,
  type Clock,
  type HmacKeyring,
} from "./abuse.js";
import { PUBLIC_ABUSE_POLICY } from "./contract.js";
import { allowedOrigins, type HttpConfig } from "./http.js";
import type { SecurityEvent, SecurityMetrics } from "./security.js";
import { FirestoreEvaluationStore, type FirestoreLike } from "./storage.js";
import type { TurnstileVerifier } from "./turnstile.js";

export const NEWS_EVALS_HTTPS_OPTIONS = Object.freeze({
  region: "europe-west3",
  memory: "256MiB" as const,
  timeoutSeconds: 15,
  maxInstances: 10,
});

const firebaseApp = getApps()[0] ?? initializeApp();
const evaluationStore = new FirestoreEvaluationStore(
  getFirestore(firebaseApp) as unknown as FirestoreLike,
);
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

export function runtimeHttpConfig(input: {
  security(): Readonly<{
    turnstileVerifier: TurnstileVerifier;
    hmacKeyring: HmacKeyring;
  }>;
  clock?: Clock;
}): HttpConfig {
  return {
    allowedOrigins: allowedOrigins(),
    attemptLimiter,
    metrics: securityMetrics,
    store: evaluationStore,
    ...(input.clock ? { clock: input.clock } : {}),
    security: input.security,
  };
}
