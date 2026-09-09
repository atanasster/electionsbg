import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDataCache,
  fetchData,
  fetchDb,
  setDbFetcher,
  setFetcher,
} from "./dataClient";

describe("source-aware data cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
    clearDataCache();
  });
  afterEach(() => vi.useRealTimers());

  it("revalidates deadline-sensitive JSON after one minute", async () => {
    const read = vi.fn(async () => ({ version: read.mock.calls.length }));
    setFetcher(read);
    await fetchData("/opencalls/index.json");
    await fetchData("/opencalls/index.json");
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    await fetchData("/opencalls/index.json");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps ordinary static data for five minutes", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ok: 1 })
      .mockResolvedValueOnce({ ok: 2 });
    setFetcher(read);
    await fetchData("/regional.json");
    vi.advanceTimersByTime(299_999);
    await fetchData("/regional.json");
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await fetchData("/regional.json");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it.each(["open-calls", "price-payload", "price-search", "poll-agencies"])(
    "applies the live policy to the %s DB route",
    async (route) => {
      const read = vi.fn(async () => ({ ok: true }));
      setDbFetcher(read);
      await fetchDb(route, { place: "Sofia" });
      vi.advanceTimersByTime(60_001);
      await fetchDb(route, { place: "Sofia" });
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps static lookalike paths on the five-minute policy", async () => {
    const read = vi.fn(async () => ({ ok: true }));
    setFetcher(read);
    await fetchData("/energy/prices.json");
    vi.advanceTimersByTime(60_001);
    await fetchData("/energy/prices.json");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("evicts a rejected fetch so the next call can retry", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ ok: true });
    setFetcher(read);
    await expect(fetchData("/regional.json")).rejects.toThrow("temporary");
    await expect(fetchData("/regional.json")).resolves.toEqual({ ok: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
