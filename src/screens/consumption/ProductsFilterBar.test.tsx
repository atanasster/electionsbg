// The /consumption/products filter-bar, chip and search WRAPPERS — the wiring no shared suite
// can see.
//
// The shared registry components are tested with synthetic labels, so nothing there can catch a
// products wrapper that hands them /persons' or /companies' strings, or their id prefix — which
// would ship a company-shaped framing over a product list with a colliding element id,
// rendering correctly, with every other test green.

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// ⚠️ `t` ECHOES THE KEY, and without this every rendered assertion in this file is vacuous.
// react-i18next's no-instance `t` returns `defaultValue` and never reads the key — and the
// products fallbacks „Търси", „Изчисти търсенето", „например", „Филтри", „Показани са само:"
// and „Премахни филтъра" are byte-identical to their /persons and /companies twins. So a
// component wired to the wrong label set renders identically. Echoing the key makes „does this
// component use the products strings?" an observable question again.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "bg", changeLanguage: () => {} },
  }),
}));
import { ProductsFilterBar } from "./ProductsFilterBar";
import { ProductsActiveFilters } from "./ProductsActiveFilters";
import { ProductsSearchField } from "./ProductsSearchField";
import { CompaniesFilterBar } from "@/screens/companies/CompaniesFilterBar";
import {
  PRODUCT_FILTER_ALL,
  PRODUCT_UNITS,
  PRODUCT_TRENDS,
} from "@/data/prices/useUrlProductFilters";
import {
  PRODUCTS_CHIP_LABELS,
  PRODUCTS_FILTER_BAR_LABEL,
  PRODUCTS_SEARCH_LABELS,
  PRODUCTS_REGISTRY_ID_PREFIX,
  PRODUCT_UNIT_LABELS,
  PRODUCT_TREND_LABELS,
} from "./productsBrowseConstants";
import {
  COMPANIES_CHIP_LABELS,
  COMPANIES_FILTER_BAR_LABEL,
  COMPANIES_SEARCH_LABELS,
} from "@/screens/companies/companiesBrowseConstants";
import {
  PERSONS_CHIP_LABELS,
  PERSONS_FILTER_BAR_LABEL,
  PERSONS_SEARCH_LABELS,
} from "@/screens/persons/personsBrowseConstants";

const selects = [
  {
    key: "group",
    label: "ГРУПА",
    allLabel: "Всички групи",
    value: PRODUCT_FILTER_ALL,
    options: [{ value: "12", label: "Прясно мляко", count: 1_204 }],
    onChange: () => {},
  },
];
const toggles = [
  {
    key: "multi",
    label: "в поне 2 вериги",
    checked: false,
    onChange: () => {},
  },
];

describe("ProductsFilterBar", () => {
  it("renders its pickers and toggles as LABELLED controls", () => {
    // The whole reason the bar moved OUT of DbDataTable's toolbar. In the toolbar the group
    // picker was an unlabelled Radix trigger whose only text was its own selected value, so a
    // screen-reader user heard „Мляко" with no indication of which dimension it filtered.
    render(<ProductsFilterBar selects={selects} toggles={toggles} />);
    expect(screen.getByRole("combobox", { name: "ГРУПА" })).toBeInTheDocument();
    expect(screen.getByLabelText("в поне 2 вериги")).toBeInTheDocument();
  });

  it("names the section for a screen reader", () => {
    render(<ProductsFilterBar selects={selects} toggles={toggles} />);
    // The KEY, not „Филтри" — which both sibling registries render too.
    expect(
      screen.getByRole("region", { name: "products_filters_label" }),
    ).toBeInTheDocument();
  });

  it("⚠️ does not share an id prefix with a sibling registry's bar", () => {
    // Both wrappers hard-code their prefix. A copy-paste leaving `idPrefix="companies"` here
    // passes every other test, and breaks `aria-labelledby` on BOTH bars the moment they share
    // a tree.
    const { container } = render(
      <>
        <CompaniesFilterBar selects={selects} toggles={[]} />
        <ProductsFilterBar selects={selects} toggles={[]} />
      </>,
    );
    const ids = Array.from(container.querySelectorAll("[id]")).map((e) => e.id);
    expect(ids.some((i) => i.startsWith("companies-filter-group-"))).toBe(true);
    expect(ids.some((i) => i.startsWith("products-filter-group-"))).toBe(true);
  });

  it("passes the PRODUCT sentinel, so the all-item matches an unset picker", () => {
    // If the wrong sentinel reached the select, `value` would match no item and Radix would
    // render an EMPTY trigger — not the placeholder, empty — over an unfiltered table.
    render(<ProductsFilterBar selects={selects} toggles={[]} />);
    expect(screen.getByRole("combobox").textContent).toMatch(/Всички групи/);
  });
});

