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
import { formatDate, formatDateLong } from "@/lib/formatDate";

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

const CULTURE_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014]; // prettier-ignore
const AGRI_YEARS = [2025, 2024, 2023, 2022, 2021, 2017, 2016, 2015];
const NS_LABEL = "Всички години";
/** The election `useElectionContext` falls back to — a static JSON import with an
 *  `elections[0]` default, so this needs no provider. */
const ELECTION_ISO = "2026-04-19";

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

describe("the default pill's date", () => {
  // The pill is the sentence that says WHICH WINDOW every figure beside it covers — on
  // /procurement/contracts it sits directly above the KPI band. It rendered the election
  // FOLDER ID with its underscores swapped for hyphens („Този парламент · 2026-04-19"), i.e.
  // an internal key shown as prose, on all 31 surfaces that mount this control.
  const pillText = () => {
    render(<ScopeControl mode="toggle" />, {
      wrapper: at("/procurement/contracts"),
    });
    return screen.getAllByRole("button")[0].textContent ?? "";
  };

  it("renders exactly what the shared formatter produces", () => {
    // EQUALITY against the helper, not a shape. `not.toMatch(/\d{4}-\d{2}-\d{2}/)` alone
    // pins „not the old bug" and admits a bare year, a truncated date or a half-formatted
    // string; this pins the right answer and, with it, that the pill routes through
    // `formatDate` at all rather than through a second hand-rolled Intl call.
    const iso = ELECTION_ISO;
    expect(pillText()).toContain(formatDate(iso, "en"));
    // The regression guard the equality does not by itself give: the raw id must be gone.
    expect(pillText()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("formats the Bulgarian pill as a numeric civil date", () => {
    // ⚠ THE SUITE ONLY EVER RENDERS THE en-GB BRANCH. i18n is uninitialized here, so
    // `i18n.language` is undefined and `formatDate` falls to English — meaning the format
    // every actual reader of this site sees is the one no rendered test covers. Asserted on
    // the helper directly, which is the reachable half, and pinned as a VALUE so the
    // bg/en divergence stays visible: „19.04.2026 г." is numeric while English abbreviates
    // the month, and the two functions' Bulgarian outputs differ from each other.
    expect(formatDate(ELECTION_ISO, "bg")).toBe("19.04.2026 г.");
    expect(formatDate(ELECTION_ISO, "en")).toBe("19 Apr 2026");
    // The long form is a different string — the docstrings claimed these were equal.
    expect(formatDateLong(ELECTION_ISO, "bg")).toBe("19 април 2026 г.");
  });

  // ⚠ THERE IS DELIBERATELY NO UTC TEST HERE, and its absence is the point.
  //
  // The first draft asserted `formatDate(iso,"bg")` did not contain „18" — self-referential
  // (it never rendered a pill), duplicated `src/lib/formatDate.test.ts`, and measured VACUOUS:
  // it passes against an UNPINNED implementation under both `Europe/Sofia` and `UTC`, which is
  // this machine and CI. Nothing pins `TZ` anywhere, so it could only ever discriminate on a
  // developer's laptop in the Americas.
  //
  // The property is real — `new Date("2026-04-19")` is UTC midnight, so an unpinned format
  // prints the 18th west of Greenwich — and it is covered where it belongs: `formatDate.test.ts`
  // owns the UTC pin, and `dateFormatterPin.test.ts` catches a bare `Intl.DateTimeFormat`
  // repo-wide. What THIS file owes is the equality above, which is what binds the pill to the
  // helper that carries the pin.
});

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

  it("shows a covered year outside the corpus band rather than clamping it", () => {
    // The other boundary. A caller's coverage need not sit inside the procurement
    // corpus (2011→now) — budget and pension series predate it — and a value that
    // already survived the PAGE's own resolve must not be second-guessed against a
    // different year set here. Clamping it would put the pill back on the default
    // while the page counted 2008: the exact mismatch this control exists to end.
    render(
      <ScopeControl
        value={"y:2008" as Scope}
        onChange={() => {}}
        years={[2010, 2009, 2008]}
        nsLabelOverride="Latest"
        allowAll={false}
      />,
      { wrapper: at("/some-page?pscope=y:2008") },
    );
    expect(picker()).toHaveTextContent("2008");
    expect(screen.getByRole("button", { name: "Latest" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
