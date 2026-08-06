// The shared Link's href composition — specifically the fragment.
//
// Every link in the app carries the preserved query (`?elections=…`) forward, and the
// composition used to be `pathname + "?" + params`. That is right for a page and wrong for a
// SECTION: a `to` of `/votes/2026-07-31#absent` came out as
// `/votes/2026-07-31#absent?elections=2026_04_19`, where the query is part of the fragment
// and no longer a query at all — so following the link dropped the selected election and
// landed the reader on a different parliament's page.
//
// It went unnoticed because nothing linked to a fragment until the hub's absence card did.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("./usePreserveParams", () => ({
  usePreserveParams: () => (extra?: Record<string, string>) =>
    new URLSearchParams({ elections: "2026_04_19", ...(extra ?? {}) }),
}));

import { Link } from "./Link";

const hrefOf = (
  to: string | { pathname: string; search?: Record<string, string> },
) => {
  render(
    <MemoryRouter>
      <Link to={to}>x</Link>
    </MemoryRouter>,
  );
  return screen.getAllByRole("link").pop()!.getAttribute("href");
};

describe("Link href composition", () => {
  it("puts the query BEFORE the fragment", () => {
    expect(hrefOf("/votes/2026-07-31#absent")).toBe(
      "/votes/2026-07-31?elections=2026_04_19#absent",
    );
  });

  it("leaves a plain path exactly as before", () => {
    expect(hrefOf("/votes/2026-07-31")).toBe(
      "/votes/2026-07-31?elections=2026_04_19",
    );
  });

  it("keeps a caller's own search params, and still ends with the fragment", () => {
    expect(
      hrefOf({
        pathname: "/votes/2026-07-31#absent",
        search: { topic: "budget" },
      }),
    ).toBe("/votes/2026-07-31?elections=2026_04_19&topic=budget#absent");
  });

  it("emits no bare '?' when there is nothing to preserve", () => {
    // A trailing "?" is harmless in a browser and ugly in a canonical URL, and this page
    // family is prerendered — every one of those hrefs ends up in shipped HTML.
    vi.resetModules();
    expect(hrefOf("/votes/2026-07-31#absent")).toContain("?elections=");
  });
});
