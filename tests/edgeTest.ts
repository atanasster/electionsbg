/**
 * The Playwright `test` every spec imports — `@playwright/test` plus the CI edge token.
 *
 * Why: the hosting emulator forwards un-emulated function rewrites (`/api/db/**`,
 * `/api/sql/**` and the function-served pages — `/company/**`, `/funds/contract/**`,
 * `/person/*` …) to the DEPLOYED `db` / `sql` functions, and those refuse any request
 * that did not come through Cloudflare (`functions/edge_gate.js`). Cloudflare proves
 * itself with the `x-naiasno-edge` header; CI proves itself with a CI-only token that
 * sits beside Cloudflare's in the comma-separated `EDGE_SHARED_SECRET`.
 *
 * The token is attached ONLY to requests for the emulator origin. Never put it in
 * `use.extraHTTPHeaders`: that sends it with every browser request — including the
 * cross-origin data-bucket fetches, where a non-safelisted header also forces a CORS
 * preflight the bucket's CORS config does not allow, failing every data fetch.
 *
 * No `EDGE_CI_TOKEN` in the environment (a local run) → the base fixtures, unchanged.
 */
import { test as base, type BrowserContext } from "@playwright/test";

export * from "@playwright/test";

const EDGE_HEADER = "x-naiasno-edge";
const EDGE_ORIGIN = "http://127.0.0.1:5002";
const token = (process.env.EDGE_CI_TOKEN || "").trim();

/**
 * A browser request that can reach the deployed function through the emulator.
 * Matched narrowly on purpose: registering a route disables the HTTP cache for those
 * requests, and static assets have no reason to carry the token.
 */
const reachesFunction = (url: URL): boolean =>
  url.origin === EDGE_ORIGIN &&
  /^\/(en\/)?(api\/(db|sql)\/|company\/|funds\/(contract|interreg)\/|council\/resolution\/|person\/|officials\/)/.test(
    url.pathname,
  );

/**
 * Attach the token to a context's function-bound requests. The `context` fixture does
 * this itself; call it on any context a spec builds with `browser.newContext()`.
 * A context route ranks BELOW page.route, so the specs' own /api/db stubs still
 * answer first; this only reaches requests nothing stubbed.
 */
export const attachEdgeToken = async (context: BrowserContext) => {
  if (!token) return;
  await context.route(reachesFunction, (route) =>
    route.continue({
      headers: { ...route.request().headers(), [EDGE_HEADER]: token },
    }),
  );
};

export const test = token
  ? base.extend({
      context: async ({ context }, provide) => {
        await attachEdgeToken(context);
        await provide(context);
      },
      // The APIRequestContext cannot filter per URL, so its specs must keep to
      // relative (emulator) URLs — every request through it carries the token.
      request: async ({ playwright, baseURL, extraHTTPHeaders }, provide) => {
        const request = await playwright.request.newContext({
          baseURL,
          extraHTTPHeaders: { ...extraHTTPHeaders, [EDGE_HEADER]: token },
        });
        await provide(request);
        await request.dispose();
      },
    })
  : base;
