import { onRequest } from "firebase-functions/v2/https";

import { handleNewsEvalsRequest } from "./http.js";

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
  },
  handleNewsEvalsRequest,
);
