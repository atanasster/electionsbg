// The analytics seam's privacy guarantees (docs/plans/gdpr-consent-v1.md, T2). The /privacy page
// promises these, and "no consent banner" depends on them staying true.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_HOSTNAME,
  FORBIDDEN_PROP_KEYS,
  UMAMI_SCRIPT_PATH,
  BEFORE_SEND_HOOK,
  beforeSend,
  buildTrackerScript,
  sanitizeProps,
  shouldLoadAnalytics,
  trackEvent,
  trackSearch,
  trackSearchSelection,
} from "./analytics";

const track = vi.fn();
beforeEach(() => {
  track.mockClear();
  vi.stubGlobal("window", { ...globalThis.window, umami: { track } });
});
afterEach(() => vi.unstubAllGlobals());

describe("sanitizeProps", () => {
  it("drops every free-text key", () => {
    const params = Object.fromEntries(FORBIDDEN_PROP_KEYS.map((k) => [k, "x"]));
    expect(sanitizeProps({ ...params, kind: "a" })).toEqual({ kind: "a" });
  });

  it("keeps scalars and drops objects, arrays, null and undefined", () => {
    expect(
      sanitizeProps({
        a: 1,
        b: true,
        c: "s",
        d: null,
        e: undefined,
        f: {},
        g: [],
      }),
    ).toEqual({ a: 1, b: true, c: "s" });
  });

  it("returns undefined rather than an empty object", () => {
    expect(sanitizeProps({ search_term: "Иван Петров" })).toBeUndefined();
  });
});

describe("what is sent", () => {
  it("a search sends its result count and never the term", () => {
    trackSearch(7);
    expect(track).toHaveBeenLastCalledWith("search", { result_count: 7 });
  });

  it("a selection sends only the result type", () => {
    trackSearchSelection("candidate");
    expect(track).toHaveBeenLastCalledWith("select_search_result", {
      result_type: "candidate",
    });
  });

  it("a caller passing a name still cannot send it", () => {
    trackEvent("x", { label: "Иван Петров", kind: "mp" });
    expect(track).toHaveBeenLastCalledWith("x", { kind: "mp" });
  });

  it("is a no-op when the tracker is absent, and never throws", () => {
    vi.stubGlobal("window", {});
    expect(() => trackEvent("x")).not.toThrow();
    vi.stubGlobal("window", {
      umami: {
        track: () => {
          throw new Error("boom");
        },
      },
    });
    expect(() => trackEvent("x")).not.toThrow();
  });
});

describe("when the tracker loads", () => {
  const base = {
    dev: false,
    webdriver: false,
    hostname: ANALYTICS_HOSTNAME,
    websiteId: "id",
  };
  it("loads only in production, on the production host, for a human, with an id", () => {
    expect(shouldLoadAnalytics(base)).toBe(true);
    expect(shouldLoadAnalytics({ ...base, dev: true })).toBe(false);
    // Playwright and the og:image screenshots must never be counted.
    expect(shouldLoadAnalytics({ ...base, webdriver: true })).toBe(false);
    expect(shouldLoadAnalytics({ ...base, hostname: "localhost" })).toBe(false);
    expect(
      shouldLoadAnalytics({ ...base, hostname: "electionsbg-staging.web.app" }),
    ).toBe(false);
    expect(shouldLoadAnalytics({ ...base, websiteId: "" })).toBe(false);
  });
});

describe("the tracker <script>", () => {
  const s = buildTrackerScript(document, "https://naiasno.bg");
  it("strips the query string and hash — ?q= carries chat questions and searches", () => {
    expect(s.getAttribute("data-exclude-search")).toBe("true");
    expect(s.getAttribute("data-exclude-hash")).toBe("true");
  });
  it("honours Do Not Track and counts only the production host", () => {
    expect(s.getAttribute("data-do-not-track")).toBe("true");
    expect(s.getAttribute("data-domains")).toBe(ANALYTICS_HOSTNAME);
  });
  it("is first-party and pins the collect origin", () => {
    // Without data-host-url the tracker posts to <script dir>/stats/api/send =
    // /stats/stats/api/send, a 404 that silently counts nothing.
    expect(s.getAttribute("src")).toBe(UMAMI_SCRIPT_PATH);
    expect(s.getAttribute("data-host-url")).toBe("https://naiasno.bg");
  });
  it("routes every send through the title-stripping hook", () => {
    expect(s.getAttribute("data-before-send")).toBe(BEFORE_SEND_HOOK);
    expect(
      beforeSend("event", { url: "/person/x", title: "Иван Петров" }),
    ).toEqual({
      url: "/person/x",
    });
  });
  it("never opts into session replay, heatmaps or performance capture", () => {
    // Umami 3 has tables for all three; they fill only if the tracker is asked to.
    const attrs = s.getAttributeNames();
    expect(
      attrs.filter((a) => /replay|heatmap|performance|recorder/.test(a)),
    ).toEqual([]);
  });
});
