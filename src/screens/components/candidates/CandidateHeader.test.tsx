// Locks the SEO-title resolution precedence in CandidateHeader, which the
// candidate preference sub-pages now depend on: an explicit `seoTitle` wins
// verbatim, otherwise it falls back to `${displayName} — ${subtitle}`, and to
// `displayName` alone when neither is set. usePartyInfo and SEO are mocked so
// the test never touches the network (an unstubbed fetch throws in jsdom, per
// the repo testing standard) and the resolved title is observable directly.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/data/parties/usePartyInfo", () => ({
  usePartyInfo: () => ({ findParty: () => undefined }),
}));
vi.mock("@/ux/SEO", () => ({
  SEO: ({ title }: { title: string }) => (
    <div data-testid="seo-title">{title}</div>
  ),
}));
// The ballot pulls region/party data hooks; irrelevant to the SEO-title logic under test.
vi.mock("./CandidateBallot", () => ({ CandidateBallot: () => null }));

import { CandidateHeader } from "./CandidateHeader";

const renderHeader = (props: React.ComponentProps<typeof CandidateHeader>) =>
  render(
    <MemoryRouter>
      <CandidateHeader {...props} />
    </MemoryRouter>,
  );

describe("CandidateHeader SEO", () => {
  it("uses explicit seoTitle verbatim when provided", () => {
    renderHeader({
      displayName: "Иван Иванов",
      seoTitle: "Иван Иванов — Преференции по области — 19.04.2026",
      subtitle: "Гласуване по области",
    });
    expect(screen.getByTestId("seo-title")).toHaveTextContent(
      "Иван Иванов — Преференции по области — 19.04.2026",
    );
  });

  it("falls back to `${displayName} — ${subtitle}` when only subtitle is set", () => {
    renderHeader({
      displayName: "Иван Иванов",
      subtitle: "Гласуване по области",
    });
    expect(screen.getByTestId("seo-title")).toHaveTextContent(
      "Иван Иванов — Гласуване по области",
    );
  });

  it("falls back to displayName alone when neither is set", () => {
    renderHeader({ displayName: "Иван Иванов" });
    expect(screen.getByTestId("seo-title")).toHaveTextContent("Иван Иванов");
  });
});
