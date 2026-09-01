// `dropParams` — the tile's opt-out from preserved query params.
//
// It exists because `usePreserveParams` carries `pscope` onto every link, which is right
// where the destination reads it and wrong where it does not: a scope-free page then answers
// for a window it has no concept of. `usePreserveParams`' own header records this shipping
// once, and it was measured again on the global home, where six of eight destinations are
// scope-free and an inbound `?pscope=y:2019` reached all six.

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FC } from "react";
import { describe, expect, it } from "vitest";
import { InfographicTile } from "./InfographicTile";
import { TILE_ACCENTS } from "./tileAccents";

const Scene: FC = () => <svg data-testid="scene" />;

const hrefFor = (to: string, search: string, dropParams?: string[]): string => {
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <InfographicTile
        to={to}
        title="T"
        accent={TILE_ACCENTS.teal}
        scene={Scene}
        {...(dropParams ? { dropParams } : {})}
      />
    </MemoryRouter>,
  );
  return screen.getByRole("link").getAttribute("href") ?? "";
};

describe("InfographicTile — preserved params", () => {
  it("preserves the allowlisted params by DEFAULT", () => {
    // The default must not change: every other hub's tiles depend on it, and dropping a
    // scope on a scope-aware destination silently resets the reader's window.
    const href = hrefFor("/procurement", "?pscope=y:2019&elections=2013_05_12");
    expect(href).toContain("pscope=y%3A2019");
    expect(href).toContain("elections=2013_05_12");
  });

  it("drops a named param", () => {
    const href = hrefFor("/budget", "?pscope=y:2019", ["pscope"]);
    expect(href).not.toContain("pscope");
  });

  it("drops only what it names", () => {
    // `elections` is a reader's global choice and must survive even where the scope does not.
    const href = hrefFor("/budget", "?pscope=y:2019&elections=2013_05_12", [
      "pscope",
    ]);
    expect(href).not.toContain("pscope");
    expect(href).toContain("elections=2013_05_12");
  });

  it("NEVER drops a param the tile itself forced", () => {
    // ⚠️ The clause that keeps the opt-out from undoing the tile's own choice. The
    // procurement tile forces `?pscope=all` because its metric is the all-scope total; a
    // drop list that removed it would land the reader on a different window from the number
    // they clicked.
    const href = hrefFor("/procurement?pscope=all", "?pscope=y:2019", [
      "pscope",
    ]);
    expect(href).toContain("pscope=all");
    expect(href).not.toContain("y%3A2019");
  });

  it("leaves a clean path when nothing survives", () => {
    // No trailing `?`, which is what `useTileHref` exists to avoid.
    expect(hrefFor("/budget", "?pscope=y:2019", ["pscope"])).toBe("/budget");
  });

  it("is a no-op when there is nothing to drop", () => {
    expect(hrefFor("/budget", "", ["pscope"])).toBe("/budget");
  });
});
