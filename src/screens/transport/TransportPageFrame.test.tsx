// The /sector/transport sub-page frame: a failed request must say so, a pending
// one shows a ghost, and only a settled one renders the page body.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TransportPageFrame } from "./TransportPageFrame";

const mount = (
  status: { isLoading: boolean; isError: boolean } | undefined,
  scoped = false,
) =>
  render(
    <MemoryRouter initialEntries={["/sector/transport/money"]}>
      <TransportPageFrame
        title={{ bg: "Страница", en: "Page" }}
        description={{ bg: "описание", en: "description" }}
        scoped={scoped}
        status={status}
      >
        <p>BODY</p>
      </TransportPageFrame>
    </MemoryRouter>,
  );

describe("TransportPageFrame", () => {
  it("renders the body once the request has settled", () => {
    mount({ isLoading: false, isError: false });
    expect(screen.getByText("BODY")).toBeTruthy();
  });

  it("says the data failed to load instead of rendering the body", () => {
    mount({ isLoading: false, isError: true });
    expect(screen.queryByText("BODY")).toBeNull();
    expect(screen.getByText(/failed to load/)).toBeTruthy();
  });

  it("withholds the body while loading", () => {
    mount({ isLoading: true, isError: false });
    expect(screen.queryByText("BODY")).toBeNull();
  });

  it("states that an unscoped page has no period", () => {
    mount(undefined, false);
    expect(screen.getByText(/No period/)).toBeTruthy();
  });

  it("links up to the transport hub", () => {
    mount(undefined);
    const up = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/sector/transport");
    expect(up).toBeTruthy();
  });
});
