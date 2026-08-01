// PersonNameLink: link-target precedence + title-casing + the plain-text fallback.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersonNameLink } from "./PersonNameLink";

const renderIn = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe("PersonNameLink", () => {
  it("prefers mpId → /candidate/mp-{id} over personSlug", () => {
    renderIn(
      <PersonNameLink name="ИВАН ПЕТРОВ" mpId={5229} personSlug="ivan-x" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("/candidate/mp-5229"),
    );
  });

  it("links to /person/{slug} when only personSlug is present", () => {
    renderIn(
      <PersonNameLink name="ИВАН ПЕТРОВ" personSlug="ivan-petrov-ab12" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("/person/ivan-petrov-ab12"),
    );
  });

  it("renders plain text (no link) when neither id is present", () => {
    renderIn(<PersonNameLink name="ИВАН ПЕТРОВ" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Иван Петров")).toBeInTheDocument();
  });

  it("title-cases the CIK all-caps name in the link body", () => {
    renderIn(
      <PersonNameLink name="ГЕОРГИ СТОЯНОВ ГЕОРГИЕВ" personSlug="g-s-g" />,
    );
    expect(screen.getByRole("link").textContent).toBe(
      "Георги Стоянов Георгиев",
    );
  });
});
