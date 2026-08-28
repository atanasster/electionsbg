import { describe, expect, it, vi } from "vitest";
import {
  readSavedNews,
  readSavedNewsFromBrowser,
  SAVED_NEWS_KEY,
  writeSavedNews,
  writeSavedNewsToBrowser,
} from "./savedNews";

describe("saved news storage", () => {
  it("fails closed on corrupt or wrong-shaped data", () => {
    expect(readSavedNews({ getItem: () => "{" })).toEqual([]);
    expect(
      readSavedNews({ getItem: () => JSON.stringify({ path: "/a" }) }),
    ).toEqual([]);
  });

  it("deduplicates valid paths and ignores other values", () => {
    expect(
      readSavedNews({
        getItem: () =>
          JSON.stringify([
            "/story/a",
            1,
            "/story/a",
            "/article/b.bg/c",
            "https://bad.example",
          ]),
      }),
    ).toEqual(["/story/a", "/article/b.bg/c"]);
  });

  it("rejects paths that can normalize or escape the news routes", () => {
    expect(
      readSavedNews({
        getItem: () =>
          JSON.stringify([
            "/story/..",
            "/story/a?x=1",
            "/story/a%2Fb",
            "/article/example.bg/a#x",
            "/article/example.bg/a\\b",
          ]),
      }),
    ).toEqual([]);
  });

  it("accepts corpus article ids that contain Cyrillic letters", () => {
    expect(
      readSavedNews({
        getItem: () => JSON.stringify(["/article/pik.bg/20260821-българия-a1"]),
      }),
    ).toEqual(["/article/pik.bg/20260821-българия-a1"]);
  });

  it("round-trips a Cyrillic corpus id through writes and reads", () => {
    let stored = "";
    const path = "/article/pik.bg/20260821-българия-a1";
    expect(
      writeSavedNews(
        {
          setItem: (_key, value) => {
            stored = value;
          },
        },
        [path],
      ),
    ).toBe(true);
    expect(readSavedNews({ getItem: () => stored })).toEqual([path]);
  });

  it("caps writes and reports denied storage", () => {
    const setItem = vi.fn();
    expect(
      writeSavedNews(
        { setItem },
        Array.from({ length: 205 }, (_, i) => `/story/${i}`),
      ),
    ).toBe(true);
    expect(JSON.parse(setItem.mock.calls[0][1])).toHaveLength(200);
    expect(
      writeSavedNews(
        {
          setItem: () => {
            throw new Error("denied");
          },
        },
        [SAVED_NEWS_KEY],
      ),
    ).toBe(false);
  });

  it("fails closed when the browser denies the storage property", () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(readSavedNewsFromBrowser()).toEqual([]);
      expect(writeSavedNewsToBrowser(["/story/a"])).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});
