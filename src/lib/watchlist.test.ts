// The watchlist is the only piece of reader state the site keeps, so it must degrade
// quietly: a corrupted key, a disabled localStorage, or a hand-edited value must never
// break the profile page it renders on.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { watchlist, WATCHLIST_MAX } from "./watchlist";

const KEY = "naiasno.watchlist.v1";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("watchlist", () => {
  it("toggles a slug on and off", () => {
    expect(watchlist.has("a")).toBe(false);
    expect(watchlist.toggle("a")).toBe(true);
    expect(watchlist.has("a")).toBe(true);
    expect(watchlist.toggle("a")).toBe(false);
    expect(watchlist.all()).toEqual([]);
  });

  it("puts the newest follow first", () => {
    watchlist.toggle("a");
    watchlist.toggle("b");
    expect(watchlist.all()).toEqual(["b", "a"]);
  });

  // A corrupted value must read as "follows nobody", not throw on render.
  it("survives a corrupted or wrongly-typed stored value", () => {
    localStorage.setItem(KEY, "{not json");
    expect(watchlist.all()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(watchlist.all()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify(["ok", 3, null, ""]));
    expect(watchlist.all()).toEqual(["ok"]);
  });

  // The server slices at 200; a longer list would silently stop alerting on its tail.
  it("caps the stored list so nothing is silently dropped server-side", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify(Array.from({ length: 250 }, (_, i) => `p${i}`)),
    );
    watchlist.toggle("new");
    expect(watchlist.all().length).toBe(WATCHLIST_MAX);
    expect(watchlist.all()[0]).toBe("new");
  });

  // Private mode: setItem throws. Following is a convenience, never a hard failure.
  it("does not throw when localStorage rejects a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => watchlist.toggle("a")).not.toThrow();
  });

  // The cross-tab path: subscribe must register a `storage` listener AND remove it on
  // unsubscribe. Deleting either call left the suite green before this test — the missing
  // removal leaks one listener per mounted component.
  it("registers and removes the cross-tab storage listener", () => {
    const add = vi.spyOn(window, "addEventListener");
    const rm = vi.spyOn(window, "removeEventListener");
    const off = watchlist.subscribe(() => {});
    expect(add).toHaveBeenCalledWith("storage", expect.any(Function));
    const fn = add.mock.calls.find((c) => c[0] === "storage")?.[1];
    off();
    expect(rm).toHaveBeenCalledWith("storage", fn);
  });

  // `storage` only fires in OTHER tabs, so same-tab subscribers need an explicit notify.
  it("notifies subscribers in the same tab", () => {
    const fn = vi.fn();
    const off = watchlist.subscribe(fn);
    watchlist.toggle("a");
    expect(fn).toHaveBeenCalled();
    off();
    watchlist.toggle("b");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
