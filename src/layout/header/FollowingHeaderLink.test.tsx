// The header watchlist entry point must stay invisible until the reader follows someone —
// it should add no chrome for the majority who never use the watchlist — and must reflect a
// same-tab follow immediately (storage events only fire cross-tab; watchlist notifies its
// own-tab subscribers).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { FollowingHeaderLink } from "./FollowingHeaderLink";
import { watchlist } from "@/lib/watchlist";

const draw = () =>
  render(
    <MemoryRouter>
      <FollowingHeaderLink />
    </MemoryRouter>,
  );

beforeEach(() => localStorage.clear());

describe("FollowingHeaderLink", () => {
  it("renders nothing when the watchlist is empty", () => {
    const { container } = draw();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a /following link with the follow count once someone is followed", () => {
    watchlist.toggle("mp-1");
    watchlist.toggle("mp-2");
    draw();
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/following");
    expect(link).toHaveTextContent("2");
  });

  it("appears when a person is followed in the same tab", () => {
    draw();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    act(() => {
      watchlist.toggle("mp-1");
    });
    expect(screen.getByRole("link")).toHaveTextContent("1");
  });
});
