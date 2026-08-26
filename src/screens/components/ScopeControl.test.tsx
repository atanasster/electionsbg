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

// A picker with NO years in it. `/governance/declarations` is sliced by
// PARLIAMENT — 2024 held two, so no calendar year names one slice — and passes
// `years={[]}`, leaving "all" as the only option. Both of the picker's default
// words then name a dimension it does not offer: the trigger says „Години" and
// its sole item says „Всички години", on a register whose spans are parliaments.
// Nothing else on the page contradicts either, so the reader is told the register
// is sliced by year and simply cannot find the years.
//
// ⚠️ These assert on i18n KEYS, not on Bulgarian. The suite mounts an
// untranslated i18n, so `t("procurement_scope_all_years")` returns the key
// itself — a truthy string, so the `|| "All years"` fallbacks never fire either.
// Asserting `not.toContain("Всички години")` therefore passes against BOTH
// implementations and proves nothing; the key is the only value that actually
// discriminates here.
describe("a picker with no years", () => {
  const DECL_YEARS_LABEL = "Всички парламенти";
  const scopeFromUrl = (url: string): Scope =>
    (new URLSearchParams(url.split("?")[1] ?? "").get("pscope") as Scope) ||
    "ns";
  const YEARS_KEY = "procurement_scope_years";
  const ALL_YEARS_KEY = "procurement_scope_all_years";

  // CONTROLLED, like the real call site. An uncontrolled <ScopeControl years={[]}>
  // re-reads `?pscope` through its own bare useScope() and resolves it against the
  // FULL corpus band, so `y:2019` paints „2019" on a register with no year slices
  // while the page counts the selected parliament. Writing the fixture uncontrolled
  // would bake that shape into the suite as the reference usage.
  const declarations = (url: string, scope?: Scope) =>
    render(
      <ScopeControl
        years={[]}
        allowAll
        value={
          scope ??
          resolveScope(scopeFromUrl(url), { years: [], allowAll: true })
        }
        onChange={() => {}}
        nsLabelOverride="Този парламент"
        yearsLabelOverride={DECL_YEARS_LABEL}
      />,
      { wrapper: at(url) },
    );

  it("labels the picker with the override, not „Години“", () => {
    declarations("/governance/declarations");
    // The placeholder — what shows while the ns pill is the active one.
    expect(picker().textContent).toContain(DECL_YEARS_LABEL);
    expect(picker().textContent).not.toContain(YEARS_KEY);
    expect(picker()).toHaveAccessibleName(DECL_YEARS_LABEL);
  });

  it("labels the SELECTED scope with it too", () => {
    // The half a placeholder-only fix misses: with ?pscope=all the trigger stops
    // showing the placeholder and renders the active label instead, which was
    // still the hard-coded „Всички години".
    declarations("/governance/declarations?pscope=all");
    expect(picker().textContent).toContain(DECL_YEARS_LABEL);
    expect(picker().textContent).not.toContain(ALL_YEARS_KEY);
  });

  it("leaves „Всички години“ alone when the picker HAS years", () => {
    // The override names the year KIND for a caller that has years, so reusing it
    // for the aggregate would print that kind where "all of them" belongs. This is
    // the mutation check on the `yearList.length === 0` condition: delete it and
    // this fails while both tests above still pass.
    render(
      <ScopeControl
        years={AGRI_YEARS}
        allowAll
        nsLabelOverride="Последна година"
        yearsLabelOverride="Финансови години"
      />,
      { wrapper: at("/subsidies?pscope=all") },
    );
    expect(picker().textContent).toContain(ALL_YEARS_KEY);
    expect(picker().textContent).not.toContain("Финансови години");
  });
  it("does not stutter when the override IS the only option", () => {
    // Here the override and the selected label are the same words, so appending the
    // value unconditionally announces „Всички парламенти: Всички парламенти". Which of
    // the two scopes is live is carried by the PILL's `aria-pressed`, not by this
    // trigger, so the label has nothing to add in that case.
    declarations("/governance/declarations?pscope=all");
    expect(picker()).toHaveAccessibleName(DECL_YEARS_LABEL);
  });

  it("announces the SELECTED YEAR on a picker that has years", () => {
    // `aria-label` overrides the trigger's content, so a bare dimension word announces
    // identically in every scope: on /culture?pscope=y:2024 the trigger reads „2024"
    // and used to announce „Години", i.e. the one fact a non-sighted reader needs was
    // the one suppressed.
    render(<ScopeControl years={CULTURE_YEARS} allowAll={false} />, {
      wrapper: at("/culture?pscope=y:2024"),
    });
    expect(picker().getAttribute("aria-label")).toContain("2024");
  });

  it("renders NO picker at all when there is nothing to pick", () => {
    // `years={[]}` is a supported shape now, so `allowAll={false}` beside it would
    // otherwise give a focusable trigger opening an empty popover.
    render(
      <ScopeControl
        years={[]}
        allowAll={false}
        value="ns"
        onChange={() => {}}
        nsLabelOverride="Този парламент"
      />,
      { wrapper: at("/governance/declarations") },
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Този парламент" }),
    ).toBeInTheDocument();
  });
});
