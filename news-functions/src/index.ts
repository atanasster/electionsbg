import { onRequest } from "firebase-functions/v2/https";

const UNAVAILABLE = {
  error: {
    code: "not_implemented",
    message: "The public evaluation API is not enabled yet.",
  },
} as const;

type ClosedResponse = {
  set(name: string, value: string): ClosedResponse;
  status(code: number): ClosedResponse;
  send(body: string): unknown;
};

export function closedScaffoldHandler(
  _request: unknown,
  response: ClosedResponse,
): void {
  response.set("Cache-Control", "no-store");
  response.set("Content-Type", "application/json; charset=utf-8");
  response.status(503).send(JSON.stringify(UNAVAILABLE));
}

/**
 * Isolated public boundary for the no-login news evaluator.
 *
 * Phase 1.2 replaces this closed scaffold with exact submit/aggregate routing.
 * Keeping a real, no-store export here makes the codebase independently
 * buildable and deployable without exposing Firestore or a half-built API.
 */
export const newsEvals = onRequest(
  {
    region: "europe-west3",
    memory: "256MiB",
    timeoutSeconds: 15,
    maxInstances: 10,
  },
  closedScaffoldHandler,
);
