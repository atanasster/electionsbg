import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("retains standalone configuration and lets the integrated entry use its own rewrite", async () => {
  vi.stubEnv("VITE_DB_API_ORIGIN", "https://electionsbg.com");
  const fetcher = vi.fn<(url: string) => Promise<Response>>(
    async () => new Response('{"ok":true}'),
  );
  vi.stubGlobal("fetch", fetcher);
  const { fetchDb, setDbOrigin } = await import("./dataClient");
  await fetchDb("prices-places", { q: "Пловдив" });
  expect(fetcher.mock.calls[0][0]).toBe(
    `https://electionsbg.com/api/db/prices-places?q=${encodeURIComponent("Пловдив")}`,
  );
  setDbOrigin("");
  await fetchDb("prices-places", { q: "Пловдив" });
  expect(fetcher.mock.calls[1][0]).toBe(
    `/api/db/prices-places?q=${encodeURIComponent("Пловдив")}`,
  );
});
