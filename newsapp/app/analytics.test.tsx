import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitNewsEvent, newsRouteFamily } from "./analytics";
import { AnalyticsRouteTracker } from "./components/AnalyticsRouteTracker";

describe("privacy-preserving news analytics", () => {
  afterEach(() => Reflect.deleteProperty(window, "naiasnoNewsAnalytics"));

  it.each([
    ["/", "home"],
    ["/story/secret-id", "story"],
    ["/article/domain/private-id", "article"],
    ["/outlet/example.bg", "outlet"],
    ["/missing?query=private", "other"],
    ["/corrections", "corrections"],
  ] as const)(
    "reduces %s to a low-cardinality route family",
    (path, expected) => {
      expect(newsRouteFamily(path)).toBe(expected);
    },
  );

  it("strips structurally compatible extra private fields", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const raw = {
      name: "page_view" as const,
      route: "story" as const,
      pathname: "/story/private-id",
      query: "secret",
      title: "private title",
      id: "private-id",
      url: "https://private.example",
    };
    emitNewsEvent(raw);
    expect(sink).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({ name: "page_view", route: "story" }),
    );
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(
      /private|secret|pathname|query|title|url/,
    );
  });

  it("fails closed for runtime-invalid names and method/outcome pairs", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    emitNewsEvent({
      name: "reader_share",
      content: "story",
      method: "native",
      outcome: "copied",
    } as unknown as Parameters<typeof emitNewsEvent>[0]);
    emitNewsEvent({
      name: "unknown",
      pathname: "/private",
    } as unknown as Parameters<typeof emitNewsEvent>[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).not.toHaveBeenCalled();
  });

  it("fails closed for nullish events and hostile property getters", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    emitNewsEvent(null as unknown as Parameters<typeof emitNewsEvent>[0]);
    emitNewsEvent(undefined as unknown as Parameters<typeof emitNewsEvent>[0]);
    emitNewsEvent(
      Object.defineProperty({}, "name", {
        get: () => {
          throw new Error("hostile getter");
        },
      }) as Parameters<typeof emitNewsEvent>[0],
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).not.toHaveBeenCalled();
  });

  it("is inert without a sink and contains sync and async sink failures", async () => {
    expect(() =>
      emitNewsEvent({ name: "page_view", route: "home" }),
    ).not.toThrow();
    window.naiasnoNewsAnalytics = () => {
      throw new Error("tracker failed");
    };
    expect(() =>
      emitNewsEvent({ name: "page_view", route: "home" }),
    ).not.toThrow();
    window.naiasnoNewsAnalytics = async () => {
      throw new Error("async tracker failed");
    };
    emitNewsEvent({ name: "page_view", route: "home" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("tracks route families without leaking route ids", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <MemoryRouter initialEntries={["/story/private-story-id"]}>
        <AnalyticsRouteTracker />
        <Link to="/article/example.bg/private-article-id">Към статия</Link>
        <Link to="/story/private-story-id?query=secret#hash">Само query</Link>
        <Link to="/story/second-private-id">Друга история</Link>
        <Routes>
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({ name: "page_view", route: "story" }),
    );
    expect(sink).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "Само query" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sink).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("link", { name: "Друга история" }));
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(sink).toHaveBeenLastCalledWith({
      name: "page_view",
      route: "story",
    });
    fireEvent.click(screen.getByRole("link", { name: "Към статия" }));
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "page_view",
        route: "article",
      }),
    );
    expect(sink).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(sink.mock.calls)).not.toContain("private-");
  });

  it("emits one initial page view under React StrictMode", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/topics"]}>
          <AnalyticsRouteTracker />
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
    expect(sink).toHaveBeenCalledWith({ name: "page_view", route: "topics" });
  });
});
