import { afterEach, expect, it, vi } from "vitest";
import { contractSearch } from "./fiscal";
import { fetchDb } from "./dataClient";
vi.mock("./dataClient", () => ({ fetchDb: vi.fn(), fetchData: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("retries a missing English Trading name with the registered transliteration", async () => {
  vi.mocked(fetchDb).mockResolvedValue({ companies: [] });
  await contractSearch(
    { company: "Show the contracts won by Sofarma Trading" },
    { lang: "en", election: "2026_04_19" },
  );
  expect(fetchDb).toHaveBeenNthCalledWith(1, "procurement-search", {
    q: "Sofarma Trading",
    limit: 1,
  });
  expect(fetchDb).toHaveBeenNthCalledWith(2, "procurement-search", {
    q: "Sofarma treyding",
    limit: 1,
  });
});