describe("ProductsActiveFilters", () => {
  it("renders the framing and a dimension-qualified chip", () => {
    render(
      <ProductsActiveFilters
        chips={[
          {
            id: "group",
            dimension: "Група",
            label: "Прясно мляко",
            onRemove: () => {},
          },
        ]}
        onClearAll={() => {}}
      />,
    );
    // ⚠️ KEYS, not strings — all three pages render „Показани са само:".
    expect(screen.getByText("products_active_filters")).toBeInTheDocument();
    // The DIMENSION is in the accessible name: „Прясно мляко ×" alone tells a screen-reader
    // user a value and not which axis it filters, and this page has three select axes.
    expect(
      screen.getByRole("button", {
        name: "products_remove_filter Група: Прясно мляко",
      }),
    ).toBeInTheDocument();
  });

  it("uses the products id prefix", () => {
    const { container } = render(
      <ProductsActiveFilters
        chips={[{ id: "a", label: "Поскъпнали", onRemove: () => {} }]}
        onClearAll={() => {}}
      />,
    );
    expect(
      container
        .querySelector('[role="group"]')!
        .getAttribute("aria-labelledby"),
    ).toMatch(new RegExp(`^${PRODUCTS_REGISTRY_ID_PREFIX}-active-filters-`));
  });
});

describe("ProductsSearchField", () => {
  it("is a named search landmark with this page's own strings", () => {
    render(
      <ProductsSearchField
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        applied=""
        minChars={3}
        tableVisible
      />,
    );
    expect(
      screen.getByRole("search", { name: "products_search_label" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("products_search_placeholder"),
    ).toBeInTheDocument();
  });

  it("⚠️ says the box and the results disagree, which is what committing on submit costs", () => {
    // The reader has typed past what the table is showing. Without this line the page renders
    // stale results beside a changed box and nothing says why.
    render(
      <ProductsSearchField
        value="олио"
        onChange={() => {}}
        onSubmit={() => {}}
        applied=""
        minChars={3}
        tableVisible
      />,
    );
    expect(
      screen.getAllByText("products_search_pending").length,
    ).toBeGreaterThan(0);
  });
});

// ── THE KEYS, not the rendered strings ────────────────────────────────────────────────────
//
// ⚠️ EVERY RENDERED ASSERTION ABOVE IS BLIND TO A WRONG i18n KEY, and this block is why it is
// not the only coverage. With no i18n instance mounted, `t` returns `defaultValue` without ever
// reading the key, and most products fallbacks are byte-identical to their two siblings'. So
// wiring any products component to another page's label set renders identically and passes
// every rendered assertion. The keys are the only thing that differs.

describe("the label wiring", () => {
  it("every products key is a products_* key", () => {
    const keys = [
      ...Object.values(PRODUCTS_CHIP_LABELS).map((l) => l.key),
      ...Object.values(PRODUCTS_SEARCH_LABELS).map((l) => l.key),
      ...Object.values(PRODUCT_UNIT_LABELS).map((l) => l.key),
      ...Object.values(PRODUCT_TREND_LABELS).map((l) => l.key),
      PRODUCTS_FILTER_BAR_LABEL.key,
    ];
    for (const k of keys)
      expect(
        k === "contracts_clear_filters" || k.startsWith("products_"),
        `${k} is neither a products_* key nor the shared clear-filters one`,
      ).toBe(true);
  });

  it("⚠️ shares NO key with either sibling label set, except the deliberate one", () => {
    // `contracts_clear_filters` is shared ON PURPOSE — „Изчисти филтрите" is the same sentence
    // on every browser and was already translated for /procurement/contracts — so it is named
    // here rather than allowed through by a loose rule.
    const SHARED_ON_PURPOSE = new Set(["contracts_clear_filters"]);
    const siblings = new Set([
      ...Object.values(PERSONS_CHIP_LABELS).map((l) => l.key),
      ...Object.values(PERSONS_SEARCH_LABELS).map((l) => l.key),
      PERSONS_FILTER_BAR_LABEL.key,
      ...Object.values(COMPANIES_CHIP_LABELS).map((l) => l.key),
      ...Object.values(COMPANIES_SEARCH_LABELS).map((l) => l.key),
      COMPANIES_FILTER_BAR_LABEL.key,
    ]);
    const products = [
      ...Object.values(PRODUCTS_CHIP_LABELS).map((l) => l.key),
      ...Object.values(PRODUCTS_SEARCH_LABELS).map((l) => l.key),
      PRODUCTS_FILTER_BAR_LABEL.key,
    ];
    for (const k of products)
      if (!SHARED_ON_PURPOSE.has(k))
        expect(siblings.has(k), `${k} is also a sibling registry's key`).toBe(
          false,
        );
  });

  it("⚠️ every unit and every trend the URL accepts has a label", () => {
    // A vocabulary member with no entry renders `undefined` through `t()` — or throws on the
    // chip path, which reads `PRODUCT_UNIT_LABELS[f.unit].key` unguarded. The URL hook validates
    // against these same unions, so a value can reach the screen the moment it is added there.
    for (const u of PRODUCT_UNITS) expect(PRODUCT_UNIT_LABELS[u]).toBeTruthy();
    for (const v of PRODUCT_TRENDS)
      expect(PRODUCT_TREND_LABELS[v]).toBeTruthy();
    // …and nothing EXTRA, so the empty-string net_unit (11,105 browsable rows, canon's `null`)
    // cannot acquire a label and thereby a picker option Radix would refuse to render.
    expect(Object.keys(PRODUCT_UNIT_LABELS).sort()).toEqual(
      [...PRODUCT_UNITS].sort(),
    );
    expect(Object.keys(PRODUCT_TREND_LABELS).sort()).toEqual(
      [...PRODUCT_TRENDS].sort(),
    );
  });
});
