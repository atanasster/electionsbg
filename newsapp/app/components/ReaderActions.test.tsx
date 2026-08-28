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
    if (shareDescriptor)
      Object.defineProperty(navigator, "share", shareDescriptor);
    else Reflect.deleteProperty(navigator, "share");
    if (clipboardDescriptor)
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("saves and removes a page locally with a pressed-state contract", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Запазено" }));
    expect(JSON.parse(localStorage.getItem(SAVED_NEWS_KEY) ?? "[]")).toEqual(
      [],
    );
  });

  it("uses the native share sheet when available", async () => {
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
  });

  it("falls back to copying the canonical page URL", async () => {
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
  });

  it("announces native-share and clipboard failures", async () => {
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
  });
});
