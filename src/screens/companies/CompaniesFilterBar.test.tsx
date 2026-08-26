// The /companies filter-bar and chip WRAPPERS — the wiring neither shared suite can see.
//
// The shared components are tested with synthetic labels, so nothing there can catch a
// /companies wrapper that hands them /persons' strings or /persons' id prefix — which would
// ship „Показани са само:" framing over a company list with a colliding element id, rendering
// correctly, with every other test green.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ⚠️ `t` ECHOES THE KEY, and without this every rendered assertion in this file is vacuous.
// react-i18next's no-instance `t` returns `defaultValue` and never reads the key, and after the
// BG copy was aligned across the two pages EVERY chip fallback is byte-identical to its /persons
// twin — so a component wired to the wrong label set renders identically. Mutation-proved during
// review: swapping the chip labels left all seven original cases green. Echoing the key makes
// „does this component use the /companies strings?" an observable question again.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "bg", changeLanguage: () => {} },
  }),
}));
import { CompaniesFilterBar } from "./CompaniesFilterBar";
import { CompaniesActiveFilters } from "./CompaniesActiveFilters";
import { PersonsFilterBar } from "@/screens/persons/PersonsFilterBar";
import { COMPANY_FILTER_ALL } from "@/data/companies/useUrlCompanyFilters";
import {
  COMPANIES_CHIP_LABELS,
  COMPANIES_FILTER_BAR_LABEL,
  COMPANIES_SEARCH_LABELS,
  COMPANIES_REGISTRY_ID_PREFIX,
} from "./companiesBrowseConstants";
import {
  PERSONS_CHIP_LABELS,
  PERSONS_FILTER_BAR_LABEL,
  PERSONS_SEARCH_LABELS,
  PERSONS_REGISTRY_ID_PREFIX,
} from "@/screens/persons/personsBrowseConstants";

const selects = [
  {
    key: "class",
    label: "ВИД",
    allLabel: "Всички видове",
    value: COMPANY_FILTER_ALL,
    options: [{ value: "coop", label: "кооперация", count: 2_708 }],
    onChange: () => {},
  },
];
const toggles = [
  {
    key: "money",
    label: "с публични средства",
    checked: false,
    onChange: () => {},
  },
];

describe("CompaniesFilterBar", () => {
  it("renders its pickers and toggles as LABELLED controls", () => {
    render(<CompaniesFilterBar selects={selects} toggles={toggles} />);
    expect(screen.getByRole("combobox", { name: "ВИД" })).toBeInTheDocument();
    expect(screen.getByLabelText("с публични средства")).toBeInTheDocument();
  });

  it("names the section for a screen reader", () => {
    render(<CompaniesFilterBar selects={selects} toggles={toggles} />);
    // The KEY, not „Филтри" — which /persons renders too.
    expect(
      screen.getByRole("region", { name: "companies_filters_label" }),
    ).toBeInTheDocument();
  });

  it("⚠️ does not share an id prefix with the persons bar", () => {
    // Both wrappers hard-code their prefix. A copy-paste leaving `idPrefix="persons"` here
    // passes every other test, and breaks `aria-labelledby` on BOTH bars the moment they
    // share a tree.
    const { container } = render(
      <>
        <PersonsFilterBar selects={selects} toggles={[]} />
        <CompaniesFilterBar selects={selects} toggles={[]} />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("[id]")).map((e) => e.id);
    expect(ids.some((i) => i.startsWith("persons-filter-class-"))).toBe(true);
    expect(ids.some((i) => i.startsWith("companies-filter-class-"))).toBe(true);
  });

  it("passes the COMPANY sentinel, so the all-item matches an unset picker", () => {
    // If the wrong sentinel reached the select, `value` would match no item and Radix would
    // render an EMPTY trigger over an unfiltered table.
    render(<CompaniesFilterBar selects={selects} toggles={[]} />);
    expect(screen.getByRole("combobox").textContent).toMatch(/Всички видове/);
  });
});

