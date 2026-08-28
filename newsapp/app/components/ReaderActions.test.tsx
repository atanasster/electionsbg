import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderActions } from "./ReaderActions";
import { SAVED_NEWS_KEY } from "./savedNews";

describe("ReaderActions", () => {
  const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, "share");
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "naiasnoNewsAnalytics");
    if (shareDescriptor)
      Object.defineProperty(navigator, "share", shareDescriptor);
    else Reflect.deleteProperty(navigator, "share");
    if (clipboardDescriptor)
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("saves and removes a page locally with a pressed-state contract", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    render(<ReaderActions path="/story/a" title="История" />);
    const save = screen.getByRole("button", { name: "Запази" });
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "Запазено" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(JSON.parse(localStorage.getItem(SAVED_NEWS_KEY) ?? "[]")).toEqual([
      "/story/a",
    ]);
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_save",
        content: "story",
        saved: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Запазено" }));
    expect(JSON.parse(localStorage.getItem(SAVED_NEWS_KEY) ?? "[]")).toEqual(
      [],
    );
    await waitFor(() =>
      expect(sink).toHaveBeenLastCalledWith({
        name: "reader_save",
        content: "story",
        saved: false,
      }),
    );
  });

  it("uses the native share sheet when available", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });
    render(<ReaderActions path="/story/a" title="История" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: "История",
        url: "https://news.electionsbg.com/story/a",
      }),
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_share",
        content: "story",
        method: "native",
        outcome: "opened",
      }),
    );
  });

  it("falls back to copying the canonical page URL", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<ReaderActions path="/article/example/a" title="Статия" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://news.electionsbg.com/article/example/a",
      ),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Връзката е копирана.",
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_share",
        content: "article",
        method: "clipboard",
        outcome: "copied",
      }),
    );
  });

  it("resynchronizes saved state when a route component is reused", () => {
    localStorage.setItem(SAVED_NEWS_KEY, JSON.stringify(["/story/b"]));
    const { rerender } = render(<ReaderActions path="/story/a" title="A" />);
    expect(screen.getByRole("button", { name: "Запази" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<ReaderActions path="/story/b" title="B" />);
    expect(screen.getByRole("button", { name: "Запазено" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("keeps cancellation quiet and reports missing share APIs", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi
        .fn()
        .mockRejectedValue(new DOMException("cancelled", "AbortError")),
    });
    const { rerender } = render(<ReaderActions path="/story/a" title="A" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_share",
        content: "story",
        method: "native",
        outcome: "cancelled",
      }),
    );

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    rerender(<ReaderActions path="/story/b" title="B" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Копирайте адреса от адресната лента.",
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_share",
        content: "story",
        method: "unavailable",
        outcome: "failed",
      }),
    );
  });

  it("announces native-share and clipboard failures", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("failed")),
    });
    const { rerender } = render(<ReaderActions path="/story/a" title="A" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Споделянето не успя.",
      ),
    );
    await waitFor(() =>
      expect(sink).toHaveBeenLastCalledWith({
        name: "reader_share",
        content: "story",
        method: "native",
        outcome: "failed",
      }),
    );

    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("failed")) },
    });
    rerender(<ReaderActions path="/story/b" title="B" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Споделянето не успя.",
      ),
    );
    await waitFor(() => expect(sink).toHaveBeenCalledTimes(2));
    expect(sink).toHaveBeenLastCalledWith({
      name: "reader_share",
      content: "story",
      method: "clipboard",
      outcome: "failed",
    });
  });

  it("treats clipboard AbortError as a clipboard failure", async () => {
    const sink = vi.fn();
    window.naiasnoNewsAnalytics = sink;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi
          .fn()
          .mockRejectedValue(new DOMException("blocked", "AbortError")),
      },
    });
    render(<ReaderActions path="/article/example/a" title="A" />);
    fireEvent.click(screen.getByRole("button", { name: "Сподели" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Споделянето не успя.",
      ),
    );
    await waitFor(() =>
      expect(sink).toHaveBeenCalledWith({
        name: "reader_share",
        content: "article",
        method: "clipboard",
        outcome: "failed",
      }),
    );
  });
});
