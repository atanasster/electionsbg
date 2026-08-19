// The byline renders a calendar DAY, so it must not be formatted in the reader's zone.
//
// `publishedAt` is a bare date ("2026-08-17"), which `new Date()` parses as UTC midnight —
// formatting that anywhere west of Greenwich lands on the previous day. The byline read
// "16 АВГУСТ 2026 Г." while the article-feed strip on the SAME page said 17, because the
// strip pins UTC and the byline had its own inline formatter. Bulgarian readers (UTC+3)
// never saw it; every reader in the Americas saw every article dated a day early.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { ArticleLayout } from "./ArticleLayout";

// A zone west of Greenwich is the whole point — under the repo's own Europe/Sofia this
// assertion passes against the buggy implementation too.
const WEST = "America/New_York";
const PUBLISHED = "2026-08-17";
let priorTz: string | undefined;

beforeAll(() => {
  priorTz = process.env.TZ;
  process.env.TZ = WEST;
});
afterAll(() => {
  process.env.TZ = priorTz;
});

const draw = (date?: string) =>
  render(
    <MemoryRouter>
      <ArticleLayout title="Заглавие" date={date} breadcrumb={null} seo={false}>
        <p>тяло</p>
      </ArticleLayout>
    </MemoryRouter>,
  );

describe("ArticleLayout byline", () => {
  it("renders the published day as ITS OWN day, west of Greenwich too", () => {
    draw(PUBLISHED);
    const byline = screen.getByText(/2026/);
    expect(byline).toHaveTextContent("17");
    expect(byline).not.toHaveTextContent("16");
  });

  it("discriminates — the pre-fix formatter really does print the day before here", () => {
    // Without this the test above is satisfiable by an implementation that never had the
    // bug to begin with (e.g. a runner whose TZ is east of UTC), so it would pass for the
    // wrong reason and stop guarding anything.
    const unpinned = new Date(PUBLISHED).toLocaleDateString("bg-BG", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    expect(unpinned).toContain("16");
  });

  it("omits the byline entirely when no date is given (documentation pages)", () => {
    draw(undefined);
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });
});