describe("CompaniesActiveFilters", () => {
  it("renders the framing and the chip", () => {
    render(
      <CompaniesActiveFilters
        chips={[
          {
            id: "class",
            dimension: "Вид",
            label: "кооперация",
            onRemove: () => {},
          },
        ]}
        onClearAll={() => {}}
      />,
    );
    // ⚠️ KEYS, not strings. Both pages render „Показани са само:" and „Премахни филтъра", so a
    // string assertion here passes with the /persons label set wired in.
    expect(screen.getByText("companies_active_filters")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "companies_remove_filter Вид: кооперация",
      }),
    ).toBeInTheDocument();
  });

  it("⚠️ prints an unresolvable obshtina code rather than nothing", () => {
    // `?obshtina` has no picker and no producer, so this chip is the ONLY surface the
    // dimension has. A filter applied and named nowhere is the state the component exists to
    // end — and the code must NOT be folded through canonicalObshtina(), which maps SOF00 to
    // SFO_CITY and matches zero rows in this corpus.
    render(
      <CompaniesActiveFilters
        chips={[
          {
            id: "obshtina",
            dimension: "Община",
            label: "SOF46",
            onRemove: () => {},
          },
        ]}
        onClearAll={() => {}}
      />,
    );
    expect(screen.getByText("SOF46")).toBeInTheDocument();
  });

  it("uses the companies id prefix", () => {
    const { container } = render(
      <CompaniesActiveFilters
        chips={[{ id: "a", label: "Варна", onRemove: () => {} }]}
        onClearAll={() => {}}
      />,
    );
    expect(
      container
        .querySelector('[role="group"]')!
        .getAttribute("aria-labelledby"),
    ).toMatch(/^companies-active-filters-/);
  });
});

// ── THE KEYS, not the rendered strings ────────────────────────────────────────────────────
//
// ⚠️ EVERY RENDERED ASSERTION ABOVE IS BLIND TO A WRONG i18n KEY, and this block is why it is
// not the only coverage. With no i18n instance mounted, react-i18next's `t` returns
// `defaultValue` without ever reading the key — and most /companies fallbacks are byte-identical
// to their /persons twins („Показани са само:", „Премахни филтъра", „Филтри", „Изчисти
// търсенето"). So wiring any /companies component to the /persons label set renders identically
// and passes every rendered assertion. Mutation-proved during review: swapping the chip labels
// left all seven cases green; only mutating `idPrefix` failed.
//
// The keys are the only thing that differs, so the keys are what these assert.

describe("the label wiring", () => {
  it("every /companies key is a companies_* key", () => {
    const keys = [
      ...Object.values(COMPANIES_CHIP_LABELS).map((l) => l.key),
      ...Object.values(COMPANIES_SEARCH_LABELS).map((l) => l.key),
      COMPANIES_FILTER_BAR_LABEL.key,
    ];
    for (const k of keys)
      expect(
        k === "contracts_clear_filters" || k.startsWith("companies_"),
        `${k} is neither a companies_* key nor the shared clear-filters one`,
      ).toBe(true);
  });

  it("⚠️ shares NO key with the /persons label sets, except the deliberate one", () => {
    // The copy-paste this catches. `contracts_clear_filters` is shared ON PURPOSE — „Изчисти
    // филтрите" is the same sentence on every browser and was already translated for
    // /procurement/contracts — so it is named here rather than allowed through by a loose rule.
    const SHARED_ON_PURPOSE = new Set(["contracts_clear_filters"]);
    const persons = new Set([
      ...Object.values(PERSONS_CHIP_LABELS).map((l) => l.key),
      ...Object.values(PERSONS_SEARCH_LABELS).map((l) => l.key),
      PERSONS_FILTER_BAR_LABEL.key,
    ]);
    const companies = [
      ...Object.values(COMPANIES_CHIP_LABELS).map((l) => l.key),
      ...Object.values(COMPANIES_SEARCH_LABELS).map((l) => l.key),
      COMPANIES_FILTER_BAR_LABEL.key,
    ];
    for (const k of companies)
      if (!SHARED_ON_PURPOSE.has(k))
        expect(persons.has(k), `${k} is also a /persons key`).toBe(false);
  });

  it("the two label sets have the SAME SHAPE, so neither page can be missing a string", () => {
    // A shared component takes every string as a required field, so a missing one is a type
    // error — but a set copied wholesale from the sibling and then half-edited is not.
    expect(Object.keys(COMPANIES_CHIP_LABELS).sort()).toEqual(
      Object.keys(PERSONS_CHIP_LABELS).sort(),
    );
    expect(Object.keys(COMPANIES_SEARCH_LABELS).sort()).toEqual(
      Object.keys(PERSONS_SEARCH_LABELS).sort(),
    );
  });

  it("the two id prefixes differ", () => {
    expect(COMPANIES_REGISTRY_ID_PREFIX).not.toBe(PERSONS_REGISTRY_ID_PREFIX);
  });
});
