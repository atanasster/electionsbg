// The scope carry has no other guard: it is invisible in the rendered text, and the
// failure mode is a page that answers for a DIFFERENT period under the right heading —
// which looks like real data, not like a bug. These pin it.

import { describe, expect, it } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { SettlementProcurementLink } from "./SettlementProcurementLink";
import { useSettlementProcurementHref } from "./useSettlementProcurementHref";

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

const hrefOf = (c: HTMLElement) =>
  c.querySelector("a")?.getAttribute("href") ?? "";

describe("SettlementProcurementLink", () => {
  it("carries the active scope into the settlement page", () => {
    const { container } = render(
      <SettlementProcurementLink ekatte="10135">
        Варна
      </SettlementProcurementLink>,
      { wrapper: at("/procurement/by-settlement?pscope=y:2024") },
    );
    expect(hrefOf(container)).toBe(
      "/procurement/settlement/10135?pscope=y%3A2024",
    );
  });

  it("emits a bare path when there is no scope to carry", () => {
    // The default scope (ns) is deliberately absent from the URL, so a link built from a
    // default view must NOT invent a ?pscope — that would pin the reader to a window
    // they never chose and freeze it against a later election.
    const { container } = render(
      <SettlementProcurementLink ekatte="10135">
        Варна
      </SettlementProcurementLink>,
      { wrapper: at("/procurement/by-settlement") },
    );
    expect(hrefOf(container)).toBe("/procurement/settlement/10135");
  });

  it("carries the selected election too, not only the scope", () => {
    const { container } = render(
      <SettlementProcurementLink ekatte="68134">
        София
      </SettlementProcurementLink>,
      { wrapper: at("/procurement/by-settlement?elections=2026_04_19") },
    );
    expect(hrefOf(container)).toContain("elections=2026_04_19");
  });

  it("URL-encodes the ekatte", () => {
    const { result } = renderHook(() => useSettlementProcurementHref(), {
      wrapper: at("/procurement"),
    });
    const to = result.current("a b/c");
    expect(typeof to === "string" ? to : to.pathname).toBe(
      "/procurement/settlement/a%20b%2Fc",
    );
  });
});
