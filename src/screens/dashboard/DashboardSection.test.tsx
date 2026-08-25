// `isRenderable` is the subtlest logic in this file and the thing every caller reasons
// about when deciding whether its section needs its own gate — and it is easy to reason
// about WRONGLY, because it cannot see through a component boundary. A caller in
// dev/PersonScreen.tsx wrote a guard BECAUSE of that property and got the predicate
// wrong; these tests pin the behaviour so the next reader has an assertion to consult
// rather than a comment.
//
// The heading/landmark assertions pin the other half: the title is a plain <span> by
// default (186 call sites depend on that), a real heading only when asked, and the
// <section> carries an accessible name either way.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FC } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
// The articles strip fetches; this file is about the section shell, not that.
vi.mock("./SectionArticlesStrip", () => ({
  SectionArticlesStrip: () => <div data-testid="articles" />,
}));

import { DashboardSection } from "./DashboardSection";

const Null: FC = () => null;

describe("DashboardSection — self-hiding", () => {
  it("renders nothing when every child is false or null", () => {
    const { container } = render(
      <DashboardSection id="person-portfolio" title="T">
        {false}
        {null}
      </DashboardSection>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("STILL renders the heading when a child element returns null at runtime", () => {
    // The trap, stated as an assertion: `isRenderable` sees a valid element and says
    // yes, so a section whose children ALL self-hide shows a heading above nothing.
    // Callers in that position must gate the whole section themselves.
    render(
      <DashboardSection id="person-portfolio" title="T">
        <Null />
      </DashboardSection>,
    );
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("renders when at least one child is real content", () => {
    render(
      <DashboardSection id="person-portfolio" title="T">
        <div>real</div>
      </DashboardSection>,
    );
    expect(screen.getByText("real")).toBeInTheDocument();
  });
});

describe("DashboardSection — heading level and accessible name", () => {
  it("defaults the title to a non-heading span", () => {
    // 186 call sites rely on this default; promoting it globally would change every
    // dashboard's outline at once.
    const { container } = render(
      <DashboardSection id="person-portfolio" title="Фирми">
        <div>x</div>
      </DashboardSection>,
    );
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector("h3")).toBeNull();
    expect(screen.getByText("Фирми").tagName).toBe("SPAN");
  });

  it("renders a real h2 when headingLevel={2}", () => {
    render(
      <DashboardSection id="person-portfolio" title="Фирми" headingLevel={2}>
        <div>x</div>
      </DashboardSection>,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Фирми" }),
    ).toBeInTheDocument();
  });

  it("keeps the sans stack on a promoted heading", () => {
    // src/index.css styles h1,h2,h3 with the display SERIF, so without font-sans the
    // opt-in would silently restyle every kicker that takes it.
    render(
      <DashboardSection id="person-portfolio" title="Фирми" headingLevel={2}>
        <div>x</div>
      </DashboardSection>,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("font-sans");
  });

  it("names the section via aria-labelledby, pointing at the title", () => {
    const { container } = render(
      <DashboardSection id="person-connections" title="Връзки">
        <div>x</div>
      </DashboardSection>,
    );
    const section = container.querySelector("section")!;
    expect(section).toHaveAttribute(
      "aria-labelledby",
      "person-connections-title",
    );
    expect(screen.getByText("Връзки")).toHaveAttribute(
      "id",
      "person-connections-title",
    );
  });

  it("omits aria-labelledby entirely when there is no title", () => {
    // An aria-labelledby pointing at a node that does not exist names the section ""
    // — worse than leaving it unnamed.
    const { container } = render(
      <DashboardSection id="person-connections">
        <div>x</div>
      </DashboardSection>,
    );
    expect(container.querySelector("section")).not.toHaveAttribute(
      "aria-labelledby",
    );
  });
});
