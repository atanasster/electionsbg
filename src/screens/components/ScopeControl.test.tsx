// The regression these pin: a scope arriving from another section that the
// control's own year list does not offer.
//
// Radix renders a controlled <Select> whose value matches no <SelectItem> as
// EMPTY — not even the placeholder. So on /culture (`nsLabelOverride` = "Всички
// години", `allowAll` off) an inbound `?pscope=y:2026` painted the widget as the
// bare default pill while the page underneath re-aggregated somewhere else
// entirely: year-scoped numbers under an all-years label, with nothing on screen
// to say the view had been narrowed. There is no other guard — the failure looks
// exactly like real data.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ScopeControl } from "./ScopeControl";
import { resolveScope, type Scope } from "@/data/scope/useScope";

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

const CULTURE_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]; // prettier-ignore
const AGRI_YEARS = [2025, 2024, 2023, 2022, 2021, 2017, 2016, 2015];
const NS_LABEL = "Всички години";

/** The pill that names the page default, and whether it reads as the active one. */
const nsPill = () => screen.getByRole("button", { name: NS_LABEL });
/** The years picker — its rendered text is what the reader sees as the scope. */
const picker = () => screen.getByRole("combobox");

const culture = (url: string) =>
  render(
    <ScopeControl
      years={CULTURE_YEARS}
      nsLabelOverride={NS_LABEL}
      allowAll={false}
    />,
    { wrapper: at(url) },
  );

describe("ScopeControl", () => {
  it("shows the active year, not the default pill", () => {
    culture("/culture?pscope=y:2024");
    expect(picker()).toHaveTextContent("2024");
    expect(nsPill()).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a year the page does not cover rather than nothing", () => {
    // /subsidies is the live case: it serves an explicit "no data for 2019"
    // state, so the control must keep showing 2019 next to it. Blank here is
    // what made the widget read as the default while the body said otherwise.
    render(
      <ScopeControl years={AGRI_YEARS} nsLabelOverride="Последна година" />,
      { wrapper: at("/subsidies?pscope=y:2019") },
    );
    expect(picker()).toHaveTextContent("2019");
    expect(
      screen.getByRole("button", { name: "Последна година" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the default pill active when nothing narrows the view", () => {
    culture("/culture");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(picker()).not.toHaveTextContent(/\d{4}/);
  });

  it("resolves 'all' onto the default pill when the page has no full-corpus view", () => {
    // On /culture "all years" IS the default, so the reader must see one active
    // affordance rather than a picker showing a mode that was switched off.
    culture("/culture?pscope=all");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(picker()).not.toHaveTextContent(/\d{4}|All years/);
  });

  it("reflects a page's resolved scope, so the pill can never outrank the numbers", () => {
    // How /culture and /administration wire it: the page resolves `?pscope`
    // against its own coverage and hands the control the SAME value it
    // aggregated on. An uncovered year lands on the default pill in both places
    // at once.
    const inbound: Scope = "y:2026";
    const resolved = resolveScope(inbound, {
      years: CULTURE_YEARS,
      allowAll: false,
    });
    render(
      <ScopeControl
        value={resolved}
        onChange={() => {}}
        years={CULTURE_YEARS}
        nsLabelOverride={NS_LABEL}
        allowAll={false}
      />,
      { wrapper: at(`/culture?pscope=${inbound}`) },
    );
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(picker()).not.toHaveTextContent(/\d{4}/);
  });
});
